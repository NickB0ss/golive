'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const banco = require('./quiz-perguntas');
const quiz = require('./quiz');

const PEERS = [{ id: 'ana', name: 'Ana' }, { id: 'bia', name: 'Bia' }, { id: 'caio', name: 'Caio' }];
const aleatorio = () => 0.25;
const estado = (extra) => quiz.init({ now: 1000, peers: PEERS, random: aleatorio, ...(extra || {}) });
const contexto = (from, extra) => ({ from, peers: PEERS, now: 1000, isLeader: from === 'ana', ...(extra || {}) });

test('banco tem pelo menos 120 perguntas autorais validas', () => {
  assert.ok(banco.perguntas.length >= 120);
  assert.equal(banco.validarBanco(), true);
  assert.equal(new Set(banco.perguntas.map((q) => q.pergunta)).size, banco.perguntas.length);
  for (const q of banco.perguntas) {
    assert.equal(q.alternativas.length, 4);
    assert.equal(new Set(q.alternativas).size, 4);
    assert.ok(q.certa >= 0 && q.certa < 4);
  }
});

test('banco exibe acentuacao e as perguntas revisadas', () => {
  const textos = banco.perguntas.flatMap((q) => [q.pergunta, ...q.alternativas]);
  assert.equal(textos.some((texto) => /[Ã�]/u.test(texto)), false);
  assert.equal(textos.includes('Qual é a capital do Brasil?'), true);
  assert.equal(textos.includes('Brasília'), true);
  assert.equal(textos.includes('Qual estado brasileiro tem formato aproximado de uma bota?'), false);
  assert.equal(textos.includes('Qual instrumento aparece com destaque no frevo?'), false);
  assert.equal(textos.includes('Qual objeto colorido os passistas levam na mão ao dançar frevo?'), true);
  assert.equal(textos.includes('Qual instrumento de cordas pequeno é presença constante nas rodas de samba e choro?'), true);
});

test('init sorteia dez perguntas e registra todos os participantes', () => {
  const s = estado();
  assert.equal(s.questions.length, 10);
  assert.deepEqual(s.players, ['ana', 'bia', 'caio']);
  assert.equal(s.round, 0);
  assert.equal(s.deadline, 21000);
});

test('prepare ignora a identidade enviada e calcula tempo pelo relogio do servidor', () => {
  const s = estado();
  const a = quiz.prepare(s, { kind: 'answer', by: 'bia', option: 2 }, { from: 'ana', now: 8500 });
  assert.deepEqual(a, { kind: 'answer', by: 'ana', option: 2, seconds: 8 });
});

test('resposta fora da partida e recusada', () => {
  assert.equal(quiz.validate(estado(), { kind: 'answer', option: 0 }, contexto('desconhecido')),
    'Voce entrou depois da partida');
});

test('resposta fora do intervalo e recusada', () => {
  assert.equal(quiz.validate(estado(), { kind: 'answer', option: 4 }, contexto('ana')), 'Alternativa invalida');
});

test('resposta duplicada e recusada', () => {
  const s = quiz.reduce(estado(), { kind: 'answer', by: 'ana', option: 0, seconds: 2 }, contexto('ana'));
  assert.equal(quiz.validate(s, { kind: 'answer', option: 1 }, contexto('ana')), 'Voce ja respondeu');
});

test('respostas ficam no servidor ate todos responderem', () => {
  const s = quiz.reduce(estado(), { kind: 'answer', by: 'ana', option: 0, seconds: 2 }, contexto('ana'));
  const view = quiz.view(s, 'bia', contexto('bia'));
  assert.equal(view.me.answer, null);
  assert.equal(view.players.find((p) => p.by === 'ana').answered, true);
  assert.equal(view.history.length, 0);
});

test('a view revela a resposta de cada um quando todos responderam', () => {
  let s = estado();
  for (const by of ['ana', 'bia', 'caio']) {
    s = quiz.reduce(s, { kind: 'answer', by, option: 0, seconds: 4 }, contexto(by));
  }
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].results.length, 3);
  assert.equal(quiz.view(s, 'caio', contexto('caio')).history[0].results.length, 3);
});

test('resposta certa vale mil menos o tempo, com desconto maximo de quinhentos', () => {
  const s = estado();
  const q = banco.perguntas[s.questions[0]];
  let n = s;
  for (const [i, by] of ['ana', 'bia', 'caio'].entries()) {
    n = quiz.reduce(n, {
      kind: 'answer', by, option: i === 0 ? q.certa : 1, seconds: i === 0 ? 12 : 700,
    }, contexto(by));
  }
  const r = n.history[0].results;
  assert.equal(r.find((x) => x.by === 'ana').points, 988);
  assert.equal(r.find((x) => x.by === 'bia').points, 0);
});

test('timeout aceita a pergunta incompleta e pontua apenas quem acertou', () => {
  const s = estado();
  const q = banco.perguntas[s.questions[0]];
  const n = quiz.reduce(s, { kind: 'answer', by: 'ana', option: q.certa, seconds: 3 }, contexto('ana'));
  const fim = quiz.reduce(n, { kind: 'timeout' }, { now: 21000, peers: PEERS });
  assert.equal(fim.history.length, 1);
  assert.equal(fim.history[0].results.find((x) => x.by === 'bia').points, 0);
});

test('timeout tem prazo de vinte segundos e some ao terminar a partida', () => {
  const s = estado();
  assert.equal(quiz.timeoutAt(s), 21000);
  let n = s;
  for (let rodada = 0; rodada < 10; rodada++) {
    n = quiz.reduce(n, { kind: 'timeout' }, { now: 21000 + rodada * 20000, peers: PEERS });
  }
  assert.equal(n.finished, true);
  assert.equal(quiz.timeoutAt(n), null);
});

test('dez rodadas formam uma partida completa', () => {
  let s = estado();
  for (let i = 0; i < 10; i++) s = quiz.reduce(s, { kind: 'timeout' }, { now: 30000 + i * 20000, peers: PEERS });
  assert.equal(s.history.length, 10);
  assert.equal(s.round, 9);
  assert.equal(s.finished, true);
});

test('nova pergunta limpa respostas e mantem o placar', () => {
  let s = estado();
  for (const by of ['ana', 'bia', 'caio']) {
    s = quiz.reduce(s, { kind: 'answer', by, option: 0, seconds: 1 }, contexto(by));
  }
  assert.equal(s.answers.length, 0);
  assert.equal(s.round, 1);
  assert.ok(s.scores.every((x) => x.points >= 0));
});

test('dropPeer retira quem saiu e libera o lugar fantasma logico', () => {
  const s = estado();
  const n = quiz.dropPeer(s, 'bia');
  assert.deepEqual(n.players, ['ana', 'caio']);
  assert.equal(n.scores.some((x) => x.by === 'bia'), false);
});

test('dropPeer apos resposta de dois revela sem esperar a pessoa que saiu', () => {
  let s = estado();
  s = quiz.reduce(s, { kind: 'answer', by: 'ana', option: 0, seconds: 1 }, contexto('ana'));
  s = quiz.reduce(s, { kind: 'answer', by: 'bia', option: 0, seconds: 1 }, contexto('bia'));
  const n = quiz.dropPeer(s, 'caio');
  assert.equal(n.history.length, 1);
});

test('migrate remove respostas e participantes da sala antiga', () => {
  const s = estado();
  const n = quiz.migrate(s);
  assert.deepEqual(n.players, []);
  assert.deepEqual(n.answers, []);
  assert.equal(n.deadline, null);
  assert.equal(n.finished, true);
});

test('view filtra a resposta de cada pessoa', () => {
  const s = quiz.reduce(estado(), { kind: 'answer', by: 'ana', option: 1, seconds: 1 }, contexto('ana'));
  assert.equal(quiz.view(s, 'ana', contexto('ana')).me.answer, 1);
  assert.equal(quiz.view(s, 'bia', contexto('bia')).me.answer, null);
});

test('view mostra placar publico e pergunta sem o indice certo', () => {
  const s = estado();
  const v = quiz.view(s, 'caio', contexto('caio'));
  assert.equal(v.question.alternativas.length, 4);
  assert.equal(Object.hasOwn(v.question, 'certa'), false);
  assert.equal(v.players.length, 3);
});

test('reset so pode ser pedido pelo lider e sorteia nova partida', () => {
  const s = estado();
  assert.equal(quiz.validate(s, { kind: 'reset' }, contexto('bia')), 'So o lider pode reiniciar');
  const a = quiz.prepare(s, { kind: 'reset' }, contexto('ana'));
  const n = quiz.reduce(s, a, contexto('ana'));
  assert.equal(n.round, 0);
  assert.equal(n.history.length, 0);
  assert.equal(n.players.length, 3);
});

test('acao desconhecida, timeout sem partida e contexto ausente sao seguros', () => {
  const s = estado();
  assert.equal(quiz.validate(s, { kind: 'nope' }, contexto('ana')), 'Acao desconhecida');
  assert.equal(quiz.validate({ ...s, finished: true }, { kind: 'timeout' }, contexto('ana')), 'Nada correndo');
  assert.equal(quiz.validate(s, null, null), 'Acao invalida');
});
