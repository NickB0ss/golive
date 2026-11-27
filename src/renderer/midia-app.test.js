'use strict';

// Regressoes da auditoria de 2026-11-25 (docs/auditoria-2026-11-25/bugs-renderer-midia.md)
// que moram no app.js. Como nos outros *-app.test.js, roda o codigo de
// producao recortado do arquivo, sem DOM. O escopo e um Proxy: o que o teste
// nao preencheu vira um duble que aceita qualquer chamada, e os globais de
// verdade (Map, Promise, String...) continuam os do Node.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./networktiming');
const { parseKind, relayKindFor } = require('./mesh');

const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
  const start = source.search(new RegExp(`\\n  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  }\n', start) + 4);
}

function caseBlock(label, next) {
  const start = source.indexOf(`      case '${label}': {`);
  const end = source.indexOf(`      case '${next}': {`, start);
  assert.ok(start >= 0 && end > start, label);
  return 'async function handle(session, msg) { let mesh = session.mesh; const sig = session.sig; '
    + `switch (msg.type) {\n${source.slice(start, end)}} }`;
}

function duble(calls, nome) {
  const filhos = new Map();
  return new Proxy(function () {}, {
    get(alvo, chave) {
      if (typeof chave !== 'string' || chave === 'then') return undefined;
      if (!filhos.has(chave)) filhos.set(chave, duble(calls, `${nome}.${chave}`));
      return filhos.get(chave);
    },
    apply(alvo, self, args) { calls.push([nome, ...args]); return undefined; },
  });
}

/** Avalia `code` (declaracoes de funcao) num escopo com `stubs` e devolve o
 * escopo, as funcoes pedidas e as chamadas feitas aos dubles automaticos. */
function load(code, names, stubs) {
  const calls = [];
  const escopo = new Proxy(stubs, {
    has: (alvo, chave) => typeof chave === 'string' && (chave in alvo || !(chave in globalThis)),
    get(alvo, chave) {
      if (typeof chave !== 'string' || chave in alvo) return alvo[chave];
      alvo[chave] = duble(calls, chave);
      return alvo[chave];
    },
    set(alvo, chave, valor) { alvo[chave] = valor; return true; },
  });
  // O `with` so existe fora do modo estrito, dai o Function em vez de vm.
  const fns = new Function('escopo', `with (escopo) { return (function () { ${code}\n`
    + `return { ${names.join(', ')} }; })(); }`)(escopo);
  return { fns, escopo: stubs, calls };
}

function gravador() {
  const chamadas = [];
  const f = (...args) => { chamadas.push(args); };
  f.chamadas = chamadas;
  return f;
}

const quieto = { log() {}, info() {}, warn() {}, error() {} };

test('R-02: camera-state desligada tira o tile da camera de quem assiste', async () => {
  const dropTile = gravador();
  const dropWatchers = gravador();
  const peers = new Map([['A', {}]]);
  const { fns } = load(caseBlock('camera-state', 'broadcast-state'), ['handle'], {
    dropTile, dropWatchers, annotate: { surfaceKey: () => 'A:camera' }, console: quieto,
  });
  const session = { mesh: { peers }, sig: {} };
  await fns.handle(session, { type: 'camera-state', id: 'A', on: true });
  assert.deepEqual(dropTile.chamadas, [], 'ligada: o tile fica');
  await fns.handle(session, { type: 'camera-state', id: 'A', on: false });
  assert.deepEqual(dropTile.chamadas, [['cam-A']]);
  assert.deepEqual(dropWatchers.chamadas, [['cam-A']]);
});

function peerLeft() {
  const tileSource = new Map([['O', 'R|screen@O'], ['X', 'X|screen']]);
  const dropTile = (id) => { tileSource.delete(id); dropTile.chamadas.push(id); };
  dropTile.chamadas = [];
  const closeIn = gravador();
  const dropRelaysOf = gravador();
  const mesh = { peers: new Map([['R', {}], ['X', {}], ['O', {}]]), closeIn, removePeer() {} };
  const kinds = () => ({ screen: new Map(), camera: new Map() });
  const { fns } = load(caseBlock('peer-left', 'offer'), ['handle'], {
    console: quieto, ownerId: null, mesaViewers: [], tileSource, dropTile, dropRelaysOf,
    KINDS: ['screen', 'camera'], relayKindFor, annotOverlayOn: false,
    rxHealthByPeer: new Map(), peerQuality: new Map(), lookingByViewer: new Map(), unwatchedCameras: new Set(),
    myRole: kinds(), recentRelayFailures: kinds(),
    originTree: { screen: { assignments: new Map() }, camera: { assignments: new Map() } },
  });
  return { fns, session: { mesh, sig: {} }, tileSource, dropTile, closeIn, dropRelaysOf };
}

test('R-03: relay que sai leva junto os tiles que ele entregava', async () => {
  const f = peerLeft();
  await f.fns.handle(f.session, { type: 'peer-left', id: 'R' });
  assert.ok(f.dropTile.chamadas.includes('O'), 'tile da origem entregue por R sai (o vigia volta a pedir)');
  assert.equal(f.tileSource.get('X'), 'X|screen', 'tile de outro caminho fica');
});

test('R-03: origem que sai fecha os repasses dela e a entrada de repasse vinda do relay', async () => {
  const f = peerLeft();
  await f.fns.handle(f.session, { type: 'peer-left', id: 'O' });
  assert.deepEqual(f.dropRelaysOf.chamadas.map(([, kind, id, opts]) => [kind, id, opts]),
    [['screen', 'O', { ended: true }], ['camera', 'O', { ended: true }]]);
  assert.deepEqual(f.closeIn.chamadas.filter(([peer]) => peer === 'R').map(([, kind]) => kind),
    ['screen@O', 'camera@O']);
});

function stalledTiles({ tileSource, receiving = [] }) {
  const checkStalledInput = gravador();
  const { fns } = load(fn('connKeyOf') + fn('checkStalledTiles'), ['checkStalledTiles'], {
    KINDS: ['screen', 'camera'], relayKindFor, myId: 'me', orphanSession: null, checkStalledInput,
    tileSource, myRole: { screen: new Map([['O', { paiId: 'R' }]]), camera: new Map() },
  });
  fns.checkStalledTiles({ mesh: { receivingFrom: () => receiving }, sig: { isOpen: () => true } });
  return checkStalledInput.chamadas.filter(([, o]) => o.hasInbound === false).map(([, o]) => `${o.peerId}|${o.kind}`);
}

test('R-03: tile cuja conexao sumiu nao esconde a entrada esperada do vigia', () => {
  assert.deepEqual(stalledTiles({ tileSource: new Map([['O', 'R|screen@O']]) }), ['R|screen@O']);
  // Outro caminho vivo ainda pinta o mesmo conteudo: nada a pedir.
  assert.deepEqual(stalledTiles({ tileSource: new Map([['O', 'O|screen']]),
    receiving: [{ peerId: 'O', kind: 'screen' }] }), []);
});

test('R-04: aceitar oferta republica a demanda completa (broadcastViewState)', async () => {
  const broadcastViewState = gravador();
  const sent = [];
  const session = { mesh: { handleOffer: async () => 'sdp' }, sig: { send: (m) => sent.push(m) } };
  const { fns } = load(caseBlock('offer', 'answer'), ['handle'], {
    console: quieto, KINDS: ['screen', 'camera'], parseKind, myRole: {}, currentSession: session,
    broadcastguards: { canAcceptOffer: () => true }, isAppWatching: () => true, broadcastViewState,
    flushPendingRelay: async () => {},
  });
  await fns.handle(session, { type: 'offer', from: 'O', sdp: {}, kind: 'screen' });
  assert.equal(sent[0].type, 'answer');
  assert.equal(broadcastViewState.chamadas.length, 1, 'janela visivel tambem precisa mandar a escolha de tela');
});

function relayDeTela() {
  const criados = [];
  const screenrelay = { create(track, opts) {
    const relay = { track: { id: `saida-${criados.length}` }, parado: false, opts, stop() { this.parado = true; } };
    criados.push(relay);
    return relay;
  } };
  const tracks = [];
  const localStream = { getVideoTracks: () => tracks.slice(), removeTrack: (t) => tracks.splice(tracks.indexOf(t), 1),
    addTrack: (t) => tracks.push(t) };
  const replaceLocalTrack = gravador();
  const stopShare = gravador();
  const capture = { readyState: 'live', contentHint: '' };
  const { fns, escopo } = load(fn('recoverScreenRelay') + fn('createScreenRelay'), ['createScreenRelay'], {
    console: quieto, screenrelay, localStream, captureTrack: capture, screenRelay: null, orphanSession: null,
    currentSession: { mesh: { replaceLocalTrack } }, SCREEN_RELAY_MAX_RECOVERIES: 3, screenRelayRecoveries: 0,
    stopShare,
  });
  escopo.screenRelay = fns.createScreenRelay(capture);
  tracks.push(escopo.screenRelay.track);
  const falhar = async () => {
    escopo.screenRelay.opts.onFrameError(new Error('GPU'));
    await new Promise((r) => setImmediate(r));
  };
  return { escopo, criados, tracks, replaceLocalTrack, stopShare, capture, falhar };
}

test('R-05: relay de tela que morre por erro e refeito e os senders recebem a saida nova', async () => {
  const f = relayDeTela();
  const primeiro = f.escopo.screenRelay;
  await f.falhar();
  assert.equal(primeiro.parado, true);
  assert.notEqual(f.escopo.screenRelay, primeiro);
  assert.deepEqual(f.tracks, [f.escopo.screenRelay.track]);
  assert.deepEqual(f.replaceLocalTrack.chamadas, [['screen', 'video', f.escopo.screenRelay.track]]);
  // Erro tardio do relay antigo nao mexe no novo.
  primeiro.opts.onFrameError(new Error('tarde'));
  await new Promise((r) => setImmediate(r));
  assert.equal(f.replaceLocalTrack.chamadas.length, 1);
});

test('R-05: esgotadas as tentativas segue com a captura crua; captura morta para', async () => {
  const f = relayDeTela();
  for (let i = 0; i < 4; i += 1) await f.falhar();
  assert.equal(f.escopo.screenRelay, null);
  assert.deepEqual(f.tracks, [f.capture]);
  assert.equal(f.capture.contentHint, 'motion');

  const g = relayDeTela();
  g.capture.readyState = 'ended';
  await g.falhar();
  assert.equal(g.stopShare.chamadas.length, 1);
});

test('R-06: sair da sala transmitindo para o medidor de som', () => {
  const stopSoundMeter = gravador();
  const el = { classList: { add() {}, remove() {} } };
  const { fns } = load(fn('resetShareState') + fn('teardownMedia'), ['teardownMedia'], {
    console: quieto, stopSoundMeter, $: () => el, shareEpoch: 0, swapEpoch: 0, mediaEpoch: 0,
    pendingShareAudioCaptures: new Set(), localStream: { getTracks: () => [] }, cameraStream: null,
    screenRelay: null, captureTrack: null, stopNativeAudioFns: [], autoquality: { initialState: () => ({}) },
    screenResolution: new Map(), appliedScreenEncoding: new Map(), screenRelayRecoveries: 2,
  });
  fns.teardownMedia();
  assert.ok(stopSoundMeter.chamadas.length >= 1);
});

function overlay() {
  const pendentes = [];
  const golive = {
    startAnnotOverlay: () => new Promise((resolve) => pendentes.push(resolve)),
    stopAnnotOverlay: gravador(),
    sendAnnotOverlayLoad: gravador(),
  };
  const { fns, escopo } = load(fn('startAnnotOverlay') + fn('stopAnnotOverlay'),
    ['startAnnotOverlay', 'stopAnnotOverlay'], {
      console: quieto, window: { golive }, annotOverlayOn: false, annotOverlayGen: 0, annotOverlayStartGen: 0,
      shareAnnotations: true, shareReactions: false, myId: 'me', annotate: { surfaceKey: () => 'me:screen' },
    });
  return { fns, escopo, golive, pendentes };
}

test('R-10: parar durante a abertura do overlay fecha a janela em vez de liga-la', async () => {
  const f = overlay();
  const abrindo = f.fns.startAnnotOverlay();
  f.fns.stopAnnotOverlay();
  f.pendentes[0]({ ok: true });
  await abrindo;
  assert.equal(f.escopo.annotOverlayOn, false);
  assert.equal(f.golive.stopAnnotOverlay.chamadas.length, 1);
  assert.equal(f.golive.sendAnnotOverlayLoad.chamadas.length, 0);
});

test('R-10: start mais novo fica com a janela; o antigo nao a fecha', async () => {
  const f = overlay();
  const velho = f.fns.startAnnotOverlay();
  f.fns.stopAnnotOverlay(); // troca de fonte
  const novo = f.fns.startAnnotOverlay();
  f.pendentes[0]({ ok: true });
  await velho;
  f.pendentes[1]({ ok: true });
  await novo;
  assert.equal(f.golive.stopAnnotOverlay.chamadas.length, 0);
  assert.equal(f.escopo.annotOverlayOn, true);
  f.fns.stopAnnotOverlay();
  assert.equal(f.golive.stopAnnotOverlay.chamadas.length, 1);
});
