'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// O conteudo desta janela e todo DOM (canvas, pointer events): o que da
// pra testar sem navegador e que o arquivo carrega em Node sem tocar em
// `document`/`ResizeObserver` fora do `mount` (a logica de permissao —
// quem pode limpar — ja e testada a serio em mesa-modules/quadro.test.js,
// contra o `canAnnotateClear` que o servidor de verdade confere).
test('carrega em Node (sem document) e se registra com o tipo certo', () => {
  const J = require('./quadro');
  assert.equal(J.type, 'quadro');
  assert.equal(typeof J.mount, 'function');
});

test('mount so precisa de document na hora de montar, nao ao carregar o arquivo', () => {
  assert.doesNotThrow(() => { delete require.cache[require.resolve('./quadro')]; require('./quadro'); });
});
