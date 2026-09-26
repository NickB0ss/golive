'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sons = require('./sons');
const { jsonBytes } = require('../mesa');

function gelar(v) {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) gelar(v[k]);
    Object.freeze(v);
  }
  return v;
}

/** O caminho do servidor: validate -> prepare -> reduce. */
function servidor(state, action, from, now) {
  const ctx = { from, isLeader: from === '1', now, peers: [], random: () => 0.5 };
  const ok = sons.validate(state, action, ctx);
  if (ok !== true) return { state, recusa: ok };
  const pronta = sons.prepare(state, action, ctx);
  return { state: sons.reduce(state, pronta, { from, isLeader: from === '1' }), pronta };
}

test('nasce vazio; de 8 a 12 sons, todos com nome', () => {
  assert.deepEqual(sons.init({}), { n: 0, last: null, recent: {} });
  assert.ok(sons.SOUNDS.length >= 8 && sons.SOUNDS.length <= 12);
  for (const s of sons.SOUNDS) assert.equal(typeof sons.SOUND_NAMES[s], 'string');
  assert.ok(Object.isFrozen(sons.SOUNDS) && Object.isFrozen(sons.SOUND_NAMES));
  assert.equal(sons.summary(sons.init({})), 'Nenhum som ainda');
});

test('prepare poe a hora e quem tocou do servidor (e ignora as do cliente)', () => {
  const s0 = sons.init({});
  const r = servidor(s0, { kind: 'play', sound: 'buzina', at: 1, by: '9' }, '2', 50_000);
  assert.deepEqual(r.pronta, { kind: 'play', sound: 'buzina', at: 50_000, by: '2' });
  assert.deepEqual(r.state, { n: 1, last: { n: 1, sound: 'buzina', at: 50_000, by: '2' }, recent: { 2: 50_000 } });
  assert.equal(sons.summary(r.state), 'Último som: Buzina');
});

test('um som por pessoa a cada 3 s, pela hora do servidor', () => {
  let r = servidor(gelar(sons.init({})), { kind: 'play', sound: 'sino' }, '1', 10_000);
  const s1 = gelar(r.state);
  // A mesma pessoa, 1 s depois: recusa com quanto falta.
  r = servidor(s1, { kind: 'play', sound: 'apito' }, '1', 11_000);
  assert.equal(r.recusa, 'Espere 2 s para tocar outro som');
  assert.equal(r.state, s1);
  r = servidor(s1, { kind: 'play', sound: 'apito' }, '1', 12_999);
  assert.equal(r.recusa, 'Espere 1 s para tocar outro som');
  // Outra pessoa pode na hora.
  r = servidor(s1, { kind: 'play', sound: 'palmas' }, '2', 10_001);
  assert.equal(r.recusa, undefined);
  const s2 = gelar(r.state);
  assert.deepEqual(s2.recent, { 1: 10_000, 2: 10_001 });
  // 3 s depois, a primeira pode de novo.
  r = servidor(s2, { kind: 'play', sound: 'apito' }, '1', 13_000);
  assert.equal(r.recusa, undefined);
  assert.equal(r.state.n, 3);
  assert.equal(sons.cooldownLeft(r.state, '1', 14_000), 2000);
  assert.equal(sons.cooldownLeft(r.state, '1', 16_000), 0);
  assert.equal(sons.cooldownLeft(r.state, '7', 14_000), 0);
});

test('hora do ultimo som no futuro (outro servidor depois da migracao) nao prende', () => {
  const s = sons.reduce(sons.init({}), { kind: 'play', sound: 'sino', at: 90_000, by: '1' }, {});
  assert.equal(sons.cooldownLeft(s, '1', 10_000), 0);
  assert.equal(sons.validate(s, { kind: 'play', sound: 'sino' }, { from: '1', now: 10_000 }), true);
  // Sem hora (cliente sem relogio medido): so a forma conta.
  assert.equal(sons.validate(s, { kind: 'play', sound: 'sino' }, { from: '1' }), true);
});

test('recent so guarda quem tocou nos ultimos 3 s: o estado nao cresce', () => {
  let s = sons.init({});
  for (let i = 0; i < 200; i++) {
    s = sons.reduce(s, { kind: 'play', sound: 'boing', at: 1000 + i * 100, by: String(i) }, {});
  }
  // Em 3 s cabem 30 sons (um a cada 100 ms).
  assert.equal(Object.keys(s.recent).length, 30);
  assert.ok(jsonBytes(s) <= sons.maxStateBytes, `${jsonBytes(s)} bytes`);
  // Pior caso: todos na mesma hora, ids de 16 -- o teto de 32 segura.
  let p = sons.init({});
  for (let i = 0; i < 100; i++) p = sons.reduce(p, { kind: 'play', sound: 'badumtss', at: 1e12 + i, by: String(1e15 + i) }, {});
  assert.equal(Object.keys(p.recent).length, sons.MAX_RECENT);
  assert.ok(Object.hasOwn(p.recent, String(1e15 + 99)), 'o ultimo fica');
  assert.ok(jsonBytes(p) <= sons.maxStateBytes, `${jsonBytes(p)} bytes`);
});

test('forma da acao: som, hora e pessoa', () => {
  const s = sons.init({});
  for (const ruim of [
    null, 5, [], {}, { kind: 'stop' }, { kind: 'play' }, { kind: 'play', sound: 'peido' }, { kind: 'play', sound: 'toString' },
    { kind: 'play', sound: 'sino', at: -1 }, { kind: 'play', sound: 'sino', at: 'agora' }, { kind: 'play', sound: 'sino', at: Infinity },
    { kind: 'play', sound: 'sino', by: '' }, { kind: 'play', sound: 'sino', by: 'x'.repeat(17) }, { kind: 'play', sound: 'sino', by: '__proto__ ' },
  ]) {
    assert.equal(typeof sons.validate(s, ruim, { from: '1', now: 1 }), 'string', JSON.stringify(ruim));
    assert.equal(sons.reduce(s, ruim, { from: '1' }), s);
  }
  // Sem hora (nao passou pelo prepare) o reduce nao toca nada.
  assert.equal(sons.reduce(s, { kind: 'play', sound: 'sino' }, { from: '1' }), s);
  assert.equal(sons.prepare(s, { kind: 'x' }, { from: '1', now: 1 }).kind, 'x');
});

test('deterministico: a mesma sequencia da o mesmo estado (e o mesmo JSON)', () => {
  const seq = [['1', 'sino', 1000], ['2', 'apito', 1200], ['3', 'errou', 1300], ['1', 'buzina', 4100], ['2', 'palmas', 5000]];
  const rodar = () => seq.reduce((s, [by, sound, at]) => sons.reduce(s, { kind: 'play', sound, at, by }, {}), sons.init({}));
  assert.equal(JSON.stringify(rodar()), JSON.stringify(rodar()));
  assert.deepEqual(rodar().recent, { 1: 4100, 2: 5000 });
  assert.deepEqual(rodar().last, { n: 5, sound: 'palmas', at: 5000, by: '2' });
});

test('esta no registro, no grupo noite', () => {
  const reg = require('./index');
  assert.ok(reg.MODULE_NAMES.includes('sons'));
  assert.equal(reg.get('sons').group, 'noite');
  assert.equal(reg.get('sons').title, 'Sons');
  assert.equal(sons.soundName('badumtss'), 'Ba dum tss');
  assert.equal(sons.soundName('constructor'), 'Som');
});
