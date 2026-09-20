'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createVisibilityHold, DEFAULTS } = require('./viewhold');

const GRACE = DEFAULTS.graceMs;

test('ficar visivel vale na hora -- nunca se segura imagem de quem esta olhando', () => {
  const h = createVisibilityHold();
  assert.deepEqual(h.observe({ visible: false, now: 0 }), { visible: true, changed: false, recheckInMs: GRACE });
  assert.deepEqual(h.observe({ visible: false, now: GRACE }), { visible: false, changed: true, recheckInMs: null });
  assert.deepEqual(h.observe({ visible: true, now: GRACE + 1 }), { visible: true, changed: true, recheckInMs: null });
});

test('piscada de oculto mais curta que a carencia nao chega a virar watching=false', () => {
  const h = createVisibilityHold();
  h.observe({ visible: true, now: 0 });
  assert.equal(h.observe({ visible: false, now: 100 }).visible, true, 'ainda segurando');
  assert.deepEqual(h.observe({ visible: true, now: 600 }), { visible: true, changed: false, recheckInMs: null });
  // A pendencia morreu junto: passar da carencia depois disso nao derruba nada.
  assert.deepEqual(h.observe({ visible: true, now: 600 + GRACE * 2 }), { visible: true, changed: false, recheckInMs: null });
  assert.equal(h.current(), true);
});

// O ciclo que o log de 2026-09-19 mostrou: janelas de watching=true de 0,4 a
// 1,3 s, curtas demais pro keyframe de 1080p chegar antes do proximo
// replaceTrack(null). Com a carencia isso tem de virar UM periodo continuo.
test('false -> true -> false -> true rapido nao produz nenhuma mudanca de estado', () => {
  const h = createVisibilityHold();
  const flaps = [
    { visible: false, now: 0 },
    { visible: true, now: 404 },
    { visible: false, now: 1019 },
    { visible: true, now: 1508 },
    { visible: false, now: 2193 },
    { visible: true, now: 2280 },
  ];
  for (const f of flaps) {
    assert.equal(h.observe(f).changed, false, `mudou em ${f.now}ms`);
    assert.equal(h.current(), true);
  }
});

test('oculto de verdade cai depois da carencia, contada do inicio da pendencia', () => {
  const h = createVisibilityHold();
  h.observe({ visible: true, now: 0 });
  assert.equal(h.observe({ visible: false, now: 1000 }).recheckInMs, GRACE, 'primeira pendencia');
  // Reobservar oculto NAO reinicia a contagem -- senao um observe periodico
  // adiantaria a carencia pra sempre e ela nunca venceria.
  assert.equal(h.observe({ visible: false, now: 1000 + GRACE / 2 }).recheckInMs, GRACE / 2);
  const r = h.observe({ visible: false, now: 1000 + GRACE });
  assert.deepEqual(r, { visible: false, changed: true, recheckInMs: null });
  // Continuar oculto depois disso e estado repetido, nao acontecimento novo.
  assert.deepEqual(h.observe({ visible: false, now: 99999 }), { visible: false, changed: false, recheckInMs: null });
});

test('comeca em "assistindo" -- o padrao seguro de toda a cadeia de view-state', () => {
  assert.equal(createVisibilityHold().current(), true);
});

test('voltar a ficar oculto depois de uma piscada recomeca a carencia inteira', () => {
  const h = createVisibilityHold();
  h.observe({ visible: false, now: 0 });
  h.observe({ visible: true, now: 500 });
  assert.equal(h.observe({ visible: false, now: 600 }).recheckInMs, GRACE, 'nao herda os 500ms ja gastos');
  assert.equal(h.observe({ visible: false, now: 600 + GRACE }).changed, true);
});

test('carencia configuravel', () => {
  const h = createVisibilityHold({ graceMs: 100 });
  h.observe({ visible: false, now: 0 });
  assert.equal(h.observe({ visible: false, now: 99 }).changed, false);
  assert.equal(h.observe({ visible: false, now: 100 }).changed, true);
});
