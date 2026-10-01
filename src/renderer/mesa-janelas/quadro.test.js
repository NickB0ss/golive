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

test('visibilidade do Quadro: botao so aparece para quem criou e os outros recebem o aviso', () => {
  const J = require('./quadro');
  const nome = (id) => (id === '7' ? 'Ana' : null);
  const dona = J.visibilidadeQuadro({ owner: '7', hidden: true }, '7', nome);
  const outra = J.visibilidadeQuadro({ owner: '7', hidden: true }, '9', nome);
  assert.equal(dona.mostraBotao, true);
  assert.equal(dona.textoBotao, 'Mostrar a todos');
  assert.equal(dona.semAcesso, false);
  assert.equal(outra.mostraBotao, false);
  assert.equal(outra.semAcesso, true);
  assert.equal(outra.aviso, 'Ana escondeu o quadro');
});

test('o retrato so e enviado ao mostrar um quadro antes escondido pela dona', () => {
  const J = require('./quadro');
  assert.equal(J.deveEnviarRetrato({ owner: '7', hidden: true }, { owner: '7', hidden: false }, '7'), true);
  assert.equal(J.deveEnviarRetrato({ owner: '7', hidden: false }, { owner: '7', hidden: false }, '7'), false);
  assert.equal(J.deveEnviarRetrato({ owner: '7', hidden: true }, { owner: '7', hidden: true }, '7'), false);
  assert.equal(J.deveEnviarRetrato({ owner: '7', hidden: true }, { owner: '7', hidden: false }, '9'), false);
});

test('perder acesso ao esconder o quadro move o foco para o aviso', () => {
  const J = require('./quadro');
  assert.equal(J.perdeAcessoAoEsconder({ hidden: false }, { hidden: true }, false), true);
  assert.equal(J.perdeAcessoAoEsconder({ hidden: false }, { hidden: true }, true), false);
  assert.equal(J.perdeAcessoAoEsconder({ hidden: true }, { hidden: true }, false), false);
});
