'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isCurrentEpoch, canAcceptOffer, canAcceptTree, createPendingTrees } = require('./broadcastguards');

test('isCurrentEpoch aborta o startShare quando stopShare invalida sua época', () => {
  let shareEpoch = 7;
  const startedAt = shareEpoch;
  assert.equal(isCurrentEpoch(startedAt, shareEpoch), true);

  shareEpoch += 1; // stopShare durante await offerOwnStreamTo()
  assert.equal(isCurrentEpoch(startedAt, shareEpoch), false);
});

test('canAcceptOffer aceita oferta direta e somente relay cujo pai confere', () => {
  const roles = new Map([['origin', { paiId: 'relay' }]]);
  const input = { knownKinds: ['screen', 'camera'], rolesByKind: { screen: roles, camera: new Map() } };

  assert.equal(canAcceptOffer({ ...input, kind: 'screen', from: 'origin' }), true);
  assert.equal(canAcceptOffer({ ...input, kind: 'screen@origin', from: 'relay' }), true);
  assert.equal(canAcceptOffer({ ...input, kind: 'screen@origin', from: 'attacker' }), false);
  assert.equal(canAcceptOffer({ ...input, kind: 'screen@unknown', from: 'attacker' }), false);
  assert.equal(canAcceptOffer({ ...input, kind: 'screen@origin@extra', from: 'relay' }), false);
});

test('canAcceptTree só aceita árvore da origem ao vivo naquele tipo de transmissão', () => {
  assert.equal(canAcceptTree({ kind: 'screen', peer: { live: true } }), true);
  assert.equal(canAcceptTree({ kind: 'screen', peer: { live: false } }), false);
  assert.equal(canAcceptTree({ kind: 'camera', peer: { cameraOn: true } }), true);
  assert.equal(canAcceptTree({ kind: 'camera', peer: { cameraOn: false } }), false);
  assert.equal(canAcceptTree({ kind: 'screen', peer: null }), false);
});

test('tree before live is held and returned once its origin announces live', () => {
  const pending = createPendingTrees();
  const tree = { kind: 'screen', from: 'origin', epoch: 4, paiId: 'origin', filhos: [] };
  pending.remember(tree);

  assert.deepEqual(pending.takeWhenLive({ origin: 'origin', kind: 'screen', live: true, latestEpoch: 0 }), tree);
  assert.equal(pending.takeWhenLive({ origin: 'origin', kind: 'screen', live: true, latestEpoch: 0 }), null);
});

test('an old pending tree is not returned when a newer epoch is known', () => {
  const pending = createPendingTrees();
  pending.remember({ kind: 'screen', from: 'origin', epoch: 3 });

  assert.equal(pending.takeWhenLive({ origin: 'origin', kind: 'screen', live: true, latestEpoch: 4 }), null);
});

test('origin departure clears its pending tree', () => {
  const pending = createPendingTrees();
  pending.remember({ kind: 'screen', from: 'origin', epoch: 4 });
  pending.forgetOrigin('origin');

  assert.equal(pending.takeWhenLive({ origin: 'origin', kind: 'screen', live: true, latestEpoch: 0 }), null);
});

// R-07 (auditoria 2026-11-25): tree crua abria uma PC por id inventado.
test('sanitizeTree filtra filhos fora da sala, repetidos, a origem e nos mesmos, com teto', () => {
  const { sanitizeTree, MAX_TREE_CHILDREN } = require('./broadcastguards');
  const sala = new Set(['O', 'eu', 'a', 'b', ...Array.from({ length: 20 }, (_, i) => `p${i}`)]);
  const base = { origem: 'O', myId: 'eu', isKnownPeer: (id) => sala.has(id) };
  const ok = sanitizeTree({ ...base, msg: { epoch: 3, paiId: 'O', filhos: ['a', 'fantasma', 'a', 'O', 'eu', 7, {}, 'b'] } });
  assert.deepEqual(ok, { epoch: 3, paiId: 'O', filhosIds: ['a', 'b'] });
  const muitos = sanitizeTree({ ...base, msg: { epoch: 1, paiId: 'O', filhos: [...sala].filter((id) => id.startsWith('p')) } });
  assert.equal(muitos.filhosIds.length, MAX_TREE_CHILDREN);
  assert.deepEqual(sanitizeTree({ ...base, msg: { epoch: 2, paiId: 'a', filhos: 'x' } }).filhosIds, []);
});

test('sanitizeTree recusa epoch que nao e inteiro e pai desconhecido', () => {
  const { sanitizeTree } = require('./broadcastguards');
  const base = { origem: 'O', myId: 'eu', isKnownPeer: (id) => ['O', 'a'].includes(id) };
  for (const epoch of [undefined, null, '3', 1.5, -1, NaN]) {
    assert.equal(sanitizeTree({ ...base, msg: { epoch, paiId: 'O', filhos: [] } }), null, String(epoch));
  }
  assert.equal(sanitizeTree({ ...base, msg: { epoch: 1, paiId: 'fantasma', filhos: [] } }), null);
  assert.equal(sanitizeTree({ ...base, msg: { epoch: 1, paiId: 'eu', filhos: [] } }), null);
  assert.equal(sanitizeTree({ ...base, msg: { epoch: 1, filhos: [] } }), null);
  assert.deepEqual(sanitizeTree({ ...base, msg: { epoch: 0, paiId: 'a' } }), { epoch: 0, paiId: 'a', filhosIds: [] });
});
