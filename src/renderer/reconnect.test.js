'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  RECONNECT_CAP_MS,
  reconnectDelayMs,
  MAX_RECONNECT,
  worstCaseReconnectMs,
} = require('./reconnect');

test('backoff cresce ate o teto de 15 s', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map(reconnectDelayMs),
    [1000, 2000, 4000, 8000, 15000, 15000],
  );
  assert.equal(RECONNECT_CAP_MS, 15000);
});

test('entrada invalida ou negativa usa a primeira espera', () => {
  assert.equal(reconnectDelayMs(-1), 1000);
  assert.equal(reconnectDelayMs(Number.NaN), 1000);
  assert.equal(reconnectDelayMs('2'), 1000);
  assert.equal(reconnectDelayMs(1.5), 1000);
});

test('MAX_RECONNECT cobre pelo menos 110 s no pior caso', () => {
  assert.equal(MAX_RECONNECT, 7);
  assert.ok(worstCaseReconnectMs(MAX_RECONNECT, 8000) >= 110000);
  assert.ok(worstCaseReconnectMs(MAX_RECONNECT - 1, 8000) < 110000);
});

test('worstCaseReconnectMs aceita timeout customizado', () => {
  assert.equal(worstCaseReconnectMs(3, 100), 7300);
});
