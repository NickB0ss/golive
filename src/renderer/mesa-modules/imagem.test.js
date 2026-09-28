'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const imagem = require('./imagem');
const registry = require('./index');
const { jsonBytes } = require('../mesa');

test('imagem esta no registro, no grupo ferramentas', () => {
  const m = registry.get('imagem');
  assert.equal(m.title, 'Imagem');
  assert.equal(m.group, 'ferramentas');
  assert.ok(registry.addable().some((x) => x.type === 'imagem'));
});

test('nasce sem imagem', () => {
  assert.deepEqual(imagem.init({}), { msgId: null, by: null, rev: 0 });
  assert.equal(imagem.summary(imagem.init({})), 'Nenhuma imagem');
});

test('validate: so o id da mensagem, nunca a imagem', () => {
  const s = imagem.init({});
  assert.equal(imagem.validate(s, { kind: 'set', msgId: '123' }), true);
  assert.equal(typeof imagem.validate(s, { kind: 'set', msgId: 'data:image/png;base64,AAAA' }), 'string');
  assert.equal(typeof imagem.validate(s, { kind: 'set', msgId: 'x'.repeat(33) }), 'string');
  assert.equal(typeof imagem.validate(s, { kind: 'set', msgId: 5 }), 'string');
  assert.equal(typeof imagem.validate(s, { kind: 'outra' }), 'string');
  assert.equal(typeof imagem.validate(s, null), 'string');
});

test('reduce troca a imagem, sem mutar o anterior, e o estado fica pequeno', () => {
  const s0 = imagem.init({});
  const s1 = imagem.reduce(s0, { kind: 'set', msgId: '12' }, { from: '3' });
  const s2 = imagem.reduce(s1, { kind: 'set', msgId: '15' }, { from: '4' });
  assert.deepEqual(s0, { msgId: null, by: null, rev: 0 });
  assert.deepEqual(s1, { msgId: '12', by: '3', rev: 1 });
  assert.deepEqual(s2, { msgId: '15', by: '4', rev: 2 });
  assert.equal(imagem.summary(s2), 'Imagem do chat');
  const pior = imagem.reduce(s0, { kind: 'set', msgId: 'x'.repeat(32) }, { from: 'y'.repeat(100) });
  assert.ok(jsonBytes(pior) <= imagem.maxStateBytes);
});
