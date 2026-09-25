'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('./tabuleiro');
const velha = require('../mesa-modules/velha');
require('./comum');
const jVelha = require('./velha');
const lig4 = require('../mesa-modules/lig4');
const jLig4 = require('./lig4');

const LAB = ['X', 'O'];
const nomes = { 1: 'Ana', 2: 'Bia' };
const nameOf = (id) => nomes[id] || null;
const ctx = (from) => ({ from, isLeader: from === '1', peers: [{ id: '1', name: 'Ana' }, { id: '2', name: 'Bia' }] });

function sentados() {
  let s = velha.init();
  s = velha.reduce(s, { kind: 'sit', seat: 0 }, ctx('1'));
  return velha.reduce(s, { kind: 'sit', seat: 1 }, ctx('2'));
}

test('minhaCadeira e virado', () => {
  const s = sentados();
  assert.equal(T.minhaCadeira(s, '1'), 0);
  assert.equal(T.minhaCadeira(s, '2'), 1);
  assert.equal(T.minhaCadeira(s, '3'), -1);
  assert.equal(T.virado(s, '2'), true);
  assert.equal(T.virado(s, '3'), false);
});

test('textoStatus: cadeiras, vez, vitoria e empate', () => {
  let s = velha.init();
  assert.equal(T.textoStatus(s, '1', LAB, nameOf), 'Cadeiras livres: sente-se para jogar');
  s = velha.reduce(s, { kind: 'sit', seat: 0 }, ctx('1'));
  assert.equal(T.textoStatus(s, '1', LAB, nameOf), 'Esperando alguém sentar na outra cadeira');
  assert.equal(T.textoStatus(s, '3', LAB, nameOf), 'Uma cadeira livre: sente-se para jogar');
  s = sentados();
  assert.equal(T.textoStatus(s, '1', LAB, nameOf), 'Sua vez');
  assert.equal(T.textoStatus(s, '2', LAB, nameOf), 'Vez de Ana');
  for (const [p, cell] of [['1', 0], ['2', 3], ['1', 1], ['2', 4], ['1', 2]]) s = velha.reduce(s, { kind: 'move', cell }, ctx(p));
  assert.equal(T.textoStatus(s, '1', LAB, nameOf), 'Você venceu');
  assert.equal(T.textoStatus(s, '3', LAB, nameOf), 'Ana venceu');
  const empate = { ...s, result: { winner: null, reason: 'velha' } };
  assert.equal(T.textoStatus(empate, '1', LAB, nameOf, jVelha.empate), 'Deu velha');
  const desistiu = { ...s, result: { winner: 1, reason: 'abandono' } };
  assert.equal(T.textoStatus(desistiu, '1', LAB, nameOf), 'Você desistiu');
  assert.equal(T.textoStatus(desistiu, '2', LAB, nameOf), 'Ana desistiu; você venceu');
});

test('nomeCadeira cai no rotulo quando a pessoa saiu', () => {
  const s = sentados();
  assert.equal(T.nomeCadeira(s, 1, LAB, nameOf), 'Bia');
  assert.equal(T.nomeCadeira(s, 1, LAB, () => null), 'Bia'); // guardado ao sentar
  assert.equal(T.nomeCadeira({ ...s, names: [null, null] }, 1, LAB, () => null), 'O');
});

test('casaDoEstado vira para quem senta na cadeira 1; nomeCasa', () => {
  assert.deepEqual(T.casaDoEstado(0, 0, 8, false), [0, 0]);
  assert.deepEqual(T.casaDoEstado(0, 0, 8, true), [7, 7]);
  assert.equal(T.nomeCasa(7, 4, 8), 'e1');
  assert.equal(T.nomeCasa(0, 0, 8), 'a8');
});

test('passoGrade: setas dentro da grade, sem sair pela borda', () => {
  assert.equal(T.passoGrade(4, 'ArrowRight', 3, 9), 5);
  assert.equal(T.passoGrade(4, 'ArrowUp', 3, 9), 1);
  assert.equal(T.passoGrade(2, 'ArrowRight', 3, 9), 2);
  assert.equal(T.passoGrade(8, 'ArrowDown', 3, 9), 8);
  assert.equal(T.passoGrade(5, 'Home', 3, 9), 3);
  assert.equal(T.passoGrade(0, 'Enter', 3, 9), null);
});

test('velha: rotulo das casas', () => {
  assert.equal(jVelha.rotuloCasa('X........', 0), 'Linha 1, coluna 1: X');
  assert.equal(jVelha.rotuloCasa('X........', 4), 'Linha 2, coluna 2: vazia');
});

test('lig4: casas livres por coluna', () => {
  let s = lig4.init();
  s = lig4.reduce(s, { kind: 'sit', seat: 0 }, ctx('1'));
  s = lig4.reduce(s, { kind: 'sit', seat: 1 }, ctx('2'));
  s = lig4.reduce(s, { kind: 'move', col: 2 }, ctx('1'));
  assert.equal(jLig4.livresNaColuna(s.board, 2), 5);
  assert.equal(jLig4.rotuloColuna(s.board, 2), 'Coluna 3: 5 casas livres');
  assert.equal(jLig4.rotuloColuna(s.board, 0), 'Coluna 1: 6 casas livres');
});
