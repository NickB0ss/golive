'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const i18n = require('../i18n');
const banco = require('../mesa-modules/quiz-perguntas');

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

// ---------- Montagem (DOM falso) ----------
const { montar } = require('./dom-falso-leva3');

const PERGUNTA = banco.perguntas[0];
const estadoQuiz = () => ({
  setup: false, temas: [...banco.TEMAS],
  question: { id: PERGUNTA.id, tema: PERGUNTA.tema, ordem: [0, 1, 2, 3] },
  round: 0, total: 10, deadline: null, finished: false, can: {}, history: [],
  me: { canAnswer: true, answered: false, answer: null },
  players: [{ by: '1', answered: false, score: 0 }, { by: '2', answered: true, score: 10 }],
});

test('quiz nao repete o titulo da barra e a pergunta N de M fica na linha de estado', () => {
  require('./comum');
  const t = montar(require('./quiz'), estadoQuiz());
  assert.ok(!t.texto().includes('Quiz'));
  assert.equal(t.achar('.mj-quiz-topo').children[0].textContent, 'Pergunta 1 de 10');
  t.destruir();
});

test('quiz mostra as alternativas como cartoes A-D e o placar com avatar', () => {
  const t = montar(require('./quiz'), estadoQuiz());
  const cartoes = t.todos('.mj-quiz-opcao');
  assert.equal(cartoes.length, 4);
  assert.equal(cartoes[1].children[0].textContent, 'B.');
  assert.ok(cartoes[1].children[0].classList.contains('mj-quiz-letra'));
  assert.equal(t.todos('.mj-cadeira-avatar').length, 2);
  assert.equal(t.todos('.mj-cadeira-avatar')[0].textContent, 'A');
  t.destruir();
});

test('quiz em preparo mostra uma caixa por tema, rotulada no idioma, e o botao Começar', () => {
  require('./comum');
  const preparo = { ...estadoQuiz(), setup: true, question: null, temas: ['games', 'anime'], can: { start: true } };
  const t = montar(require('./quiz'), preparo);
  const caixas = t.todos('.mj-quiz-tema');
  assert.equal(caixas.length, 8);
  assert.equal(caixas[0].children[1].textContent, 'Games');
  assert.equal(caixas[0].children[0].checked, true);
  assert.equal(caixas[2].children[0].checked, false);
  assert.ok(t.botao('Começar'));
  t.destruir();
});

test('quiz em preparo: marcar manda os temas e Começar manda start', () => {
  require('./comum');
  const preparo = { ...estadoQuiz(), setup: true, question: null, temas: ['games'], can: { start: true } };
  const t = montar(require('./quiz'), preparo);
  const caixas = t.todos('.mj-quiz-tema').map((l) => l.children[0]);
  caixas[1].checked = true;
  t.achar('.mj-quiz-temas').dispatch('change');
  assert.deepEqual(t.acoes[0], { kind: 'temas', temas: ['games', 'anime'] });
  t.botao('Começar').click();
  assert.deepEqual(t.acoes[1], { kind: 'start' });
  t.destruir();
});

test('quiz em preparo: desmarcar o ultimo tema e desfeito e nada e enviado', () => {
  require('./comum');
  const preparo = { ...estadoQuiz(), setup: true, question: null, temas: ['games'], can: { start: true } };
  const t = montar(require('./quiz'), preparo);
  const caixa = t.todos('.mj-quiz-tema')[0].children[0];
  caixa.checked = false;
  t.achar('.mj-quiz-temas').dispatch('change');
  assert.equal(caixa.checked, true);
  assert.equal(t.acoes.length, 0);
  assert.match(t.achar('.mj-quiz-status').textContent, /tema/);
  t.destruir();
});

test('quiz mostra a pergunta e as alternativas no idioma de quem le, na ordem da view', () => {
  require('./comum');
  const estado = estadoQuiz();
  estado.question.ordem = [3, 2, 1, 0];
  try {
    for (const [idioma, lingua] of [['pt-BR', 'pt'], ['en', 'en'], ['es', 'es']]) {
      i18n.definirIdioma(idioma);
      const t = montar(require('./quiz'), estado);
      assert.equal(t.achar('.mj-quiz-pergunta').textContent, PERGUNTA[lingua][0], idioma);
      const alts = t.todos('.mj-quiz-opcao').map((b) => b.children[1].textContent);
      assert.deepEqual(alts, [...PERGUNTA[lingua][1]].reverse(), idioma);
      assert.equal(t.achar('.mj-quiz-tema-pergunta').textContent, i18n.t('quiz.tema.games'), idioma);
      t.destruir();
    }
  } finally { i18n.definirIdioma('pt-BR'); }
});
