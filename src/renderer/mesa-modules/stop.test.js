'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const stop = require('./stop');

const peers = [
  { id: 'ana', name: 'Ana' },
  { id: 'bia', name: 'Bia' },
  { id: 'caio', name: 'Caio' },
];

function ctx(from, now = 1000, list = peers) {
  return { from, by: from, now, peers: list, random: () => 0 };
}

function act(state, action, from, now = 1000, list = peers) {
  const c = ctx(from, now, list);
  assert.equal(stop.validate(state, action, c), true, `acao ${action.kind}`);
  return stop.reduce(state, stop.prepare(state, action, c), c);
}

function rodada(list = peers) {
  return act(stop.init(ctx('ana', 1000, list)), { kind: 'start' }, 'ana', 1000, list);
}

function respondeTudo(state, from, prefix = '') {
  return act(state, {
    kind: 'answer',
    answers: state.categories.map((_, i) => `${prefix}${String.fromCharCode(65 + i)}`),
  }, from);
}

test('inicia com categorias classicas, criador e sem rodada', () => {
  const state = stop.init(ctx('ana'));
  assert.equal(state.createdBy, 'ana');
  assert.deepEqual(state.categories, stop.DEFAULT_CATEGORIES);
  assert.equal(state.phase, 'setup');
});

test('sorteia apenas letras permitidas pelo servidor', () => {
  const state = rodada();
  assert.equal(state.letter, 'A');
  assert.equal(stop.LETTERS.includes(state.letter), true);
  assert.equal(stop.LETTERS.includes('K'), false);
  assert.equal(state.deadline, 1000 + stop.ROUND_MS);
});

test('somente quem criou troca categorias entre rodadas', () => {
  const state = stop.init(ctx('ana'));
  assert.equal(stop.validate(state, { kind: 'categories', categories: ['Nome', 'Filme'] }, ctx('bia')),
    'Só quem criou a janela');
  const changed = act(state, { kind: 'categories', categories: ['Nome', 'Filme'] }, 'ana');
  assert.deepEqual(changed.categories, ['Nome', 'Filme']);
});

test('aceita no maximo dez categorias entre rodadas', () => {
  const state = stop.init(ctx('ana'));
  const eleven = Array.from({ length: 11 }, (_, i) => `Categoria ${i}`);
  assert.equal(stop.validate(state, { kind: 'categories', categories: eleven }, ctx('ana')),
    'No máximo 10 categorias');
});

test('recusa categorias vazias, repetidas e troca durante a rodada', () => {
  const setup = stop.init(ctx('ana'));
  assert.match(stop.validate(setup, { kind: 'categories', categories: ['Nome', ' '] }, ctx('ana')), /vazia/);
  assert.match(stop.validate(setup, { kind: 'categories', categories: ['Nome', 'nome'] }, ctx('ana')), /repetidas/);
  const state = rodada();
  assert.equal(stop.validate(state, { kind: 'categories', categories: ['Nome'] }, ctx('ana')),
    'Troque as categorias entre rodadas');
});

test('cada resposta e limitada a quarenta caracteres', () => {
  const state = rodada();
  const answers = state.categories.map(() => 'a'.repeat(41));
  assert.equal(stop.validate(state, { kind: 'answer', answers }, ctx('ana')), 'Resposta longa demais (máx. 40)');
});

test('participantes da rodada ficam fixados ao iniciar', () => {
  const state = rodada(peers.slice(0, 2));
  assert.deepEqual(state.players, ['ana', 'bia']);
  assert.equal(stop.validate(state, { kind: 'answer', answers: state.categories.map(() => 'A') }, ctx('caio')),
    'Você não está nesta rodada');
});

test('respostas ficam secretas antes do STOP', () => {
  let state = rodada();
  state = respondeTudo(state, 'ana', 'Ana');
  const ana = stop.view(state, 'ana', ctx('ana'));
  const bia = stop.view(state, 'bia', ctx('bia'));
  assert.equal(ana.myAnswers[0], 'AnaA');
  assert.equal(bia.myAnswers, null);
  assert.equal(JSON.stringify(bia).includes('AnaA'), false);
});

test('STOP exige todas as respostas do proprio participante', () => {
  const state = rodada();
  assert.equal(stop.validate(state, { kind: 'stop' }, ctx('ana')), 'Preencha todas as respostas');
});

test('quem preencheu tudo encerra a escrita para todos', () => {
  let state = rodada();
  state = respondeTudo(state, 'ana');
  state = act(state, { kind: 'stop' }, 'ana');
  assert.equal(state.phase, 'review');
  assert.equal(state.deadline, null);
  assert.equal(stop.validate(state, { kind: 'answer', answers: state.categories.map(() => 'A') }, ctx('bia')),
    'A rodada já parou');
});

test('o timeout de tres minutos revela as respostas', () => {
  let state = rodada();
  state = respondeTudo(state, 'ana');
  assert.equal(stop.timeoutAt(state), 1000 + stop.ROUND_MS);
  state = act(state, { kind: 'timeout' }, 'bia', 1000 + stop.ROUND_MS);
  assert.equal(state.phase, 'review');
  assert.equal(stop.timeoutAt(state), null);
});

test('timeout sem prazo e recusado pelo modulo', () => {
  const state = stop.init(ctx('ana'));
  assert.equal(stop.validate(state, { kind: 'timeout' }, ctx('ana')), 'Nada correndo');
});

test('voto de anulacao aceita uma resposta por participante e mostra o placar', () => {
  let state = rodada();
  state = respondeTudo(state, 'ana');
  state = act(state, { kind: 'stop' }, 'ana');
  state = act(state, { kind: 'vote', player: 'ana', category: 0, annul: true }, 'bia');
  assert.deepEqual(state.votes[0], { player: 'ana', category: 0, yes: ['bia'], no: [] });
  const view = stop.view(state, 'caio', ctx('caio'));
  assert.deepEqual(view.votes[0], { player: 'ana', category: 0, yes: 1, no: 0, mine: null, annulled: false });
});

test('maioria de quem esta na rodada anula e empate nao anula', () => {
  let state = rodada();
  state = respondeTudo(state, 'ana');
  state = act(state, { kind: 'stop' }, 'ana');
  state = act(state, { kind: 'vote', player: 'ana', category: 0, annul: true }, 'ana');
  state = act(state, { kind: 'vote', player: 'ana', category: 0, annul: false }, 'bia');
  assert.equal(stop.isAnnulled(state, 'ana', 0), false);
  state = act(state, { kind: 'vote', player: 'ana', category: 0, annul: true }, 'caio');
  assert.equal(stop.isAnnulled(state, 'ana', 0), true);
});

test('trocar o voto atualiza o placar sem duplicar eleitor', () => {
  let state = rodada();
  state = respondeTudo(state, 'ana');
  state = act(state, { kind: 'stop' }, 'ana');
  state = act(state, { kind: 'vote', player: 'ana', category: 0, annul: true }, 'bia');
  state = act(state, { kind: 'vote', player: 'ana', category: 0, annul: false }, 'bia');
  assert.deepEqual(state.votes[0], { player: 'ana', category: 0, yes: [], no: ['bia'] });
});

test('resposta deve comecar com a letra sem distinguir caixa ou acento', () => {
  let state = rodada();
  state = { ...state, letter: 'A', answers: { ana: ['Árvore'], bia: ['Bola'], caio: [''] }, phase: 'review' };
  assert.deepEqual(stop.points(state)[0], { player: 'ana', category: 0, points: 10 });
  assert.deepEqual(stop.points(state)[1], { player: 'bia', category: 0, points: 0 });
});

test('respostas repetidas ignoram acento e caixa e valem cinco', () => {
  let state = rodada();
  state = { ...state, letter: 'A', answers: { ana: ['Árvore'], bia: ['arvore'], caio: ['Amor'] }, phase: 'review' };
  const pts = stop.points(state).filter((x) => x.category === 0);
  assert.deepEqual(pts.map((x) => x.points), [5, 5, 10]);
});

test('vazia ou anulada vale zero, mesmo que seja unica', () => {
  let state = rodada();
  state = { ...state, letter: 'A', answers: { ana: ['Amor'], bia: [''], caio: ['Arara'] }, phase: 'review' };
  state = act(state, { kind: 'vote', player: 'ana', category: 0, annul: true }, 'ana');
  state = act(state, { kind: 'vote', player: 'ana', category: 0, annul: true }, 'bia');
  assert.deepEqual(stop.points(state).filter((x) => x.category === 0).map((x) => x.points), [0, 0, 10]);
});

test('encerrar correcao soma os pontos e permite nova rodada', () => {
  let state = rodada();
  state = respondeTudo(state, 'ana');
  state = act(state, { kind: 'stop' }, 'ana');
  state = act(state, { kind: 'finish' }, 'ana');
  assert.equal(state.phase, 'setup');
  assert.equal(state.scores.ana, 10);
  assert.equal(stop.validate(state, { kind: 'start' }, ctx('bia')), 'Só quem criou a janela');
});

test('acao fora da fase e de quem nao participa e recusada', () => {
  const state = stop.init(ctx('ana'));
  assert.equal(stop.validate(state, { kind: 'vote', player: 'ana', category: 0, annul: true }, ctx('ana')),
    'Ainda não é hora de corrigir');
  assert.equal(stop.validate(state, { kind: 'answer', answers: ['A'] }, ctx('ana')), 'A rodada ainda não começou');
});

test('dropPeer tira jogador fantasma da rodada e de seus votos', () => {
  let state = rodada();
  state = respondeTudo(state, 'ana');
  state = act(state, { kind: 'stop' }, 'ana');
  state = act(state, { kind: 'vote', player: 'ana', category: 0, annul: true }, 'bia');
  state = stop.dropPeer(state, 'bia');
  assert.deepEqual(state.players, ['ana', 'caio']);
  assert.deepEqual(state.votes, []);
  assert.equal(stop.view(state, 'bia', ctx('bia')).myAnswers, null);
});

test('view esconde respostas alheias, mas revela todas na correcao', () => {
  let state = rodada();
  state = respondeTudo(state, 'ana', 'Ana');
  state = respondeTudo(state, 'bia', 'Bia');
  const hidden = stop.view(state, 'caio', ctx('caio'));
  assert.equal(hidden.answers, null);
  state = act(state, { kind: 'stop' }, 'ana');
  const open = stop.view(state, 'caio', ctx('caio'));
  assert.equal(open.answers.ana[0], 'AnaA');
  assert.equal(open.answers.bia[0], 'BiaA');
});

test('migracao cancela rodada e nunca leva respostas ou votos secretos', () => {
  let state = rodada();
  state = respondeTudo(state, 'ana', 'Segredo');
  const migrated = stop.migrate(state);
  assert.equal(migrated.phase, 'setup');
  assert.deepEqual(migrated.players, []);
  assert.equal(JSON.stringify(migrated).includes('SegredoA'), false);
  assert.deepEqual(migrated.scores, state.scores);
});

test('lider sobrevivente gere a janela depois da saida ou migracao do criador', () => {
  const abandoned = stop.dropPeer(stop.init(ctx('ana')), 'ana');
  assert.equal(stop.validate(abandoned, { kind: 'start' }, { ...ctx('bia'), isLeader: true }), true);
  const migrated = stop.migrate(stop.init(ctx('ana')));
  assert.equal(stop.validate(migrated, { kind: 'categories', categories: ['Nome'] }, { ...ctx('bia'), isLeader: true }), true);
});
