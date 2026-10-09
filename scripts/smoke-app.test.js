'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, interpretOutcome, EXIT } = require('./smoke-app');

test('parseArgs: padroes, --exe resolvido, erros para valor invalido', () => {
  const d = parseArgs([]);
  assert.deepEqual(d.errors, []);
  assert.equal(d.exe, null);
  assert.equal(parseArgs(['--exe=dist/x.exe']).exe, path.resolve('dist/x.exe'));
  assert.equal(parseArgs(['--timeout-ms=12000']).timeoutMs, 12000);
  assert.ok(parseArgs(['--timeout-ms=1']).errors.length);
  assert.ok(parseArgs(['--report=x.txt']).errors.length);
  assert.ok(parseArgs(['--eval=1']).errors.length);
  assert.ok(parseArgs(['--exe']).errors.length);
});

test('interpretOutcome: so passa com relatorio ok E saida 0', () => {
  assert.equal(interpretOutcome({ report: { ok: true }, exitCode: 0, hardTimedOut: false }).code, EXIT.OK);
  assert.equal(interpretOutcome({ report: { ok: true }, exitCode: 1, hardTimedOut: false }).code, EXIT.FAILED);
  assert.equal(interpretOutcome({ report: { ok: false }, exitCode: 1, hardTimedOut: false }).code, EXIT.FAILED);
  assert.equal(interpretOutcome({ report: { ok: false, timedOut: true }, exitCode: 2, hardTimedOut: false }).code, EXIT.TIMEOUT);
  assert.equal(interpretOutcome({ report: null, exitCode: 0, hardTimedOut: false }).code, EXIT.FAILED, 'sem relatorio nunca passa');
  assert.equal(interpretOutcome({ report: null, exitCode: null, hardTimedOut: true }).code, EXIT.TIMEOUT);
  assert.equal(interpretOutcome({ report: 'lixo', exitCode: 0, hardTimedOut: false }).code, EXIT.FAILED);
});

test('--help sai 0; argumento invalido sai 3; exe inexistente sai 3 sem abrir nada', () => {
  const run = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'smoke-app.js'), ...a], { encoding: 'utf8', timeout: 20000 });
  assert.equal(run('--help').status, 0);
  assert.equal(run('--bogus').status, 3);
  assert.equal(run('--exe=C:/nao/existe/GoLive.exe').status, 3);
});
