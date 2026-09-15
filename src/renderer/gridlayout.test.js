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
