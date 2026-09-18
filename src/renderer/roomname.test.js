'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRoomName, MAX_ROOM_NAME_CHARS } = require('./roomname');

test('tira espaco das pontas', () => {
  assert.equal(normalizeRoomName('  Sala do Nicolas  '), 'Sala do Nicolas');
});

test('colapsa espacos internos repetidos', () => {
  assert.equal(normalizeRoomName('Sala   do    Nicolas'), 'Sala do Nicolas');
});

test('troca caracteres de controle por espaco em vez de gruda-los', () => {
  assert.equal(normalizeRoomName('Sala\ndo\tNicolas'), 'Sala do Nicolas');
});

test('corta no teto de caracteres', () => {
  const longo = 'x'.repeat(MAX_ROOM_NAME_CHARS + 20);
  const resultado = normalizeRoomName(longo);
  assert.equal(resultado.length, MAX_ROOM_NAME_CHARS);
});

test('so espaco/controle vira null -- quem chama decide o padrao', () => {
  assert.equal(normalizeRoomName('   '), null);
  assert.equal(normalizeRoomName('\n\t'), null);
  assert.equal(normalizeRoomName(''), null);
});

test('tipo errado vira null', () => {
  assert.equal(normalizeRoomName(null), null);
  assert.equal(normalizeRoomName(undefined), null);
  assert.equal(normalizeRoomName(42), null);
});
