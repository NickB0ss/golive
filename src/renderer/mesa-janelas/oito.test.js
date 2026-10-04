'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../i18n');
const janela = require('./oito');

test('textoDeStatus mostra a vez e o placar da rodada', () => {
  const state = {
    phase: 'play',
    turn: 1,
    seats: ['ana', 'bia'],
    names: ['Ana', 'Bia'],
    scores: [20, 40],
  };

  assert.equal(janela.textoDeStatus(state), 'Vez de Bia — 20 × 40 pontos');
});

test('Oito envia estado proprio e alheio para a barra', () => {
  const chamadas = [];
  const api = { setStatus: (v) => chamadas.push(['status', v]), setTurn: (v) => chamadas.push(['turn', v]) };
  janela.atualizarBarra(api, 'Ana tem 3 cartas · vez de Ana', true);
  janela.atualizarBarra(api, 'Bia tem 3 cartas · vez de Bia', false);
  assert.deepEqual(chamadas, [
    ['status', 'Ana tem 3 cartas · vez de Ana'], ['turn', true],
    ['status', 'Bia tem 3 cartas · vez de Bia'], ['turn', false],
  ]);
});

test('podeJogar reconhece naipe, valor e oito', () => {
  assert.equal(janela.podeJogar('2h', 'Kh', 'h'), true);
  assert.equal(janela.podeJogar('Ks', 'Kh', 'h'), true);
  assert.equal(janela.podeJogar('8c', 'Kh', 'h'), true);
  assert.equal(janela.podeJogar('3s', 'Kh', 'h'), false);
});

// ---------- Montagem (DOM falso) ----------
require('./comum');
require('./cartas');
const { montar } = require('./dom-falso-leva3');

const estadoOito = (extra = {}) => ({
  phase: 'play', seats: ['1', '2'], names: ['Ana', 'Bia'], scores: [0, 0], counts: [7, 7], hand: ['Qc', '8h'],
  discard: 'Kh', suit: 'h', turn: 0, deadline: null, winner: null,
  me: { seat: 0, can: { play: true, draw: false, start: false, stand: true, reset: true, sit: [] } }, ...extra,
});

test('oito nao repete o titulo da barra no corpo e o alto e a linha de estado', () => {
  const t = montar(janela, estadoOito());
  assert.ok(!t.texto().includes('Oito maluco'));
  assert.equal(t.achar('.mj-oito-topo').children[0].textContent, 'Vez de Ana');
  t.destruir();
});

test('oito mostra o naipe escolhido em chip e o monte ao lado do descarte', () => {
  assert.deepEqual(janela.chipNaipe('h'), { nome: 'Copas', texto: '♥ Copas', vermelho: true });
  assert.deepEqual(janela.chipNaipe('s'), { nome: 'Espadas', texto: '♠ Espadas', vermelho: false });
  const t = montar(janela, estadoOito());
  assert.equal(t.achar('.mj-oito-naipe').textContent, '♥ Copas');
  assert.equal(t.achar('.mj-oito-naipe').getAttribute('aria-label'), 'Naipe: Copas');
  assert.ok(t.achar('.mj-oito-monte').querySelector('.is-verso'));
  t.destruir();
});

test('oito: uma acao principal por momento (dar as cartas na espera, comprar sem jogada)', () => {
  const espera = montar(janela, estadoOito({ phase: 'waiting', me: { seat: 0, can: { start: true, sit: [] } } }));
  assert.ok(espera.botao('Dar cartas').classList.contains('mj-pri'));
  assert.ok(!espera.botao('Comprar').classList.contains('mj-pri'));
  espera.destruir();
  const compra = montar(janela, estadoOito({ me: { seat: 0, can: { draw: true, start: false, sit: [] } } }));
  assert.ok(compra.botao('Comprar').classList.contains('mj-pri'));
  compra.destruir();
});
