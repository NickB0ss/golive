'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { menuItems, positionPopover } = require('./tile-menu');

test('qualidade entra apenas no menu de tela remota', () => {
  assert.deepEqual(menuItems({ id: 'bia', kind: 'screen', watched: true, mesa: false }), [
    'volume', 'espiar', 'qualidade', 'parar',
  ]);
  assert.ok(!menuItems({ id: 'me', kind: 'screen', watched: true, mesa: false }).includes('qualidade'));
  assert.ok(!menuItems({ id: 'cam-bia', kind: 'camera', watched: true, mesa: false }).includes('qualidade'));
});

test('rotula as opcoes fechadas de qualidade', () => {
  const { qualityLabel } = require('./tile-menu');
  assert.equal(qualityLabel('auto'), 'Auto');
  assert.equal(qualityLabel('1080p'), '1080p');
  assert.equal(qualityLabel('720p'), '720p');
  assert.equal(qualityLabel('480p'), '480p');
});

test('popover fica inteiramente dentro da janela', () => {
  assert.deepEqual(positionPopover({
    x: 990,
    y: 790,
    width: 200,
    height: 160,
    viewportWidth: 1000,
    viewportHeight: 800,
  }), { x: 792, y: 632 });
});
