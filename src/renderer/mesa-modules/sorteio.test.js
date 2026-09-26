'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sorteio = require('./sorteio');

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

const ctxCliente = {
  from: '1', isLeader: false,
  get peers() { throw new Error('reduce leu a sala'); },
  get now() { throw new Error('reduce leu o relogio'); },
  get random() { throw new Error('reduce leu a sorte'); },
};

function semRelogioNemSorte(fn) {
  const { now } = Date;
  const { random } = Math;
  Date.now = () => { throw new Error('reduce leu Date.now'); };
  Math.random = () => { throw new Error('reduce leu Math.random'); };
  try { return fn(); } finally { Date.now = now; Math.random = random; }
}

/** Sorte com semente (mulberry32), para o teste ser repetivel. */
function semente(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SALA = [{ id: '1', name: 'Ana' }, { id: '2', name: 'Bia' }, { id: '3', name: 'Caio' }];

function servidor(state, action, extra = {}) {
  const ctx = { from: '1', isLeader: false, peers: SALA, now: 0, random: semente(7), ...extra };
  const ok = sorteio.validate(state, action, ctx);
  assert.equal(ok, true, `${JSON.stringify(action)}: ${ok}`);
  const pronta = sorteio.prepare(state, action, ctx);
  return { pronta, state: sorteio.reduce(deepFreeze(state), pronta, ctxCliente) };
}

function roda(state, actions, extra) {
  const prontas = [];
  for (const a of actions) {
    const r = servidor(state, a, extra);
    prontas.push(r.pronta);
    state = r.state;
  }
  return { state, prontas };
}

const MALFORMADAS = [
  null, undefined, 3, 'draw', [], {}, { kind: 1 }, { kind: 'valueOf' }, { kind: '__proto__' },
  { kind: 'add' }, { kind: 'add', name: 9 }, { kind: 'add', name: ' \n ' },
  { kind: 'add', name: 'x'.repeat(41) }, { kind: 'add', name: 'x'.repeat(100000) },
  { kind: 'remove' }, { kind: 'remove', index: -1 }, { kind: 'remove', index: 99 },
  { kind: 'remove', index: 0.5 }, { kind: 'remove', index: '0' }, { kind: 'remove', index: 5 },
  { kind: 'teams', count: 1 }, { kind: 'teams', count: 9 }, { kind: 'teams', count: NaN },
  { kind: 'draw', order: 'abc' }, { kind: 'draw', order: [0, 0, 1] }, { kind: 'draw', order: [0, 1] },
  { kind: 'draw', order: [0, 1, 7] }, { kind: 'draw', order: [0, 1, 2.5] },
  { kind: 'draw', order: new Array(1000).fill(0) },
  { kind: 'addPeers', peers: 'todos' },
];

test('init traz as pessoas da sala com o id de cada uma', () => {
  const s = sorteio.init({ peers: SALA, by: '1', now: 0, random: () => 0 });
  assert.deepEqual(s, {
    entries: [
      { name: 'Ana', peerId: '1' }, { name: 'Bia', peerId: '2' }, { name: 'Caio', peerId: '3' },
    ],
    teamCount: 2, teams: null, round: 0,
  });
  assert.equal(sorteio.summary(s), '3 nomes, 2 times');
  assert.deepEqual(sorteio.init({}).entries, []);
});

test('init pula pessoa malformada e repetida', () => {
  const s = sorteio.init({
    peers: [null, { id: 1, name: 'x' }, { id: '4', name: '' }, { id: '5', name: 'Eva' }, { id: '5', name: 'Eva' }],
  });
  assert.deepEqual(s.entries, [{ name: 'Eva', peerId: '5' }]);
});

test('metadados seguem o contrato', () => {
  assert.equal(sorteio.type, 'sorteio');
  assert.equal(sorteio.title, 'Sorteio de times');
  assert.equal(sorteio.group, 'noite');
});

test('nome digitado entra sem peerId; remover tira pelo indice', () => {
  const { state } = roda(sorteio.init({ peers: SALA }), [
    { kind: 'add', name: '  Duda ' },
    { kind: 'remove', index: 0 },
  ]);
  assert.deepEqual(state.entries.map((e) => [e.name, e.peerId]), [
    ['Bia', '2'], ['Caio', '3'], ['Duda', null],
  ]);
});

test('addPeers: prepare poe a sala na acao e so quem falta entra', () => {
  let s = sorteio.init({ peers: SALA.slice(0, 1) });
  const pronta = sorteio.prepare(s, { kind: 'addPeers', peers: [{ id: '9', name: 'Intruso' }] }, { peers: SALA });
  assert.deepEqual(pronta, { kind: 'addPeers', peers: SALA });
  s = sorteio.reduce(deepFreeze(s), pronta, ctxCliente);
  assert.deepEqual(s.entries.map((e) => e.peerId), ['1', '2', '3']);
  assert.equal(sorteio.validate(s, { kind: 'addPeers' }, { peers: SALA }), 'Todo mundo da sala já está na lista');
  // Sem a lista preparada, reduce nao inventa ninguem.
  assert.equal(sorteio.reduce(deepFreeze(s), { kind: 'addPeers' }, ctxCliente), s);
});

test('sorteio: prepare grava a permutacao e reduce reparte em rodizio', () => {
  const base = roda(sorteio.init({ peers: SALA }), [{ kind: 'add', name: 'Duda' }]).state;
  const s = { ...base };
  const pronta = sorteio.prepare(s, { kind: 'draw', order: [0, 1, 2, 3] }, { random: semente(42) });
  assert.equal(pronta.order.length, 4);
  assert.deepEqual([...pronta.order].sort(), [0, 1, 2, 3]);
  const r = sorteio.reduce(deepFreeze(s), { kind: 'draw', order: [3, 1, 0, 2] }, ctxCliente);
  assert.deepEqual(r.teams, [
    [{ name: 'Duda', peerId: null }, { name: 'Ana', peerId: '1' }],
    [{ name: 'Bia', peerId: '2' }, { name: 'Caio', peerId: '3' }],
  ]);
  assert.equal(r.round, 1);
  assert.equal(sorteio.summary(r), 'Duda, Ana × Bia, Caio');
});

test('sortear de novo usa sorte nova e conta a rodada', () => {
  let s = roda(sorteio.init({ peers: SALA }), [{ kind: 'add', name: 'Duda' }, { kind: 'add', name: 'Eva' }]).state;
  const vistas = new Set();
  const rnd = semente(1);
  for (let i = 0; i < 20; i++) {
    s = roda(s, [{ kind: 'draw' }], { random: rnd }).state;
    vistas.add(JSON.stringify(s.teams));
  }
  assert.equal(s.round, 20);
  assert.ok(vistas.size > 1);
});

test('rodizio com 3 times e 7 nomes da times de 3, 2 e 2', () => {
  const nomes = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name) => ({ kind: 'add', name }));
  const { state } = roda(sorteio.init({}), [...nomes, { kind: 'teams', count: 3 }, { kind: 'draw' }]);
  assert.deepEqual(state.teams.map((t) => t.length), [3, 2, 2]);
});

test('sorte fora de [0, 1) nao gera indice fora do alcance', () => {
  const s = roda(sorteio.init({ peers: SALA }), []).state;
  for (const r of [() => 1, () => -3, () => NaN, () => Infinity, () => 'x']) {
    const pronta = sorteio.prepare(s, { kind: 'draw' }, { random: r });
    assert.deepEqual([...pronta.order].sort(), [0, 1, 2]);
  }
});

test('poucos nomes: recusa com motivo', () => {
  const s = sorteio.init({ peers: SALA.slice(0, 1) });
  assert.equal(sorteio.validate(s, { kind: 'draw' }), 'Ponha pelo menos 2 nomes');
  const t = { ...sorteio.init({ peers: SALA }), teamCount: 4 };
  assert.equal(sorteio.validate(t, { kind: 'draw' }), 'Poucos nomes para 4 times');
  assert.equal(sorteio.reduce(deepFreeze(t), { kind: 'draw', order: [0, 1, 2] }), t);
});

test('permutacao que nao casa com a lista e ignorada', () => {
  const s = deepFreeze(sorteio.init({ peers: SALA }));
  assert.equal(sorteio.validate(s, { kind: 'draw', order: [0, 1] }), 'Sorteio inválido');
  assert.equal(sorteio.reduce(s, { kind: 'draw', order: [0, 1] }, ctxCliente), s);
  assert.equal(sorteio.reduce(s, { kind: 'draw', order: [2, 2, 1] }, ctxCliente), s);
  assert.equal(sorteio.reduce(s, { kind: 'draw' }, ctxCliente), s);
});

test('lista tem teto', () => {
  let s = sorteio.init({});
  for (let i = 0; i < sorteio.MAX_ENTRIES; i++) s = sorteio.reduce(s, { kind: 'add', name: `N${i}` });
  assert.equal(s.entries.length, sorteio.MAX_ENTRIES);
  assert.equal(sorteio.validate(s, { kind: 'add', name: 'X' }), `A lista está cheia (máx. ${sorteio.MAX_ENTRIES})`);
  assert.equal(sorteio.reduce(deepFreeze(s), { kind: 'add', name: 'X' }), s);
  const cheio = sorteio.reduce(deepFreeze(s), { kind: 'addPeers', peers: SALA });
  assert.equal(cheio, s);
});

test('limpar tira nomes e resultado', () => {
  const { state } = roda(sorteio.init({ peers: SALA }), [{ kind: 'draw' }, { kind: 'clear' }]);
  assert.deepEqual(state.entries, []);
  assert.equal(state.teams, null);
  assert.equal(sorteio.summary(state), '0 nomes, 2 times');
});

test('acao malformada e recusada com motivo e nunca lanca', () => {
  const s = deepFreeze(sorteio.init({ peers: SALA }));
  const ctx = { peers: SALA, now: 0, random: () => 0.3 };
  for (const a of MALFORMADAS) {
    const r = sorteio.validate(s, a, ctx);
    assert.equal(typeof r, 'string', JSON.stringify(a));
    assert.equal(sorteio.reduce(s, a, ctxCliente), s, JSON.stringify(a));
    sorteio.prepare(s, a, ctx);
  }
});

test('mesma sequencia preparada da o mesmo estado, sem relogio nem sorte', () => {
  const { prontas, state } = roda(sorteio.init({ peers: SALA }), [
    { kind: 'add', name: 'Duda' }, { kind: 'draw' }, { kind: 'remove', index: 1 },
    { kind: 'add', name: 'Eva' }, { kind: 'draw' }, { kind: 'teams', count: 3 }, { kind: 'draw' },
  ]);
  const aplica = () => prontas.reduce((s, a) => sorteio.reduce(deepFreeze(s), a, ctxCliente), sorteio.init({ peers: SALA }));
  const a = semRelogioNemSorte(aplica);
  const b = semRelogioNemSorte(aplica);
  assert.deepEqual(a, b);
  assert.deepEqual(a, state);
});

test('estado no pior caso cabe em maxStateBytes', () => {
  const e = { name: '€'.repeat(sorteio.MAX_NAME), peerId: '9'.repeat(sorteio.MAX_PEER_ID) };
  const entries = Array.from({ length: sorteio.MAX_ENTRIES }, () => e);
  const s = { entries, teamCount: sorteio.MAX_TEAMS, teams: [entries], round: 1e9 };
  assert.ok(Buffer.byteLength(JSON.stringify(s)) <= sorteio.maxStateBytes);
});
