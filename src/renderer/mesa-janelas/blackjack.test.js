'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const J = require('./blackjack');
const bj = require('../mesa-modules/blackjack');

const mao = (extra) => Object.assign({ cards: ['Ts', '7d'], total: 17, soft: false, blackjack: false, bust: false, bet: 10, result: null, win: null }, extra);

test('textoTotal: macio, blackjack, estourou', () => {
  assert.equal(J.textoTotal(mao()), '17');
  assert.equal(J.textoTotal(mao({ cards: ['As', '6d'], soft: true })), '17 macio');
  assert.equal(J.textoTotal(mao({ cards: ['As', 'Kd'], total: 21, blackjack: true })), 'Blackjack!');
  assert.equal(J.textoTotal(mao({ total: 25, bust: true })), 'Estourou');
  assert.equal(J.textoTotal(mao({ cards: [] })), '');
});

test('textoBanca: so a aberta ate virar', () => {
  assert.equal(J.textoBanca({ cards: ['Ts', null], total: 10, revealed: false }), 'Mostra 10');
  assert.equal(J.textoBanca({ cards: ['As', null], total: 11, revealed: false }), 'Mostra ás');
  assert.equal(J.textoBanca({ cards: ['Ts', '6d', 'Kc'], total: 26, bust: true, revealed: true }), 'Estourou');
  assert.equal(J.textoBanca({ cards: [] }), '');
});

test('textoResultado: ganhou, empate, perdeu', () => {
  assert.equal(J.textoResultado(mao()), null);
  assert.equal(J.textoResultado(mao({ result: 'win', win: 30 })), 'Ganhou 30');
  assert.equal(J.textoResultado(mao({ result: 'blackjack', win: 1500 })), 'Blackjack! Ganhou 1 500');
  assert.equal(J.textoResultado(mao({ result: 'push', win: 0 })), 'Empate');
  assert.equal(J.textoResultado(mao({ result: 'bust', win: -10 })), 'Perdeu 10');
});

test('segundos: arredonda para cima e nunca fica negativo', () => {
  assert.equal(J.segundos(null, 0), null);
  assert.equal(J.segundos(10000, 0), 10);
  assert.equal(J.segundos(10000, 9001), 1);
  assert.equal(J.segundos(10000, 20000), 0);
});

// Uma rodada de verdade pelo modulo, lida pela view de cada um.
function rodada() {
  const PEERS = [{ id: 'bia', name: 'Bia' }, { id: 'leo', name: 'Leo' }];
  const run = (s, a, from) => {
    const c = { from, now: 1000, peers: PEERS, random: () => 0.3 };
    assert.equal(bj.validate(s, a, c), true);
    return bj.reduce(s, bj.prepare(s, a, c), { from });
  };
  let s = bj.init({ random: () => 0.3 });
  s = run(s, { kind: 'sit', seat: 0 }, 'bia');
  s = run(s, { kind: 'sit', seat: 1 }, 'leo');
  s = Object.assign({}, s, { shoe: ['Ts', '9h', '5c', '7s', '9d', 'Kd', '3h'].concat(s.shoe) });
  const s0 = s;
  s = run(s, { kind: 'bet', amount: 10 }, 'bia');
  s = run(s, { kind: 'bet', amount: 10 }, 'leo');
  return { s0, s, run };
}

test('textoStatus e anuncio seguem a rodada', () => {
  const { s0, s, run } = rodada();
  const nome = (id) => ({ bia: 'Bia', leo: 'Leo' })[id];
  assert.equal(J.textoStatus(bj.view(s0, 'bia'), nome), 'Façam as apostas');
  const vb = bj.view(s, 'bia');
  assert.equal(J.textoStatus(vb, nome), 'Sua vez');
  assert.equal(J.textoStatus(bj.view(s, 'leo'), nome), 'Vez de Bia');
  const fala = J.anuncio(bj.view(s0, 'bia'), vb, nome);
  assert.match(fala, /Cartas na mesa/);
  assert.match(fala, /Sua vez: 17/);
  const s2 = run(s, { kind: 'stand' }, 'bia');
  assert.equal(J.anuncio(bj.view(s, 'leo'), bj.view(s2, 'leo'), nome), 'Sua vez: 18');
  const s3 = run(s2, { kind: 'stand' }, 'leo');
  const fim = J.anuncio(bj.view(s2, 'bia'), bj.view(s3, 'bia'), nome);
  assert.match(fim, /Banca: 18/);
  assert.match(fim, /você: Perdeu 10/);
  assert.equal(J.esperaTimeout(bj.view(s, 'bia')), 0);
  assert.equal(J.esperaTimeout(bj.view(s, 'leo')), 700);
  assert.equal(J.esperaTimeout(bj.view(s, null)), 1500);
});
