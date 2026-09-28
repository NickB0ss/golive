'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cron = require('./cronometro');

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

const ctxCliente = {
  from: '1', isLeader: false, peers: [],
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

/** Faz o papel do servidor: valida, prepara com a hora dada e reduz. */
function servidor(state, action, now) {
  const ctx = { from: '1', isLeader: false, peers: [], now, random: () => 0.5 };
  assert.equal(cron.validate(state, action, ctx), true, JSON.stringify(action));
  const pronta = cron.prepare(state, action, ctx);
  return { pronta, state: cron.reduce(deepFreeze(state), pronta, ctxCliente) };
}

function roda(state, passos) {
  const prontas = [];
  for (const [action, now] of passos) {
    const r = servidor(state, action, now);
    prontas.push(r.pronta);
    state = r.state;
  }
  return { state, prontas };
}

const MALFORMADAS = [
  null, undefined, 1, 'start', [], {}, { kind: 7 }, { kind: 'hasOwnProperty' }, { kind: '__proto__' },
  { kind: 'set' }, { kind: 'set', mode: 'lado' }, { kind: 'set', mode: 'down' },
  { kind: 'set', mode: 'down', duration: 999 }, { kind: 'set', mode: 'down', duration: cron.MAX_MS + 1 },
  { kind: 'set', mode: 'down', duration: 1500.5 }, { kind: 'set', mode: 'down', duration: '60000' },
  { kind: 'set', mode: 'up', duration: Infinity }, { kind: 'adjust' }, { kind: 'adjust', delta: 0 },
  { kind: 'adjust', delta: NaN }, { kind: 'adjust', delta: cron.MAX_MS + 1 }, { kind: 'adjust', delta: '60000' },
  { kind: 'label' }, { kind: 'label', text: 5 }, { kind: 'label', text: 'x'.repeat(41) },
];

test('init: regressivo de 5 min, parado', () => {
  const s = cron.init({ now: 123 });
  assert.deepEqual(s, {
    mode: 'down', duration: 300000, elapsed: 0, running: false, startedAt: null, label: '',
  });
  assert.equal(cron.remaining(s, 999999), 300000);
  assert.equal(cron.summary(s), '05:00 (parado)');
});

test('metadados seguem o contrato', () => {
  assert.equal(cron.type, 'cronometro');
  assert.equal(cron.title, 'Cronômetro');
  assert.equal(cron.group, 'noite');
  assert.equal(typeof cron.prepare, 'function');
});

test('prepare carimba a hora do servidor e ignora a do cliente', () => {
  const s = cron.init({});
  const ctx = { now: 5000, random: () => 0 };
  assert.deepEqual(cron.prepare(s, { kind: 'start', at: 1, lixo: true }, ctx), { kind: 'start', at: 5000 });
  assert.deepEqual(cron.prepare(s, { kind: 'adjust', delta: 60000, at: 1 }, ctx), { kind: 'adjust', delta: 60000, at: 5000 });
  assert.deepEqual(cron.prepare(s, { kind: 'start', at: 1 }, {}), { kind: 'start' });
  assert.deepEqual(cron.prepare(s, { kind: 'reset', at: 1 }, ctx), { kind: 'reset' });
  // Malformada passa intacta: quem recusa e o validate.
  const ruim = { kind: 'nada' };
  assert.equal(cron.prepare(s, ruim, ctx), ruim);
  assert.equal(cron.prepare(s, null, ctx), null);
});

test('regressivo: cada cliente calcula o que falta pelo relogio da sala', () => {
  const { state } = roda(cron.init({}), [[{ kind: 'start' }, 10000]]);
  assert.equal(state.running, true);
  assert.equal(state.startedAt, 10000);
  assert.equal(cron.remaining(state, 10000), 300000);
  assert.equal(cron.remaining(state, 70000), 240000);
  assert.equal(cron.summary(state, 70000), '04:00');
  assert.equal(cron.summary(state), 'regressivo correndo');
  // Relogio do cliente um pouco atras do servidor nao da tempo a mais.
  assert.equal(cron.remaining(state, 9000), 300000);
  // Passou do fim: zero, nunca negativo.
  assert.equal(cron.remaining(state, 10000 + 400000), 0);
  assert.equal(cron.isFinished(state, 10000 + 400000), true);
  assert.equal(cron.summary(state, 10000 + 400000), 'tempo esgotado');
});

test('pausar acumula o corrido; retomar continua de onde parou', () => {
  const { state } = roda(cron.init({}), [
    [{ kind: 'start' }, 1000],
    [{ kind: 'pause' }, 31000],
  ]);
  assert.equal(state.elapsed, 30000);
  assert.equal(state.running, false);
  assert.equal(cron.remaining(state, 999999), 270000);
  assert.equal(cron.summary(state), '04:30 (pausado)');
  const r = roda(state, [[{ kind: 'start' }, 100000]]).state;
  assert.equal(cron.remaining(r, 110000), 260000);
});

test('pausar depois do fim guarda a duracao; iniciar de novo recomeca', () => {
  let { state } = roda(cron.init({}), [
    [{ kind: 'set', mode: 'down', duration: 10000 }, 0],
    [{ kind: 'start' }, 0],
    [{ kind: 'pause' }, 50000],
  ]);
  assert.equal(state.elapsed, 10000);
  state = roda(state, [[{ kind: 'start' }, 60000]]).state;
  assert.equal(state.elapsed, 0);
  assert.equal(cron.remaining(state, 61000), 9000);
});

test('iniciar correndo e pausar parado sao recusados', () => {
  const s = cron.init({});
  assert.equal(cron.validate(s, { kind: 'pause' }), 'Já está parado');
  const c = roda(s, [[{ kind: 'start' }, 0]]).state;
  assert.equal(cron.validate(c, { kind: 'start' }), 'Já está correndo');
  assert.equal(cron.validate(c, { kind: 'set', mode: 'up' }), 'Pause antes de mudar');
  assert.equal(cron.reduce(deepFreeze(c), { kind: 'start', at: 5 }), c);
  assert.equal(cron.reduce(deepFreeze(c), { kind: 'set', mode: 'up' }), c);
});

test('acao que precisava de hora e chegou sem ela nao muda nada', () => {
  const s = deepFreeze(cron.init({}));
  assert.equal(cron.reduce(s, { kind: 'start' }, ctxCliente), s);
  assert.equal(cron.reduce(s, { kind: 'start', at: -1 }, ctxCliente), s);
  assert.equal(cron.reduce(s, { kind: 'start', at: NaN }, ctxCliente), s);
});

test('zerar para e volta ao comeco', () => {
  const { state } = roda(cron.init({}), [[{ kind: 'start' }, 0], [{ kind: 'reset' }, 5000]]);
  assert.equal(state.running, false);
  assert.equal(state.elapsed, 0);
  assert.equal(state.startedAt, null);
});

test('ajustar no regressivo mexe na duracao, com piso e teto', () => {
  let { state } = roda(cron.init({}), [[{ kind: 'start' }, 0], [{ kind: 'adjust', delta: 60000 }, 30000]]);
  assert.equal(state.duration, 360000);
  assert.equal(cron.remaining(state, 60000), 300000);
  state = roda(state, [[{ kind: 'adjust', delta: -cron.MAX_MS }, 60000]]).state;
  assert.equal(state.duration, cron.MIN_DURATION);
  state = roda(state, [[{ kind: 'adjust', delta: cron.MAX_MS }, 60000]]).state;
  assert.equal(state.duration, cron.MAX_MS);
});

test('progressivo: conta para cima; ajuste correndo vale sobre o total', () => {
  let { state } = roda(cron.init({}), [
    [{ kind: 'set', mode: 'up' }, 0],
    [{ kind: 'start' }, 1000],
  ]);
  assert.equal(cron.remaining(state, 5000), null);
  assert.equal(cron.displayMs(state, 5000), 4000);
  assert.equal(cron.summary(state, 61000), '01:00');
  state = roda(state, [[{ kind: 'adjust', delta: -10000 }, 21000]]).state; // corrido 20 s -> 10 s
  assert.equal(state.startedAt, 21000);
  assert.equal(cron.elapsedAt(state, 21000), 10000);
  assert.equal(cron.elapsedAt(state, 31000), 20000);
  state = roda(state, [[{ kind: 'adjust', delta: -cron.MAX_MS }, 31000]]).state;
  assert.equal(cron.elapsedAt(state, 31000), 0);
  state = roda(state, [[{ kind: 'pause' }, 32000], [{ kind: 'adjust', delta: 5000 }, 40000]]).state;
  assert.equal(state.elapsed, 6000);
  assert.equal(cron.isFinished(state, 1e12), false);
});

test('set troca o modo e a duracao e zera o corrido', () => {
  const { state } = roda(cron.init({}), [
    [{ kind: 'start' }, 0], [{ kind: 'pause' }, 5000],
    [{ kind: 'set', mode: 'down', duration: 90000 }, 6000],
  ]);
  assert.equal(state.duration, 90000);
  assert.equal(state.elapsed, 0);
  assert.equal(roda(state, [[{ kind: 'set', mode: 'up' }, 7000]]).state.duration, 90000);
});

test('rotulo aparece no resumo e tem teto', () => {
  const { state } = roda(cron.init({}), [[{ kind: 'label', text: ' Pausa\tdo lanche ' }, 0]]);
  assert.equal(state.label, 'Pausa do lanche');
  assert.equal(cron.summary(state), 'Pausa do lanche · 05:00 (parado)');
  assert.equal(cron.validate(state, { kind: 'label', text: 'x'.repeat(cron.MAX_LABEL) }), true);
});

test('formatMs: regressivo arredonda para cima, horas quando precisa', () => {
  assert.equal(cron.formatMs(1, true), '00:01');
  assert.equal(cron.formatMs(1999, false), '00:01');
  assert.equal(cron.formatMs(0, true), '00:00');
  assert.equal(cron.formatMs(3723000, false), '1:02:03');
});

test('acao malformada e recusada com motivo e nunca lanca', () => {
  const s = deepFreeze(cron.init({}));
  const ctx = { now: 1, random: () => 0 };
  for (const a of MALFORMADAS) {
    const r = cron.validate(s, a, ctx);
    assert.equal(typeof r, 'string', JSON.stringify(a));
    assert.equal(cron.reduce(s, a, ctxCliente), s, JSON.stringify(a));
    cron.prepare(s, a, ctx);
  }
});

test('mesma sequencia de acoes preparadas da o mesmo estado, sem relogio nem sorte', () => {
  const { prontas } = roda(cron.init({}), [
    [{ kind: 'start' }, 100], [{ kind: 'adjust', delta: 30000 }, 200], [{ kind: 'pause' }, 5100],
    [{ kind: 'label', text: 'Rodada' }, 5200], [{ kind: 'start' }, 9000],
  ]);
  const aplica = () => prontas.reduce((s, a) => cron.reduce(deepFreeze(s), a, ctxCliente), cron.init({}));
  const a = semRelogioNemSorte(aplica);
  const b = semRelogioNemSorte(aplica);
  assert.deepEqual(a, b);
  assert.equal(a.elapsed, 5000);
  assert.equal(a.startedAt, 9000);
});

test('estado no pior caso cabe em maxStateBytes', () => {
  const s = {
    mode: 'down', duration: cron.MAX_MS, elapsed: cron.MAX_MS, running: true,
    startedAt: 9999999999999.5, label: '€'.repeat(cron.MAX_LABEL),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(s)) <= cron.maxStateBytes);
});
