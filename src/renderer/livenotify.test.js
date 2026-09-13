'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTracker, shouldNotify, markNotified } = require('./livenotify');

const base = {
  enabled: true,
  appFocused: false,
  joinedAtMs: 0,
  nowMs: 5000,
};

test('shouldNotify nunca notifica quando esta desligado', () => {
  assert.equal(shouldNotify(createTracker(), 'peer-1', { ...base, enabled: false }), false);
});

test('shouldNotify nunca notifica quando o app esta focado', () => {
  assert.equal(shouldNotify(createTracker(), 'peer-1', { ...base, appFocused: true }), false);
});

test('shouldNotify nunca notifica dentro da janela de entrada', () => {
  assert.equal(shouldNotify(createTracker(), 'peer-1', { ...base, nowMs: 4999 }), false);
});

test('shouldNotify nunca notifica a sincronizacao bootstrap da migracao', () => {
  assert.equal(shouldNotify(createTracker(), 'peer-1', { ...base, bootstrap: true }), false);
});

test('shouldNotify avisa transmissao real depois da migracao sem bootstrap', () => {
  assert.equal(shouldNotify(createTracker(), 'peer-1', { ...base, nowMs: 6000, bootstrap: false }), true);
});

test('shouldNotify nunca notifica dentro do cooldown do mesmo peer', () => {
  const tracker = createTracker();
  markNotified(tracker, 'peer-1', 5000);
  assert.equal(shouldNotify(tracker, 'peer-1', { ...base, nowMs: 34999 }), false);
});

test('shouldNotify notifica fora das tres janelas', () => {
  assert.equal(shouldNotify(createTracker(), 'peer-1', base), true);
});

test('markNotified reinicia o cooldown somente do peer avisado', () => {
  const tracker = createTracker();
  markNotified(tracker, 'peer-1', 5000);

  assert.equal(shouldNotify(tracker, 'peer-1', { ...base, nowMs: 34999 }), false);
  assert.equal(shouldNotify(tracker, 'peer-2', { ...base, nowMs: 34999 }), true);
});
