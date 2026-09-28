'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../mesa-modules/enquete');
require('./comum');
const janela = require('./enquete');

function comVotos() {
  let s = m.init({ by: '1' });
  s = m.reduce(s, { kind: 'edit', question: 'Pizza?', options: ['Pizza', 'Hambúrguer', 'Tanto faz'] }, { from: '1' });
  s = m.reduce(s, { kind: 'vote', option: 0, by: '1' });
  s = m.reduce(s, { kind: 'vote', option: 0, by: '2' });
  s = m.reduce(s, { kind: 'vote', option: 1, by: '3' });
  return s;
}

test('registra o conteudo da enquete', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.enquete, janela);
});

test('barras: contagem, fatia, meu voto, frente e quem votou', () => {
  const b = janela.barras(m, comVotos(), '2');
  assert.deepEqual(b.map((x) => x.n), [2, 1, 0]);
  assert.ok(Math.abs(b[0].frac - 2 / 3) < 1e-9);
  assert.deepEqual(b.map((x) => x.meu), [true, false, false]);
  assert.deepEqual(b.map((x) => x.frente), [true, false, false]);
  assert.deepEqual(b[0].votantes, ['1', '2']);
  // Sem voto nenhum: ninguem na frente, fatias zeradas.
  const vazio = janela.barras(m, m.init({}), '1');
  assert.deepEqual(vazio.map((x) => [x.frac, x.frente]), [[0, false], [0, false]]);
});

test('acaoVoto: vota, troca, e clicar no proprio voto tira', () => {
  const s = comVotos();
  assert.deepEqual(janela.acaoVoto(m, s, '2', 0), { kind: 'unvote' });
  assert.deepEqual(janela.acaoVoto(m, s, '2', 1), { kind: 'vote', option: 1 });
  assert.deepEqual(janela.acaoVoto(m, s, '4', 2), { kind: 'vote', option: 2 });
  // E o modulo aceita cada uma.
  assert.equal(m.validate(s, { kind: 'unvote' }, { from: '2' }), true);
  assert.equal(m.validate(s, { kind: 'vote', option: 1 }, { from: '2' }), true);
});

test('rotuloOpcao e textoTotal', () => {
  const [b0, b1] = janela.barras(m, comVotos(), '2');
  assert.equal(janela.rotuloOpcao(b0, false), 'Pizza: 2 votos. Seu voto; clique para tirar');
  assert.equal(janela.rotuloOpcao(b1, false), 'Hambúrguer: 1 voto');
  assert.equal(janela.rotuloOpcao(b0, true), 'Pizza: 2 votos. Seu voto');
  assert.equal(janela.textoTotal(m.init({})), 'Ninguém votou ainda');
  assert.equal(janela.textoTotal(comVotos()), '3 votos');
  assert.equal(janela.textoTotal(m.reduce(comVotos(), { kind: 'close' })), '3 votos · encerrada');
});

test('bolinhas: ate o teto, o resto vira +N', () => {
  assert.deepEqual(janela.bolinhas(['1', '2'], 6), { mostrar: ['1', '2'], resto: 0 });
  const ids = ['1', '2', '3', '4', '5', '6', '7', '8'];
  assert.deepEqual(janela.bolinhas(ids, 6), { mostrar: ['1', '2', '3', '4', '5'], resto: 3 });
});
