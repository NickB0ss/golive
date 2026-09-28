'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const velha = require('./velha');

const PEERS = [{ id: 'bia', name: 'Bia' }, { id: 'leo', name: 'Leo' }, { id: 'ana', name: 'Ana' }];
const ctx = (from, extra) => Object.assign({ from, isLeader: false, peers: PEERS }, extra);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** Aplica a acao exigindo que seja valida, sobre um estado congelado. */
function act(state, action, from, extra) {
  const c = ctx(from, extra);
  assert.equal(velha.validate(state, action, c), true, JSON.stringify(action));
  // Como no servidor: prepare (com peers) e depois reduce.
  const prepared = velha.prepare(deepFreeze(state), action, c);
  return deepFreeze(velha.reduce(deepFreeze(state), prepared, c));
}

function seated() {
  let s = deepFreeze(velha.init({}));
  s = act(s, { kind: 'sit', seat: 0 }, 'bia');
  return act(s, { kind: 'sit', seat: 1 }, 'leo');
}

function playCells(s, cells) {
  cells.forEach((cell, i) => { s = act(s, { kind: 'move', cell }, i % 2 ? 'leo' : 'bia'); });
  return s;
}

test('descritor segue o contrato', () => {
  assert.equal(velha.type, 'velha');
  assert.equal(velha.title, 'Jogo da velha');
  assert.equal(velha.group, 'jogos');
  assert.equal(velha.size.aspect, velha.size.w / velha.size.h);
  assert.ok(JSON.stringify(velha.init({})).length < velha.maxStateBytes);
});

test('init comeca com cadeiras livres e a vez da cadeira 0', () => {
  const s = velha.init({});
  assert.deepEqual(s.seats, [null, null]);
  assert.equal(s.board, '.........');
  assert.equal(s.turn, 0);
  assert.equal(velha.summary(s), 'Cadeiras livres');
});

test('X na cadeira 0 comeca e as vezes alternam', () => {
  let s = seated();
  assert.equal(velha.summary(s), 'Bia × Leo — vez de Bia');
  s = act(s, { kind: 'move', cell: 4 }, 'bia');
  assert.equal(s.board, '....X....');
  assert.equal(velha.summary(s), 'Bia × Leo — vez de Leo');
  assert.equal(velha.validate(s, { kind: 'move', cell: 0 }, ctx('bia')), 'Não é a sua vez');
  s = act(s, { kind: 'move', cell: 0 }, 'leo');
  assert.equal(s.board, 'O...X....');
});

test('so quem esta sentado joga; quem assiste e recusado', () => {
  const s = seated();
  assert.equal(velha.validate(s, { kind: 'move', cell: 0 }, ctx('ana')), 'Sente-se para jogar');
});

test('sem adversario sentado ninguem joga', () => {
  const s = act(deepFreeze(velha.init({})), { kind: 'sit', seat: 0 }, 'bia');
  assert.equal(velha.validate(s, { kind: 'move', cell: 0 }, ctx('bia')), 'Espere alguém sentar na outra cadeira');
  assert.equal(velha.summary(s), 'Bia espera adversário');
});

test('casa ocupada e casa fora do tabuleiro sao recusadas', () => {
  const s = playCells(seated(), [4]);
  assert.equal(velha.validate(s, { kind: 'move', cell: 4 }, ctx('leo')), 'Casa ocupada');
  for (const cell of [-1, 9, 1.5, '3', null, undefined]) {
    assert.equal(velha.validate(s, { kind: 'move', cell }, ctx('leo')), 'Casa inválida');
  }
});

test('tres em linha vence e marca a linha', () => {
  // X: 0 1 2   O: 3 4
  const s = playCells(seated(), [0, 3, 1, 4, 2]);
  assert.deepEqual(s.result, { winner: 0, reason: 'linha' });
  assert.deepEqual(s.line, [0, 1, 2]);
  assert.equal(velha.summary(s), 'Bia venceu');
  assert.equal(velha.validate(s, { kind: 'move', cell: 5 }, ctx('leo')), 'A partida acabou');
});

test('diagonal da cadeira 1 tambem vence', () => {
  // X: 0 1 5   O: 2 4 6
  const s = playCells(seated(), [0, 2, 1, 4, 5, 6]);
  assert.deepEqual(s.result, { winner: 1, reason: 'linha' });
  assert.deepEqual(s.line, [2, 4, 6]);
  assert.equal(velha.summary(s), 'Leo venceu');
});

test('tabuleiro cheio sem linha da velha', () => {
  // X O X / X O O / O X X
  const s = playCells(seated(), [0, 1, 2, 4, 3, 5, 7, 6, 8]);
  assert.equal(s.board, 'XOXXOOOXX');
  assert.deepEqual(s.result, { winner: null, reason: 'velha' });
  assert.equal(velha.summary(s), 'Deu velha');
});

test('vitoria na nona jogada conta como vitoria, nao como velha', () => {
  // X: 0 4 5 7 e fecha 0-4-8 na nona   O: 1 2 3 6
  const s = playCells(seated(), [0, 1, 4, 2, 5, 3, 7, 6, 8]);
  assert.equal(s.moves, 9);
  assert.equal(s.result.winner, 0);
});

test('reset mantem as cadeiras; pode sentado ou lider, nao quem assiste', () => {
  const s = playCells(seated(), [0, 3, 1, 4, 2]);
  assert.equal(velha.validate(s, { kind: 'reset' }, ctx('ana')), 'Só quem está sentado ou o líder recomeça');
  const r = act(s, { kind: 'reset' }, 'ana', { isLeader: true });
  assert.deepEqual(r.seats, ['bia', 'leo']);
  assert.equal(r.board, '.........');
  assert.equal(r.result, null);
  assert.equal(r.turn, 0);
  assert.deepEqual(act(s, { kind: 'reset' }, 'leo'), r);
});

test('dropPeer libera a cadeira e a partida continua com quem sentar', () => {
  let s = playCells(seated(), [4]);
  s = deepFreeze(velha.dropPeer(s, 'leo'));
  assert.deepEqual(s.seats, ['bia', null]);
  assert.equal(s.board, '....X....');
  s = act(s, { kind: 'sit', seat: 1 }, 'ana');
  s = act(s, { kind: 'move', cell: 0 }, 'ana');
  assert.equal(s.board, 'O...X....');
  assert.equal(velha.dropPeer(s, 'zeca'), s);
});

test('mensagem malformada nunca lanca, so e recusada, e reduce devolve o mesmo estado', () => {
  const s = deepFreeze(seated());
  const bad = [null, undefined, 1, 'move', [], {}, { kind: 1 }, { kind: 'voar' },
    { kind: 'move' }, { kind: 'move', cell: {} }, { kind: 'sit' }, { kind: 'resign' }];
  for (const action of bad) {
    for (const c of [ctx('bia'), undefined, null, {}]) {
      const v = velha.validate(s, action, c);
      assert.equal(typeof v, 'string', JSON.stringify(action));
      assert.equal(velha.reduce(s, action, c), s);
    }
  }
});

test('estado estranho nao derruba validate, reduce nem summary', () => {
  for (const s of [null, undefined, {}, { seats: 'x' }]) {
    assert.equal(typeof velha.validate(s, { kind: 'move', cell: 0 }, ctx('bia')), 'string');
    assert.equal(velha.reduce(s, { kind: 'move', cell: 0 }, ctx('bia')), s);
    assert.equal(typeof velha.summary(s), 'string');
    assert.equal(velha.dropPeer(s, 'bia'), s);
  }
});
