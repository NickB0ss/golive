'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { friendlySourceNames } = require('./sourcename');

test('tela unica vira "Monitor 1 (principal)" em vez de "Entire screen"', () => {
  assert.deepEqual(
    friendlySourceNames([{ id: 'screen:0:0', name: 'Entire screen', display_id: '2528732444' }], 2528732444),
    ['Monitor 1 (principal)'],
  );
});

test('varias telas sao numeradas na ordem da lista, so a principal marcada', () => {
  const sources = [
    { id: 'screen:0:0', name: 'Screen 1', display_id: '111' },
    { id: 'window:42:0', name: 'Valorant' },
    { id: 'screen:1:0', name: 'Screen 2', display_id: '222' },
  ];
  assert.deepEqual(friendlySourceNames(sources, 222), ['Monitor 1', 'Valorant', 'Monitor 2 (principal)']);
});

test('sem display_id ou sem principal conhecido, fica so o numero', () => {
  assert.deepEqual(friendlySourceNames([{ id: 'screen:0:0', name: 'Entire screen', display_id: '' }], 111), ['Monitor 1']);
  assert.deepEqual(friendlySourceNames([{ id: 'screen:0:0', name: 'Entire screen', display_id: '111' }], null), ['Monitor 1']);
});

test('janela mantem o titulo', () => {
  assert.deepEqual(friendlySourceNames([{ id: 'window:1:0', name: 'Discord' }, { id: 'window:2:0' }], 1), ['Discord', '']);
});
