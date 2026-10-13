'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fitOwnedWindow } = require('./owned-window');

test('cabe na area de trabalho: tamanho do cenario, sem limite', () => {
  const r = fitOwnedWindow({ width: 1280, height: 720, fps: 30 }, { width: 1920, height: 1040 });
  assert.deepEqual([r.width, r.height, r.fps, r.clamped], [1280, 720, 30, false]);
  assert.deepEqual(r.expectedPixels, { width: 1280, height: 720 });
});

test('maior que a area de trabalho: limita e avisa', () => {
  const r = fitOwnedWindow({ width: 1920, height: 1080, fps: 60 }, { width: 1536, height: 816 }, 1.25);
  assert.equal(r.clamped, true);
  assert.equal(r.width, 1536);
  assert.equal(r.height, 816);
  assert.deepEqual(r.expectedPixels, { width: 1920, height: 1020 });
});

test('escala do monitor: pede DIP = pixels / escala para capturar os pixels pedidos', () => {
  const r = fitOwnedWindow({ width: 1920, height: 1080, fps: 60 }, { width: 3000, height: 2000 }, 1.5);
  assert.deepEqual([r.width, r.height, r.clamped], [1280, 720, false]);
  assert.deepEqual(r.expectedPixels, { width: 1920, height: 1080 });
});

test('entradas invalidas: escala vira 1 e area minima de 1 DIP', () => {
  const r = fitOwnedWindow({ width: 640, height: 360, fps: 30 }, { width: 0, height: NaN }, 0);
  assert.equal(r.scaleFactor, 1);
  assert.equal(r.width, 1);
  assert.equal(r.clamped, true);
});
