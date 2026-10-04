'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../i18n');
require('./comum');
const janela = require('./domino');

test('Dominó envia estado proprio e alheio para a barra', () => {
  const chamadas = [];
  const api = { setStatus: (v) => chamadas.push(['status', v]), setTurn: (v) => chamadas.push(['turn', v]) };
  janela.atualizarBarra(api, 'Vez de Ana · monte: 8', true);
  janela.atualizarBarra(api, 'Vez de Bia · monte: 8', false);
  assert.deepEqual(chamadas, [
    ['status', 'Vez de Ana · monte: 8'], ['turn', true], ['status', 'Vez de Bia · monte: 8'], ['turn', false],
  ]);
});

test('dominó desenha pontos SVG e reconhece pedra que encaixa', () => {
  assert.match(janela.pedraSvg([6, 0]), /<circle/g);
  const s = { phase: 'play', me: { seat: 0 }, turn: 0, ends: [2, 5] };
  assert.equal(janela.podeJogar(s, [2, 6]), true);
  assert.equal(janela.podeJogar(s, [1, 4]), false);
});

test('dominó mostra prazo pela hora do servidor', () => {
  assert.equal(janela.segundos(31000, 1000), 30);
  assert.equal(janela.segundos(null, 1000), null);
});

// ---------- Montagem (DOM falso) ----------
const { montar } = require('./dom-falso-leva3');

const estadoDomino = (extra = {}) => ({
  phase: 'waiting', seats: [null, null, null, null], names: [null, null, null, null], counts: [0, 0, 0, 0],
  scores: [0, 0, 0, 0], table: [], hand: [], stock: 0, turn: 0,
  me: { seat: -1, can: { sit: [true, true, true, true] } },
  ...extra,
});

test('domino sem ninguem mostra o vazio no lugar da mesa e a frase de situacao some', () => {
  const t = montar(janela, estadoDomino());
  assert.equal(t.achar('.mj-vazio').hidden, false);
  assert.equal(t.achar('.mj-do-mesa').hidden, true);
  assert.equal(t.achar('.mj-do-status').hidden, true);
  assert.equal(t.todos('.mj-cadeira-livre').length, 4);
  assert.equal(t.achar('.mj-vazio-texto').textContent, 'Sente 2 a 4 pessoas e dê as pedras');
  t.destruir();
});

test('domino com gente sentada mostra a mesa e Comprar/Passar/Levantar em C.acoes', () => {
  const t = montar(janela, estadoDomino({ seats: ['1', '2', null, null], names: ['Ana', 'Bia', null, null] }));
  assert.equal(t.achar('.mj-vazio').hidden, true);
  assert.equal(t.achar('.mj-do-mesa').hidden, false);
  assert.ok(t.botao('Comprar do monte').classList.contains('mj-pri'));
  assert.ok(t.botao('Passar a vez').classList.contains('mj-fantasma'));
  assert.ok(t.botao('Levantar da cadeira').classList.contains('mj-fantasma'));
  assert.ok(t.achar('.mj-do-acoes').classList.contains('mj-acoes'));
  t.destruir();
});

test('domino: o botao Sentar continua o mesmo entre atualizacoes (o foco nao cai)', () => {
  const t = montar(janela, estadoDomino());
  const antes = t.todos('.mj-cadeira-livre')[0];
  t.atualizar(estadoDomino());
  assert.equal(t.todos('.mj-cadeira-livre')[0], antes);
  t.destruir();
});
