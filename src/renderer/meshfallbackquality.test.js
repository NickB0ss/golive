'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMeshFallbackQuality } = require('./meshfallbackquality');

test('saida do modo degradado espera dez segundos de topologia estavel', () => {
  const quality = createMeshFallbackQuality({ now: () => now });
  let now = 0;
  quality.enter();
  assert.equal(quality.canRestore(), false);
  now = 9_999;
  assert.equal(quality.canRestore(), false);
  now = 10_000;
  assert.equal(quality.canRestore(), true);
});

test('mudanca de topologia reinicia a espera para voltar qualidade', () => {
  let now = 0;
  const quality = createMeshFallbackQuality({ now: () => now });
  quality.enter();
  now = 9_000;
  quality.topologyChanged();
  now = 18_999;
  assert.equal(quality.canRestore(), false);
  now = 19_000;
  assert.equal(quality.canRestore(), true);
});

test('entrada no modo degradado continua imediata', () => {
  let now = 42;
  const quality = createMeshFallbackQuality({ now: () => now });
  assert.equal(quality.enter(), true);
  assert.equal(quality.isDegraded(), true);
});
