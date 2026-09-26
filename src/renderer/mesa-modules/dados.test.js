'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const dados = require('./dados');

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

/** Sorte que devolve os valores dados, em ciclo. */
function sequencia(...vals) {
  let i = 0;
  return () => vals[i++ % vals.length];
}

function servidor(state, action, from, random) {
  const ctx = { from, isLeader: false, peers: [], now: 0, random };
  const ok = dados.validate(state, action, ctx);
  assert.equal(ok, true, `${JSON.stringify(action)}: ${ok}`);
  const pronta = dados.prepare(state, action, ctx);
  return { pronta, state: dados.reduce(deepFreeze(state), pronta, ctxCliente) };
}

function roda(state, passos, random = sequencia(0.5)) {
  const prontas = [];
  for (const [action, from] of passos) {
    const r = servidor(state, action, from, random);
    prontas.push(r.pronta);
    state = r.state;
  }
  return { state, prontas };
}

const MALFORMADAS = [
  null, undefined, 6, 'roll', [], {}, { kind: 2 }, { kind: 'toString' }, { kind: '__proto__' },
  { kind: 'config' }, { kind: 'config', count: 0, sides: 6 }, { kind: 'config', count: 7, sides: 6 },
  { kind: 'config', count: 2, sides: 7 }, { kind: 'config', count: 2, sides: 100 },
  { kind: 'config', count: '2', sides: 6 }, { kind: 'config', count: 2, sides: '6' },
  { kind: 'roll', sides: 6 }, { kind: 'roll', sides: 6, values: [] }, { kind: 'roll', sides: 6, values: [7] },
  { kind: 'roll', sides: 6, values: [0] }, { kind: 'roll', sides: 6, values: [1.5] },
  { kind: 'roll', sides: 6, values: ['3'] }, { kind: 'roll', sides: 6, values: [1, 1, 1, 1, 1, 1, 1] },
  { kind: 'roll', sides: 5, values: [1] }, { kind: 'roll', values: [1] }, { kind: 'roll', sides: 6, values: 'x' },
  { kind: 'coin', value: 'lado' }, { kind: 'coin', value: 1 },
];

test('init: 2d6 e historico vazio', () => {
  const s = dados.init({ now: 1, random: () => 0 });
  assert.deepEqual(s, { count: 2, sides: 6, history: [], rolls: 0 });
  assert.equal(dados.summary(s), 'Nenhuma rolagem ainda');
});

test('metadados seguem o contrato', () => {
  assert.equal(dados.type, 'dados');
  assert.equal(dados.title, 'Dados e moeda');
  assert.equal(dados.group, 'noite');
});

test('prepare sorteia com a sorte do servidor e ignora o resultado do cliente', () => {
  const s = dados.init({});
  const pronta = dados.prepare(s, { kind: 'roll', sides: 6, values: [6, 6], by: '7' }, {
    from: '3', random: sequencia(0, 0.999),
  });
  assert.deepEqual(pronta, { kind: 'roll', by: '3', sides: 6, values: [1, 6] });
  assert.deepEqual(
    dados.prepare(s, { kind: 'coin', value: 'cara' }, { from: '3', random: sequencia(0.7) }),
    { kind: 'coin', by: '3', value: 'coroa' },
  );
  // Sem sorte (fora do servidor) a acao sai sem resultado, e reduce nao faz nada.
  const semSorte = dados.prepare(s, { kind: 'roll', sides: 6, values: [6, 6] }, { from: '3' });
  assert.deepEqual(semSorte, { kind: 'roll', by: '3' });
  assert.equal(dados.reduce(deepFreeze(s), semSorte, ctxCliente), s);
});

test('rolar guarda no historico e o resumo mostra a soma', () => {
  const { state } = roda(dados.init({}), [[{ kind: 'roll' }, '1']], sequencia(0.4, 0.7));
  assert.deepEqual(state.history, [{ n: 1, kind: 'dice', by: '1', sides: 6, values: [3, 5] }]);
  assert.equal(dados.summary(state), '2d6: 3 + 5 = 8');
  assert.equal(dados.total(state.history[0]), 8);
});

test('configurar dados e lados; um dado so mostra o valor', () => {
  const { state } = roda(dados.init({}), [
    [{ kind: 'config', count: 1, sides: 20 }, '1'],
    [{ kind: 'roll' }, '2'],
  ], sequencia(0.8));
  assert.equal(dados.summary(state), '1d20: 17');
  for (const sides of dados.SIDES) {
    for (const count of [dados.MIN_DICE, dados.MAX_DICE]) {
      const s = roda(dados.init({}), [[{ kind: 'config', count, sides }, '1'], [{ kind: 'roll' }, '1']],
        sequencia(0, 0.99999)).state;
      const vals = s.history[0].values;
      assert.equal(vals.length, count);
      assert.ok(vals.every((v) => v >= 1 && v <= sides));
    }
  }
});

test('moeda: cara ou coroa', () => {
  const { state } = roda(dados.init({}), [[{ kind: 'coin' }, '1'], [{ kind: 'coin' }, '2']], sequencia(0.1, 0.9));
  assert.deepEqual(state.history.map((h) => h.value), ['cara', 'coroa']);
  assert.equal(dados.summary(state), 'Moeda: coroa');
});

test('sorte fora de [0, 1) nao da valor fora do dado', () => {
  const s = dados.init({});
  for (const r of [() => 1, () => -1, () => NaN, () => Infinity, () => 'x']) {
    const p = dados.prepare(s, { kind: 'roll' }, { from: '1', random: r });
    assert.ok(p.values.every((v) => v >= 1 && v <= 6), JSON.stringify(p));
    assert.ok(['cara', 'coroa'].includes(dados.prepare(s, { kind: 'coin' }, { random: r }).value));
  }
});

test('historico guarda so os ultimos 10 e conta todas as rolagens', () => {
  const passos = Array.from({ length: 15 }, () => [{ kind: 'roll' }, '1']);
  const { state } = roda(dados.init({}), passos);
  assert.equal(state.history.length, dados.MAX_HISTORY);
  assert.equal(state.rolls, 15);
  assert.deepEqual(state.history.map((h) => h.n), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  const limpo = roda(state, [[{ kind: 'clear' }, '1']]).state;
  assert.deepEqual([limpo.history, limpo.rolls], [[], 15]);
});

test('reduce usa o by da acao; sem ele, ctx.from; sem nenhum, null', () => {
  const s = deepFreeze(dados.init({}));
  const a = { kind: 'coin', value: 'cara' };
  assert.equal(dados.reduce(s, { ...a, by: '5' }, ctxCliente).history[0].by, '5');
  assert.equal(dados.reduce(s, a, ctxCliente).history[0].by, '99');
  assert.equal(dados.reduce(s, a).history[0].by, null);
});

test('acao malformada e recusada com motivo e nunca lanca', () => {
  const s = deepFreeze(dados.init({}));
  const ctx = { from: '1', now: 0, random: () => 0.5 };
  for (const a of MALFORMADAS) {
    const r = dados.validate(s, a, ctx);
    assert.equal(typeof r, 'string', JSON.stringify(a));
    assert.equal(dados.reduce(s, a, ctxCliente), s, JSON.stringify(a));
    dados.prepare(s, a, ctx);
  }
});

test('mesma sequencia preparada da o mesmo estado, sem relogio nem sorte', () => {
  const { prontas, state } = roda(dados.init({}), [
    [{ kind: 'roll' }, '1'], [{ kind: 'config', count: 3, sides: 8 }, '2'], [{ kind: 'roll' }, '2'],
    [{ kind: 'coin' }, '3'], [{ kind: 'roll' }, '1'],
  ], sequencia(0.12, 0.5, 0.93, 0.31));
  const aplica = () => prontas.reduce((s, a) => dados.reduce(deepFreeze(s), a, ctxCliente), dados.init({}));
  const a = semRelogioNemSorte(aplica);
  const b = semRelogioNemSorte(aplica);
  assert.deepEqual(a, b);
  assert.deepEqual(a, state);
});

test('estado no pior caso cabe em maxStateBytes', () => {
  const entry = {
    n: 1e12, kind: 'dice', by: '9'.repeat(dados.MAX_PEER_ID), sides: 20, values: new Array(dados.MAX_DICE).fill(20),
  };
  const s = { count: dados.MAX_DICE, sides: 20, history: new Array(dados.MAX_HISTORY).fill(entry), rolls: 1e12 };
  assert.ok(Buffer.byteLength(JSON.stringify(s)) <= dados.maxStateBytes);
});
