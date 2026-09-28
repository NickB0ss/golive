'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const roleta = require('./roleta');

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

const ctxCliente = {
  from: '99', isLeader: false, peers: [],
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

function sequencia(...vals) {
  let i = 0;
  return () => vals[i++ % vals.length];
}

function servidor(state, action, from, random, now) {
  const ctx = { from, isLeader: false, peers: [], now, random };
  const ok = roleta.validate(state, action, ctx);
  assert.equal(ok, true, `${JSON.stringify(action)}: ${ok}`);
  const pronta = roleta.prepare(state, action, ctx);
  return { pronta, state: roleta.reduce(deepFreeze(state), pronta, ctxCliente) };
}

function roda(state, actions, random = sequencia(0.5), now = 1000) {
  const prontas = [];
  for (const a of actions) {
    const r = servidor(state, a, '1', random, now);
    prontas.push(r.pronta);
    state = r.state;
  }
  return { state, prontas };
}

const OPCOES = { kind: 'setOptions', options: ['Pizza', 'Sushi', 'Hambúrguer', 'Açaí'] };

const MALFORMADAS = [
  null, undefined, 1, 'spin', [], {}, { kind: 3 }, { kind: 'constructor' }, { kind: '__proto__' },
  { kind: 'add' }, { kind: 'add', text: 4 }, { kind: 'add', text: '   ' }, { kind: 'add', text: 'x'.repeat(33) },
  { kind: 'add', text: 'x'.repeat(1e6) }, { kind: 'edit', index: 0 }, { kind: 'edit', index: 9, text: 'a' },
  { kind: 'edit', index: -1, text: 'a' }, { kind: 'edit', index: '0', text: 'a' }, { kind: 'remove', index: 4 },
  { kind: 'remove', index: 1.5 }, { kind: 'remove' }, { kind: 'setOptions' }, { kind: 'setOptions', options: 'a,b' },
  { kind: 'setOptions', options: new Array(17).fill('a') }, { kind: 'setOptions', options: ['a', ''] },
  { kind: 'setOptions', options: ['a', null] },
  { kind: 'spin', index: 9, turns: 3, offset: 0.5 }, { kind: 'spin', index: 0, turns: 2, offset: 0.5 },
  { kind: 'spin', index: 0, turns: 6, offset: 0.5 }, { kind: 'spin', index: 0, turns: 3, offset: 1.5 },
  { kind: 'spin', index: 0, turns: 3, offset: NaN }, { kind: 'spin', index: 0, turns: 3 },
  { kind: 'spin', index: '0', turns: 3, offset: 0.5 }, { kind: 'spin', index: 4, turns: 3, offset: 0.5 },
];

test('init: sem opcoes e sem giro', () => {
  const s = roleta.init({ now: 1, random: () => 0 });
  assert.deepEqual(s, { options: [], spin: null, spins: 0, last: null });
  assert.equal(roleta.summary(s), '0 opções, ainda não girou');
});

test('metadados seguem o contrato', () => {
  assert.equal(roleta.type, 'roleta');
  assert.equal(roleta.title, 'Roleta');
  assert.equal(roleta.group, 'noite');
});

test('adicionar, editar, remover e trocar a lista limpam o texto', () => {
  const { state } = roda(roleta.init({}), [
    { kind: 'add', text: ' Pizza ' }, { kind: 'add', text: 'Sushi' }, { kind: 'add', text: 'Taco' },
    { kind: 'edit', index: 2, text: 'Açaí\n' }, { kind: 'remove', index: 0 },
  ]);
  assert.deepEqual(state.options, ['Sushi', 'Açaí']);
  const t = roda(state, [OPCOES]).state;
  assert.deepEqual(t.options, OPCOES.options);
  assert.equal(roleta.summary(t), '4 opções, ainda não girou');
});

test('girar: prepare decide fatia, voltas, ponto de parada, hora e autor', () => {
  const s = roda(roleta.init({}), [OPCOES]).state;
  const pronta = roleta.prepare(s, { kind: 'spin', index: 0, turns: 3, offset: 0.5, by: '7', at: 1 }, {
    from: '2', now: 5000, random: sequencia(0.6, 0.99, 0),
  });
  assert.deepEqual(pronta, { kind: 'spin', index: 2, turns: 5, offset: 0.15, at: 5000, by: '2' });
  const r = roleta.reduce(deepFreeze(s), pronta, ctxCliente);
  assert.deepEqual(r.spin, { n: 1, index: 2, turns: 5, offset: 0.15, at: 5000, by: '2' });
  assert.equal(r.last, 'Hambúrguer');
  assert.equal(roleta.summary(r), 'Roleta: Hambúrguer');
});

test('spinAngle poe o ponto sorteado sob o ponteiro', () => {
  // 4 fatias de 90 graus; fatia 1 no meio (offset 0,5) -> 135 graus do topo.
  const graus = roleta.spinAngle({ index: 1, turns: 3, offset: 0.5 }, 4);
  assert.equal(graus, 3 * 360 + 360 - 135);
  assert.equal((graus + 135) % 360, 0);
});

test('sorte fora de [0, 1) nao da fatia nem voltas fora do alcance', () => {
  const s = roda(roleta.init({}), [OPCOES]).state;
  for (const r of [() => 1, () => -1, () => NaN, () => Infinity, () => 'x']) {
    const p = roleta.prepare(s, { kind: 'spin' }, { random: r });
    assert.equal(roleta.validate(s, p), true, JSON.stringify(p));
    assert.notEqual(roleta.reduce(deepFreeze(s), p), s);
  }
});

test('precisa de 2 opcoes para girar; sem resultado preparado nada muda', () => {
  const um = roda(roleta.init({}), [{ kind: 'add', text: 'Só' }]).state;
  assert.equal(roleta.validate(um, { kind: 'spin' }), 'Ponha pelo menos 2 opções');
  assert.equal(roleta.reduce(deepFreeze(um), { kind: 'spin', index: 0, turns: 3, offset: 0.5 }), um);
  const s = deepFreeze(roda(roleta.init({}), [OPCOES]).state);
  assert.equal(roleta.reduce(s, { kind: 'spin' }, ctxCliente), s);
  // Fora do servidor (sem sorte) a acao sai sem resultado.
  assert.deepEqual(roleta.prepare(s, { kind: 'spin' }, { from: '1' }), { kind: 'spin', by: '1' });
});

test('mexer nas opcoes zera o giro mas guarda o ultimo resultado', () => {
  let { state } = roda(roleta.init({}), [OPCOES, { kind: 'spin' }], sequencia(0));
  assert.equal(state.last, 'Pizza');
  state = roda(state, [{ kind: 'remove', index: 0 }]).state;
  assert.equal(state.spin, null);
  assert.equal(state.last, 'Pizza');
  state = roda(state, [{ kind: 'spin' }], sequencia(0.99, 0, 0.5)).state;
  assert.equal(state.spin.n, 2);
  assert.equal(state.last, 'Açaí');
});

test('teto de opcoes', () => {
  const cheia = roda(roleta.init({}), [
    { kind: 'setOptions', options: Array.from({ length: roleta.MAX_OPTIONS }, (_, i) => `O${i}`) },
  ]).state;
  assert.equal(roleta.validate(cheia, { kind: 'add', text: 'X' }), `A roleta está cheia (máx. ${roleta.MAX_OPTIONS})`);
  assert.equal(roleta.reduce(deepFreeze(cheia), { kind: 'add', text: 'X' }), cheia);
  assert.equal(roleta.validate(cheia, { kind: 'add', text: 'x'.repeat(roleta.MAX_TEXT) }), `A roleta está cheia (máx. ${roleta.MAX_OPTIONS})`);
  assert.equal(roleta.validate(roleta.init({}), { kind: 'add', text: 'x'.repeat(roleta.MAX_TEXT) }), true);
});

test('acao malformada e recusada com motivo e nunca lanca', () => {
  const s = deepFreeze(roda(roleta.init({}), [OPCOES]).state);
  const ctx = { from: '1', now: 0, random: () => 0.5 };
  for (const a of MALFORMADAS) {
    const r = roleta.validate(s, a, ctx);
    assert.equal(typeof r, 'string', JSON.stringify(a));
    assert.equal(roleta.reduce(s, a, ctxCliente), s, JSON.stringify(a));
    roleta.prepare(s, a, ctx);
  }
});

test('mesma sequencia preparada da o mesmo estado, sem relogio nem sorte', () => {
  const { prontas, state } = roda(roleta.init({}), [
    OPCOES, { kind: 'spin' }, { kind: 'add', text: 'Taco' }, { kind: 'spin' }, { kind: 'spin' },
  ], sequencia(0.21, 0.77, 0.4, 0.05, 0.93));
  const aplica = () => prontas.reduce((s, a) => roleta.reduce(deepFreeze(s), a, ctxCliente), roleta.init({}));
  const a = semRelogioNemSorte(aplica);
  const b = semRelogioNemSorte(aplica);
  assert.deepEqual(a, b);
  assert.deepEqual(a, state);
});

test('estado no pior caso cabe em maxStateBytes', () => {
  const texto = '€'.repeat(roleta.MAX_TEXT);
  const s = {
    options: new Array(roleta.MAX_OPTIONS).fill(texto),
    spin: { n: 1e12, index: 15, turns: 5, offset: 0.123, at: 9999999999999.5, by: '9'.repeat(roleta.MAX_PEER_ID) },
    spins: 1e12,
    last: texto,
  };
  assert.ok(Buffer.byteLength(JSON.stringify(s)) <= roleta.maxStateBytes);
});
