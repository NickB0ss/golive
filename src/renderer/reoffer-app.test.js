'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('./networktiming');
const { createMesh, parseKind, relayKindFor } = require('./mesh');
const sourceswap = require('./sourceswap');
const { createRelayRetry } = require('./stallwatch');
const broadcastguards = require('./broadcastguards');
const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('  async function reofferOne(');
const end = source.indexOf('\n  function runLeafReoffer(', start);
assert.ok(start >= 0 && end > start);

function setup({ role = 'direct', hasOutbound = false, treeEnabled = true } = {}) {
  const calls = [];
  const peers = new Map([['viewer', { outConns: hasOutbound ? { screen: {} } : {} }]]);
  const mesh = { peers, isNegotiating: () => false,
    closeOut(id, kind) { calls.push(['close', id, kind]); delete peers.get(id).outConns[kind]; },
    async offerTo(id, stream, quality, kind) {
      calls.push(['offer', id, stream, quality, kind]);
      peers.get(id).outConns[kind] = {};
      return true;
    },
  };
  const track = { kind: 'video', readyState: 'live' };
  const stream = { getVideoTracks: () => [track] };
  const session = { mesh, sig: { isOpen: () => true } };
  const ctx = vm.createContext({
    currentSession: session, cfg: { network: { tree: treeEnabled } },
    localStream: stream, cameraStream: stream, KINDS: ['screen', 'camera'],
    parseKind, relayKindFor, broadcastguards,
    originTree: { screen: { assignments: new Map(role ? [['viewer', { role }]] : []) },
      camera: { assignments: new Map(role ? [['viewer', { role }]] : []) } },
    qualityFor: () => ({ preset: 'global' }),
    offerOwnStreamTo: (...args) => {
      const [active, id, media, , kind] = args;
      return active.mesh.offerTo(id, media, { preset: 'destinatario' }, kind);
    },
    enforceSharePauseFor: (active, id) => calls.push(['pause', active, id]),
    myRole: { screen: new Map(), camera: new Map() },
  });
  vm.runInContext(source.slice(start, end), ctx);
  return { ctx, session, mesh, calls, track, stream };
}

for (const role of ['direct', 'relay']) {
  test(`reoffer real recria conexao ausente de destinatario ${role}`, async () => {
    const f = setup({ role });
    assert.equal(await f.ctx.reofferOne(f.session, 'viewer', 'screen'), true);
    assert.equal(f.calls.filter(([type]) => type === 'offer').length, 1);
    assert.equal(f.calls.find(([type]) => type === 'offer')[3].preset, 'destinatario');
    assert.equal(f.calls.at(-1)[0], 'pause', 'reaplica pausa tambem em conexao nova');
  });
}

test('reoffer real nao cria envio direto para folha mesmo com conexao velha presente', async () => {
  const f = setup({ role: 'folha', hasOutbound: true });
  assert.equal(await f.ctx.reofferOne(f.session, 'viewer', 'screen'), false);
  assert.equal(f.calls.length, 0);
});

test('reoffer real exige atribuicao conhecida quando nao ha conexao na arvore', async () => {
  const f = setup({ role: null });
  assert.equal(await f.ctx.reofferOne(f.session, 'viewer', 'screen'), false);
  assert.equal(f.calls.length, 0);
});

test('reoffer real preserva recuperacao de conexao inicial antes da primeira atribuicao', async () => {
  const f = setup({ role: null, hasOutbound: true });
  assert.equal(await f.ctx.reofferOne(f.session, 'viewer', 'screen'), true);
});

test('reoffer real em malha recria conexao sem atribuicao de arvore', async () => {
  const f = setup({ role: null, treeEnabled: false });
  assert.equal(await f.ctx.reofferOne(f.session, 'viewer', 'screen'), true);
});

test('reoffer real recusa sessao antiga e peer removido antes de alterar conexoes', async () => {
  const f = setup({ hasOutbound: true });
  f.ctx.currentSession = {};
  assert.equal(await f.ctx.reofferOne(f.session, 'viewer', 'screen'), false);
  f.ctx.currentSession = f.session;
  f.mesh.peers.delete('viewer');
  assert.equal(await f.ctx.reofferOne(f.session, 'viewer', 'screen'), false);
  assert.equal(f.calls.length, 0);
});

test('reoffer real nao envia com sinalizacao fechada ou video encerrado', async () => {
  const f = setup({ hasOutbound: true });
  f.session.sig.isOpen = () => false;
  assert.equal(await f.ctx.reofferOne(f.session, 'viewer', 'screen'), false);
  f.session.sig.isOpen = () => true;
  f.track.readyState = 'ended';
  assert.equal(await f.ctx.reofferOne(f.session, 'viewer', 'screen'), false);
  assert.equal(f.calls.length, 0);
});

test('reoffer real de camera ausente respeita papel sem aplicar pausa da tela', async () => {
  const f = setup();
  assert.equal(await f.ctx.reofferOne(f.session, 'viewer', 'camera'), true);
  assert.equal(f.calls.some(([type]) => type === 'pause'), false);
});

test('conclusao de reoffer real obsoleto nao reaplica pausa na sessao nova', async () => {
  const f = setup({ hasOutbound: true });
  let finish;
  f.mesh.offerTo = () => new Promise(resolve => { finish = resolve; });
  const pending = f.ctx.reofferOne(f.session, 'viewer', 'screen');
  f.ctx.currentSession = {};
  finish(true);
  assert.equal(await pending, false);
  assert.equal(f.calls.some(([type]) => type === 'pause'), false);
});

test('reoffer real nao atropela negociacao ainda valida', async () => {
  const f = setup({ hasOutbound: true });
  f.mesh.isNegotiating = () => true;
  assert.equal(await f.ctx.reofferOne(f.session, 'viewer', 'screen'), false);
  assert.equal(f.calls.length, 0);
});

function realOutgoing(t, { falha = false, pausada = false } = {}) {
  const f = setup();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pcs = [];
  const tracksAoCriar = [];
  let falhasRestantes = falha === true ? Infinity : Number(falha);
  const anterior = global.RTCPeerConnection;
  t.after(() => { global.RTCPeerConnection = anterior; });
  global.RTCPeerConnection = class {
    constructor() { pcs.push(this); this.signalingState = 'stable'; this.canais = []; this.listeners = {}; }
    addEventListener(tipo, fn) { this.listeners[tipo] = fn; }
    close() { this.connectionState = 'closed'; }
    addTransceiver(track) {
      if (falhasRestantes > 0) {
        falhasRestantes -= 1;
        throw new Error('falha persistente no preparo');
      }
      tracksAoCriar.push(track);
      const kind = typeof track === 'string' ? track : track.kind;
      const sender = {
        track: typeof track === 'string' ? null : track,
        async replaceTrack(next) { this.track = next; },
        getParameters: () => ({}), async setParameters() {},
      };
      const canal = { sender, receiver: { track: { kind } } };
      this.canais.push(canal);
      return canal;
    }
    getSenders() { return this.canais.map((c) => c.sender); }
    getTransceivers() { return this.canais; }
    async createOffer() { return { type: 'offer', sdp: 'v=0' }; }
    async setLocalDescription(desc) { this.localDescription = desc; }
  };
  f.stream.getTracks = () => [f.track];
  Object.assign(f.ctx, {
    session: f.session, orphanSession: null, renderMembersPanel() {}, sourceswap,
    sharePaused: pausada, plannedScreenOffers: new Map(),
    reapplyAudienceQuality() {}, qualityForPeer: () => ({}),
    relayRetry: createRelayRetry(), relayRetryKey: (id, kind) => `${id}|${kind}`,
  });
  for (const name of ['isActiveSession', 'offerOwnStreamTo', 'enforceSharePauseFor', 'scheduleDirectRetry',
    'forgetOriginTree']) {
    const begin = source.indexOf(`  function ${name}(`);
    if (begin >= 0) vm.runInContext(source.slice(begin, source.indexOf('\n  }', begin) + 4), f.ctx);
  }
  const begin = source.indexOf('      onPeerState: ') + '      onPeerState: '.length;
  const end = source.indexOf('\n      },\n    });', begin);
  const onPeerState = vm.runInContext('(' + source.slice(begin, end + 8) + ')', f.ctx);
  const mesh = createMesh({
    send() {}, onTrack() {},
    onPeerState(id, state) {
      // Interrompe a regressao antiga, que de outro modo nunca devolveria o event loop ao teste.
      if (pcs.length < 15) onPeerState(id, state);
    },
  });
  mesh.addPeer('viewer', 'Viewer');
  f.session.mesh = mesh;
  return { ...f, mesh, pcs, tracksAoCriar, offer: () =>
    f.ctx.offerOwnStreamTo(f.session, 'viewer', f.stream, {}, 'screen') };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('a recuperacao pausada cria sender sem track e so transmite apos religar', async (t) => {
  const f = realOutgoing(t, { pausada: true });
  assert.equal(await f.ctx.reofferOne(f.session, 'viewer', 'screen'), true);
  const sender = f.pcs[0].getSenders()[0];
  assert.deepEqual(f.tracksAoCriar, ['video'], 'a captura nunca foi anexada durante a oferta pausada');
  assert.equal(sender.track, null);
  assert.equal(f.mesh.isPeerSuspended('viewer', 'screen'), true);
  f.mesh.setPeerDemand('viewer', 'screen', true, f.track);
  await f.mesh.demandApplied('viewer', 'screen');
  assert.equal(sender.track, f.track);
});

test('falha direta persistente devolve controle e limita a tres novas conexoes com backoff', async (t) => {
  const f = realOutgoing(t, { falha: true });
  await assert.rejects(f.offer(), /falha persistente/);
  await nextTurn();
  assert.equal(f.pcs.length, 1);
  for (const [i, ms] of [1000, 2000, 4000].entries()) {
    t.mock.timers.tick(ms - 1);
    await nextTurn();
    assert.equal(f.pcs.length, i + 1);
    t.mock.timers.tick(1);
    await nextTurn();
    assert.equal(f.pcs.length, i + 2);
  }
  t.mock.timers.tick(60000);
  await nextTurn();
  assert.equal(f.pcs.length, 4);
});

test('retry direto recupera falha inicial antes da primeira arvore e renova o prazo ao conectar', async (t) => {
  const f = realOutgoing(t, { falha: 1 });
  f.ctx.originTree.screen.assignments.clear();
  await assert.rejects(f.offer(), /falha persistente/);
  t.mock.timers.tick(1000);
  await nextTurn();
  const recuperada = f.pcs[1];
  assert.equal(recuperada.getSenders()[0].track, f.track);
  recuperada.connectionState = 'connected';
  recuperada.listeners.connectionstatechange();
  recuperada.connectionState = 'failed';
  recuperada.listeners.connectionstatechange();
  t.mock.timers.tick(1000);
  await nextTurn();
  assert.equal(f.pcs.length, 3, 'sem o reset ao conectar, esperaria 2 s');
  assert.equal(f.pcs[2].getSenders()[0].track, f.track);
});

for (const mudanca of ['folha', 'sem origem', 'peer saiu', 'sessao trocada', 'nova PC', 'outra transmissao']) {
  test(`retry direto abandona recuperacao obsoleta: ${mudanca}`, async (t) => {
    const f = realOutgoing(t, { falha: true });
    await assert.rejects(f.offer(), /falha persistente/);
    if (mudanca === 'folha') f.ctx.originTree.screen.assignments.set('viewer', { role: 'folha' });
    if (mudanca === 'sem origem') f.ctx.localStream = null;
    if (mudanca === 'peer saiu') f.mesh.removePeer('viewer');
    if (mudanca === 'sessao trocada') f.ctx.currentSession = {};
    if (mudanca === 'nova PC') f.mesh.peers.get('viewer').outConns.screen = {};
    if (mudanca === 'outra transmissao') {
      f.ctx.forgetOriginTree('screen');
      f.ctx.localStream = { ...f.stream };
      f.ctx.originTree.screen.assignments.set('viewer', { role: 'direct' });
    }
    t.mock.timers.tick(10000);
    await nextTurn();
    assert.equal(f.pcs.length, 1);
  });
}

// R-01 (auditoria 2026-11-25): o relay que nao olha a tela nao mede a propria
// entrada; o pedido da folha e o unico sinal de que ela congelou.
function setupRelay({ framesDecoded = [10, 10, 10, 10], hasInbound = true } = {}) {
  const sent = [];
  const relayed = [];
  const agora = 10000;
  const peers = new Map([
    ['folha', { outConns: { 'screen@O': {} }, inConns: {} }],
    ['O', { name: 'Origem', outConns: {}, inConns: hasInbound ? { screen: {} } : {} }],
  ]);
  const mesh = { peers, isNegotiating: () => false,
    closeOut(id, kind) { delete peers.get(id).outConns[kind]; },
    async relayTo(id, sourceId, kind) { relayed.push([id, sourceId, kind]); return true; },
  };
  const session = { mesh, sig: { isOpen: () => true, send: (m) => sent.push({ ...m }) } };
  const history = framesDecoded.map((n, i) => ({ at: agora - (framesDecoded.length - 1 - i) * 2000,
    sample: { framesDecoded: n } }));
  const ctx = vm.createContext({
    currentSession: session, cfg: { network: { tree: true } }, KINDS: ['screen', 'camera'],
    parseKind, relayKindFor, stallwatch: require('./stallwatch'), console: { warn() {}, info() {} },
    myRole: { screen: new Map([['O', { role: 'relay', filhosIds: ['folha'], relayed: new Set() }]]),
      camera: new Map() },
    relayRetry: createRelayRetry(), relayRetryKey: (id, kind) => `${id}|${kind}`,
    qualityForPeer: () => ({}), stallDiagByInput: new Map([['O|screen', history]]),
    relayInputReofferAt: new Map(), performance: { now: () => agora }, Date,
  });
  vm.runInContext(source.slice(start, end), ctx);
  return { ctx, session, sent, relayed };
}

test('R-01: relay com a entrada parada pede a entrada de volta a origem', async () => {
  const f = setupRelay();
  assert.equal(await f.ctx.reofferOne(f.session, 'folha', 'screen@O'), true);
  assert.deepEqual(f.sent, [{ type: 'reoffer', to: 'O', kind: 'screen' }]);
  assert.equal(f.relayed.length, 0, 'refazer a perna do filho com a mesma track parada nao adianta');
  // Segundo filho (ou nova tentativa) dentro do intervalo: um pedido so.
  assert.equal(await f.ctx.reofferOne(f.session, 'folha', 'screen@O'), true);
  assert.equal(f.sent.length, 1);
});

test('R-01: relay sem a entrada tambem pede a origem', async () => {
  const f = setupRelay({ hasInbound: false, framesDecoded: [] });
  assert.equal(await f.ctx.reofferOne(f.session, 'folha', 'screen@O'), true);
  assert.deepEqual(f.sent, [{ type: 'reoffer', to: 'O', kind: 'screen' }]);
});

test('R-01: entrada com quadros chegando refaz so a perna do filho', async () => {
  const f = setupRelay({ framesDecoded: [10, 40, 70, 100] });
  assert.equal(await f.ctx.reofferOne(f.session, 'folha', 'screen@O'), true);
  assert.equal(f.sent.length, 0);
  assert.deepEqual(f.relayed, [['folha', 'O', 'screen']]);
});
