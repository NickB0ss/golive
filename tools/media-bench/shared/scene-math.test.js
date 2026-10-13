'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { frameState, mulberry32, RETANGULOS, BLOCOS_RUIDO } = require('./scene-math');

test('mesma semente, mesma sequencia', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('o quadro N e deterministico e muda de um quadro pro outro', () => {
  assert.deepEqual(frameState(120, 1280, 720), frameState(120, 1280, 720));
  assert.notDeepEqual(frameState(120, 1280, 720).rects, frameState(121, 1280, 720).rects);
  assert.notDeepEqual(frameState(120, 1280, 720).blocks, frameState(121, 1280, 720).blocks);
});

test('tudo cabe no canvas', () => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [320, 240]]) {
    for (const n of [0, 1, 59, 600, 123456]) {
      const s = frameState(n, w, h);
      assert.equal(s.rects.length, RETANGULOS);
      assert.equal(s.blocks.length, BLOCOS_RUIDO);
      for (const r of s.rects) {
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 1 && r.y + r.h <= h + 1, `${w}x${h} n=${n}`);
      }
      for (const b of s.blocks) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.s <= w && b.y + b.s <= h);
    }
  }
});
