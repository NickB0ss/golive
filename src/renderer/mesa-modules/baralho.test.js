'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('./baralho');

/** Sorte deterministica (LCG) para os testes. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('newDeck tem 52 cartas distintas por baralho, e decks invalidos viram 1', () => {
  const d = B.newDeck();
  assert.equal(d.length, 52);
  assert.equal(new Set(d).size, 52);
  assert.ok(d.every(B.isCard));
  assert.equal(B.newDeck(6).length, 312);
  for (const bad of [0, -1, 1.5, '2', 99, null]) assert.equal(B.newDeck(bad).length, 52);
});

test('shuffle e uma permutacao, nao muta a entrada e repete com a mesma sorte', () => {
  const d = Object.freeze(B.newDeck());
  const a = B.shuffle(d, seeded(7));
  const b = B.shuffle(d, seeded(7));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, d);
  assert.deepEqual(a.slice().sort(), d.slice().sort());
  assert.notDeepEqual(B.shuffle(d, seeded(8)), a);
});

test('sorte fora de [0, 1) nao quebra nem sai do alcance', () => {
  for (const r of [() => 1, () => -3, () => NaN, () => 'x']) {
    const out = B.shuffle(B.newDeck(), r);
    assert.equal(new Set(out).size, 52);
  }
});

test('draw tira do topo sem mutar', () => {
  const d = Object.freeze(['As', 'Kd', '2c']);
  assert.deepEqual(B.draw(d, 2), { cards: ['As', 'Kd'], rest: ['2c'] });
  assert.deepEqual(B.draw(d, 9), { cards: ['As', 'Kd', '2c'], rest: [] });
  assert.deepEqual(B.draw(d, -1), { cards: [], rest: ['As', 'Kd', '2c'] });
});

test('isCard, rankIndex, isRed e cardName', () => {
  for (const bad of ['', 'A', 'Ax', '1s', 'as', 10, null, 'Ass']) assert.equal(B.isCard(bad), false);
  assert.equal(B.rankIndex('2c'), 0);
  assert.equal(B.rankIndex('As'), 12);
  assert.equal(B.isRed('Th'), true);
  assert.equal(B.isRed('Ts'), false);
  assert.equal(B.cardName('Ah'), 'ás de copas');
  assert.equal(B.cardName('Tc'), 'dez de paus');
  assert.equal(B.cardName('zz'), 'carta');
});
