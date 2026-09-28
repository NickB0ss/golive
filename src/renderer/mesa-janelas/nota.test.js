'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../mesa-modules/nota');
const C = require('./comum');
const janela = require('./nota');

test('registra o conteudo da nota', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.nota, janela);
  assert.equal(typeof janela.mount, 'function');
});

test('contador conta caractere de verdade, como o validate do modulo', () => {
  assert.deepEqual(janela.contador('oi', 1000, C.milhar), { n: 2, passou: false, texto: '2 / 1 000' });
  const emoji = '😀'.repeat(1000);
  assert.equal(janela.contador(emoji, 1000, C.milhar).passou, false);
  assert.equal(m.validate(m.init(), { kind: 'set', text: emoji }), true);
  const longo = 'a'.repeat(1001);
  assert.equal(janela.contador(longo, 1000, C.milhar).passou, true);
  assert.equal(typeof m.validate(m.init(), { kind: 'set', text: longo }), 'string');
});

test('precisaSalvar so quando mudou do que a sala tem', () => {
  assert.equal(janela.precisaSalvar('a', 'a'), false);
  assert.equal(janela.precisaSalvar('ab', 'a'), true);
});

test('textoAutor', () => {
  const nomeDe = (id) => (id === '2' ? 'Bia' : 'Alguém');
  assert.equal(janela.textoAutor(m.init(), nomeDe), '');
  assert.equal(janela.textoAutor(m.reduce(m.init(), { kind: 'set', text: 'x' }, { from: '2' }), nomeDe), 'Salvo por Bia');
});

test('a pausa de digitacao nao e "a cada tecla"', () => {
  assert.ok(janela.PAUSA_MS >= 500);
});
