'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const K = require('./cartas');
const { Elemento } = require('./dom-falso-leva3');

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

function comDocumento(fazer) {
  const anterior = globalThis.document;
  globalThis.document = { createElement: (tag) => new Elemento(tag) };
  try {
    return fazer();
  } finally {
    globalThis.document = anterior;
  }
}

test('carta tem volume e o verso mantem o rotulo de carta virada', () => {
  const [frente, verso] = comDocumento(() => [K.carta('Ah'), K.carta(null)]);
  assert.ok(frente.classList.contains('mj-volume'));
  assert.ok(frente.classList.contains('is-vermelha'));
  assert.ok(verso.classList.contains('mj-volume'));
  assert.ok(verso.classList.contains('is-verso'));
  assert.equal(verso.getAttribute('aria-label'), 'carta virada');
});

test('so a carta de face revelada gira; sem o pedido nao gira', () => {
  const [gira, parada, versoGira] = comDocumento(() => [
    K.carta('Ks', { vira: true }), K.carta('Ks'), K.carta(null, { vira: true }),
  ]);
  assert.ok(gira.classList.contains('is-vira'));
  assert.ok(!parada.classList.contains('is-vira'));
  assert.ok(!versoGira.classList.contains('is-vira'));
});
