'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  chooseSuccessor,
  chooseNewOwner,
  successorRank,
  successorTimeoutMs,
} = require('./succession');

test('chooseSuccessor ordena ids numericamente e exclui o host', () => {
  assert.equal(chooseSuccessor(['9', '10', '2'], '9'), '2');
  assert.equal(chooseSuccessor(['1', '2', '10'], '1'), '2');
});

test('chooseSuccessor devolve null quando o host e o unico candidato', () => {
  assert.equal(chooseSuccessor(['1'], '1'), null);
  assert.equal(chooseSuccessor([], '1'), null);
});

test('chooseNewOwner preserva o dono atual que sobreviveu', () => {
  assert.equal(chooseNewOwner(['2', '3'], '3', '2'), '3');
});

test('chooseNewOwner escolhe o sucessor quando o dono atual saiu', () => {
  assert.equal(chooseNewOwner(['2', '3'], '1', '2'), '2');
});

test('chooseNewOwner propaga successorId nulo quando ninguem sobreviveu', () => {
  assert.equal(chooseNewOwner([], '1', null), null);
});

test('successorRank exclui host e encontra a posicao numerica', () => {
  assert.equal(successorRank(['9', '10', '2'], '9', '2'), 0);
  assert.equal(successorRank(['9', '10', '2'], '9', '10'), 1);
});

test('successorRank devolve -1 para host ou id ausente', () => {
  assert.equal(successorRank(['1', '2'], '1', '1'), -1);
  assert.equal(successorRank(['1', '2'], '1', '3'), -1);
});

test('successorTimeoutMs escala por rank e age logo para rank negativo ou zero', () => {
  assert.equal(successorTimeoutMs(-1), 0);
  assert.equal(successorTimeoutMs(0), 0);
  assert.equal(successorTimeoutMs(1), 15000);
  assert.equal(successorTimeoutMs(2), 30000);
});
