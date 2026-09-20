'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canNavigateTo } = require('./navigation');

test('canNavigateTo aceita somente a pagina local esperada', () => {
  const local = 'file:///C:/GoLive/src/renderer/index.html';

  assert.equal(canNavigateTo(local, local), true);
  assert.equal(canNavigateTo('https://exemplo.invalido/', local), false);
  assert.equal(canNavigateTo('file:///C:/GoLive/src/renderer/espiar.html', local), false);
  assert.equal(canNavigateTo('not a url', local), false);
});
