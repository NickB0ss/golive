'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const K = require('./cartas');

test('face e rotulo das cartas', () => {
  assert.equal(K.face('As'), 'A♠');
  assert.equal(K.face('Th'), '10♥');
  assert.equal(K.face('xx'), '');
  assert.equal(K.rotulo('Qd'), 'dama de ouros');
  assert.equal(K.rotulo(null), 'carta virada');
  assert.equal(K.rotulo('zz'), 'carta');
  assert.equal(K.rotuloMao(['Ac', null]), 'ás de paus, carta virada');
  assert.equal(K.rotuloMao([]), 'sem cartas');
});
