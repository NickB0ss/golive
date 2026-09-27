'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pedras = require('./pedras');

test('pedras: duplo-seis tem 28 pedras sem repeticao e embaralha sem mutar', () => {
  const base = pedras.newSet();
  assert.equal(base.length, 28);
  assert.equal(new Set(base.map((p) => p.join('-'))).size, 28);
  assert.deepEqual(base[0], [0, 0]);
  assert.deepEqual(base.at(-1), [6, 6]);
  const misto = pedras.shuffle(base, () => 0);
  assert.deepEqual(base[0], [0, 0]);
  assert.notDeepEqual(misto, base);
});
