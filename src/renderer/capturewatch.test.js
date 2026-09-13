'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCaptureWatch } = require('./capturewatch');

test('fica instavel ao acumular tres mutes em 20 segundos', () => {
  const watch = createCaptureWatch();
  assert.equal(watch.event('mute', 0), null);
  assert.equal(watch.event('unmute', 100), null);
  assert.equal(watch.event('mute', 5000), null);
  assert.equal(watch.event('unmute', 5100), null);
  assert.deepEqual(watch.event('mute', 10000), { state: 'instavel', mutes: 3 });
});

test('fica instavel quando um mute dura tres segundos', () => {
  const watch = createCaptureWatch();
  assert.equal(watch.event('mute', 0), null);
  assert.deepEqual(watch.tick(3000), { state: 'instavel', mutes: 1 });
});

test('so volta a ok depois de quinze segundos sem mute', () => {
  const watch = createCaptureWatch();
  watch.event('mute', 0);
  watch.tick(3000);
  assert.equal(watch.event('unmute', 4000), null);
  assert.equal(watch.tick(18999), null);
  assert.deepEqual(watch.tick(19000), { state: 'ok' });
});

test('devolve apenas transicoes', () => {
  const watch = createCaptureWatch();
  assert.equal(watch.tick(1000), null);
  watch.event('mute', 2000);
  assert.deepEqual(watch.tick(5000), { state: 'instavel', mutes: 1 });
  assert.equal(watch.tick(6000), null);
});
