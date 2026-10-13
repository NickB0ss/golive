'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { bucketMetrics, summarizeCpu } = require('./cpu');

test('bucketMetrics soma por tipo e ignora lixo', () => {
  const r = bucketMetrics([
    { type: 'GPU', cpu: { percentCPUUsage: 3 } },
    { type: 'Tab', cpu: { percentCPUUsage: 2 } },
    { type: 'Tab', cpu: { percentCPUUsage: 1 } },
    { type: 'Tab', cpu: {} },
    null,
  ]);
  assert.deepEqual(r.byType, { GPU: 3, Tab: 3 });
  assert.equal(r.total, 6);
  assert.deepEqual(bucketMetrics(undefined), { byType: {}, total: 0 });
});

test('summarizeCpu so olha a janela e devolve null sem amostra', () => {
  const s = [
    { t: 100, byType: { GPU: 10 }, total: 10 },
    { t: 200, byType: { GPU: 20, Tab: 4 }, total: 24 },
    { t: 300, byType: { GPU: 30 }, total: 30 },
    { t: 900, byType: { GPU: 99 }, total: 99 },
  ];
  const r = summarizeCpu(s, 150, 350);
  assert.equal(r.samples, 2);
  assert.equal(r.totalMean, 27);
  assert.equal(r.totalMax, 30);
  assert.equal(r.byTypeMean.GPU, 25);
  assert.equal(r.byTypeMean.Tab, 2);
  assert.equal(summarizeCpu(s, 400, 500), null);
  assert.equal(summarizeCpu([], 0, 1), null);
});
