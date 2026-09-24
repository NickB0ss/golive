'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const leaderloss = require('./leaderloss');
const { MAX_RECONNECT } = require('./reconnect');

const { decide, refusedStreak, hostPortOf, REFUSED_STREAK } = leaderloss;

test('duas recusas seguidas bastam', () => {
  assert.equal(REFUSED_STREAK, 2);
  assert.deepEqual(decide({ attempts: 1, maxAttempts: 7, results: ['refused'] }), { giveUp: false, reason: null });
  assert.deepEqual(decide({ attempts: 2, maxAttempts: 7, results: ['refused', 'refused'] }), { giveUp: true, reason: 'recusa' });
});

test('timeout e inalcancavel nunca encurtam a escada (queda de rota)', () => {
  for (const r of ['timeout', 'unreachable', 'open', 'error']) {
    const results = [r, r, r, r, r, r];
    assert.deepEqual(decide({ attempts: 6, maxAttempts: 7, results }), { giveUp: false, reason: null }, r);
    assert.deepEqual(decide({ attempts: 7, maxAttempts: 7, results }), { giveUp: true, reason: 'escada' }, r);
  }
});

test('so recusas SEGUIDAS contam: uma resposta no meio zera a sequencia', () => {
  assert.equal(refusedStreak(['refused', 'timeout', 'refused']), 1);
  assert.equal(refusedStreak(['timeout', 'refused', 'refused']), 2);
  // A rota caiu e voltou com a porta recusando: so as duas ultimas decidem.
  assert.equal(decide({ attempts: 3, maxAttempts: 7, results: ['timeout', 'refused', 'refused'] }).reason, 'recusa');
  // A porta voltou a aceitar (o lider subiu de novo, ou o sucessor na mesma
  // porta): a escada segue e a proxima tentativa reconecta.
  assert.equal(decide({ attempts: 3, maxAttempts: 7, results: ['refused', 'refused', 'open'] }).giveUp, false);
});

test('sem checagem (IPC ausente) o comportamento e o de antes', () => {
  for (let n = 0; n < MAX_RECONNECT; n += 1) assert.equal(decide({ attempts: n, maxAttempts: MAX_RECONNECT }).giveUp, false);
  assert.deepEqual(decide({ attempts: MAX_RECONNECT, maxAttempts: MAX_RECONNECT }), { giveUp: true, reason: 'escada' });
  assert.equal(refusedStreak(null), 0);
});

test('hostPortOf tira host e porta da URL da sala', () => {
  assert.deepEqual(hostPortOf('ws://26.10.20.30:9000'), { host: '26.10.20.30', port: 9000 });
  assert.deepEqual(hostPortOf('100.64.1.2:9003'), { host: '100.64.1.2', port: 9003 });
  assert.deepEqual(hostPortOf('ws://[fd7a:115c::1]:9000/'), { host: 'fd7a:115c::1', port: 9000 });
  assert.deepEqual(hostPortOf('ws://pc-da-ana:9001'), { host: 'pc-da-ana', port: 9001 });
  assert.equal(hostPortOf('ws://26.10.20.30'), null);
  assert.equal(hostPortOf('ws://26.10.20.30:70000'), null);
  assert.equal(hostPortOf(''), null);
  assert.equal(hostPortOf(null), null);
});

test('describe nao expoe endereco', () => {
  for (const r of ['refused', 'timeout', 'unreachable', 'open', 'error', undefined]) {
    assert.doesNotMatch(leaderloss.describe(r), /\d+\.\d+/);
  }
  assert.ok(leaderloss.isResult('refused'));
  assert.ok(!leaderloss.isResult('talvez'));
});
