'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const domino = require('./domino');

const PEERS = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase() }));

function ctx(from, now = 1000, peers = PEERS) {
  return { from, now, peers, random: () => 0 };
}

function state(extra) {
  return Object.assign(domino.init(), {
    seats: ['a', 'b', null, null], names: ['A', 'B', null, null],
    hands: [[], [], [], []], phase: 'play', ends: [6, 6], turn: 0, deadline: 31000,
  }, extra);
}

function start(hands, stock = [], winner = null) {
  return domino.reduce(state({ phase: 'waiting', winner }), { kind: 'start', hands, stock, at: 1000 }, ctx('a'));
}

test('dá sete pedras a cada pessoa', () => {
  const s = start([Array(7).fill([1, 2]), Array(7).fill([2, 3]), [], []]);
  assert.equal(s.hands[0].length + s.hands[1].length + s.table.length, 14);
});

test('com dois jogadores, o restante fica no monte', () => {
  const s = start([Array(7).fill([6, 6]), Array(7).fill([1, 2]), [], []], Array(14).fill([0, 1]));
  assert.equal(s.stock.length, 14);
});

test('com três jogadores, o restante fica no monte', () => {
  const s = start([Array(7).fill([6, 6]), Array(7).fill([1, 2]), Array(7).fill([2, 3]), []], Array(7).fill([0, 1]));
  assert.equal(s.stock.length, 7);
});

test('com quatro jogadores não há monte', () => {
  const s = start(Array.from({ length: 4 }, () => Array(7).fill([1, 2])));
  assert.equal(s.stock.length, 0);
});

test('abre quem tem o duplo-seis', () => {
  const s = start([[[1, 2]], [[6, 6]], [], []]);
  assert.deepEqual(s.table[0].stone, [6, 6]);
});

test('sem duplo-seis abre o maior duplo', () => {
  const s = start([[[4, 4]], [[3, 3]], [], []]);
  assert.deepEqual(s.table[0].stone, [4, 4]);
});

test('sem duplo abre a pedra de maior soma', () => {
  const s = start([[[5, 6]], [[4, 6]], [], []]);
  assert.deepEqual(s.table[0].stone, [5, 6]);
});

test('a mao seguinte espera o vencedor escolher a pedra de abertura', () => {
  const s = start([[[6, 6]], [[0, 1]], [], []], [], 1);
  assert.equal(s.phase, 'opening');
  assert.deepEqual(s.table, []);
  assert.equal(domino.validate(s, { kind: 'open', stone: 0 }, ctx('b')), true);
  const aberta = domino.reduce(s, { kind: 'open', stone: 0, at: 1000 }, ctx('b'));
  assert.deepEqual(aberta.table[0].stone, [0, 1]);
});

test('encaixa pela ponta esquerda e gira a pedra', () => {
  const s = state({ hands: [[[2, 6], [0, 0]], [[1, 1]], [], []] });
  const next = domino.reduce(s, { kind: 'play', stone: 0, end: 'left', at: 1000 }, ctx('a'));
  assert.deepEqual(next.ends, [2, 6]);
  assert.deepEqual(next.table[0].stone, [2, 6]);
});

test('encaixa pela ponta direita e gira a pedra', () => {
  const s = state({ hands: [[[1, 6], [0, 0]], [[1, 1]], [], []] });
  const next = domino.reduce(s, { kind: 'play', stone: 0, end: 'right', at: 1000 }, ctx('a'));
  assert.deepEqual(next.ends, [6, 1]);
  assert.deepEqual(next.table.at(-1).stone, [6, 1]);
});

test('recusa peça que não encaixa', () => {
  const s = state({ hands: [[[1, 2]], [[3, 4]], [], []] });
  assert.equal(domino.validate(s, { kind: 'play', stone: 0, end: 'left' }, ctx('a')), 'mesa.domino.naoEncaixa');
});

test('compra até poder jogar com monte', () => {
  let s = state({ hands: [[[1, 1]], [[3, 4]], [], []], stock: [[2, 5], [6, 6]] });
  s = domino.reduce(s, { kind: 'draw', at: 1000 }, ctx('a'));
  s = domino.reduce(s, { kind: 'draw', at: 1001 }, ctx('a'));
  assert.equal(s.hands[0].length, 3);
  assert.equal(domino.validate(s, { kind: 'play', stone: 2, end: 'left' }, ctx('a')), true);
});

test('sem monte, passa a vez', () => {
  const s = state({ hands: [[[1, 1]], [[2, 2]], [], []], stock: [] });
  assert.equal(domino.reduce(s, { kind: 'pass', at: 1000 }, ctx('a')).turn, 1);
});

test('com quatro jogadores passa e nunca compra', () => {
  const s = state({ seats: ['a', 'b', 'c', 'd'], hands: [[[1, 1]], [[2, 2]], [[3, 3]], [[4, 4]]], stock: [] });
  assert.equal(domino.validate(s, { kind: 'draw' }, ctx('a')), 'mesa.domino.jaPodeJogar');
  assert.equal(domino.validate(s, { kind: 'pass' }, ctx('a')), true);
});

test('batida individual marca a soma dos adversários', () => {
  const s = state({ hands: [[[6, 6]], [[2, 3]], [], []] });
  const next = domino.reduce(s, { kind: 'play', stone: 0, end: 'left', at: 1000 }, ctx('a'));
  assert.equal(next.scores[0], 5);
});

test('batida em dupla marca apenas as pedras adversárias', () => {
  const s = state({ seats: ['a', 'b', 'c', 'd'], hands: [[[6, 6]], [[2, 3]], [[1, 1]], [[4, 4]]] });
  const next = domino.reduce(s, { kind: 'play', stone: 0, end: 'left', at: 1000 }, ctx('a'));
  assert.equal(next.scores[0], 13);
  assert.equal(next.scores[2], 13);
});

test('tranca: menor soma vence e marca a soma adversária', () => {
  let s = state({ hands: [[[1, 1]], [[4, 4]], [], []], stock: [] });
  s = domino.reduce(s, { kind: 'pass', at: 1000 }, ctx('a'));
  s = domino.reduce(s, { kind: 'pass', at: 1001 }, ctx('b'));
  assert.equal(s.result.winner, 0);
  assert.equal(s.scores[0], 8);
});

test('empate na tranca não marca ponto', () => {
  let s = state({ hands: [[[1, 2]], [[0, 3]], [], []], stock: [] });
  s = domino.reduce(s, { kind: 'pass', at: 1000 }, ctx('a'));
  s = domino.reduce(s, { kind: 'pass', at: 1001 }, ctx('b'));
  assert.equal(s.result.winner, null);
  assert.deepEqual(s.scores, [0, 0, 0, 0]);
});

test('encerra o jogo ao alcançar 100 pontos', () => {
  const s = state({ scores: [98, 0, 0, 0], hands: [[[6, 6]], [[1, 1]], [], []] });
  const next = domino.reduce(s, { kind: 'play', stone: 0, end: 'left', at: 1000 }, ctx('a'));
  assert.equal(next.result.game, true);
});

test('timeout joga a primeira pedra que encaixa', () => {
  const s = state({ hands: [[[1, 1], [2, 6]], [[3, 3]], [], []] });
  const next = domino.reduce(s, domino.prepare(s, { kind: 'timeout' }, ctx('b', 32000)), ctx('b', 32000));
  assert.deepEqual(next.table.at(-1).stone, [2, 6]);
});

test('timeout compra quando não há pedra e passa sem monte', () => {
  const stocked = state({ hands: [[[1, 1]], [[3, 3]], [], []], stock: [[2, 6]] });
  const bought = domino.reduce(stocked, domino.prepare(stocked, { kind: 'timeout' }, ctx('b', 32000)), ctx('b', 32000));
  assert.equal(bought.hands[0].length, 2);
  const empty = state({ hands: [[[1, 1]], [[3, 3]], [], []], stock: [] });
  const passed = domino.reduce(empty, domino.prepare(empty, { kind: 'timeout' }, ctx('b', 32000)), ctx('b', 32000));
  assert.equal(passed.turn, 1);
});

test('recusa ação fora da vez', () => {
  const s = state({ hands: [[[6, 6]], [[6, 5]], [], []] });
  assert.equal(domino.validate(s, { kind: 'play', stone: 0, end: 'left' }, ctx('b')), 'mesa.jogo.naoESuaVez');
});

test('view mostra só as próprias pedras, contagens e não revela o monte', () => {
  const s = state({ hands: [[[6, 6]], [[1, 2]], [], []], stock: [[0, 0], [2, 2]] });
  const view = domino.view(s, 'a', { peers: PEERS });
  assert.deepEqual(view.hand, [[6, 6]]);
  assert.deepEqual(view.counts, [1, 1, 0, 0]);
  assert.equal(view.stock, 2);
  assert.equal(JSON.stringify(view).includes('[1,2]'), false);
  assert.equal(JSON.stringify(view).includes('[0,0]'), false);
});

test('migração cancela a mão e preserva lugares e placar', () => {
  const migrated = domino.migrate(state({ scores: [9, 3, 0, 0] }));
  assert.equal(migrated.phase, 'waiting');
  assert.deepEqual(migrated.hands, [[], [], [], []]);
  assert.deepEqual(migrated.scores, [9, 3, 0, 0]);
});

test('lugar fantasma fica livre e dropPeer libera a cadeira', () => {
  const s = state({ seats: ['old', 'b', null, null], phase: 'waiting' }); // sentar so entre maos (J-07)
  const peers = [{ id: 'new', name: 'Novo' }, { id: 'b', name: 'B' }];
  assert.equal(domino.validate(s, { kind: 'sit', seat: 0 }, ctx('new', 0, peers)), true);
  assert.equal(domino.dropPeer(s, 'b').seats[1], null);
});

test('saida de quem esta na vez avanca imediatamente para o proximo vivo', () => {
  const s = state({ turn: 0, hands: [[[6, 6]], [[1, 2]], [], []] });
  const next = domino.dropPeer(s, 'a');
  assert.equal(next.seats[0], null);
  assert.deepEqual(next.hands[0], []);
  assert.equal(next.turn, 1);
});

// ---- Auditoria da Mesa 2026-11-25 (J-06, J-07, J-12 e lugar fantasma na abertura) ----

// Como o servidor: validate e prepare com `peers`; o reduce so recebe { from, isLeader }.
function comoServidor(s, action, from, now = 1000, peers = PEERS) {
  const c = { from, now, peers, random: () => 0, isLeader: false };
  const veredito = domino.validate(s, action, c);
  if (veredito !== true) return { erro: veredito };
  const preparada = JSON.parse(JSON.stringify(domino.prepare(s, action, c)));
  return { estado: domino.reduce(s, preparada, { from, isLeader: false }) };
}

function emAbertura() {
  return state({
    phase: 'opening', turn: 1, winner: 1, ends: null, deadline: 31000, hands: [[[1, 2]], [[6, 6]], [], []],
  });
}

test('J-06: timeout na abertura vale (o prazo que o servidor anuncia) e abre com a 1a pedra', () => {
  const s = emAbertura();
  assert.equal(domino.timeoutAt(s), 31000);
  const r = comoServidor(s, { kind: 'timeout' }, 'a', 31000);
  assert.equal(r.erro, undefined);
  assert.equal(r.estado.phase, 'play');
  assert.deepEqual(r.estado.table[0].stone, [6, 6]);
});

test('J-06: timeout sem mao correndo continua recusado', () => {
  assert.equal(comoServidor(state({ phase: 'waiting' }), { kind: 'timeout' }, 'a').erro, 'mesa.domino.nadaCorrendo');
  assert.equal(comoServidor(state({ phase: 'done' }), { kind: 'timeout' }, 'a').erro, 'mesa.domino.nadaCorrendo');
});

test('J-06: se quem devia abrir sai da sala, a mao volta a esperar "Nova mao" (ninguem fica travado)', () => {
  const s = emAbertura();
  const d = domino.dropPeer(s, 'b');
  assert.equal(d.phase, 'waiting');
  assert.equal(d.turn, null);
  assert.equal(domino.timeoutAt(d), null);
  assert.equal(comoServidor(d, { kind: 'start' }, 'a').erro, 'mesa.domino.precisaDeDois' /* so Ana sentada */);
  // Quem nao era o da vez saindo na abertura nao muda a fase.
  const outro = domino.dropPeer(state({ ...emAbertura(), seats: ['a', 'b', 'c', null] }), 'c');
  assert.equal(outro.phase, 'opening');
});

test('J-07: nao da para sentar com a mao em curso (abertura ou jogo)', () => {
  for (const phase of ['opening', 'play']) {
    const r = comoServidor(state({ phase }), { kind: 'sit', seat: 2 }, 'c');
    assert.equal(r.erro, 'mesa.cadeiras.partidaComecou', phase);
  }
  for (const phase of ['waiting', 'done']) {
    assert.equal(comoServidor(state({ phase }), { kind: 'sit', seat: 2 }, 'c').erro, undefined, phase);
  }
  const v = domino.view(state({ phase: 'play' }), 'c', { peers: PEERS });
  assert.deepEqual(v.me.can.sit, [false, false, false, false]);
});

test('J-12: depois do jogo (100 pontos) a proxima mao zera o placar', () => {
  const fim = state({
    phase: 'done', scores: [104, 0, 0, 0], winner: 0, ends: null, table: [],
    result: { reason: 'bateu', winner: 0, gain: 6, game: true },
  });
  const r = comoServidor(fim, { kind: 'start' }, 'a');
  assert.equal(r.erro, undefined);
  assert.deepEqual(r.estado.scores, [0, 0, 0, 0]);
  // Mao comum (sem fim de jogo): o placar segue.
  const comum = { ...fim, scores: [10, 0, 0, 0], result: { reason: 'bateu', winner: 0, gain: 6, game: false } };
  assert.deepEqual(comoServidor(comum, { kind: 'start' }, 'a').estado.scores, [10, 0, 0, 0]);
});

test('migracao: lugar fantasma nao ganha pedras nem a vez quando a mao comeca', () => {
  const novos = [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }];
  const antigo = state({ seats: ['velho', null, null, null], names: ['V', null, null, null], phase: 'waiting' });
  let s = domino.migrate(antigo);
  s = comoServidor(s, { kind: 'sit', seat: 1 }, 'x', 1000, novos).estado;
  s = comoServidor(s, { kind: 'sit', seat: 2 }, 'y', 1000, novos).estado;
  const r = comoServidor(s, { kind: 'start' }, 'x', 1000, novos);
  assert.equal(r.erro, undefined);
  assert.equal(r.estado.seats[0], null);
  assert.deepEqual(r.estado.hands.map((m) => m.length > 0), [false, true, true, false]);
  assert.ok([1, 2].includes(r.estado.turn));
});
