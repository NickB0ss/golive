'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
require('./networktiming');
const meshModule = require('./mesh');
const config = require('./config');
const qualitypolicy = require('./qualitypolicy');
const peerquality = require('./peerquality');
const screenres = require('./screenres');
const sourceswap = require('./sourceswap');
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

// Executa as funcoes de producao, sem carregar o DOM do app nem manter uma
// segunda implementacao da politica. Os limites sao as declaracoes do arquivo.
function functionSource(name) {
  const start = app.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  const end = app.indexOf('\n  }', start);
  return app.slice(start, end + 4);
}

function setup() {
  const mesh = meshModule.createMesh({ send() {}, onTrack() {}, onPeerState() {} });
  const track = { kind: 'video', readyState: 'live' };
  for (const id of ['a', 'b', 'c']) {
    mesh.addPeer(id, id);
    const sender = { track, replaceTrack(next) {
      return Promise.resolve().then(() => { this.track = next; });
    } };
    mesh.peers.get(id).outConns.screen = { getSenders: () => [sender] };
  }
  const session = { mesh, sig: { send() {} } };
  const applied = [];
  const ctx = vm.createContext({
    config, qualitypolicy, peerquality, screenres, sourceswap, parseKind: meshModule.parseKind,
    cfg: config.load(null), currentSession: session, localStream: { getVideoTracks: () => [track] },
    captureTrack: { getSettings: () => ({ width: 1920, height: 1080 }) },
    sharePaused: false, originTree: { screen: { assignments: new Map() } },
    myRole: { screen: new Map(), camera: new Map() }, plannedScreenOffers: new Map(),
    autoQuality: { steps: 0 }, meshFallback: { screen: false }, peerQuality: new Map(),
    screenResolution: new Map(), reapplyAudienceQuality: () => applied.push(ctx.qualityFor('screen').preset),
    enforceSharePauseFor() {},
  });
  const names = ['localScreenLoad', 'qualityFor', 'qualityForPeer', 'screenSourceSize',
    'screenEncodingForPeer', 'normalizeEncodeHealth', 'offerOwnStreamTo'];
  vm.runInContext(names.map(functionSource).join('\n'), ctx);
  return { ctx, session, mesh, applied, track };
}

test('app liga GoLive.qualitypolicy antes de app.js no boot', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.ok(html.indexOf('src="qualitypolicy.js"') < html.indexOf('src="app.js"'));
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'qualitypolicy.js'), 'utf8'), { window });
  assert.equal(typeof window.GoLive.qualitypolicy.screenSenderLoad, 'function');
  assert.match(app.slice(0, app.indexOf('} = window.GoLive;')), /qualitypolicy/);
});

test('view-state real reaplica watch/suspend/resume sem nenhum tick de stats', async () => {
  const { ctx, mesh, session, applied, track } = setup();
  const reappliedTracks = [];
  ctx.reapplyAudienceQuality = () => {
    applied.push(ctx.qualityFor('screen').preset);
    reappliedTracks.push(mesh.peers.get('c').outConns.screen.getSenders()[0].track);
  };
  Object.assign(ctx, {
    mesh, session, sig: session.sig, myId: 'eu', KINDS: ['screen', 'camera'],
    isKnownKind: () => true, filhosQueDemosA: () => 0, recomputeTree() {},
    normalizeReceiveHealth: () => null, trackForKind: () => track,
    lookingKey: (...parts) => parts.join('|'), lookingByViewer: new Map(),
    broadcastWatchers() {}, renderMembersPanel() {}, broadcastViewState() {},
    console: { info() {} },
  });
  const start = app.indexOf("      case 'view-state': {");
  const end = app.indexOf('      // Um espectador cuja tela', start);
  vm.runInContext(`async function receive(msg) { switch (msg.type) { ${app.slice(start, end)} } }`, ctx);
  assert.equal(ctx.qualityFor('screen').preset, '1080p30');
  await ctx.receive({ type: 'view-state', from: 'c', kind: 'screen', watching: false });
  assert.equal(ctx.localScreenLoad().total, 2);
  assert.equal(applied.at(-1), '1080p60');
  await ctx.receive({ type: 'view-state', from: 'c', kind: 'screen', watching: true, looking: false,
    encodeHealth: { msPerFrame: 20, load: 0.6 } });
  assert.equal(applied.at(-1), '1080p30');
  assert.equal(reappliedTracks.at(-1), track, 'retune depois de replaceTrack resolver sem tick de stats');
  assert.equal(mesh.peers.get('c').encodeHealth.load, 0.6);
});

test('tree real fecha folhas e reaplica custo local; oferta explicita deduplica', async () => {
  const { ctx, mesh, session, applied } = setup();
  Object.assign(ctx, { myId: 'eu', broadcastWatchers() {} });
  mesh.offerTo = async (id, stream, quality) => {
    applied.push(quality.preset);
    return true;
  };
  vm.runInContext(functionSource('applyOriginAssignments'), ctx);
  const assignments = new Map([
    ['a', { role: 'relay', paiId: 'eu', filhosIds: ['b', 'c'] }],
    ['b', { role: 'folha', paiId: 'a', filhosIds: [] }],
    ['c', { role: 'folha', paiId: 'a', filhosIds: [] }],
  ]);
  // closeOut usa close() de uma PC; a bancada so precisa fechar o slot.
  mesh.closeOut = (id, kind) => { delete mesh.peers.get(id).outConns[kind]; };
  ctx.originTree.screen.assignments = assignments;
  ctx.applyOriginAssignments(session, 'screen', assignments, 1);
  assert.equal(applied.at(-1), '1080p60');
  assert.equal(ctx.localScreenLoad().total, 1);
  await ctx.offerOwnStreamTo(session, 'b', ctx.localStream, config.qualityFromPreset('1080p60'), 'screen');
  assert.equal(ctx.plannedScreenOffers.size, 0);
  assert.equal(ctx.localScreenLoad().total, 1);
});

test('pausa manual real reaplica antes e depois da retomada dos senders', async () => {
  const { ctx, session, mesh, applied } = setup();
  Object.assign(ctx, {
    orphanSession: null, shareAnnotations: false, shareReactions: false, myEncodeHealth: null,
    ui: { grid: { setPaused() {} }, setToggleState() {} }, t: (key) => key,
    showToast() {}, renderMembersPanel() {}, renderRoomStatus() {}, console,
  });
  session.sig.isOpen = () => false;
  vm.runInContext(functionSource('setSharePaused'), ctx);
  ctx.setSharePaused(true);
  await Promise.all([...mesh.peers.keys()].map((id) => mesh.demandApplied(id, 'screen')));
  await Promise.resolve();
  assert.equal(ctx.localScreenLoad().total, 0);
  ctx.plannedScreenOffers.set('new', { peerId: 'a', kind: 'screen' });
  assert.equal(ctx.localScreenLoad().total, 0, 'oferta de tela pausada nao planeja encoder');
  ctx.setSharePaused(false);
  await Promise.all([...mesh.peers.keys()].map((id) => mesh.demandApplied(id, 'screen')));
  await Promise.resolve();
  assert.equal(ctx.localScreenLoad().total, 3);
  assert.equal(applied.at(-1), '1080p30');
});

test('BWE lento e local ao sender; irmao saudavel mantem teto estatico do relay', () => {
  const { ctx, mesh } = setup();
  for (const peer of mesh.peers.values()) peer.outConns = {};
  ctx.localStream = null;
  ctx.myRole.screen.set('origem', { role: 'relay', filhosIds: ['a', 'b'] });
  ctx.screenResolution.set('a:screen@origem', { height: 720, bweBps: 700_000 });
  const floor = ctx.qualityFor('screen');
  const a = ctx.qualityForPeer('a', 'screen@origem');
  const b = ctx.qualityForPeer('b', 'screen@origem');
  assert.equal(a.preset, '1080p30');
  assert.equal(b.preset, '1080p30');
  const slow = ctx.screenEncodingForPeer('a', 'screen@origem', a, floor);
  const healthy = ctx.screenEncodingForPeer('b', 'screen@origem', b, floor);
  assert.ok(slow.maxBitrate < healthy.maxBitrate);
  assert.equal(healthy.maxBitrate, 6_000_000);
  mesh.peers.get('b').viewWidth = { 'screen@origem': 900 };
  assert.equal(ctx.qualityForPeer('b', 'screen@origem').preset, '720p30', 'viewport ainda limita conexao');
  ctx.autoQuality.steps = 1;
  assert.equal(ctx.qualityFor('screen').preset, '1080p30');
  ctx.meshFallback.screen = true;
  assert.equal(ctx.qualityFor('screen').preset, '720p30');
});

test('BWE da PC antiga nao limita uma reconexao antes da primeira amostra', () => {
  const { ctx, mesh } = setup();
  const pc = mesh.peers.get('a').outConns.screen;
  const floor = ctx.qualityFor('screen');
  ctx.screenResolution.set('a:screen', { pc, height: 720, bweBps: 700_000 });
  assert.ok(ctx.screenEncodingForPeer('a', 'screen', floor, floor).maxBitrate < 6_000_000);
  mesh.peers.get('a').outConns.screen = {};
  assert.equal(ctx.screenEncodingForPeer('a', 'screen', floor, floor).maxBitrate, 6_000_000);
});

test('fim da origem limpa plano apos dropRelaysOf real e reaplicador real restaura sender proprio', async () => {
  const { ctx, mesh, session, track } = setup();
  const kind = 'screen@origem';
  mesh.addPeer('origem', 'origem');
  mesh.peers.get('origem').live = true;
  for (const id of ['b', 'c']) {
    delete mesh.peers.get(id).outConns.screen;
    mesh.peers.get(id).outConns[kind] = {
      close() {}, getSenders: () => [{ track: null }],
    };
    mesh.peers.get(id).suspended = { [kind]: true };
  }
  const state = { role: 'relay', epoch: 1, paiId: 'origem', filhosIds: ['b', 'c'], relayed: new Set(['b', 'c']) };
  ctx.myRole.screen.set('origem', state);
  ctx.originTree.screen.assignments = new Map([...mesh.peers.keys()].map((id) =>
    [id, { role: id === 'a' ? 'direct' : 'folha' }]));
  const encodings = [];
  mesh.applyEncodingToPeer = (peerId, quality, senderKind) => {
    if (mesh.peers.get(peerId)?.outConns[senderKind]) encodings.push({ peerId, quality, kind: senderKind });
  };
  Object.assign(ctx, {
    mesh, session, KINDS: ['screen', 'camera'], relayKindFor: meshModule.relayKindFor,
    relayRetry: { cancel() {} }, relayRetryKey: (id, k) => `${id}:${k}`,
    cameraStream: null, appliedScreenEncoding: new Map(), lastCaptureKey: '',
    captureTrack: { ...track, getSettings: () => ({ width: 1920, height: 1080 }),
      applyConstraints: () => Promise.resolve() }, console,
    pendingTrees: {}, normalizeLimit: () => null,
    ui: { annotations: { setSurface() {} }, reactions: { setSurface() {} }, grid: { removeTile() {} } },
    annotate: { surfaceKey: () => 'origem:screen' }, playSoundEvent() {}, dropWatchers() {}, unwatchScreen() {},
    syncWatchedScreens() {}, renderMembersPanel() {},
  });
  const reapplyFunctions = ['applyScreenEncoding', 'reapplyAudienceQuality', 'dropRelaysOf'];
  vm.runInContext(reapplyFunctions.map(functionSource).join('\n'), ctx);
  assert.equal(ctx.localScreenLoad().total, 1);
  ctx.dropRelaysOf(session, 'screen', 'origem');
  assert.equal(mesh.peers.get('b').outConns[kind], null);
  assert.equal(ctx.localScreenLoad().total, 3, 'recuperacao transitoria ainda planeja dois repasses');
  ctx.reapplyAudienceQuality();
  assert.equal(encodings.at(-1).quality.fps, 30);
  const start = app.indexOf("      case 'broadcast-state': {");
  const end = app.indexOf('      // Um espectador avisando', start);
  vm.runInContext(`async function receiveBroadcast(msg) { switch (msg.type) { ${app.slice(start, end)} } }`, ctx);
  await ctx.receiveBroadcast({ type: 'broadcast-state', id: 'origem', live: false });
  assert.equal(ctx.localScreenLoad().total, 1, 'plano de origem encerrada nao degrada a nossa captura');
  assert.equal(ctx.qualityFor('screen').preset, '1080p60');
  assert.equal(encodings.at(-1).peerId, 'a');
  assert.equal(encodings.at(-1).kind, 'screen');
  assert.equal(encodings.at(-1).quality.fps, 60, 'reaplicador real restaurou o sender sem stats');
  assert.equal(state.filhosIds.length, 0);
  assert.equal(state.epoch, 1, 'encerra demanda sem apagar protecao contra tree antiga');
});
