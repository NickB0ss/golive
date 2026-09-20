'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PcmPlanarPool } = require('./pcm-planar');

test('pool desintercala e reutiliza os planos devolvidos pelo worklet', () => {
  const pool = new PcmPlanarPool({ channels: 2, framesPerBuffer: 4, warmBuffers: 1 });
  const primeiro = pool.acquire(3);
  pool.deinterleave(new Float32Array([1, -1, 2, -2, 3, -3]), primeiro, 3);
  assert.deepEqual(Array.from(primeiro[0].subarray(0, 3)), [1, 2, 3]);
  assert.deepEqual(Array.from(primeiro[1].subarray(0, 3)), [-1, -2, -3]);

  pool.release(primeiro);
  const segundo = pool.acquire(2);
  assert.strictEqual(segundo[0], primeiro[0]);
  assert.strictEqual(segundo[1], primeiro[1]);
});

test('pool aumenta uma vez para bloco maior e depois reaproveita essa reserva', () => {
  const pool = new PcmPlanarPool({ channels: 2, framesPerBuffer: 2, warmBuffers: 0 });
  const grande = pool.acquire(5);
  assert.equal(grande[0].length, 5);
  pool.release(grande);
  assert.strictEqual(pool.acquire(5)[0], grande[0]);
});
