'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./comum');
const janela = require('./domino');

test('dominó desenha pontos SVG e reconhece pedra que encaixa', () => {
  assert.match(janela.pedraSvg([6, 0]), /<circle/g);
  const s = { phase: 'play', me: { seat: 0 }, turn: 0, ends: [2, 5] };
  assert.equal(janela.podeJogar(s, [2, 6]), true);
  assert.equal(janela.podeJogar(s, [1, 4]), false);
});

test('dominó mostra prazo pela hora do servidor', () => {
  assert.equal(janela.segundos(31000, 1000), 30);
  assert.equal(janela.segundos(null, 1000), null);
});
