'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const janela = require('./xadrez');

test('Xadrez envia estado proprio e alheio para a barra', () => {
  const chamadas = [];
  const api = { setStatus: (v) => chamadas.push(['status', v]), setTurn: (v) => chamadas.push(['turn', v]) };
  janela.atualizarBarra(api, 'Sua vez (xeque)', true);
  janela.atualizarBarra(api, 'Vez de Pretas', false);
  assert.deepEqual(chamadas, [['status', 'Sua vez (xeque)'], ['turn', true], ['status', 'Vez de Pretas'], ['turn', false]]);
});
