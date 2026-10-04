'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const oito = require('./oito');

const PEERS = [{ id: 'ana', name: 'Ana' }, { id: 'bia', name: 'Bia' }, { id: 'caio', name: 'Caio' }];
let agora = 1000;
function ctx(from, extra = {}) { return { from, peers: PEERS, now: agora, random: () => 0, ...extra }; }
function act(state, action, from, extra) {
  const c = ctx(from, extra);
  assert.equal(oito.validate(state, action, c), true, JSON.stringify(action));
  return oito.reduce(state, oito.prepare(state, action, c), c);
}
function sentado(state, id) { return state.seats.indexOf(id); }
function pronto() {
  let s = oito.init(ctx('ana'));
  s = act(s, { kind: 'sit', seat: 0 }, 'ana');
  s = act(s, { kind: 'sit', seat: 1 }, 'bia');
  return act(s, { kind: 'start' }, 'ana');
}

test('inicia com 7 cartas para dois e cinco para tres a oito', () => {
  const s = pronto();
  assert.equal(s.hands[0].length, 7);
  assert.equal(s.hands[1].length, 7);
  let t = oito.init(ctx('ana'));
  t = act(t, { kind: 'sit', seat: 0 }, 'ana');
  t = act(t, { kind: 'sit', seat: 1 }, 'bia');
  t = act(t, { kind: 'sit', seat: 2 }, 'caio');
  t = act(t, { kind: 'start' }, 'ana');
  assert.deepEqual(t.hands.slice(0, 3).map((h) => h.length), [5, 5, 5]);
});

test('aceita mesmo naipe ou valor, e o oito escolhe o naipe', () => {
  let s = pronto();
  s = { ...s, hands: [['2h', 'Ks', '8c'], ['3s']], discard: ['Kh'], suit: 'h', turn: 0, deadline: agora + oito.TURN_MS };
  assert.equal(oito.validate(s, { kind: 'play', card: '2h' }, ctx('ana')), true);
  assert.equal(oito.validate(s, { kind: 'play', card: 'Ks' }, ctx('ana')), true);
  assert.equal(oito.validate(s, { kind: 'play', card: '8c', suit: 'd' }, ctx('ana')), true);
  s = act(s, { kind: 'play', card: '8c', suit: 'd' }, 'ana');
  assert.equal(s.suit, 'd');
  assert.equal(s.discard.at(-1), '8c');
});

test('compra ate uma carta jogavel e a baixa; com monte vazio reembaralha descarte sem o topo', () => {
  let s = pronto();
  s = { ...s, hands: [['2c'], ['3s']], deck: ['4d', 'Kh'], discard: ['7s', 'Ah'], suit: 'h', turn: 0, deadline: agora + oito.TURN_MS };
  s = act(s, { kind: 'draw', suit: 's' }, 'ana');
  assert.deepEqual(s.hands[0], ['2c', '4d']);
  assert.equal(s.discard.at(-1), 'Kh');
  assert.equal(s.suit, 'h');
  s = { ...s, turn: 0, hands: [['2c'], ['3s']], deck: [], discard: ['4s', '6d', 'Kh'], suit: 'h', deadline: agora + oito.TURN_MS };
  s = act(s, { kind: 'draw', suit: 's' }, 'ana');
  assert.equal(s.discard.at(-1), 'Kh', 'a carta de cima nunca volta ao monte');
  assert.equal(s.turn, 1, 'sem carta jogavel depois de esgotar, passa');
});

test('oito comprado usa o naipe escolhido e mao vazia pontua para o vencedor', () => {
  let s = pronto();
  s = { ...s, hands: [['2c'], ['8d', 'Kh']], deck: ['8s'], discard: ['Ah'], suit: 'h', turn: 0, deadline: agora + oito.TURN_MS };
  s = act(s, { kind: 'draw', suit: 'c' }, 'ana');
  assert.equal(s.suit, 'c');
  assert.equal(s.hands[0].length, 1);
});

test('vai a cem pontos e encerra a partida', () => {
  let s = pronto();
  s = { ...s, scores: [90, 0], hands: [['Ks'], ['8d']], discard: ['7s'], suit: 's', turn: 0, deadline: agora + oito.TURN_MS };
  s = act(s, { kind: 'play', card: 'Ks' }, 'ana');
  assert.equal(s.phase, 'finished');
  assert.equal(s.winner, 0);
  assert.equal(s.scores[0], 140);
});

test('timeout compra e passa, e so existe durante a decisao', () => {
  let s = pronto();
  const before = s.hands[0].length;
  assert.equal(oito.timeoutAt(s), s.deadline);
  agora = s.deadline + 1;
  s = act(s, { kind: 'timeout' }, 'bia');
  assert.equal(s.turn, 1);
  assert.ok(s.hands[0].length >= before);
  assert.equal(oito.timeoutAt({ ...s, phase: 'waiting' }), null);
});

test('view esconde baralho e maos alheias, mas mostra contagens e naipe escolhido', () => {
  const s = pronto();
  const v = oito.view(s, 'ana', { peers: PEERS });
  assert.deepEqual(v.hand, s.hands[sentado(s, 'ana')]);
  assert.equal(v.hands, undefined);
  assert.equal(v.deck, undefined);
  assert.equal(v.counts[1], s.hands[1].length);
  assert.equal(v.suit, s.suit);
  assert.equal(JSON.stringify(v).includes(s.hands[1][0]), false);
});

test('migracao cancela a rodada sem segredo e lugares fantasmas contam como livres', () => {
  const s = pronto();
  const m = oito.migrate(s);
  assert.equal(m.phase, 'waiting');
  assert.deepEqual(m.hands, Array(8).fill(null).map(() => []));
  assert.equal(JSON.stringify(m).includes(s.deck[0]), false);
  const novo = { from: 'nova-ana', peers: [{ id: 'nova-ana', name: 'Ana' }], now: agora, random: () => 0 };
  assert.equal(oito.validate(m, { kind: 'sit', seat: 0 }, novo), true);
  assert.equal(oito.view(m, 'nova-ana', novo).seats[0], null);
});

test('dropPeer libera o lugar e cancela a rodada sem vazar a mao', () => {
  const s = pronto();
  const d = oito.dropPeer(s, 'bia');
  assert.equal(d.seats[1], null);
  assert.equal(d.phase, 'waiting');
  assert.deepEqual(d.hands[1], []);
  assert.equal(oito.dropPeer(s, 'caio'), s);
});

test('carta do mesmo naipe vale', () => {
  const s = { ...pronto(), hands: [['2h'], ['3s']], discard: ['Kh'], suit: 'h', turn: 0 };
  assert.equal(oito.validate(s, { kind: 'play', card: '2h' }, ctx('ana')), true);
});

test('carta do mesmo valor vale', () => {
  const s = { ...pronto(), hands: [['Ks'], ['3s']], discard: ['Kh'], suit: 'h', turn: 0 };
  assert.equal(oito.validate(s, { kind: 'play', card: 'Ks' }, ctx('ana')), true);
});

test('carta que nao combina e recusada', () => {
  const s = { ...pronto(), hands: [['2s'], ['3s']], discard: ['Kh'], suit: 'h', turn: 0 };
  assert.equal(oito.validate(s, { kind: 'play', card: '2s' }, ctx('ana')), 'mesa.oito.naoCombina');
});

test('oito vale sobre qualquer carta e exige naipe', () => {
  const s = { ...pronto(), hands: [['8s'], ['3s']], discard: ['Kh'], suit: 'h', turn: 0 };
  assert.equal(oito.validate(s, { kind: 'play', card: '8s' }, ctx('ana')), 'mesa.oito.escolhaNaipe');
  assert.equal(oito.validate(s, { kind: 'play', card: '8s', suit: 'c' }, ctx('ana')), true);
});

test('naipe escolhido pelo oito vale para quem joga depois', () => {
  let s = { ...pronto(), hands: [['8s', '2c'], ['3c']], discard: ['Kh'], suit: 'h', turn: 0 };
  s = act(s, { kind: 'play', card: '8s', suit: 'c' }, 'ana');
  assert.equal(oito.validate(s, { kind: 'play', card: '3c' }, ctx('bia')), true);
});

test('sem carta e sem monte passa a vez', () => {
  let s = { ...pronto(), hands: [['2s'], ['3c']], deck: [], discard: ['Kh'], suit: 'h', turn: 0 };
  s = act(s, { kind: 'draw', suit: 's' }, 'ana');
  assert.equal(s.turn, 1);
});

test('pontuacao soma oito figuras as e numeros', () => {
  assert.equal(oito.points(['8s', 'Kh', 'Qd', 'Jc', 'Ah', '7s']), 88);
});

test('aceita dois jogadores nos extremos dos oito lugares', () => {
  let s = oito.init(ctx('ana'));
  s = act(s, { kind: 'sit', seat: 0 }, 'ana');
  s = act(s, { kind: 'sit', seat: 7 }, 'bia');
  assert.equal(oito.validate(s, { kind: 'start' }, ctx('ana')), true);
});

test('aceita oito jogadores', () => {
  const peers = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  let s = oito.init();
  for (let i = 0; i < 8; i += 1) {
    const c = { from: `p${i}`, peers, now: agora, random: () => 0 };
    s = oito.reduce(s, oito.prepare(s, { kind: 'sit', seat: i }, c), c);
  }
  assert.equal(oito.validate(s, { kind: 'start' }, { from: 'p0', peers }), true);
});

test('acao fora da vez e recusada', () => {
  const s = pronto();
  assert.equal(oito.validate(s, { kind: 'draw' }, ctx('bia')), 'mesa.jogo.naoESuaVez');
});
