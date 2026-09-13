'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clampBounds, parseStoredBounds } = require('./spywin');

const displays = [
  { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
  { bounds: { x: -1280, y: 0, width: 1280, height: 1024 } },
];
const fallback = { x: 1500, y: 800, width: 360, height: 202 };

test('clampBounds preserva uma janela inteiramente visivel', () => {
  assert.deepEqual(clampBounds({ x: 100, y: 100, width: 360, height: 202 }, displays, fallback), {
    x: 100, y: 100, width: 360, height: 202,
  });
});

test('clampBounds usa o fallback quando a janela esta fora de todos os monitores', () => {
  assert.deepEqual(clampBounds({ x: 4000, y: 4000, width: 360, height: 202 }, displays, fallback), fallback);
});

test('clampBounds empurra a janela parcialmente fora para dentro do monitor mais proximo', () => {
  assert.deepEqual(clampBounds({ x: 1800, y: 950, width: 360, height: 202 }, displays, fallback), {
    x: 1560, y: 878, width: 360, height: 202,
  });
});

test('parseStoredBounds aceita somente o JSON completo com numeros finitos positivos', () => {
  assert.deepEqual(parseStoredBounds('{"x":10,"y":20,"width":360,"height":202}'), {
    x: 10, y: 20, width: 360, height: 202,
  });
  assert.equal(parseStoredBounds('{'), null);
  assert.equal(parseStoredBounds('{"x":10,"y":20,"width":"360","height":202}'), null);
  assert.equal(parseStoredBounds('{"x":10,"y":20,"width":0,"height":202}'), null);
});
