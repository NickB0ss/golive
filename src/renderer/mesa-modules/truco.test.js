'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const truco = require('./truco');

const PEERS = ['ana', 'bia', 'caio', 'duda'].map((id) => ({
  id,
  name: id[0].toUpperCase() + id.slice(1)
}));
const ctx = (from, now = 1000) => ({ from, peers: PEERS, now, random: () => 0.2 });
function passo(state, action, from, now = 1000) {
  const c = ctx(from, now);
  assert.equal(truco.validate(state, action, c), true, JSON.stringify(action));
  return truco.reduce(state, truco.prepare(state, action, c), c);
}
function sentados(n) {
  let s = truco.init({});
  for (let i = 0; i < n; i += 1) {
    s = passo(s, { kind: 'sit', seat: i }, PEERS[i].id);
  }
  return s;
}
function mao(s, cards, vira = '4s') {
  const ativos = s.seats.map((id, seat) => id ? seat : null).filter((x) => x !== null);
  const teams = ativos.map((seat, i) => [seat, s.seats.length === 4 ? seat % 2 : i]);
  return Object.assign({}, s, {
    phase: 'play',
    hand: {
      cards,
      vira,
      manilha: '5',
      seats: ativos,
      teams,
      dealer: ativos[ativos.length - 1],
      lead: ativos[0],
      turn: ativos[0],
      table: [],
      rounds: [],
      value: 1,
      pending: null,
      deadline: 31000,
      iron: false,
      eleven: null,
      lastCaller: null
    }
  });
}

test('ordem classica e manilhas respeitam o naipe', () => {
  assert.equal(truco.forca('4s', 'A'), 0);
  assert.equal(truco.forca('3s', 'A'), 9);
  assert.ok(truco.forca('Ad', 'A') < truco.forca('As', 'A'));
  assert.ok(truco.forca('As', 'A') < truco.forca('Ah', 'A'));
  assert.ok(truco.forca('Ah', 'A') < truco.forca('Ac', 'A'));
  assert.equal(truco.proximaManilha('3s'), '4');
});

test('empates da primeira, segunda e terceira rodada dao o vencedor previsto', () => {
  assert.equal(truco.vencedorDasRodadas([null, 1]), 1);
  assert.equal(truco.vencedorDasRodadas([0, null]), 0);
  assert.equal(truco.vencedorDasRodadas([1, 0, null]), 1);
  assert.equal(truco.vencedorDasRodadas([null, null, null]), null);
});

test('truco sobe 3, 6, 9 e 12; correr entrega o valor anterior', () => {
  let s = mao(sentados(2), [['4s', '5s', '6s'], ['7s', 'Qs', 'Js']]);
  s = passo(s, { kind: 'call' }, 'ana');
  assert.equal(s.hand.pending.amount, 3);
  s = passo(s, { kind: 'answer', answer: 'raise' }, 'bia');
  assert.equal(s.hand.pending.amount, 6);
  s = passo(s, { kind: 'answer', answer: 'accept' }, 'ana');
  assert.equal(s.hand.value, 6);
  s = passo(s, { kind: 'call' }, 'ana');
  s = passo(s, { kind: 'answer', answer: 'run' }, 'bia');
  assert.deepEqual(s.scores, [6, 0]);
});

test('mao de onze mostra somente ao parceiro e mao de ferro nao mostra a propria', () => {
  let s = sentados(4);
  s = Object.assign({}, s, { scores: [11, 3] });
  s = truco.reduce(s, {
    kind: 'deal',
    cards: [['As', 'Ks', 'Qs'], ['4s', '5s', '6s'], ['3s', '2s', '7s'], ['4h', '5h', '6h']],
    vira: '4s',
    dealer: 3,
    at: 1000
  }, ctx('ana'));
  const ana = truco.view(s, 'ana', { peers: PEERS });
  const bia = truco.view(s, 'bia', { peers: PEERS });
  assert.deepEqual(ana.hand.cards, ['As', 'Ks', 'Qs']);
  assert.deepEqual(ana.hand.partnerCards, ['3s', '2s', '7s']);
  assert.equal(bia.hand.cards, undefined);
  s = passo(s, { kind: 'eleven', choice: 'play' }, 'ana');
  s = Object.assign({}, s, { scores: [11, 11] });
  s = truco.reduce(s, {
    kind: 'deal',
    cards: [['As', 'Ks', 'Qs'], ['4s', '5s', '6s'], ['3s', '2s', '7s'], ['4h', '5h', '6h']],
    vira: '4s',
    dealer: 3,
    at: 2000
  }, ctx('ana', 2000));
  const ferro = truco.view(s, 'ana', { peers: PEERS });
  assert.deepEqual(ferro.hand.cards, [null, null, null]);
});

test('encoberta nunca entra na view e timeout joga a carta mais fraca', () => {
  let s = mao(sentados(2), [['As', '4s', '3s'], ['7s', 'Qs', 'Js']]);
  s = passo(s, { kind: 'play', index: 0 }, 'ana');
  s = passo(s, { kind: 'play', index: 0 }, 'bia');
  s = passo(s, { kind: 'play', index: 0, covered: true }, 'ana');
  assert.equal(truco.view(s, 'bia', { peers: PEERS }).hand.table.at(-1).card, undefined);
  s = truco.reduce(s, { kind: 'timeout', at: 40000 }, ctx('bia', 40000));
  assert.deepEqual(s.hand.cards[1], ['Js']);
});

test('migracao cancela a mao e lugar fantasma fica livre; saida corre', () => {
  let s = mao(sentados(2), [['As', '4s', '3s'], ['7s', 'Qs', 'Js']]);
  s = truco.dropPeer(s, 'bia');
  assert.deepEqual(s.scores, [1, 0]);
  const migrado = truco.migrate(mao(sentados(2), [['As'], ['Ks']]));
  assert.equal(migrado.hand, null);
  const fantasma = truco.view(Object.assign({}, sentados(2), { seats: ['sumiu', 'bia'] }), 'bia', { peers: PEERS });
  assert.equal(fantasma.seats[0], null);
});

test('forca sem manilha segue 4, 5, 6, 7, Q, J, K, A, 2, 3', () => {
  const ranks = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
  for (let i = 0; i < ranks.length; i += 1) {
    assert.equal(truco.forca(`${ranks[i]}s`, 'X'), i);
  }
});

test('vira 3 faz do 4 a manilha', () => {
  assert.equal(truco.proximaManilha('3h'), '4');
});

test('ouros perde para espadas entre as manilhas', () => {
  assert.ok(truco.forca('Ad', 'A') < truco.forca('As', 'A'));
});

test('espadas perde para copas entre as manilhas', () => {
  assert.ok(truco.forca('As', 'A') < truco.forca('Ah', 'A'));
});

test('copas perde para paus entre as manilhas', () => {
  assert.ok(truco.forca('Ah', 'A') < truco.forca('Ac', 'A'));
});

test('carta igual que nao e manilha empata', () => {
  assert.equal(truco.forca('Qs', 'A'), truco.forca('Qh', 'A'));
});

test('primeira empatada e segunda vencida decide a mao', () => {
  assert.equal(truco.vencedorDasRodadas([null, 0]), 0);
});

test('segunda empatada depois da primeira vencida conserva a primeira', () => {
  assert.equal(truco.vencedorDasRodadas([1, null]), 1);
});

test('terceira empatada conserva quem venceu a primeira', () => {
  assert.equal(truco.vencedorDasRodadas([0, 1, null]), 0);
});

test('todas as rodadas empatadas nao dao vencedor', () => {
  assert.equal(truco.vencedorDasRodadas([null, null, null]), null);
});

test('aceitar truco faz a mao valer 3', () => {
  let s = mao(sentados(2), [['4s'], ['5s']]);
  s = passo(s, { kind: 'call' }, 'ana');
  s = passo(s, { kind: 'answer', answer: 'accept' }, 'bia');
  assert.equal(s.hand.value, 3);
});

test('correr do pedido de 3 da 1 ao outro lado', () => {
  let s = mao(sentados(2), [['4s'], ['5s']]);
  s = passo(s, { kind: 'call' }, 'ana');
  s = passo(s, { kind: 'answer', answer: 'run' }, 'bia');
  assert.deepEqual(s.scores, [1, 0]);
});

test('aumentar para 6 e correr entrega 3', () => {
  let s = mao(sentados(2), [['4s'], ['5s']]);
  s = passo(s, { kind: 'call' }, 'ana');
  s = passo(s, { kind: 'answer', answer: 'raise' }, 'bia');
  s = passo(s, { kind: 'answer', answer: 'run' }, 'ana');
  assert.deepEqual(s.scores, [0, 3]);
});

test('aumentar para 9 e correr entrega 6', () => {
  let s = mao(sentados(2), [['4s'], ['5s']]);
  s = passo(s, { kind: 'call' }, 'ana');
  s = passo(s, { kind: 'answer', answer: 'raise' }, 'bia');
  s = passo(s, { kind: 'answer', answer: 'raise' }, 'ana');
  s = passo(s, { kind: 'answer', answer: 'run' }, 'bia');
  assert.deepEqual(s.scores, [6, 0]);
});

test('aumentar para 12 e correr entrega 9', () => {
  let s = mao(sentados(2), [['4s'], ['5s']]);
  s = passo(s, { kind: 'call' }, 'ana');
  s = passo(s, { kind: 'answer', answer: 'raise' }, 'bia');
  s = passo(s, { kind: 'answer', answer: 'raise' }, 'ana');
  s = passo(s, { kind: 'answer', answer: 'raise' }, 'bia');
  s = passo(s, { kind: 'answer', answer: 'run' }, 'ana');
  assert.deepEqual(s.scores, [0, 9]);
});

test('quem pediu por ultimo nao pede de novo e nao passa de 12', () => {
  let s = mao(sentados(2), [['4s'], ['5s']]);
  s = passo(s, { kind: 'call' }, 'ana');
  s = passo(s, { kind: 'answer', answer: 'accept' }, 'bia');
  assert.equal(truco.validate(s, { kind: 'call' }, ctx('ana')), 'mesa.truco.cantoIndisponivel');
  s = passo(s, { kind: 'call' }, 'bia');
  s = passo(s, { kind: 'answer', answer: 'raise' }, 'ana');
  s = passo(s, { kind: 'answer', answer: 'raise' }, 'bia');
  s = passo(s, { kind: 'answer', answer: 'accept' }, 'ana');
  assert.equal(truco.validate(s, { kind: 'call' }, ctx('ana')), 'mesa.truco.cantoIndisponivel');
});

test('encoberta so vale da segunda rodada e perde para qualquer carta', () => {
  let s = mao(sentados(2), [['4s', '4h', '4d'], ['As', '3s', '5d']]);
  assert.equal(
    truco.validate(s, { kind: 'play', index: 0, covered: true }, ctx('ana')),
    'mesa.truco.encobertaSegunda'
  );
  s = passo(s, { kind: 'play', index: 0 }, 'ana');
  s = passo(s, { kind: 'play', index: 0 }, 'bia');
  s = passo(s, { kind: 'play', index: 0, covered: true }, 'bia');
  s = passo(s, { kind: 'play', index: 0 }, 'ana');
  assert.deepEqual(s.hand.rounds.map((rodada) => rodada.winner), [1, 0]);
});

test('mao de onze jogar vale 3, correr da 1 e bloqueia truco', () => {
  let s = sentados(2);
  s = Object.assign({}, s, { scores: [11, 2] });
  s = truco.reduce(s, {
    kind: 'deal', cards: [['As'], ['4s']], vira: '4s', dealer: 1, at: 1000,
  }, ctx('ana'));
  assert.equal(truco.validate(s, { kind: 'call' }, ctx('ana')), 'mesa.truco.maoNaoJogando');
  s = passo(s, { kind: 'eleven', choice: 'play' }, 'ana');
  assert.equal(s.hand.value, 3);
  s = Object.assign({}, sentados(2), { scores: [11, 2] });
  s = truco.reduce(s, {
    kind: 'deal', cards: [['As'], ['4s']], vira: '4s', dealer: 1, at: 1000,
  }, ctx('ana'));
  s = passo(s, { kind: 'eleven', choice: 'run' }, 'ana');
  assert.deepEqual(s.scores, [11, 3]);
});

test('partida termina quando uma dupla chega a 12', () => {
  let s = mao(Object.assign({}, sentados(2), { scores: [11, 0] }), [['4s'], ['5s']]);
  s = passo(s, { kind: 'call' }, 'ana');
  s = passo(s, { kind: 'answer', answer: 'run' }, 'bia');
  assert.equal(s.phase, 'finished');
  assert.deepEqual(s.scores, [12, 0]);
});

test('duas pessoas sao adversarias e quatro formam duplas de frente', () => {
  assert.deepEqual(mao(sentados(2), [['4s'], ['5s']]).hand.teams, [[0, 0], [1, 1]]);
  assert.deepEqual(mao(sentados(4), [[], [], [], []]).hand.teams, [[0, 0], [1, 1], [2, 0], [3, 1]]);
});

test('timeout responde ao truco correndo e jogada fora da vez e recusada', () => {
  let s = mao(sentados(2), [['4s'], ['5s']]);
  assert.equal(truco.validate(s, { kind: 'play', index: 0 }, ctx('bia')), 'mesa.jogo.naoESuaVez');
  s = passo(s, { kind: 'call' }, 'ana');
  s = truco.reduce(s, { kind: 'timeout', at: 40000 }, ctx('bia', 40000));
  assert.deepEqual(s.scores, [1, 0]);
});

test('cada lugar ve so a propria mao e nunca o monte', () => {
  const s = mao(sentados(2), [['As', 'Ks'], ['3s', '2s']]);
  s.hand.deck = ['4s', '5s'];
  const ana = truco.view(s, 'ana', { peers: PEERS });
  const bia = truco.view(s, 'bia', { peers: PEERS });
  assert.deepEqual(ana.hand.cards, ['As', 'Ks']);
  assert.deepEqual(bia.hand.cards, ['3s', '2s']);
  assert.equal(JSON.stringify(ana).includes('3s'), false);
  assert.equal(JSON.stringify(bia).includes('As'), false);
  assert.equal(JSON.stringify(ana).includes('deck'), false);
});

test('espectador nao pode falsificar reinicio de lider nem cantar truco', () => {
  const s = mao(sentados(2), [['4s'], ['5s']]);
  assert.equal(truco.validate(s, { kind: 'reset', leader: true }, ctx('caio')), 'mesa.truco.soQuemEstaNaMesaReinicia');
  assert.equal(truco.validate(s, { kind: 'reset' }, { from: 'caio', peers: PEERS, isLeader: true }), true);
  assert.equal(truco.validate(s, { kind: 'call' }, ctx('caio')), 'mesa.truco.cantoIndisponivel');
  assert.equal(truco.view(s, 'caio', { peers: PEERS }).me.can.call, false);
});
