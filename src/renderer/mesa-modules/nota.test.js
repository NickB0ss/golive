'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const nota = require('./nota');
const { jsonBytes } = require('../mesa');

test('nota nasce vazia', () => {
  assert.deepEqual(nota.init({}), { text: '', by: null, rev: 0 });
});

test('validate aceita texto ate 1000 caracteres (emoji conta como um)', () => {
  const s = nota.init({});
  assert.equal(nota.validate(s, { kind: 'set', text: 'oi' }), true);
  assert.equal(nota.validate(s, { kind: 'set', text: '😀'.repeat(1000) }), true);
  assert.equal(typeof nota.validate(s, { kind: 'set', text: 'a'.repeat(1001) }), 'string');
  assert.equal(typeof nota.validate(s, { kind: 'set', text: 5 }), 'string');
  assert.equal(typeof nota.validate(s, { kind: 'apagar' }), 'string');
  assert.equal(typeof nota.validate(s, null), 'string');
});

test('reduce: o ultimo que salva vence, sem mutar o anterior', () => {
  const s0 = nota.init({});
  const s1 = nota.reduce(s0, { kind: 'set', text: 'da Ana' }, { from: '1' });
  const s2 = nota.reduce(s1, { kind: 'set', text: 'da Bia' }, { from: '2' });
  assert.deepEqual(s0, { text: '', by: null, rev: 0 });
  assert.deepEqual(s1, { text: 'da Ana', by: '1', rev: 1 });
  assert.deepEqual(s2, { text: 'da Bia', by: '2', rev: 2 });
});

test('o pior texto valido cabe no teto do estado', () => {
  const pior = '\u0000'.repeat(1000); // cada um vira \u0000 (6 bytes) no JSON
  assert.equal(nota.validate(nota.init({}), { kind: 'set', text: pior }), true);
  assert.ok(jsonBytes(nota.reduce(nota.init({}), { kind: 'set', text: pior }, { from: '12345' })) <= nota.maxStateBytes);
});
