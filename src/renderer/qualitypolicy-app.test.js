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

// ---------- Escada por congestao (plano 2026-10-25), Tarefa 2 ----------
// updateScreenResolution de producao, com screenres real: quem conta como
// enviando, o log da troca e o aquecimento da PC nova.
function setupEscada() {
  const base = setup();
  const logs = [];
  Object.assign(base.ctx, {
    appliedScreenEncoding: new Map(),
    console: { log: (s) => logs.push(String(s)), warn() {}, info() {} },
  });
  vm.runInContext(functionSource('updateScreenResolution'), base.ctx);
  return { ...base, logs };
}

/** Uma linha de sender de tela com folga (uso 0,3) e 1000 pacotes no tick. */
const linhaFolga = (peerId, kind, pc) => ({
  peerId, kind, pc, name: peerId, availableBps: 1_500_000, mbps: 0.45, fps: 30,
  sentDelta: 1000, lostDelta: 0, rtt: 30, limitation: null,
});

/** Estado ja aquecido em 540p, para a folga poder subir um degrau. */
function semear(ctx, key, pc) {
  ctx.screenResolution.set(key, { ...screenres.initialState(1080, -60_000), height: 540, bweBps: 1_500_000, pc });
}

function ticks(ctx, linha, segundos) {
  for (let t = 0; t < segundos; t += 1) ctx.updateScreenResolution([linha], t * 1000);
}

test('escada: alvo direto com a tela pausada nao anda', () => {
  const { ctx } = setupEscada();
  const pc = {};
  semear(ctx, 'a:screen', pc);
  ctx.sharePaused = true;
  ticks(ctx, linhaFolga('a', 'screen', pc), 20);
  const st = ctx.screenResolution.get('a:screen');
  assert.equal(st.height, 540);
  assert.equal(st.folgaMs, 0);
});

test('escada: repasse segue adaptando com a propria tela pausada', () => {
  const { ctx } = setupEscada();
  const pc = {};
  semear(ctx, 'a:screen@b', pc);
  ctx.sharePaused = true;
  ticks(ctx, linhaFolga('a', 'screen@b', pc), 16);
  assert.equal(ctx.screenResolution.get('a:screen@b').height, 720);
});

test('escada: demanda suspensa nao anda', () => {
  const { ctx, mesh } = setupEscada();
  const pc = {};
  semear(ctx, 'a:screen', pc);
  mesh.peers.get('a').suspended = { screen: true };
  ticks(ctx, linhaFolga('a', 'screen', pc), 20);
  assert.equal(ctx.screenResolution.get('a:screen').height, 540);
  assert.equal(ctx.screenResolution.get('a:screen').folgaMs, 0);
});

test('escada: a linha [qualidade] sai so no tick da troca, com o motivo', () => {
  const { ctx, logs } = setupEscada();
  const pc = {};
  semear(ctx, 'a:screen', pc);
  ticks(ctx, linhaFolga('a', 'screen', pc), 20);
  const linhas = logs.filter((s) => s.startsWith('[qualidade] tela->'));
  assert.deepEqual(linhas, ['[qualidade] tela->a: 540p -> 720p (tentativa: encoder usando 30% da bwe, 15s de folga)']);
});

test('escada: PC nova comeca em aquecimento', () => {
  const { ctx } = setupEscada();
  const velha = {};
  semear(ctx, 'a:screen', velha);
  const nova = {};
  ctx.updateScreenResolution([linhaFolga('a', 'screen', nova)], 42_000);
  const st = ctx.screenResolution.get('a:screen');
  assert.equal(st.pc, nova);
  assert.equal(st.desdeMs, 42_000);
  assert.equal(st.height, 1080);
});

test('escada: a carencia do peerquality usa o estado da escada', () => {
  // O bloco do peerquality vive dentro do updateStats; o contrato e a linha.
  assert.match(app, /senderBandwidthLimited: limByPeer\.get\(key\) === 'bandwidth'\n\s+&& !screenres\.emCarencia\(screenResolution\.get\(key\), now\),/);
});

// ---------- Escada por congestao (plano 2026-10-25), Tarefa 3 ----------
// logEncodeDiag de producao: perda (da janela da escada), rtt, uso e o
// motivo recente da troca chegam na linha [diag].
function setupDiag() {
  const base = setup();
  const linhas = [];
  Object.assign(base.ctx, {
    encodediag: require('./encodediag'),
    isSoftwareEncoder: require('./encodehealth').isSoftwareEncoder,
    appliedScreenEncoding: new Map(),
    diagPrev: new Map(),
    console: { log: (s) => linhas.push(String(s)), warn: (s) => linhas.push(String(s)), info() {} },
  });
  vm.runInContext(functionSource('logEncodeDiag'), base.ctx);
  return { ...base, linhas };
}

const linhaDiag = (extra = {}) => ({
  peerId: 'a', kind: 'screen', name: 'a', encoder: 'NvCodecH264Encoder', powerEfficient: true,
  captureFps: 30, width: 1280, height: 720, fps: 30, mbps: 1.2, msPerFrame: 5,
  availableBps: 1_500_000, rttRtcp: 41.6, rtt: 30, ...extra,
});

test('diag: perda da janela, rtt do RTCP e uso saem na linha', () => {
  const { ctx, linhas } = setupDiag();
  ctx.appliedScreenEncoding.set('a:screen', { maxBitrate: 1_800_000, scaleDownBy: 1.5, height: 720, bweBps: 1_500_000 });
  ctx.screenResolution.set('a:screen', { ...screenres.initialState(1080, 0), perda: 0.012 });
  ctx.logEncodeDiag([linhaDiag()], 1000);
  assert.match(linhas[0], / perda=1\.2% rtt=42ms uso=80%$/);
});

test('diag: sem BWE nem estado da escada, os campos viram ?', () => {
  const { ctx, linhas } = setupDiag();
  ctx.appliedScreenEncoding.set('a:screen', { maxBitrate: 1_800_000, scaleDownBy: 1, height: 720, bweBps: null });
  ctx.logEncodeDiag([linhaDiag({ availableBps: null, rttRtcp: null, rtt: null })], 1000);
  assert.match(linhas[0], / perda=\?% rtt=\?ms uso=\?%$/);
});

test('diag: a linha MUDOU leva o motivo recente da troca de degrau', () => {
  const { ctx, linhas } = setupDiag();
  ctx.screenResolution.set('a:screen', {
    ...screenres.initialState(1080, 0), ultimoMotivo: 'tentativa: encoder usando 30% da bwe, 15s de folga', ultimoMotivoMs: 900,
  });
  ctx.appliedScreenEncoding.set('a:screen', { maxBitrate: 1_800_000, scaleDownBy: 2, height: 540, bweBps: 1_500_000 });
  ctx.logEncodeDiag([linhaDiag()], 1000);
  ctx.appliedScreenEncoding.set('a:screen', { maxBitrate: 1_800_000, scaleDownBy: 1.5, height: 720, bweBps: 1_500_000 });
  ctx.logEncodeDiag([linhaDiag()], 2000);
  assert.doesNotMatch(linhas[0], /motivo=/, 'a primeira linha nao e MUDOU');
  assert.match(linhas[1], /^\[diag\] MUDOU .* motivo="tentativa: encoder usando 30% da bwe, 15s de folga"$/);
});
