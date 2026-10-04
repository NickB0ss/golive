'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../i18n');
const janela = require('./lig4');

test('Lig 4 envia estado proprio e alheio para a barra', () => {
  const chamadas = [];
  const api = { setStatus: (v) => chamadas.push(['status', v]), setTurn: (v) => chamadas.push(['turn', v]) };
  janela.atualizarBarra(api, 'Sua vez', true);
  janela.atualizarBarra(api, 'Vez de Amarelas', false);
  assert.deepEqual(chamadas, [['status', 'Sua vez'], ['turn', true], ['status', 'Vez de Amarelas'], ['turn', false]]);
});

test('rotulos e rotuloColuna acompanham o idioma', () => {
  const { definirIdioma } = require('../i18n');
  try {
    assert.deepEqual(janela.rotulos(), ['Vermelhas', 'Amarelas']);
    const vazio = Array.from({ length: 6 }, () => '.......');
    assert.equal(janela.rotuloColuna(vazio, 0), 'Coluna 1: 6 casas livres');
    const quase = vazio.map((l, i) => (i === 0 ? l : `${l.slice(0, 3)}X${l.slice(4)}`));
    assert.equal(janela.rotuloColuna(quase, 3), 'Coluna 4: 1 casa livre');
    const cheia = vazio.map((l) => `${l.slice(0, 3)}X${l.slice(4)}`);
    assert.equal(janela.rotuloColuna(cheia, 3), 'Coluna 4: cheia');
    definirIdioma('en');
    assert.equal(janela.rotuloColuna(quase, 3), 'Column 4: 1 free cell');
    assert.equal(janela.empate(), 'Draw, board full');
  } finally {
    definirIdioma('pt-BR');
  }
});
