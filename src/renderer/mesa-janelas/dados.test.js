'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../mesa-modules/dados');
require('./comum');
const janela = require('./dados');

const nomeDe = (id) => ({ 1: 'Ana', 2: 'Bia' })[id] || 'Alguém';

function rolado() {
  let s = m.init();
  s = m.reduce(s, { kind: 'roll', sides: 6, values: [3, 5], by: '2' });
  s = m.reduce(s, { kind: 'coin', value: 'cara', by: '1' });
  return m.reduce(s, { kind: 'roll', sides: 20, values: [17], by: '1' });
}

test('registra o conteudo dos dados', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.dados, janela);
});

test('novaJogada so quando o contador sobe (config e limpar nao animam)', () => {
  const s0 = m.init();
  const s1 = m.reduce(s0, { kind: 'roll', sides: 6, values: [1, 2], by: '1' });
  assert.equal(janela.novaJogada(null, s1), false); // ao montar, nada anima
  assert.equal(janela.novaJogada(s0, s1), true);
  assert.equal(janela.novaJogada(s1, m.reduce(s1, { kind: 'config', count: 3, sides: 8 })), false);
  assert.equal(janela.novaJogada(s1, m.reduce(s1, { kind: 'clear' })), false);
});

test('mudouHistorico por conteudo, nao por referencia', () => {
  const s = rolado();
  assert.equal(janela.mudouHistorico(s, JSON.parse(JSON.stringify(s))), false);
  assert.equal(janela.mudouHistorico(s, m.reduce(s, { kind: 'clear' })), true);
});

test('anuncio usa o describe do modulo', () => {
  const s = rolado();
  assert.equal(janela.anuncio(m, s.history[0], nomeDe), 'Bia rolou 2d6: 3 + 5 = 8');
  assert.equal(janela.anuncio(m, s.history[1], nomeDe), 'Ana jogou a moeda: cara');
  assert.equal(janela.anuncio(m, s.history[2], nomeDe), 'Ana rolou 1d20: 17');
});

test('faces: dados com total, moeda, e nada antes da primeira jogada', () => {
  const s = rolado();
  assert.deepEqual(janela.faces(m, s.history[0]), { tipo: 'dados', valores: ['3', '5'], total: 8, lados: 6 });
  assert.deepEqual(janela.faces(m, s.history[1]), { tipo: 'moeda', valores: ['Cara'], total: null });
  assert.equal(janela.faces(m, s.history[2]).total, null);
  assert.deepEqual(janela.faces(m, null), { tipo: 'nada', valores: [], total: null });
});

test('historico do mais novo ao mais velho, sem a jogada do meio', () => {
  const h = janela.historico(m, rolado());
  assert.deepEqual(h.map((x) => x.texto), ['Moeda: cara', '2d6: 3 + 5 = 8']);
  assert.equal(janela.ultima(m.init()), null);
});
