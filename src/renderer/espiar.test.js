'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpyState } = require('./espiar');

test('estado de espiar abre um tile e troca o conteudo sem criar outro estado', () => {
  const state = createSpyState();
  assert.deepEqual(state.open('peer-1'), { action: 'open', tileId: 'peer-1' });
  assert.deepEqual(state.open('peer-2'), { action: 'replace', tileId: 'peer-2' });
  assert.equal(state.tileId(), 'peer-2');
});

test('estado de espiar so fecha para o tile que esta aberto', () => {
  const state = createSpyState();
  state.open('peer-1');
  assert.equal(state.closeFor('peer-2'), false);
  assert.equal(state.tileId(), 'peer-1');
  assert.equal(state.closeFor('peer-1'), true);
  assert.equal(state.tileId(), null);
});

test('estado de espiar fecha quando a janela filha avisa que acabou', () => {
  const state = createSpyState();
  state.open('peer-1');
  assert.equal(state.closed('peer-2'), false);
  assert.equal(state.closed('peer-1'), true);
  assert.equal(state.tileId(), null);
});
