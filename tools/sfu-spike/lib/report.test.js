'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, exitCodeFor, statusOf, reportFileName, EXIT, ARCHITECTURE, LIMITATIONS, SCHEMA } = require('./report');

const sc = (status) => ({ key: status, status });
const base = { startedAt: 'a', finishedAt: 'b' };

test('status: ok, warning, partial; warning ainda sai com 0', () => {
  assert.equal(buildReport({ ...base, planned: 2, scenarios: [sc('ok'), sc('ok')] }).status, 'ok');
  const w = buildReport({ ...base, planned: 2, scenarios: [sc('ok'), sc('warning')] });
  assert.equal(w.status, 'warning');
  assert.equal(exitCodeFor(w), EXIT.OK);
  const p = buildReport({ ...base, planned: 2, scenarios: [sc('ok'), sc('failed')] });
  assert.equal(p.status, 'partial');
  assert.equal(exitCodeFor(p), EXIT.FAILED);
});

test('cenario ausente NUNCA vira ok nem e pulado em silencio', () => {
  const r = buildReport({ ...base, planned: 2, scenarios: [sc('ok')] });
  assert.equal(r.status, 'error');
  assert.equal(r.missingScenarios, 1);
  assert.equal(exitCodeFor(r), EXIT.FAILED);
  const none = buildReport({ ...base, planned: 2, scenarios: [] });
  assert.equal(none.status, 'error');
  assert.equal(none.completed, 0);
});

test('timeout e fatal prevalecem; relatorio ausente e falha', () => {
  assert.equal(statusOf([sc('ok')], { timedOut: true, planned: 1 }), 'timeout');
  assert.equal(exitCodeFor({ status: 'timeout' }), EXIT.TIMEOUT);
  assert.equal(buildReport({ ...base, planned: 1, scenarios: [sc('ok')], fatal: 'x' }).status, 'error');
  assert.equal(exitCodeFor(null), EXIT.FAILED);
});

test('relatorio afirma forwarding sem encode por arquitetura e nao promete zero CPU nem hardware', () => {
  const r = buildReport({ ...base, planned: 1, scenarios: [sc('ok')] });
  assert.equal(r.schema, SCHEMA);
  const text = JSON.stringify([ARCHITECTURE, LIMITATIONS]);
  assert.match(text, /sem decodificar nem recodificar/);
  assert.match(text, /NAO prova custo zero/);
  assert.doesNotMatch(text.toLowerCase(), /zero cpu|hardware comprovado|hardware provado/);
  assert.match(r.network, /127\.0\.0\.1/);
  assert.doesNotMatch(r.network, /nenhuma porta fora do loopback/);
  assert.match(r.network, /0\.0\.0\.0/);
  assert.ok(r.limitations.some((l) => /multi-PC/.test(l)));
  assert.ok(r.limitations.some((l) => /Camada unica/.test(l)));
});

test('nome do relatorio e estavel e saneado', () => {
  assert.equal(reportFileName(new Date('2026-10-05T10:20:30.456Z'), 'meu teste/1'), 'sfu-spike-2026-10-05T10-20-30-456Z-meu_teste_1.json');
  assert.equal(reportFileName(new Date('2026-10-05T10:20:30.456Z'), ''), 'sfu-spike-2026-10-05T10-20-30-456Z.json');
});

test('midCloseCovered: false quando nenhum cenario fechou um consumidor no meio', () => {
  const withMid = { key: 'c4', status: 'ok', checks: [{ id: 'mid-close', status: 'passed' }] };
  const noMid = { key: 'c1', status: 'ok', checks: [{ id: 'mid-close', status: 'not-applicable' }] };
  assert.equal(buildReport({ ...base, planned: 1, scenarios: [noMid] }).midCloseCovered, false);
  assert.equal(buildReport({ ...base, planned: 2, scenarios: [noMid, withMid] }).midCloseCovered, true);
  assert.equal(buildReport({ ...base, planned: 1, scenarios: [{ key: 'x', status: 'failed', checks: [{ id: 'mid-close', status: 'failed' }] }] }).midCloseCovered, false);
});

test('rede: a faixa UDP do cliente aparece no relatorio', () => {
  const r = buildReport({ ...base, planned: 1, scenarios: [sc('ok')], clientUdpPortRange: { min: 42200, max: 42399 } });
  assert.match(r.network, /42200-42399/);
  assert.deepEqual(r.clientUdpPortRange, { min: 42200, max: 42399 });
});
