'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const janela = require('./oito');

test('textoDeStatus mostra a vez e o placar da rodada', () => {
  const state = {
    phase: 'play',
    turn: 1,
    seats: ['ana', 'bia'],
    names: ['Ana', 'Bia'],
    scores: [20, 40],
  };

  assert.equal(janela.textoDeStatus(state), 'Vez de Bia — 20 × 40 pontos');
});

test('podeJogar reconhece naipe, valor e oito', () => {
  assert.equal(janela.podeJogar('2h', 'Kh', 'h'), true);
  assert.equal(janela.podeJogar('Ks', 'Kh', 'h'), true);
  assert.equal(janela.podeJogar('8c', 'Kh', 'h'), true);
  assert.equal(janela.podeJogar('3s', 'Kh', 'h'), false);
});
