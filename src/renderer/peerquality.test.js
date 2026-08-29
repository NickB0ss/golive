'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initialState, next, isBad, LIMITS } = require('./peerquality');

const OK = { atMs: 0, senderBandwidthLimited: false, receiveHealth: { lossPct: 0, freezeRate: 0, softwareDecoder: false } };
const BW = { ...OK, senderBandwidthLimited: true };
const SW = { ...OK, receiveHealth: { lossPct: 0, freezeRate: 0, softwareDecoder: true } };
const FREEZE = { ...OK, receiveHealth: { lossPct: 0.5, freezeRate: 30, softwareDecoder: false } };
const FREEZE_BY_LOSS = { ...OK, receiveHealth: { lossPct: 8, freezeRate: 30, softwareDecoder: false } };

// Aplica varias amostras, 1s entre elas.
function run(state, signals, startMs = 0) {
  let s = state;
  signals.forEach((sig, i) => { s = next(s, { ...sig, atMs: startMs + i * 1000 }); });
  return s;
}

test('isBad: link limitado por banda e ruim', () => {
  assert.equal(isBad(BW, {}), true);
});

test('isBad: decoder em software do espectador e ruim', () => {
  assert.equal(isBad(SW, {}), true);
});

test('isBad: travar MUITO com perda baixa e ruim (decode nao acompanha)', () => {
  assert.equal(isBad(FREEZE, {}), true);
});

test('isBad: travar com perda ALTA NAO e este caso -- o GCC ja trata banda', () => {
  assert.equal(isBad(FREEZE_BY_LOSS, {}), false);
});

test('isBad: receiveHealth ausente nao e ruim', () => {
  assert.equal(isBad({ ...OK, receiveHealth: null }, {}), false);
});

test('uma amostra ruim isolada nao degrada', () => {
  assert.equal(run(initialState(), [BW]).steps, 0);
});

test('amostras ruins seguidas o bastante descem um degrau e zeram a corrida', () => {
  const s = run(initialState(), Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(BW));
  assert.equal(s.steps, 1);
  assert.equal(s.badRun, 0);
});

test('uma amostra boa no meio zera a corrida de ruins', () => {
  const s = run(initialState(), [BW, BW, OK, BW, BW]);
  assert.equal(s.steps, 0);
});

test('a escada por peer tem teto', () => {
  const muitas = Array(LIMITS.BAD_SAMPLES_TO_DEGRADE * (LIMITS.MAX_PEER_STEPS + 3)).fill(SW);
  assert.equal(run(initialState(), muitas).steps, LIMITS.MAX_PEER_STEPS);
});

test('so sobe de volta depois da folga continua observada', () => {
  const degradado = run(initialState(), Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(BW));
  const t0 = LIMITS.BAD_SAMPLES_TO_DEGRADE * 1000;
  // primeira boa ancora o relogio
  const inicio = next(degradado, { ...OK, atMs: t0 });
  assert.equal(inicio.steps, 1);
  const cedo = next(inicio, { ...OK, atMs: t0 + LIMITS.GOOD_MS_TO_RECOVER - 1 });
  assert.equal(cedo.steps, 1);
  const naHora = next(cedo, { ...OK, atMs: t0 + LIMITS.GOOD_MS_TO_RECOVER + 1 });
  assert.equal(naHora.steps, 0);
});

test('uma ruim durante a espera cancela a recuperacao', () => {
  const degradado = run(initialState(), Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(BW));
  const t0 = LIMITS.BAD_SAMPLES_TO_DEGRADE * 1000;
  let s = next(degradado, { ...OK, atMs: t0 });
  s = next(s, { ...BW, atMs: t0 + 1000 });
  s = next(s, { ...OK, atMs: t0 + 2000 });
  s = next(s, { ...OK, atMs: t0 + 2000 + LIMITS.GOOD_MS_TO_RECOVER - 1 });
  assert.equal(s.steps, 1);
});

test('dois peers com estados separados nao se contaminam', () => {
  let a = initialState();
  let b = initialState();
  a = run(a, Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(BW));
  b = run(b, [OK, OK, OK]);
  assert.equal(a.steps, 1);
  assert.equal(b.steps, 0);
});

test('entrada indefinida nao lanca', () => {
  assert.equal(next(undefined, undefined).steps, 0);
});
