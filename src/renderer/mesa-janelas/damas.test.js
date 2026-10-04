'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../i18n');
const janela = require('./damas');

test('Damas envia estado proprio e alheio para a barra', () => {
  const chamadas = [];
  const api = { setStatus: (v) => chamadas.push(['status', v]), setTurn: (v) => chamadas.push(['turn', v]) };
  janela.atualizarBarra(api, 'Sua vez', true);
  janela.atualizarBarra(api, 'Vez de Escuras', false);
  assert.deepEqual(chamadas, [['status', 'Sua vez'], ['turn', true], ['status', 'Vez de Escuras'], ['turn', false]]);
});

test('nomePeca e empate saem pelo dicionario do idioma ativo', () => {
  const { definirIdioma } = require('../i18n');
  try {
    assert.equal(janela.nomePeca('C'), 'dama clara');
    assert.equal(janela.nomePeca('.'), 'vazia');
    assert.equal(janela.empate({ reason: 'damas' }), 'Empate: 20 lances só de damas');
    assert.equal(janela.empate(null), 'Empate');
    definirIdioma('en');
    assert.equal(janela.nomePeca('e'), 'dark man');
    assert.equal(janela.empate({ reason: 'damas' }), 'Draw: 20 moves with only kings');
    assert.deepEqual(janela.rotulos(), ['Light', 'Dark']);
  } finally {
    definirIdioma('pt-BR');
  }
});
