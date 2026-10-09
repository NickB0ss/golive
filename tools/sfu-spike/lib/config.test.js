'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgv, buildPlan, validateConfig, QUICK, DEFAULTS } = require('./config');

test('padrao: cenarios com 1 e 4 consumidores, h264, loopback', () => {
  const { options, errors } = parseArgv([]);
  assert.deepEqual(errors, []);
  const plan = buildPlan(options);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.scenarios.map((s) => s.config.consumers), [1, 4]);
  for (const s of plan.scenarios) {
    assert.equal(s.config.codec, 'h264');
    assert.equal(s.config.listenIp, '127.0.0.1');
    assert.equal(s.config.durationMs, DEFAULTS.durationMs);
  }
});

test('--quick encurta a janela e mantem 1 e 4 consumidores', () => {
  const plan = buildPlan(parseArgv(['--quick']).options);
  assert.deepEqual(plan.scenarios.map((s) => s.config.consumers), [1, 4]);
  assert.equal(plan.scenarios[0].config.durationMs, QUICK.durationMs);
  assert.equal(plan.scenarios[0].config.width, 640);
  assert.ok(plan.timeoutMs > 2 * (QUICK.durationMs + QUICK.warmupMs));
});

test('--consumers, --codec e duracoes sao validados', () => {
  assert.deepEqual(buildPlan(parseArgv(['--consumers=2,2,3']).options).scenarios.map((s) => s.config.consumers), [2, 3]);
  for (const bad of ['--consumers=0', '--consumers=9', '--consumers=a', '--consumers=', '--codec=av1', '--duration-ms=abc', '--bogus']) {
    const { options, errors } = parseArgv([bad]);
    const plan = buildPlan(options);
    assert.ok(errors.length + plan.errors.length > 0, `${bad} deveria falhar`);
  }
  assert.equal(parseArgv(['--codec=vp8']).options.codec, 'vp8');
  assert.ok(buildPlan(parseArgv(['--duration-ms=10']).options).errors.length > 0);
  assert.ok(buildPlan(parseArgv(['--timeout-ms=5']).options).errors.length > 0);
});

test('validateConfig exige listenIp 127.0.0.1', () => {
  const cfg = buildPlan(parseArgv(['--quick']).options).scenarios[0].config;
  assert.deepEqual(validateConfig(cfg), []);
  assert.ok(validateConfig({ ...cfg, listenIp: '0.0.0.0' }).length > 0);
  assert.ok(validateConfig({ ...cfg, listenIp: undefined }).length > 0);
  assert.ok(validateConfig(null).length > 0);
  assert.ok(validateConfig({ ...cfg, consumers: 99 }).length > 0);
});
