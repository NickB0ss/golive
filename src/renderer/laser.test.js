'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TTL_MS, shouldEmit, createStore } = require('./laser');

test('shouldEmit recusa antes de completar o intervalo da taxa', () => {
  assert.equal(shouldEmit(1000, 1041, 24), false);
});

test('shouldEmit aceita ao completar o intervalo da taxa', () => {
  assert.equal(shouldEmit(1000, 1000 + (1000 / 24), 24), true);
});

test('shouldEmit aceita o primeiro envio sem timestamp anterior', () => {
  for (const lastSentAt of [0, null, undefined]) {
    assert.equal(shouldEmit(lastSentAt, 1000, 24), true);
  }
});

test('apply guarda coordenadas normalizadas e arredondadas', () => {
  const store = createStore();
  assert.equal(store.apply('tela', 'ana', { x: 0.1239, y: 0.5004 }, 10), true);
  assert.equal(store.apply('tela', 'bia', { x: 0, y: 1 }, 10), true);
  assert.deepEqual(store.active(10), [
    { from: 'ana', surfaceId: 'tela', x: 0.124, y: 0.5, age: 0 },
    { from: 'bia', surfaceId: 'tela', x: 0, y: 1, age: 0 },
  ]);
});

test('apply descarta coordenadas invalidas sem apagar a posicao anterior', () => {
  const store = createStore();
  store.apply('tela', 'ana', { x: 0.5, y: 0.5 }, 10);
  for (const op of [
    { x: -0.1, y: 0.5 }, { x: 1.1, y: 0.5 }, { x: NaN, y: 0.5 },
    { x: '0.5', y: 0.5 }, { x: undefined, y: 0.5 },
  ]) {
    assert.equal(store.apply('tela', 'ana', op, 20), false);
  }
  assert.deepEqual(store.active(20), [
    { from: 'ana', surfaceId: 'tela', x: 0.5, y: 0.5, age: 10 },
  ]);
});

test('active devolve so pontos vivos com a idade correta', () => {
  const store = createStore();
  store.apply('a', 'ana', { x: 0, y: 0 }, 0);
  store.apply('b', 'bia', { x: 1, y: 1 }, 1);
  assert.deepEqual(store.active(TTL_MS), [
    { from: 'bia', surfaceId: 'b', x: 1, y: 1, age: TTL_MS - 1 },
  ]);
});

test('active respeita ttl customizado', () => {
  const store = createStore();
  store.apply('tela', 'ana', { x: 0.5, y: 0.5 }, 100);
  assert.equal(store.active(149, 50).length, 1);
  assert.equal(store.active(150, 50).length, 0);
});

test('dropAuthor remove apenas o autor em varias superficies', () => {
  const store = createStore();
  store.apply('a', 'ana', { x: 0, y: 0 }, 10);
  store.apply('b', 'ana', { x: 0, y: 0 }, 10);
  store.apply('a', 'bia', { x: 1, y: 1 }, 10);
  store.dropAuthor('ana');
  assert.deepEqual(store.active(10), [
    { from: 'bia', surfaceId: 'a', x: 1, y: 1, age: 0 },
  ]);
});

test('drop remove apenas os pontos da superficie indicada', () => {
  const store = createStore();
  store.apply('a', 'ana', { x: 0, y: 0 }, 10);
  store.apply('b', 'bia', { x: 1, y: 1 }, 10);
  store.drop('a');
  assert.deepEqual(store.active(10), [
    { from: 'bia', surfaceId: 'b', x: 1, y: 1, age: 0 },
  ]);
});
