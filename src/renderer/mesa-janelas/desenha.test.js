'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../i18n');
require('../mesa-modules/desenha');

test('Desenha envia estado proprio e alheio para a barra', () => {
  const J = require('./desenha');
  const chamadas = [];
  const api = { setStatus: (v) => chamadas.push(['status', v]), setTurn: (v) => chamadas.push(['turn', v]) };
  J.atualizarBarra(api, 'Sua vez de desenhar', true);
  J.atualizarBarra(api, 'Bia está desenhando', false);
  assert.deepEqual(chamadas, [
    ['status', 'Sua vez de desenhar'], ['turn', true], ['status', 'Bia está desenhando'], ['turn', false],
  ]);
});

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

// ---------- Montagem (DOM falso) ----------
require('../annotate');
require('./comum');
const { montar } = require('./dom-falso-leva3');

const lobby = (extra = {}) => ({
  phase: 'lobby', round: 0, players: [], me: { joined: false, isDrawer: false }, ...extra,
});

test('desenha esperando gente mostra o vazio com "Entrar na rodada" como acao', () => {
  const t = montar(require('./desenha'), lobby());
  const entrar = t.botao('Entrar na rodada');
  assert.ok(entrar.parentNode.parentNode.classList.contains('mj-vazio'));
  entrar.click();
  assert.deepEqual(t.acoes, [{ kind: 'join' }]);
  t.destruir();
});

test('desenha: mostra os tracos no tamanho do idioma ativo', () => {
  const { definirIdioma } = globalThis.GoLive.i18n;
  definirIdioma('en');
  const t = montar(require('./desenha'), {
    phase: 'drawing', round: 1, players: [], drawerId: '1', deadline: 0,
    word: null, wordLens: { pt: 8, en: 9, es: 8 }, iGuessed: false,
    me: { joined: true, isDrawer: false },
  });
  assert.equal(t.achar('.mj-ds-palavra').textContent, '_ _ _ _ _ _ _ _ _');
  t.destruir();
  definirIdioma('pt-BR');
});

test('desenha: Começar e a acao principal do rodape e Sair e secundaria', () => {
  const t = montar(require('./desenha'), lobby({ me: { joined: true, isDrawer: false } }));
  const comecar = t.botao('Começar');
  assert.ok(comecar.parentNode.classList.contains('mj-acoes'));
  assert.ok(comecar.classList.contains('mj-pri'));
  assert.ok(t.botao('Sair da rodada').classList.contains('mj-fantasma'));
  assert.equal(t.botao('Entrar na rodada').hidden, true);
  t.destruir();
});
