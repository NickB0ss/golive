'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeTree, allDirect, sameAssignments,
  FANOUT_ORIGEM, FANOUT_RELAY, PROFUNDIDADE_MAX,
} = require('./tree');

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

// ---------- Revisao final F2 ----------

test('relayIneligible tira o no da eleicao de relay sem tira-lo da arvore (#2)', () => {
  const candidates = [
    // Melhor RTT da sala, mas acabou de falhar como relay: nao pode ser
    // reeleito na hora, senao a arvore fica batendo entre dois estados.
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: false, suspended: false, relayIneligible: true },
    { id: 'c', joinedAt: 2, rtt: 40, transmitting: false, suspended: false },
    { id: 'd', joinedAt: 3, rtt: 50, transmitting: false, suspended: false },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('c').role, 'relay');
  assert.notEqual(out.get('b').role, 'relay');
  // Continua na arvore -- so nao como relay.
  assert.ok(out.has('b'));
});

test('todos vetados como relay caem pra direct (malha)', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: false, suspended: false, relayIneligible: true },
    { id: 'c', joinedAt: 2, rtt: 6, transmitting: false, suspended: false, relayIneligible: true },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('b').role, 'direct');
  assert.equal(out.get('c').role, 'direct');
  assert.equal(out.get('b').paiId, 'a');
});

test('allDirect poe todo mundo direto na origem (dissolve a arvore, #5)', () => {
  const out = allDirect('a', [{ id: 'b' }, { id: 'c' }]);
  assert.equal(out.size, 2);
  for (const id of ['b', 'c']) {
    assert.equal(out.get(id).role, 'direct');
    assert.equal(out.get(id).paiId, 'a');
    assert.deepEqual(out.get(id).filhosIds, []);
  }
});

test('sameAssignments: topologia igual e igual, com filhos em qualquer ordem (#4)', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 10, transmitting: false, suspended: false },
    { id: 'c', joinedAt: 2, rtt: 20, transmitting: false, suspended: false },
    { id: 'd', joinedAt: 3, rtt: 30, transmitting: false, suspended: false },
  ];
  const a = computeTree('a', candidates);
  const b = computeTree('a', candidates);
  assert.equal(sameAssignments(a, b), true);

  // Mesma topologia, filhos invertidos -- a ORDEM nao e informacao.
  const reordered = new Map(b);
  reordered.set('b', { ...b.get('b'), filhosIds: [...b.get('b').filhosIds].reverse() });
  assert.equal(sameAssignments(a, reordered), true);
});

test('sameAssignments detecta mudanca de papel, de pai, de filhos e de tamanho', () => {
  const base = new Map([
    ['b', { role: 'relay', paiId: 'a', filhosIds: ['c', 'd'] }],
    ['c', { role: 'folha', paiId: 'b', filhosIds: [] }],
    ['d', { role: 'folha', paiId: 'b', filhosIds: [] }],
  ]);
  const roleChanged = new Map(base);
  roleChanged.set('c', { role: 'direct', paiId: 'a', filhosIds: [] });
  assert.equal(sameAssignments(base, roleChanged), false);

  const paiChanged = new Map(base);
  paiChanged.set('c', { role: 'folha', paiId: 'x', filhosIds: [] });
  assert.equal(sameAssignments(base, paiChanged), false);

  const filhosChanged = new Map(base);
  filhosChanged.set('b', { role: 'relay', paiId: 'a', filhosIds: ['c', 'e'] });
  assert.equal(sameAssignments(base, filhosChanged), false);

  const smaller = new Map(base);
  smaller.delete('d');
  assert.equal(sameAssignments(base, smaller), false);

  // Mapa vazio (estado inicial) nunca e igual a uma arvore de verdade --
  // e o que garante que o PRIMEIRO recalculo sempre se aplica.
  assert.equal(sameAssignments(base, new Map()), false);
});
