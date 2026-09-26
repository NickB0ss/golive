'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('janela Quiz registra o tipo e expõe mount', () => {
  require('./comum');
  const janela = require('./quiz');
  assert.equal(janela.type, 'quiz');
  assert.equal(typeof janela.mount, 'function');
});
