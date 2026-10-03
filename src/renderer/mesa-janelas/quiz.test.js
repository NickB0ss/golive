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

// ---------- Montagem (DOM falso) ----------
const { montar } = require('./dom-falso-leva3');

const estadoQuiz = () => ({
  question: { pergunta: 'Qual a capital?', alternativas: ['Rio', 'Brasília', 'Lima', 'Quito'] },
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
