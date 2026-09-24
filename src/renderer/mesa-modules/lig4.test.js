'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const lig4 = require('./lig4');

const PEERS = [{ id: 'bia', name: 'Bia' }, { id: 'leo', name: 'Leo' }, { id: 'ana', name: 'Ana' }];
const ctx = (from, extra) => Object.assign({ from, isLeader: false, peers: PEERS }, extra);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function act(state, action, from, extra) {
  const c = ctx(from, extra);
  assert.equal(lig4.validate(state, action, c), true, JSON.stringify(action));
  return deepFreeze(lig4.reduce(deepFreeze(state), action, c));
}

function seated() {
  let s = deepFreeze(lig4.init({}));
  s = act(s, { kind: 'sit', seat: 0 }, 'bia');
  return act(s, { kind: 'sit', seat: 1 }, 'leo');
}

function playCols(s, cols) {
  for (const col of cols) s = act(s, { kind: 'move', col }, s.turn === 0 ? 'bia' : 'leo');
  return s;
}

test('descritor segue o contrato', () => {
  assert.equal(lig4.type, 'lig4');
  assert.equal(lig4.title, 'Lig 4');
  assert.equal(lig4.group, 'jogos');
  assert.equal(lig4.size.aspect, lig4.size.w / lig4.size.h);
  assert.equal(lig4.size.minW / lig4.size.minH, lig4.size.aspect);
});

test('init: 7 x 6 vazio, vez da cadeira 0', () => {
  const s = lig4.init({});
  assert.equal(s.board.length, 6);
  assert.ok(s.board.every((row) => row === '.......'));
  assert.equal(s.turn, 0);
});

test('a peca cai ate o fundo e empilha', () => {
  const s = playCols(seated(), [3, 3]);
  assert.equal(s.board[5], '...V...');
  assert.equal(s.board[4], '...A...');
  assert.deepEqual(s.last, [4, 3]);
  assert.equal(lig4.summary(s), 'Bia × Leo — vez de Bia');
});

test('coluna cheia e coluna fora do tabuleiro sao recusadas', () => {
  const s = playCols(seated(), [0, 0, 0, 0, 0, 0]);
  assert.equal(lig4.validate(s, { kind: 'move', col: 0 }, ctx('bia')), 'Coluna cheia');
  for (const col of [-1, 7, 2.5, '1', null]) {
    assert.equal(lig4.validate(s, { kind: 'move', col }, ctx('bia')), 'Coluna inválida');
  }
});

test('fora da vez e quem assiste nao jogam', () => {
  const s = seated();
  assert.equal(lig4.validate(s, { kind: 'move', col: 0 }, ctx('leo')), 'Não é a sua vez');
  assert.equal(lig4.validate(s, { kind: 'move', col: 0 }, ctx('ana')), 'Sente-se para jogar');
});

test('quatro na horizontal vence', () => {
  const s = playCols(seated(), [0, 0, 1, 1, 2, 2, 3]);
  assert.deepEqual(s.result, { winner: 0, reason: 'linha' });
  assert.deepEqual(s.line, [[5, 0], [5, 1], [5, 2], [5, 3]]);
  assert.equal(lig4.summary(s), 'Bia venceu');
  assert.equal(lig4.validate(s, { kind: 'move', col: 4 }, ctx('leo')), 'A partida acabou');
});

test('quatro na vertical vence', () => {
  const s = playCols(seated(), [0, 1, 0, 1, 0, 1, 6, 1]);
  assert.deepEqual(s.result, { winner: 1, reason: 'linha' });
  assert.deepEqual(s.line, [[2, 1], [3, 1], [4, 1], [5, 1]]);
  assert.equal(lig4.summary(s), 'Leo venceu');
});

test('diagonal subindo para a direita vence', () => {
  // V em (5,0) (4,1) (3,2) (2,3)
  const s = playCols(seated(), [0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
  assert.equal(s.result.winner, 0);
  assert.deepEqual(s.line, [[2, 3], [3, 2], [4, 1], [5, 0]]);
});

test('diagonal descendo para a direita vence, peca do meio fechando', () => {
  // V em (2,0) (3,1) (4,2) (5,3); a ultima cai em (3,1)
  const s = playCols(seated(), [3, 2, 2, 1, 1, 0, 0, 0, 0, 6, 1]);
  assert.equal(s.result.winner, 0);
  assert.deepEqual(s.last, [3, 1]);
  assert.deepEqual(s.line, [[2, 0], [3, 1], [4, 2], [5, 3]]);
});

test('tabuleiro cheio sem quatro em linha empata', () => {
  const order = [2, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3,
    6, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6];
  const s = playCols(seated(), order);
  assert.deepEqual(s.result, { winner: null, reason: 'empate' });
  assert.equal(lig4.summary(s), 'Empate, tabuleiro cheio');
  assert.ok(JSON.stringify(s).length < lig4.maxStateBytes);
});

test('reset e dropPeer mantem o combinado das cadeiras', () => {
  let s = playCols(seated(), [0, 0, 1, 1, 2, 2, 3]);
  assert.equal(lig4.validate(s, { kind: 'reset' }, ctx('ana')), 'Só quem está sentado ou o líder recomeça');
  s = act(s, { kind: 'reset' }, 'bia');
  assert.deepEqual(s.seats, ['bia', 'leo']);
  assert.equal(s.result, null);
  assert.equal(s.moves, 0);
  s = deepFreeze(lig4.dropPeer(s, 'bia'));
  assert.deepEqual(s.seats, [null, 'leo']);
  assert.equal(lig4.summary(s), 'Leo espera adversário');
});

test('mensagem malformada nunca lanca e nao muda o estado', () => {
  const s = deepFreeze(seated());
  const bad = [null, 7, 'x', [], {}, { kind: 'move' }, { kind: 'move', col: [] }, { kind: 'drop' }, { kind: 'sit', seat: 9 }];
  for (const action of bad) {
    for (const c of [ctx('bia'), undefined, {}]) {
      assert.equal(typeof lig4.validate(s, action, c), 'string');
      assert.equal(lig4.reduce(s, action, c), s);
    }
  }
  assert.equal(typeof lig4.summary(null), 'string');
});
