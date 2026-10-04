'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const banco = require('./quiz-perguntas');
const quiz = require('./quiz');
const i18n = require('../i18n');

const PEERS = [{ id: 'ana', name: 'Ana' }, { id: 'bia', name: 'Bia' }, { id: 'caio', name: 'Caio' }];
const aleatorio = () => 0.25;
const contexto = (from, extra) => ({ from, peers: PEERS, now: 1000, isLeader: from === 'ana', ...(extra || {}) });
const preparo = () => quiz.init({ now: 1000, peers: PEERS, random: aleatorio });
// Partida ja comecada: o 'start' passa por prepare + reduce, como no servidor da sala.
const estado = () => {
  const s = preparo();
  return quiz.reduce(s, quiz.prepare(s, { kind: 'start' }, { ...contexto('ana'), random: aleatorio }), contexto('ana'));
};

test('banco provisorio: formato valido nas tres linguas e consulta por id e idioma', () => {
  assert.ok(banco.perguntas.length >= 8 * 10);
  assert.equal(banco.validarBanco(10), true);
  for (const tema of banco.TEMAS) assert.ok(banco.perguntas.filter((q) => q.tema === tema).length >= 10, tema);
  const q = banco.perguntas[0];
  assert.equal(banco.porId(q.id), q);
  assert.equal(banco.porId('nao-existe'), null);
  assert.equal(banco.texto(q, 'en').pergunta, q.en[0]);
  assert.deepEqual(banco.texto(q, 'es').alternativas, q.es[1]);
  assert.equal(banco.texto(q, 'pt-BR').pergunta, q.pt[0]);
});

test('validarBanco recusa o tema que não chegou ao mínimo', () => {
  // Enquanto algum tema estiver provisorio (Tarefas 14a-14h), o minimo de 60 reprova; a 14i troca este teste.
  assert.throws(() => banco.validarBanco(60), /Tema \w+/);
});

test('nasce em preparo, com todos os temas marcados e sem rodada', () => {
  const s = preparo();
  assert.equal(s.setup, true);
  assert.deepEqual(s.temas, [...banco.TEMAS]);
  assert.equal(quiz.timeoutAt(s), null);
});

test('temas: subconjunto não vazio, sem repetição, só em preparo', () => {
  const s = preparo();
  assert.equal(quiz.validate(s, { kind: 'temas', temas: ['games'] }, contexto('bia')), true);
  assert.notEqual(quiz.validate(s, { kind: 'temas', temas: [] }, contexto('bia')), true);
  assert.notEqual(quiz.validate(s, { kind: 'temas', temas: ['games', 'games'] }, contexto('bia')), true);
  assert.notEqual(quiz.validate(s, { kind: 'temas', temas: ['xadrez'] }, contexto('bia')), true);
  assert.equal(quiz.validate(estado(), { kind: 'temas', temas: ['games'] }, contexto('bia')),
    i18n.codigo('mesa.quiz.jaComecou'));
});

test('start sorteia 10 perguntas só dos temas marcados', () => {
  let s = preparo();
  s = quiz.reduce(s, { kind: 'temas', temas: ['anime'] }, contexto('ana'));
  const acao = quiz.prepare(s, { kind: 'start' }, { ...contexto('ana'), random: aleatorio });
  s = quiz.reduce(s, acao, contexto('ana'));
  assert.equal(s.setup, false);
  assert.equal(s.questions.length, 10);
  assert.ok(s.questions.every((id) => banco.porId(id).tema === 'anime'));
  assert.equal(new Set(s.questions).size, 10);
  assert.equal(quiz.validate(s, { kind: 'start' }, contexto('ana')), i18n.codigo('mesa.quiz.jaComecou'));
});

test('a view manda id, tema e ordem -- nunca texto', () => {
  const s = estado();
  const v = quiz.view(s, 'bia', contexto('bia'));
  assert.deepEqual(Object.keys(v.question).sort(), ['id', 'ordem', 'tema']);
  assert.equal(v.question.ordem.length, 4);
  // Nenhum campo da view (history, revealed, o que for) carrega texto do banco,
  // em nenhuma lingua: so ids, indices e codigos atravessam a rede.
  const json = JSON.stringify(v);
  for (const p of banco.perguntas) {
    for (const l of ['pt', 'en', 'es']) {
      assert.ok(!json.includes(JSON.stringify(p[l][0])), `${p.id} ${l}: enunciado na view`);
      for (const alt of p[l][1]) assert.ok(!json.includes(JSON.stringify(alt)), `${p.id} ${l}: "${alt}" na view`);
    }
  }
  const estadoJson = JSON.stringify(s);
  for (const p of banco.perguntas) assert.ok(!estadoJson.includes(JSON.stringify(p.pt[0])), p.id);
});

test('reset volta ao preparo mantendo os temas', () => {
  let s = preparo();
  s = quiz.reduce(s, { kind: 'temas', temas: ['musica', 'filmes'] }, contexto('ana'));
  s = quiz.reduce(s, quiz.prepare(s, { kind: 'start' }, { ...contexto('ana'), random: aleatorio }), contexto('ana'));
  s = quiz.reduce(s, quiz.prepare(s, { kind: 'reset' }, contexto('ana')), contexto('ana'));
  assert.equal(s.setup, true);
  assert.deepEqual(s.temas, ['musica', 'filmes']);
});

test('em preparo, responder e estourar o prazo são recusados', () => {
  const s = preparo();
  assert.equal(quiz.validate(s, { kind: 'answer', option: 0 }, contexto('ana')), i18n.codigo('mesa.quiz.emPreparo'));
  assert.equal(quiz.validate(s, { kind: 'timeout' }, contexto('ana')), i18n.codigo('mesa.quiz.emPreparo'));
});

test('migrate de partida em andamento volta ao preparo, com os mesmos temas e nada da rodada', () => {
  let s = preparo();
  s = quiz.reduce(s, { kind: 'temas', temas: ['anime', 'games'] }, contexto('ana'));
  s = quiz.reduce(s, quiz.prepare(s, { kind: 'start' }, { ...contexto('ana'), random: aleatorio }), contexto('ana'));
  const m = quiz.migrate(s);
  assert.equal(m.setup, true);
  assert.deepEqual(m.temas, ['games', 'anime']);
  assert.equal(quiz.timeoutAt(m), null);
  for (const campo of ['ordens', 'questions', 'answers', 'history']) {
    assert.ok(!m[campo] || m[campo].length === 0, campo);
  }
  assert.equal(quiz.validate(m, { kind: 'start' }, contexto('bia')), true);
  assert.deepEqual(quiz.migrate({ ...s, temas: ['xadrez'] }).temas, [...banco.TEMAS]);
});

test('start sorteia dez perguntas e registra todos os participantes', () => {
  const s = estado();
  assert.equal(s.questions.length, 10);
  assert.equal(s.ordens.length, 10);
  assert.ok(s.ordens.every((ordem) => ordem.length === 4 && new Set(ordem).size === 4));
  assert.ok(Buffer.byteLength(JSON.stringify(s)) <= 16 * 1024);
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
    i18n.codigo('mesa.quiz.entrouDepois'));
});

test('resposta fora do intervalo e recusada', () => {
  assert.equal(quiz.validate(estado(), { kind: 'answer', option: 4 }, contexto('ana')),
    i18n.codigo('mesa.quiz.alternativaInvalida'));
});

test('resposta duplicada e recusada', () => {
  const s = quiz.reduce(estado(), { kind: 'answer', by: 'ana', option: 0, seconds: 2 }, contexto('ana'));
  assert.equal(quiz.validate(s, { kind: 'answer', option: 1 }, contexto('ana')), i18n.codigo('mesa.quiz.jaRespondeu'));
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
  const q = banco.porId(s.questions[0]);
  const certa = s.ordens[0].indexOf(q.certa);
  let n = s;
  for (const [i, by] of ['ana', 'bia', 'caio'].entries()) {
    n = quiz.reduce(n, {
      kind: 'answer', by, option: i === 0 ? certa : (certa + 1) % 4, seconds: i === 0 ? 12 : 700,
    }, contexto(by));
  }
  const r = n.history[0].results;
  assert.equal(r.find((x) => x.by === 'ana').points, 988);
  assert.equal(r.find((x) => x.by === 'bia').points, 0);
});

test('timeout aceita a pergunta incompleta e pontua apenas quem acertou', () => {
  const s = estado();
  const q = banco.porId(s.questions[0]);
  const certa = s.ordens[0].indexOf(q.certa);
  const n = quiz.reduce(s, { kind: 'answer', by: 'ana', option: certa, seconds: 3 }, contexto('ana'));
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
  const n = quiz.migrate(estado());
  assert.deepEqual(n.players, []);
  assert.deepEqual(n.answers, []);
  assert.equal(n.deadline, null);
  assert.equal(n.setup, true);
  assert.deepEqual(n.ordens, []);
});

test('view filtra a resposta de cada pessoa', () => {
  const s = quiz.reduce(estado(), { kind: 'answer', by: 'ana', option: 1, seconds: 1 }, contexto('ana'));
  assert.equal(quiz.view(s, 'ana', contexto('ana')).me.answer, 1);
  assert.equal(quiz.view(s, 'bia', contexto('bia')).me.answer, null);
});

test('view mostra placar publico e pergunta sem o indice certo', () => {
  const s = estado();
  const v = quiz.view(s, 'caio', contexto('caio'));
  assert.equal(Object.hasOwn(v.question, 'certa'), false);
  assert.equal(Object.hasOwn(v.question, 'alternativas'), false);
  assert.equal(JSON.stringify(v).includes('"ordens"'), false);
  assert.equal(v.players.length, 3);
});

test('sorteia posicoes diferentes para a alternativa certa com aleatorio controlado', () => {
  let chamadas = 0;
  const random = () => {
    chamadas += 1;
    if (chamadas <= banco.perguntas.length - 1) return 0.5;
    return chamadas <= banco.perguntas.length + 2 ? 0 : 0.999;
  };
  const s0 = quiz.init({ now: 1000, peers: PEERS, random });
  const s = quiz.reduce(s0, quiz.prepare(s0, { kind: 'start' }, { ...contexto('ana'), random }), contexto('ana'));
  // Aleatorio 0 desloca a primeira ordem; 0.999 mantem a segunda como esta.
  assert.deepEqual(s.ordens.slice(0, 2), [[1, 2, 3, 0], [0, 1, 2, 3]]);
  const view = quiz.view(s, 'ana', contexto('ana'));
  assert.deepEqual(view.question.ordem, s.ordens[0]);
});

test('a view revela o indice certo apenas depois de a rodada terminar', () => {
  let s = estado();
  const antes = quiz.view(s, 'ana', contexto('ana'));
  assert.equal(JSON.stringify(antes).includes('"certa"'), false);
  for (const by of ['ana', 'bia', 'caio']) {
    s = quiz.reduce(s, { kind: 'answer', by, option: 0, seconds: 1 }, contexto(by));
  }
  const depois = quiz.view(s, 'ana', contexto('ana'));
  assert.equal(Number.isInteger(depois.history[0].certa), true);
  assert.ok(depois.history[0].certa >= 0 && depois.history[0].certa < 4);
});

test('a posicao certa se distribui entre as quatro alternativas', () => {
  const contagens = [0, 0, 0, 0];
  for (let partida = 0; partida < 1000; partida++) {
    const s0 = quiz.init({ now: 0, peers: PEERS, random: Math.random });
    const s = quiz.reduce(s0, quiz.prepare(s0, { kind: 'start' }, { ...contexto('ana'), random: Math.random }),
      contexto('ana'));
    for (let rodada = 0; rodada < s.questions.length; rodada++) {
      const q = banco.porId(s.questions[rodada]);
      contagens[s.ordens[rodada].indexOf(q.certa)] += 1;
    }
  }
  for (const quantidade of contagens) assert.ok(quantidade >= 2000 && quantidade <= 3000);
});

test('reset so pode ser pedido pelo lider e sorteia nova partida', () => {
  const s = estado();
  assert.equal(quiz.validate(s, { kind: 'reset' }, contexto('bia')), i18n.codigo('mesa.quiz.soLiderReinicia'));
  const a = quiz.prepare(s, { kind: 'reset' }, contexto('ana'));
  const n = quiz.reduce(s, a, contexto('ana'));
  assert.equal(n.setup, true);
  assert.equal(n.round, 0);
  assert.equal(n.history.length, 0);
  assert.equal(n.players.length, 3);
});

test('acao desconhecida, timeout sem partida e contexto ausente sao seguros', () => {
  const s = estado();
  assert.equal(quiz.validate(s, { kind: 'nope' }, contexto('ana')), i18n.codigo('mesa.jogo.acaoDesconhecida'));
  assert.equal(quiz.validate({ ...s, finished: true }, { kind: 'timeout' }, contexto('ana')),
    i18n.codigo('mesa.quiz.nadaCorrendo'));
  assert.equal(quiz.validate(s, null, null), i18n.codigo('mesa.jogo.acaoInvalida'));
});

test('pergunta em espanhol que termina em ? abre com ¿', () => {
  const sem = banco.perguntas.filter((p) => p.es[0].endsWith('?') && !p.es[0].includes('¿')).map((p) => p.id);
  assert.deepEqual(sem, []);
});
