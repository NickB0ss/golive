'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('./cadeiras');

const PEERS = [{ id: 'bia', name: 'Bia' }, { id: 'leo', name: 'Leo' }, { id: 'ana', name: 'Ana' }];
const ctx = (from, extra) => Object.assign({ from, isLeader: false, peers: PEERS }, extra);
// Como o servidor aplica: prepare com peers, reduce com o ctx dos clientes.
const sit = (state, seat, from) =>
  C.reduceSeat(state, C.prepareSeat(state, { kind: 'sit', seat }, ctx(from)), { from, isLeader: false });

test('sit guarda o id e o nome de quem sentou', () => {
  const s = sit(C.emptySeats(), 1, 'leo');
  assert.deepEqual(s, { seats: [null, 'leo'], names: [null, 'Leo'] });
});

test('o nome vem da acao preparada: servidor e clientes chegam ao mesmo estado', () => {
  const acao = C.prepareSeat(C.emptySeats(), { kind: 'sit', seat: 0, name: 'Forjado' }, ctx('bia'));
  assert.deepEqual(acao, { kind: 'sit', seat: 0, name: 'Bia' });
  const servidor = C.reduceSeat(C.emptySeats(), acao, ctx('bia'));
  const cliente = C.reduceSeat(C.emptySeats(), acao, { from: 'bia', isLeader: false });
  assert.deepEqual(cliente, servidor);
  // Sem prepare (acao crua), o reduce nao inventa nome a partir de peers.
  assert.deepEqual(C.reduceSeat(C.emptySeats(), { kind: 'sit', seat: 0 }, ctx('bia')).names, [null, null]);
});

test('sit recusa cadeira ocupada, cadeira invalida e quem ja esta sentado', () => {
  const s = sit(C.emptySeats(), 0, 'bia');
  assert.equal(C.validateSeat(s, { kind: 'sit', seat: 0 }, ctx('leo')), 'Cadeira ocupada');
  assert.equal(C.validateSeat(s, { kind: 'sit', seat: 1 }, ctx('bia')), 'Você já está sentado');
  for (const seat of [2, -1, '0', 0.5, null, undefined]) {
    assert.equal(C.validateSeat(s, { kind: 'sit', seat }, ctx('leo')), 'Cadeira inválida');
  }
  assert.equal(C.validateSeat(s, { kind: 'sit', seat: 1 }, {}), 'Quem mandou?');
});

test('stand so vale para quem esta sentado e libera a cadeira', () => {
  const s = sit(C.emptySeats(), 0, 'bia');
  assert.equal(C.validateSeat(s, { kind: 'stand' }, ctx('leo')), 'Você não está sentado');
  assert.equal(C.validateSeat(s, { kind: 'stand' }, ctx('bia')), true);
  assert.deepEqual(C.reduceSeat(s, { kind: 'stand' }, ctx('bia')), C.emptySeats());
});

test('sit sem nome na lista de peers guarda nome nulo', () => {
  const s = sit(C.emptySeats(), 0, 'zeca');
  assert.deepEqual(s.names, [null, null]);
  assert.equal(C.nameOf(s, 0, ['Brancas', 'Pretas']), 'Brancas');
});

test('dropPeer libera a cadeira e devolve o mesmo estado se a pessoa assistia', () => {
  const s = { seats: ['bia', 'leo'], names: ['Bia', 'Leo'], outro: 1 };
  assert.deepEqual(C.dropPeer(s, 'leo'), { seats: ['bia', null], names: ['Bia', null], outro: 1 });
  assert.equal(C.dropPeer(s, 'ana'), s);
});

test('canReset aceita sentado ou lider e recusa quem so assiste', () => {
  const s = { seats: ['bia', null], names: ['Bia', null] };
  assert.equal(C.canReset(s, ctx('bia')), true);
  assert.equal(C.canReset(s, ctx('ana', { isLeader: true })), true);
  assert.equal(C.canReset(s, ctx('ana')), 'Só quem está sentado ou o líder recomeça');
});

test('canPlay exige cadeira, adversario, vez e partida em andamento', () => {
  const s = { seats: ['bia', 'leo'], names: ['Bia', 'Leo'], result: null };
  assert.equal(C.canPlay(s, ctx('bia'), 0), true);
  assert.equal(C.canPlay(s, ctx('leo'), 0), 'Não é a sua vez');
  assert.equal(C.canPlay(s, ctx('ana'), 0), 'Sente-se para jogar');
  assert.equal(C.canPlay({ ...s, seats: ['bia', null] }, ctx('bia'), 0), 'Espere alguém sentar na outra cadeira');
  assert.equal(C.canPlay({ ...s, result: { winner: 0 } }, ctx('bia'), 0), 'A partida acabou');
});

test('describePlaying cobre cadeiras vazias, meia e cheia', () => {
  const L = ['X', 'O'];
  assert.equal(C.describePlaying({ seats: [null, null], names: [null, null] }, 0, L), 'Cadeiras livres');
  assert.equal(C.describePlaying({ seats: [null, 'leo'], names: [null, 'Leo'] }, 0, L), 'Leo espera adversário');
  assert.equal(C.describePlaying({ seats: ['bia', 'leo'], names: ['Bia', 'Leo'] }, 1, L), 'Bia × Leo — vez de Leo');
});

test('nameOf prefere o nome atual da sala quando a lista vem', () => {
  const s = { seats: ['bia', null], names: ['Bia', null] };
  assert.equal(C.nameOf(s, 0, ['X', 'O'], [{ id: 'bia', name: 'Beatriz' }]), 'Beatriz');
  assert.equal(C.nameOf(s, 0, ['X', 'O'], []), 'Bia');
});

test('nome longo e cortado no teto', () => {
  const long = 'a'.repeat(100);
  const c = { from: 'x', peers: [{ id: 'x', name: long }] };
  const s = C.reduceSeat(C.emptySeats(), C.prepareSeat(C.emptySeats(), { kind: 'sit', seat: 0 }, c), c);
  assert.equal(s.names[0].length, C.NAME_MAX);
});

test('safe troca excecao pelo valor reserva', () => {
  assert.equal(C.safe(() => { throw new Error('x'); }, 'reserva'), 'reserva');
  assert.equal(C.safe(() => 1, 'reserva'), 1);
});
