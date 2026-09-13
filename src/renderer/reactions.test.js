'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { REACTIONS, TTL_MS, isValidEmoji, createBurstLimiter, createStore } = require('./reactions');

test('isValidEmoji aceita cada emoji permitido', () => {
  for (const emoji of REACTIONS) assert.equal(isValidEmoji(emoji), true);
});

test('isValidEmoji recusa valores fora da lista fechada', () => {
  for (const emoji of ['x', '', {}, 42, undefined]) {
    assert.equal(isValidEmoji(emoji), false);
  }
});

test('limiter deixa passar a rajada inicial e recusa a sexta chamada', () => {
  const limiter = createBurstLimiter({ capacity: 5, refillMs: 300 });
  for (let i = 0; i < 5; i++) assert.equal(limiter.hit(1000), true);
  assert.equal(limiter.hit(1000), false);
});

test('limiter repoe exatamente uma ficha por intervalo', () => {
  const limiter = createBurstLimiter({ capacity: 5, refillMs: 300 });
  for (let i = 0; i < 5; i++) limiter.hit(1000);
  assert.equal(limiter.hit(1300), true);
  assert.equal(limiter.hit(1300), false);
});

test('limiter nunca acumula mais fichas que a capacidade', () => {
  const limiter = createBurstLimiter({ capacity: 5, refillMs: 300 });
  limiter.hit(0);
  for (let i = 0; i < 5; i++) assert.equal(limiter.hit(30000), true);
  assert.equal(limiter.hit(30000), false);
});

test('apply invalido devolve null e nao cria bolha', () => {
  const store = createStore();
  assert.equal(store.apply('tela', 'ana', 'x', 10), null);
  assert.deepEqual(store.active('tela', 10), []);
});

test('apply valido cria bolha que active devolve', () => {
  const store = createStore();
  const bubble = store.apply('tela', 'ana', REACTIONS[0], 10);
  assert.equal(bubble.surfaceId, 'tela');
  assert.equal(bubble.from, 'ana');
  assert.equal(bubble.emoji, REACTIONS[0]);
  assert.deepEqual(store.active('tela', 10), [bubble]);
});

test('active nao devolve bolha quando sua idade alcanca o ttl', () => {
  const store = createStore();
  store.apply('tela', 'ana', REACTIONS[0], 10);
  assert.deepEqual(store.active('tela', 10 + TTL_MS), []);
});

test('prune remove expiradas de varias superficies e mantem as vivas', () => {
  const store = createStore();
  store.apply('a', 'ana', REACTIONS[0], 0);
  store.apply('b', 'bia', REACTIONS[1], 0);
  const viva = store.apply('c', 'caio', REACTIONS[2], 1000);
  store.prune(1400);
  assert.deepEqual(store.active('a', 1400), []);
  assert.deepEqual(store.active('b', 1400), []);
  assert.deepEqual(store.active('c', 1400), [viva]);
});

test('dropAuthor remove as reacoes do autor em varias superficies', () => {
  const store = createStore();
  store.apply('a', 'ana', REACTIONS[0], 10);
  store.apply('b', 'ana', REACTIONS[1], 10);
  const daBia = store.apply('a', 'bia', REACTIONS[2], 10);
  store.dropAuthor('ana');
  assert.deepEqual(store.active('a', 10), [daBia]);
  assert.deepEqual(store.active('b', 10), []);
});
