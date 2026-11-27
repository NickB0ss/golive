// src/main/prazo.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { comPrazo, PRAZO_ESGOTADO } = require('./prazo');

test('devolve o valor quando a promessa resolve antes do prazo', async () => {
  assert.equal(await comPrazo(Promise.resolve(42), 1000), 42);
});

test('propaga a rejeicao que chega antes do prazo', async () => {
  await assert.rejects(comPrazo(Promise.reject(new Error('falhou')), 1000), /falhou/);
});

test('devolve PRAZO_ESGOTADO quando a promessa nunca resolve', async () => {
  const t0 = Date.now();
  assert.equal(await comPrazo(new Promise(() => {}), 50), PRAZO_ESGOTADO);
  assert.ok(Date.now() - t0 < 1000);
});

test('aceita valor que nao e promessa', async () => {
  assert.equal(await comPrazo('x', 1000), 'x');
});
