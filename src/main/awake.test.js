'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldKeepAwake } = require('./awake');

test('fora da sala nunca prende a maquina acordada, mesmo com sharing/watching presos de um estado anterior', () => {
  assert.equal(shouldKeepAwake({ inRoom: false, sharing: true, watching: true }), false);
});

test('na sala, parado (nem transmitindo nem assistindo), nao prende a maquina acordada', () => {
  assert.equal(shouldKeepAwake({ inRoom: true, sharing: false, watching: false }), false);
});

test('na sala transmitindo prende a maquina acordada', () => {
  assert.equal(shouldKeepAwake({ inRoom: true, sharing: true, watching: false }), true);
});

test('na sala assistindo um tile prende a maquina acordada', () => {
  assert.equal(shouldKeepAwake({ inRoom: true, sharing: false, watching: true }), true);
});

test('na sala transmitindo e assistindo ao mesmo tempo prende a maquina acordada', () => {
  assert.equal(shouldKeepAwake({ inRoom: true, sharing: true, watching: true }), true);
});
