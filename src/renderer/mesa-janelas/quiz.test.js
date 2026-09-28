'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Quiz envia estado proprio e alheio para a barra', () => {
  const janela = require('./quiz');
  const chamadas = [];
  const api = { setStatus: (v) => chamadas.push(['status', v]), setTurn: (v) => chamadas.push(['turn', v]) };
  janela.atualizarBarra(api, 'Pergunta 1 de 5', true);
  janela.atualizarBarra(api, 'Resposta registrada', false);
  assert.deepEqual(chamadas, [
    ['status', 'Pergunta 1 de 5'], ['turn', true], ['status', 'Resposta registrada'], ['turn', false],
  ]);
});

test('janela Quiz registra o tipo e expõe mount', () => {
  require('./comum');
  const janela = require('./quiz');
  assert.equal(janela.type, 'quiz');
  assert.equal(typeof janela.mount, 'function');
});
