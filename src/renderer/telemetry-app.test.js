'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const txstats = require('./txstats');
const rxstats = require('./rxstats');
const peerquality = require('./peerquality');
const encodehealth = require('./encodehealth');
const config = require('./config');
require('./networktiming');
const { parseKind, relayKindFor } = require('./mesh');
const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
function fn(name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
function setup() {
  let at = 1000;
  const pc = {}, peer = { name: 'p', outConns: { screen: pc }, inConns: {} };
  const mesh = { peers: new Map([['p', peer]]), statsFor: async () => null,
    inStatsFor: async () => null, receivingFrom: () => [], setPeerDemand: () => false };
  const session = { mesh, sig: { isOpen: () => false } };
  const output = [];
  const ctx = vm.createContext({ txstats, rxstats, peerquality, encodehealth, config, parseKind, relayKindFor,
    currentSession: session, performance: { now: () => at }, Date, console: { log() {} },
    statsPrev: Object.assign(new Map(), txstats.createTracker()),
    rxPrevSample: Object.assign(new Map(), rxstats.createTracker()), rxPrevAtMs: 0,
    rxHealthByPeer: new Map(), peerQuality: new Map(), senderHealth: new Map(),
    myEncodeHealth: null, myEncodeHealthByKind: new Map(),
    localStream: null, sharePaused: false, KINDS: ['screen', 'camera'],
    myRole: { screen: new Map(), camera: new Map() }, originTree: { screen: { assignments: new Map() } },
    isRelaying: () => false, conndiag: { readSelectedPair() {} }, logRouteChange() {},
    summarizeScreenEncodeHealth: encodehealth.summarizeScreenEncodeHealth,
    updateScreenResolution: () => false, qualityForPeer: () => ({ fps: 60 }),
    renderMembersPanel() {}, reapplyAudienceQuality() {}, updateViewerHealth() {}, logEncodeDiag() {},
    renderStats: (tx, rx) => output.push({ tx, rx }), broadcastViewState() {},
    updateEncoderWarning() {}, renderRoomStatus() {},
    RX_HEALTH_TTL_MS: 6000, health: require('./health'), autoquality: require('./autoquality'),
  });
  const legacy = ['readSenderReport', 'deriveRates'].filter((name) => source.includes(`  function ${name}(`));
  const inputHealth = source.includes('  function receiveHealthForInput(') ? [fn('receiveHealthForInput')] : [];
  vm.runInContext([...legacy.map(fn), ...inputHealth, fn('freshReceiveHealth'), fn('updateStats')].join('\n'), ctx);
  return { ctx, pc, peer, mesh, output, clock: (value) => { at = value; } };
}
test('updateStats rejeita resposta getStats de uma PC substituida durante await', async () => {
  const { ctx, peer, mesh, output } = setup();
  mesh.statsFor = async () => {
    peer.outConns.screen = {};
    return [{ type: 'outbound-rtp', kind: 'video', bytesSent: 100, framesEncoded: 10 }];
  };
  await ctx.updateStats();
  assert.equal(output[0].tx.length, 0);
  assert.equal(peer.rtt, undefined);
});

test('lote TX descarta a primeira PC trocada durante stats do segundo peer antes de politica e painel', async () => {
  const { ctx, mesh, peer, output } = setup();
  mesh.peers.set('q', { name: 'q', outConns: { screen: {} }, inConns: {} });
  ctx.localStream = {};
  ctx.autoQuality = ctx.autoquality.initialState();
  ctx.qualityFor = () => ({ fps: 60 });
  mesh.statsFor = async (id) => {
    if (id === 'q') peer.outConns.screen = {};
    return [{ type: 'outbound-rtp', kind: 'video', bytesSent: 100, framesEncoded: 10,
      qualityLimitationReason: id === 'p' ? 'cpu' : 'none' }];
  };
  await ctx.updateStats();
  assert.equal(output[0].tx.length, 1);
  assert.equal(output[0].tx[0].peerId, 'q');
  assert.equal(ctx.myEncodeHealthByKind.get('screen').cpuLimited, false);
  assert.equal(ctx.autoQuality.badSinceMs, null, 'escada global nao iniciou sofrimento com a PC antiga');
  assert.equal(ctx.peerQuality.has('p:screen'), false);
  assert.equal(peer.rtt, undefined);
});

test('broadcast real nao renova saude RX da PC anterior enquanto reconexao retorna stats null', async () => {
  const { ctx, mesh, peer, clock } = setup();
  peer.inConns.screen = { connectionState: 'connected' };
  mesh.receivingFrom = () => [{ peerId: 'p', kind: 'screen' }];
  let frames = 10;
  mesh.inStatsFor = async () => frames == null ? null : [{ id: 'i', type: 'inbound-rtp', kind: 'video',
    framesDecoded: frames, packetsReceived: frames, packetsLost: 0, freezeCount: 0 }];
  const messages = [];
  Object.assign(ctx, { lastViewStateSent: new Map(), folhaAssistindo: () => false,
    wantsMedia: () => true, isAppWatching: () => true, mesaView: null,
    tetoRecebido: { larguraEscolhida: () => null, combinar: () => null },
    encodeHealthForInput: () => null, relayLoad: () => 0, console: { info() {} },
  });
  vm.runInContext(fn('broadcastViewState'), ctx);
  await ctx.updateStats();
  frames = 20; clock(2000); await ctx.updateStats();
  ctx.currentSession.sig = { isOpen: () => true, send: (msg) => messages.push(msg) };
  ctx.broadcastViewState();
  assert.equal(messages.at(-1).receiveHealth.lossPct, 0);
  peer.inConns.screen = { connectionState: 'connecting' };
  ctx.broadcastViewState();
  assert.equal(messages.at(-1).receiveHealth, null, 'nenhum anuncio entre troca de PC e proximo tick');
  frames = null; clock(3000); await ctx.updateStats();
  assert.equal(messages.at(-1).receiveHealth, null);
  assert.equal(ctx.rxHealthByPeer.size, 0);
});

test('broadcast durante o getStats RX da mesma PC nao apaga a saude valida', async () => {
  const { ctx, mesh, peer, clock } = setup();
  peer.inConns.screen = { connectionState: 'connected' };
  mesh.receivingFrom = () => [{ peerId: 'p', kind: 'screen' }];
  let frames = 10;
  let duranteAwait = null;
  const messages = [];
  mesh.inStatsFor = async () => {
    if (duranteAwait) duranteAwait();
    return [{ id: 'i', type: 'inbound-rtp', kind: 'video',
      framesDecoded: frames, packetsReceived: frames, packetsLost: 0, freezeCount: 0 }];
  };
  Object.assign(ctx, { lastViewStateSent: new Map(), folhaAssistindo: () => false,
    wantsMedia: () => true, isAppWatching: () => true, mesaView: null,
    tetoRecebido: { larguraEscolhida: () => null, combinar: () => null },
    encodeHealthForInput: () => null, relayLoad: () => 0, console: { info() {} },
  });
  vm.runInContext(fn('broadcastViewState'), ctx);
  await ctx.updateStats();
  frames = 20; clock(2000); await ctx.updateStats();
  ctx.currentSession.sig = { isOpen: () => true, send: (msg) => messages.push(msg) };
  // Visibilidade, Mesa ou demanda podem disparar view-state no meio do tick.
  let anuncioDuranteAwait;
  duranteAwait = () => { ctx.broadcastViewState(); anuncioDuranteAwait = messages.at(-1); };
  frames = 30; clock(3000); await ctx.updateStats();
  assert.equal(anuncioDuranteAwait.receiveHealth?.lossPct, 0, 'PC sem troca continua anunciando a saude medida');
});
test('RX integrado mede delta entre ticks e reinicia na troca da PC', async () => {
  const { ctx, peer, mesh, output, clock } = setup();
  peer.inConns['screen@origem'] = {};
  mesh.receivingFrom = () => [{ peerId: 'p', kind: 'screen@origem' }];
  let frames = 10;
  mesh.inStatsFor = async () => [{ id: 'i', type: 'inbound-rtp', kind: 'video', framesDecoded: frames,
    packetsReceived: frames, packetsLost: 0, freezeCount: 0,
    jitterBufferEmittedCount: frames, jitterBufferDelay: frames / 10 }];
  await ctx.updateStats();
  assert.equal(output.at(-1).rx[0].bufferMs, null);
  frames = 20; clock(3000); await ctx.updateStats();
  assert.equal(output.at(-1).rx[0].bufferMs, 100);
  peer.inConns['screen@origem'] = {}; frames = 30; clock(4000); await ctx.updateStats();
  assert.equal(output.at(-1).rx[0].bufferMs, null);
  assert.equal(ctx.rxHealthByPeer.size, 0);
});
test('qualityForPeer e view-state guardam saude e largura por origem completa', async () => {
  const { ctx, mesh, peer } = setup();
  ctx.qualityFor = () => config.qualityFromPreset('1080p60');
  ctx.localScreenLoad = () => ({ byKind: new Map() });
  ctx.peerQuality.set('p:screen@a', { steps: 1 });
  ctx.peerQuality.set('p:screen@b', { steps: 0 });
  vm.runInContext(fn('qualityForPeer'), ctx);
  assert.equal(ctx.qualityForPeer('p', 'screen@a').preset, '1080p30');
  assert.equal(ctx.qualityForPeer('p', 'screen@b').preset, '1080p60');
  Object.assign(ctx, { mesh, session: ctx.currentSession, sig: { send() {} }, myId: 'me',
    isKnownKind: () => true, normalizeEncodeHealth: (v) => v || null,
    normalizeReceiveHealth: (v) => v || null, filhosQueDemosA: () => 0, recomputeTree() {},
    trackForKind: () => null, lookingKey: (...parts) => parts.join('|'), lookingByViewer: new Map(),
    broadcastWatchers() {}, cameraStream: null, console: { info() {} },
  });
  const start = source.indexOf("      case 'view-state': {");
  const end = source.indexOf('      // Um espectador cuja tela', start);
  vm.runInContext(`async function receive(msg) { switch(msg.type) { ${source.slice(start, end)} } }`, ctx);
  await ctx.receive({ type: 'view-state', from: 'p', kind: 'screen@a', watching: true,
    maxWidth: 800, receiveHealth: { lossPct: 9 }, encodeHealth: { msPerFrame: 50 } });
  await ctx.receive({ type: 'view-state', from: 'p', kind: 'screen@b', watching: true,
    maxWidth: 1920, receiveHealth: { lossPct: 0 } });
  assert.equal(ctx.freshReceiveHealth(peer, 'screen@a').lossPct, 9);
  assert.equal(ctx.freshReceiveHealth(peer, 'screen@b').lossPct, 0);
  assert.equal(peer.viewWidth['screen@a'], 800);
  assert.equal(ctx.qualityForPeer('p', 'screen@a').preset, '720p30');
  assert.equal(peer.encodeHealthByKind['screen@a'].msPerFrame, 50);
  assert.equal(peer.encodeHealthByKind['screen@b'], null);
  peer.outConns['screen@a'] = {};
  assert.equal(ctx.freshReceiveHealth(peer, 'screen@a'), null);
});

test('normalizador de recepcao nao inventa perda ou freeze ausente', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fn('normalizeReceiveHealth'), ctx);
  assert.equal(ctx.normalizeReceiveHealth({ lossPct: null, freezeRate: 0 }), null);
  assert.equal(ctx.normalizeReceiveHealth({ lossPct: 0 }), null);
  assert.equal(ctx.normalizeReceiveHealth({ lossPct: 0, freezeRate: 0 }).lossPct, 0);
});

test('escada integrada nao aplica banda de outra origem e reinicia com PC nova', async () => {
  const { ctx, mesh, peer, clock } = setup();
  peer.outConns = { 'screen@a': {}, 'screen@b': {} };
  ctx.isRelaying = () => true;
  ctx.myRole.screen.set('a', { role: 'relay', filhosIds: ['p'] });
  ctx.myRole.screen.set('b', { role: 'relay', filhosIds: ['p'] });
  mesh.statsFor = async (id, kind) => [{ type: 'outbound-rtp', kind: 'video', bytesSent: 100,
    framesEncoded: 10, qualityLimitationReason: kind === 'screen@a' ? 'bandwidth' : 'none' }];
  await ctx.updateStats();
  clock(17000); await ctx.updateStats();
  clock(21000); await ctx.updateStats();
  assert.equal(ctx.peerQuality.get('p:screen@a').steps, 1);
  assert.equal(ctx.peerQuality.get('p:screen@b').steps, 0);
  peer.outConns['screen@a'] = {}; clock(22000); await ctx.updateStats();
  assert.equal(ctx.peerQuality.get('p:screen@a').steps, 0);
});

test('relay anuncia encode somente dos filhos da origem recebida', () => {
  const { ctx } = setup();
  ctx.myId = 'me';
  ctx.myEncodeHealth = { msPerFrame: 99 };
  ctx.myEncodeHealthByKind.set('screen@a', { msPerFrame: 3 });
  ctx.myEncodeHealthByKind.set('screen@b', { msPerFrame: 40 });
  const method = 'encodeHealthForInput';
  if (source.includes(`  function ${method}(`)) vm.runInContext(fn(method), ctx);
  assert.equal(typeof ctx[method], 'function');
  assert.equal(ctx[method]('a', 'screen').msPerFrame, 3);
  assert.equal(ctx[method]('relay', 'screen@b').msPerFrame, 40);
  assert.equal(ctx[method]('unserved', 'screen'), null);
});

test('eleicao de relay nao perde a saude de tela quando chega view-state de camera depois', async () => {
  const { ctx, mesh, peer } = setup();
  Object.assign(ctx, { mesh, session: ctx.currentSession, sig: { send() {} }, myId: 'me',
    isKnownKind: () => true, normalizeEncodeHealth: (v) => v || null,
    normalizeReceiveHealth: (v) => v || null, filhosQueDemosA: () => 0, recomputeTree() {},
    trackForKind: () => null, lookingKey: (...parts) => parts.join('|'), lookingByViewer: new Map(),
    broadcastWatchers() {}, cameraStream: null, console: { info() {} },
  });
  const start = source.indexOf("      case 'view-state': {");
  const end = source.indexOf('      // Um espectador cuja tela', start);
  vm.runInContext(`async function receive(msg) { switch(msg.type) { ${source.slice(start, end)} } }`, ctx);
  await ctx.receive({ type: 'view-state', from: 'p', kind: 'screen', watching: true,
    encodeHealth: { softwareEncoder: true, msPerFrame: 50 } });
  await ctx.receive({ type: 'view-state', from: 'p', kind: 'camera', watching: true, encodeHealth: null });
  await ctx.receive({ type: 'view-state', from: 'p', kind: 'screen@outra', watching: true, encodeHealth: null });
  assert.equal(peer.encodeHealth.softwareEncoder, true, 'slot da eleicao segue a entrada direta de tela');
  assert.equal(peer.encodeHealthByKind.camera, null);
});

test('encodeHealth enviado em camera e tela da mesma origem e a saude de tela (par 0.25.0)', () => {
  const { ctx } = setup();
  ctx.myEncodeHealthByKind.set('screen@a', { msPerFrame: 7 });
  vm.runInContext(fn('encodeHealthForInput'), ctx);
  assert.equal(ctx.encodeHealthForInput('a', 'camera').msPerFrame, 7);
  assert.equal(ctx.encodeHealthForInput('a', 'screen').msPerFrame, 7);
  assert.equal(ctx.encodeHealthForInput('x', 'camera@a').msPerFrame, 7);
});

test('painel real aceita campos ausentes e nao anuncia hardware ou total parcial', () => {
  const { ctx } = setup();
  let html;
  ctx.ui = { escapeHtml: (v) => v, settings: { isStatsVisible: () => true, setStatsHtml: (v) => { html = v; } } };
  ctx.t = (key) => key;
  ctx.isSoftwareEncoder = encodehealth.isSoftwareEncoder;
  ctx.qualityFor = () => ({ bitrate: 12000000 });
  ctx.LIMITATION_LABELS = {};
  vm.runInContext(fn('renderStats'), ctx);
  const row = { peerId: 'p', kind: 'screen', name: 'p', ...txstats.readSenderReport([]),
    mbps: null, msPerFrame: null };
  ctx.renderStats([row, { ...row, mbps: 1 }], []);
  assert.match(html, /diag.encoderDesconhecido/);
  assert.doesNotMatch(html, /diag.encoderHardware|NaN|nullxnull/);
  assert.match(html, /diag.saidaTotal<\/span><b>-<\/b>/);
  ctx.renderStats([{ ...row, framesEncoded: 10, framesSent: 10 }], []);
  assert.match(html, /<td class="">0<\/td>/, 'zero observado de descartes e exibido');
});

test('scripts de telemetria e sucessao carregam em ordem em file e HTTP', async () => {
  const { responder } = require('../main/origem');
  const { fileURLToPath, pathToFileURL } = require('node:url');
  const renderer = __dirname;
  const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  for (const base of ['http://localhost/index.html', pathToFileURL(path.join(renderer, 'index.html')).href]) {
    const window = {};
    for (const ref of scripts.filter((s) => /(?:txstats|rxstats|encodehealth|encodediag|succession)\.js$/.test(s))) {
      const url = new URL(ref, base);
      const code = url.protocol === 'file:' ? fs.readFileSync(fileURLToPath(url), 'utf8')
        : (await responder({ raiz: renderer, metodo: 'GET', url: url.href })).corpo.toString();
      vm.runInNewContext(code, { window });
    }
    assert.equal(window.GoLive.succession.chooseSuccessor(['20', '3', '1'], '1'), '3');
    assert.equal(window.GoLive.rxstats.readReceiverReport([]).codec, null);
    assert.equal(window.GoLive.txstats.readSenderReport([]).rtt, null);
  }
});
