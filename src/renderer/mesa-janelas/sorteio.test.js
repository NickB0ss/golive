'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../mesa-modules/sorteio');
require('./comum');
const janela = require('./sorteio');

const PEERS = [{ id: '1', name: 'Ana' }, { id: '2', name: 'Bia' }];

test('registra o conteudo do sorteio', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.sorteio, janela);
});

test('chaves: pessoa pelo id, nome digitado pelo texto e a ocorrencia', () => {
  const entries = [
    { name: 'Ana', peerId: '1' },
    { name: 'Zé', peerId: null },
    { name: 'Zé', peerId: null },
    { name: 'Ana', peerId: null },
  ];
  assert.deepEqual(janela.chaves(entries), ['p:1#0', 'n:Zé#0', 'n:Zé#1', 'n:Ana#0']);
  // Tirar o primeiro Zé nao muda a chave de quem veio antes.
  assert.deepEqual(janela.chaves([entries[0], entries[2]]), ['p:1#0', 'n:Zé#0']);
});

test('rotuloSortear e textoTimes', () => {
  let s = m.init({ peers: PEERS });
  assert.equal(janela.rotuloSortear(s), 'Sortear');
  assert.equal(janela.textoTimes(s), '');
  s = m.reduce(s, { kind: 'add', name: 'Caio' });
  s = m.reduce(s, { kind: 'add', name: 'Duda' });
  s = m.reduce(s, { kind: 'draw', order: [0, 1, 2, 3] });
  assert.equal(janela.rotuloSortear(s), 'Sortear de novo');
  assert.equal(janela.textoTimes(s), 'Time 1: Ana e Caio. Time 2: Bia e Duda.');
});

test('opcoesTimes cobre de MIN a MAX e todas passam no validate', () => {
  const o = janela.opcoesTimes(m);
  assert.equal(o[0].valor, m.MIN_TEAMS);
  assert.equal(o[o.length - 1].valor, m.MAX_TEAMS);
  for (const x of o) assert.equal(m.validate(m.init({}), { kind: 'teams', count: x.valor }), true);
});
