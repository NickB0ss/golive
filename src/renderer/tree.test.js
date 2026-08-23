'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeTree, FANOUT_ORIGEM, FANOUT_RELAY, PROFUNDIDADE_MAX } = require('./tree');

test('constantes batem com a spec de 2026-08-23 (F2)', () => {
  assert.equal(FANOUT_ORIGEM, 1);
  assert.equal(FANOUT_RELAY, 2);
  assert.equal(PROFUNDIDADE_MAX, 2);
});

test('sala de 4 (origem + 3): 1 relay, 2 folhas -- cenario de validacao da spec', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 40, transmitting: false, suspended: false },
    { id: 'c', joinedAt: 2, rtt: 10, transmitting: false, suspended: false },
    { id: 'd', joinedAt: 3, rtt: 90, transmitting: false, suspended: false },
  ];
  const out = computeTree('a', candidates);

  assert.equal(out.get('c').role, 'relay'); // menor RTT vence
  assert.deepEqual(out.get('c').paiId, 'a');
  assert.deepEqual(out.get('c').filhosIds.sort(), ['b', 'd']);

  assert.equal(out.get('b').role, 'folha');
  assert.equal(out.get('b').paiId, 'c');
  assert.equal(out.get('d').role, 'folha');
  assert.equal(out.get('d').paiId, 'c');
});

test('desempate por quem entrou ha mais tempo quando RTT e igual ou desconhecido', () => {
  const candidates = [
    { id: 'b', joinedAt: 5, rtt: null, transmitting: false, suspended: false },
    { id: 'c', joinedAt: 1, rtt: null, transmitting: false, suspended: false },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('c').role, 'relay'); // entrou primeiro
  assert.equal(out.get('b').role, 'folha');
});

test('quem esta transmitindo ou suspenso nao e candidato a relay', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: true, suspended: false },  // ja e origem de outra arvore
    { id: 'c', joinedAt: 2, rtt: 5, transmitting: false, suspended: true },  // minimizou (F1.3)
    { id: 'd', joinedAt: 3, rtt: 999, transmitting: false, suspended: false },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('d').role, 'relay'); // unico elegivel, mesmo com RTT ruim
  assert.equal(out.get('b').role, 'folha');
  assert.equal(out.get('c').role, 'folha');
});

test('sem nenhum candidato elegivel, todo mundo cai pra direct (malha)', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: true, suspended: false },
    { id: 'c', joinedAt: 2, rtt: 5, transmitting: true, suspended: false },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('b').role, 'direct');
  assert.equal(out.get('c').role, 'direct');
  assert.equal(out.get('b').paiId, 'a');
});

test('overflow alem da capacidade do relay (fanout 2) cai pra direct com a origem', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 10, transmitting: false, suspended: false }, // vira relay
    { id: 'c', joinedAt: 2, rtt: 20, transmitting: false, suspended: false },
    { id: 'd', joinedAt: 3, rtt: 30, transmitting: false, suspended: false },
    { id: 'e', joinedAt: 4, rtt: 40, transmitting: false, suspended: false }, // excedente
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('b').role, 'relay');
  assert.deepEqual(out.get('b').filhosIds.sort(), ['c', 'd']);
  assert.equal(out.get('e').role, 'direct');
  assert.equal(out.get('e').paiId, 'a');
});

test('lista de candidatos vazia devolve mapa vazio', () => {
  assert.equal(computeTree('a', []).size, 0);
});
