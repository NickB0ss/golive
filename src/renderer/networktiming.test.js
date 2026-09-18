'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DISCONNECT_GRACE_MS, REELECTION_HYSTERESIS_MS } = require('./networktiming');

test('histerese de reeleicao permanece maior que a carencia de desconexao', () => {
  assert.equal(REELECTION_HYSTERESIS_MS, DISCONNECT_GRACE_MS + 3000);
  assert.ok(REELECTION_HYSTERESIS_MS > DISCONNECT_GRACE_MS);
});
