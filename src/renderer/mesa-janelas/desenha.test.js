'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Conteudo todo DOM (canvas, formulario, botoes): o que da pra testar sem
// navegador e que o arquivo carrega em Node sem tocar em `document` fora do
// `mount`. A logica de verdade (quem pode desenhar, palavra secreta,
// pontos) ja e testada a serio em mesa-modules/desenha.test.js contra o
// que o servidor de fato confere.
test('carrega em Node (sem document) e se registra com o tipo certo', () => {
  const J = require('./desenha');
  assert.equal(J.type, 'desenha');
  assert.equal(typeof J.mount, 'function');
});
