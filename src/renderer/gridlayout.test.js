'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gridLayout } = require('./gridlayout');

test('uma tela so continua na grade comum', () => {
  assert.deepEqual(gridLayout([
    { id: 'screen-a', kind: 'screen', watched: true },
  ]), {
    layout: 'grid', count: 1, main: ['screen-a'], strip: [],
  });
});

test('tela assistida com camera vira palco e tira', () => {
  assert.deepEqual(gridLayout([
    { id: 'screen-a', kind: 'screen', watched: true },
    { id: 'cam-a', kind: 'camera', watched: true },
  ]), {
    layout: 'spotlight', count: 2, main: ['screen-a'], strip: ['cam-a'],
  });
});

test('duas telas assistidas dividem o palco e a camera fica na tira', () => {
  assert.deepEqual(gridLayout([
    { id: 'screen-a', kind: 'screen', watched: true },
    { id: 'screen-b', kind: 'screen', watched: true },
    { id: 'cam-a', kind: 'camera', watched: true },
  ]), {
    layout: 'spotlight', count: 3, main: ['screen-a', 'screen-b'], strip: ['cam-a'],
  });
});

test('so cameras continuam na grade comum', () => {
  assert.deepEqual(gridLayout([
    { id: 'cam-a', kind: 'camera', watched: true },
    { id: 'cam-b', kind: 'camera', watched: true },
  ]), {
    layout: 'grid', count: 2, main: ['cam-a', 'cam-b'], strip: [],
  });
});

test('tela nao assistida nao inicia palco', () => {
  assert.deepEqual(gridLayout([
    { id: 'screen-a', kind: 'screen', watched: false },
    { id: 'cam-a', kind: 'camera', watched: true },
  ]), {
    layout: 'grid', count: 2, main: ['screen-a', 'cam-a'], strip: [],
  });
});

test('tiles proprios seguem o kind, nao o formato do id', () => {
  assert.deepEqual(gridLayout([
    { id: 'me', kind: 'screen', watched: true },
    { id: 'cam-me', kind: 'camera', watched: true },
  ]), {
    layout: 'spotlight', count: 2, main: ['me'], strip: ['cam-me'],
  });
});

test('sete ou mais tiles mantem telas assistidas no palco', () => {
  assert.deepEqual(gridLayout([
    { id: 'screen-a', kind: 'screen', watched: true },
    { id: 'cam-a', kind: 'camera', watched: true },
    { id: 'cam-b', kind: 'camera', watched: true },
    { id: 'cam-c', kind: 'camera', watched: true },
    { id: 'cam-d', kind: 'camera', watched: true },
    { id: 'cam-e', kind: 'camera', watched: true },
    { id: 'screen-b', kind: 'screen', watched: false },
  ]), {
    layout: 'spotlight', count: 7, main: ['screen-a'],
    strip: ['cam-a', 'cam-b', 'cam-c', 'cam-d', 'cam-e', 'screen-b'],
  });
});

test('destaque escolhido vai sozinho pro palco e o resto desce pra tira', () => {
  assert.deepEqual(gridLayout([
    { id: 'screen-a', kind: 'screen', watched: true },
    { id: 'cam-a', kind: 'camera', watched: true },
  ], { focus: 'cam-a' }), {
    layout: 'spotlight', count: 2, main: ['cam-a'], strip: ['screen-a'],
  });
});

test('destaque em tela nao assistida ou que saiu e ignorado', () => {
  const tiles = [
    { id: 'screen-a', kind: 'screen', watched: true },
    { id: 'screen-b', kind: 'screen', watched: false },
    { id: 'cam-a', kind: 'camera', watched: true },
  ];
  const auto = gridLayout(tiles);
  assert.deepEqual(gridLayout(tiles, { focus: 'screen-b' }), auto);
  assert.deepEqual(gridLayout(tiles, { focus: 'sumiu' }), auto);
});

test('destaque com um tile so nao cria tira', () => {
  assert.deepEqual(gridLayout([{ id: 'cam-a', kind: 'camera', watched: true }], { focus: 'cam-a' }), {
    layout: 'grid', count: 1, main: ['cam-a'], strip: [],
  });
});
