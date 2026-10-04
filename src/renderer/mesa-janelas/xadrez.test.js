'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../i18n');
const janela = require('./xadrez');

test('Xadrez envia estado proprio e alheio para a barra', () => {
  const chamadas = [];
  const api = { setStatus: (v) => chamadas.push(['status', v]), setTurn: (v) => chamadas.push(['turn', v]) };
  janela.atualizarBarra(api, 'Sua vez (xeque)', true);
  janela.atualizarBarra(api, 'Vez de Pretas', false);
  assert.deepEqual(chamadas, [['status', 'Sua vez (xeque)'], ['turn', true], ['status', 'Vez de Pretas'], ['turn', false]]);
});

test('nomePeca e empate: pt-BR como antes, en e es pela chave de frase', () => {
  const { definirIdioma } = require('../i18n');
  try {
    assert.equal(janela.nomePeca({ type: 'p', color: 'w' }), 'peão branco');
    assert.equal(janela.nomePeca({ type: 'q', color: 'b' }), 'dama preta');
    assert.equal(janela.nomePeca(null), 'vazia');
    assert.equal(janela.empate({ reason: 'cinquenta' }), 'Empate pela regra dos 50 lances');
    assert.equal(janela.empate({ reason: 'x' }), 'Empate');
    definirIdioma('en');
    assert.equal(janela.nomePeca({ type: 'q', color: 'b' }), 'black queen');
    assert.deepEqual(janela.rotulos(), ['White', 'Black']);
    definirIdioma('es');
    assert.equal(janela.nomePeca({ type: 'r', color: 'w' }), 'torre blanca');
    assert.equal(janela.nomePeca({ type: 'k', color: 'b' }), 'rey negro');
  } finally {
    definirIdioma('pt-BR');
  }
});
