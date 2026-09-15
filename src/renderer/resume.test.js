'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  planResume, kindsToReoffer, reofferRequests, reofferStillNeeded,
  RESUME_REOFFER_SPACING_MS, RESUME_REOFFER_ATTEMPTS, RESUME_REOFFER_RETRY_MS,
} = require('./resume');

test('retomada sem mudancas adota todos os peers existentes', () => {
  assert.deepEqual(
    planResume({ resumed: true, welcomePeerIds: ['2', '3'], meshPeerIds: ['2', '3'] }),
    { adopt: true, offerTo: [], dropPeers: [] },
  );
});

test('retomada oferece so para o peer novo', () => {
  assert.deepEqual(
    planResume({ resumed: true, welcomePeerIds: ['2', '3'], meshPeerIds: ['2'] }),
    { adopt: true, offerTo: ['3'], dropPeers: [] },
  );
});

test('retomada derruba so o peer que saiu', () => {
  assert.deepEqual(
    planResume({ resumed: true, welcomePeerIds: ['2'], meshPeerIds: ['2', '3'] }),
    { adopt: true, offerTo: [], dropPeers: ['3'] },
  );
});

test('welcome sem retomada descarta a sessao orfa', () => {
  assert.deepEqual(
    planResume({ resumed: false, welcomePeerIds: ['2'], meshPeerIds: ['2'] }),
    { adopt: false, offerTo: [], dropPeers: [] },
  );
});

test('reoferta somente saidas ausentes, instaveis ou encerradas', () => {
  assert.deepEqual(
    kindsToReoffer({
      outConnStates: {
        screen: { exists: true, signalingState: 'stable', connectionState: 'connected' },
        camera: { exists: true, signalingState: 'have-local-offer', connectionState: 'connecting' },
        'screen@7': { exists: true, signalingState: 'stable', connectionState: 'failed' },
        'camera@7': { exists: true, signalingState: 'stable', connectionState: 'closed' },
        'screen@8': { exists: false },
      },
    }),
    ['camera', 'screen@7', 'camera@7', 'screen@8'],
  );
});

// Log de 2026-09-15 21:46:37: a retomada fechou a entrada de tela vinda de #1
// e ninguem pediu a oferta de volta -- quem transmite via a propria saida
// saudavel e respondeu 'nada a re-ofertar' ao peer-resumed.
test('entrada derrubada na retomada vira pedido de reoferta a quem a servia', () => {
  assert.deepEqual(
    reofferRequests([
      { peerId: '1', kind: 'screen', dir: 'in' },
      { peerId: '4', kind: 'camera@7', dir: 'in' },
    ]),
    [{ to: '1', kind: 'screen', delayMs: 0 }, { to: '4', kind: 'camera@7', delayMs: RESUME_REOFFER_SPACING_MS }],
  );
});

test('saida derrubada na retomada nao pede nada: a recuperacao local re-oferta', () => {
  assert.deepEqual(reofferRequests([{ peerId: '1', kind: 'screen', dir: 'out' }]), []);
});

// Espelho do limitador do servidor (createRateLimiter + MAX_REOFFER_PER_SECOND
// em server/signaling-core.js): janela fixa de 1 s, 2 pedidos por janela.
test('pedidos da retomada cabem no limite de 2 reoffer/s do servidor', () => {
  const recovered = ['1', '3', '5'].flatMap((peerId) => [
    { peerId, kind: 'screen', dir: 'in' },
    { peerId, kind: 'camera', dir: 'in' },
  ]);
  const requests = reofferRequests(recovered);
  assert.equal(requests.length, 6);
  let windowStart = -Infinity;
  let count = 0;
  for (const { delayMs } of requests) {
    if (delayMs - windowStart >= 1000) {
      windowStart = delayMs;
      count = 0;
    }
    count += 1;
    assert.ok(count <= 2, `mais de 2 pedidos na janela que comeca em ${windowStart} ms`);
  }
});

test('pedido da retomada so se repete enquanto a entrada nao voltou', () => {
  assert.equal(reofferStillNeeded({ peer: { inConns: { screen: null } }, kind: 'screen' }), true);
  assert.equal(reofferStillNeeded({ peer: { inConns: {} }, kind: 'screen@7' }), true);
  // Oferta nova ja recriou a entrada: repetir derrubaria a saida saudavel.
  assert.equal(reofferStillNeeded({ peer: { inConns: { screen: {} } }, kind: 'screen' }), false);
  // Peer saiu da sala.
  assert.equal(reofferStillNeeded({ peer: undefined, kind: 'screen' }), false);
});

// 15000 = REOFFER_MIN_GAP_MS de app.js, a carencia por pedinte+kind no emissor.
test('a ultima tentativa cai depois da carencia do reoffer no emissor', () => {
  assert.ok((RESUME_REOFFER_ATTEMPTS - 1) * RESUME_REOFFER_RETRY_MS > 15000);
});

test('pedido de reoferta sem duplicata e tolerante a lixo', () => {
  assert.deepEqual(
    reofferRequests([
      { peerId: '1', kind: 'screen', dir: 'in' },
      { peerId: '1', kind: 'screen', dir: 'in' },
      null,
      { peerId: '', kind: 'screen', dir: 'in' },
      { peerId: '2', dir: 'in' },
    ]),
    [{ to: '1', kind: 'screen', delayMs: 0 }],
  );
  assert.deepEqual(reofferRequests(undefined), []);
});

test('nao reoferta saidas saudaveis', () => {
  assert.deepEqual(
    kindsToReoffer({
      outConnStates: {
        screen: { exists: true, signalingState: 'stable', connectionState: 'connected' },
        camera: { exists: true, signalingState: 'stable', connectionState: 'disconnected' },
      },
    }),
    [],
  );
});
