'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const janela = require('./lig4');

test('Lig 4 envia estado proprio e alheio para a barra', () => {
  const chamadas = [];
  const api = { setStatus: (v) => chamadas.push(['status', v]), setTurn: (v) => chamadas.push(['turn', v]) };
  janela.atualizarBarra(api, 'Sua vez', true);
  janela.atualizarBarra(api, 'Vez de Amarelas', false);
  assert.deepEqual(chamadas, [['status', 'Sua vez'], ['turn', true], ['status', 'Vez de Amarelas'], ['turn', false]]);
});
