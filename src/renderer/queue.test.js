'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSerialQueue } = require('./queue');

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

test('roda na ordem do push, sem sobrepor -- a mais lenta termina antes da seguinte comecar', async () => {
  const queue = createSerialQueue();
  const log = [];

  const a = queue.push(async () => {
    log.push('a:inicio');
    await delay(20);
    log.push('a:fim');
  });
  const b = queue.push(async () => {
    log.push('b:inicio');
    await delay(1);
    log.push('b:fim');
  });
  const c = queue.push(async () => { log.push('c:inicio'); log.push('c:fim'); });

  await Promise.all([a, b, c]);

  assert.deepEqual(log, [
    'a:inicio', 'a:fim',
    'b:inicio', 'b:fim',
    'c:inicio', 'c:fim',
  ]);
});

test('rejeicao no meio nao quebra a cadeia', async () => {
  const queue = createSerialQueue();
  const log = [];

  queue.push(async () => { log.push('a'); });
  const boom = queue.push(async () => { throw new Error('boom'); });
  const last = queue.push(async () => { log.push('c'); });

  await assert.rejects(boom, /boom/);
  await last;
  assert.deepEqual(log, ['a', 'c']);
});

test('erro SINCRONO tambem nao quebra a cadeia nem estoura no chamador', async () => {
  const queue = createSerialQueue();
  const log = [];

  let boom;
  assert.doesNotThrow(() => {
    boom = queue.push(() => { throw new Error('sincrono'); });
  });
  const last = queue.push(() => { log.push('depois'); });

  await assert.rejects(boom, /sincrono/);
  await last;
  assert.deepEqual(log, ['depois']);
});

test('o valor de retorno da fn chega a quem chamou push', async () => {
  const queue = createSerialQueue();
  assert.equal(await queue.push(async () => 42), 42);
  assert.equal(await queue.push(() => 'sincrono'), 'sincrono');
});

test('filas diferentes nao compartilham cadeia', async () => {
  const a = createSerialQueue();
  const b = createSerialQueue();
  const log = [];

  const lenta = a.push(async () => { await delay(20); log.push('a'); });
  const rapida = b.push(async () => { log.push('b'); });

  await Promise.all([lenta, rapida]);
  assert.deepEqual(log, ['b', 'a']);
});
