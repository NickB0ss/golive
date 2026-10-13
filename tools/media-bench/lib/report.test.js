'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, exitCodeFor, reportFileName, EXIT, LIMITATIONS, SCHEMA } = require('./report');

const ok = { key: 'a', status: 'ok' };
const bad = { key: 'b', status: 'error' };

test('status: ok, partial, error por fatal ou cenario faltando, timeout', () => {
  assert.equal(buildReport({ scenarios: [ok], planned: 1 }).status, 'ok');
  assert.equal(buildReport({ scenarios: [ok, bad], planned: 2 }).status, 'partial');
  assert.equal(buildReport({ scenarios: [ok], planned: 2 }).status, 'error');
  assert.equal(buildReport({ scenarios: [ok], planned: 1, fatal: 'x' }).status, 'error');
  assert.equal(buildReport({ scenarios: [], planned: 3, timedOut: true }).status, 'timeout');
});

test('codigos de saida: so ok e zero', () => {
  assert.equal(exitCodeFor({ status: 'ok' }), EXIT.OK);
  assert.equal(exitCodeFor({ status: 'partial' }), EXIT.FAILED);
  assert.equal(exitCodeFor({ status: 'error' }), EXIT.FAILED);
  assert.equal(exitCodeFor({ status: 'timeout' }), EXIT.TIMEOUT);
  assert.equal(exitCodeFor(null), EXIT.FAILED);
});

test('o relatorio carrega esquema, limites e declara loopback sem STUN', () => {
  const r = buildReport({ scenarios: [ok], planned: 1 });
  assert.equal(r.schema, SCHEMA);
  assert.ok(r.limitations.length >= 5);
  assert.match(r.limitations.join(' '), /NAO e captura WGC real/);
  assert.match(r.limitations.join(' '), /sessoes de encoder de hardware/);
  assert.match(r.network, /nenhum STUN/);
  assert.equal(LIMITATIONS, r.limitations);
});

test('nome do arquivo: UTC, sem caracteres invalidos no Windows', () => {
  const n = reportFileName(new Date('2026-10-08T12:34:56.789Z'), 'meu teste/1');
  assert.equal(n, 'media-bench-2026-10-08T12-34-56-789Z-meu_teste_1.json');
  assert.ok(!/[:<>"|?*\\/]/.test(n));
});
