'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const galeria = require('./galeria');
const registry = require('./index');

test('galeria esta no registro, no grupo ferramentas', () => {
  const m = registry.get('galeria');
  assert.equal(m.title, 'Galeria');
  assert.equal(m.group, 'ferramentas');
});

test('a galeria nao guarda nada da sala e nao tem acoes', () => {
  const s = galeria.init({});
  assert.deepEqual(s, {});
  assert.equal(typeof galeria.validate(s, { kind: 'set' }), 'string');
  assert.equal(galeria.reduce(s, {}), s);
  assert.equal(galeria.summary(s), 'Imagens do chat');
});
