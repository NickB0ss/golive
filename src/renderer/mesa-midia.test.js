'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCoordinator } = require('./mesa-midia');

test('o primeiro video fica ativo; o segundo entra em espera', () => {
  const c = createCoordinator();
  const log = [];
  const a = c.register('image', (on) => log.push(['a', on]));
  const b = c.register('image', (on) => log.push(['b', on]));
  assert.equal(a.active(), true);
  assert.equal(b.active(), false);
  assert.deepEqual(log, [], 'registrar nao chama onChange');
  b.take();
  assert.deepEqual(log, [['a', false], ['b', true]]);
  assert.equal(c.activeOf('image'), b.id);
  b.take();
  assert.equal(log.length, 2, 'tomar de novo nao repete');
});

test('saiu o ativo: o mais antigo em espera assume; saiu um em espera: nada muda', () => {
  const c = createCoordinator();
  const log = [];
  const a = c.register('image', (on) => log.push(['a', on]));
  const b = c.register('image', (on) => log.push(['b', on]));
  const d = c.register('image', (on) => log.push(['d', on]));
  b.release();
  assert.deepEqual(log, []);
  a.release();
  assert.deepEqual(log, [['d', true]]);
  d.release();
  assert.equal(c.activeOf('image'), null);
  assert.equal(c.size(), 0);
  d.release();
  d.take();
  assert.equal(c.activeOf('image'), null, 'handle solto nao volta');
});

test('audio (radio) tem vaga propria e nao disputa com o video', () => {
  const c = createCoordinator();
  const v = c.register('image', () => {});
  const r1 = c.register('audio', () => {});
  const r2 = c.register('audio', () => {});
  assert.equal(v.active(), true);
  assert.equal(r1.active(), true);
  assert.equal(r2.active(), false);
});

test('onChange que lanca nao impede os outros', () => {
  const c = createCoordinator();
  c.register('image', () => { throw new Error('x'); });
  let chamado = false;
  const b = c.register('image', () => { chamado = true; });
  b.take();
  assert.equal(chamado, true);
});
