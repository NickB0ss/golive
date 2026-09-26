'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const quadro = require('./quadro');
const { jsonBytes } = require('../mesa');

test('init carimba quem criou a janela (ctx.by), sem ele fica null', () => {
  assert.deepEqual(quadro.init({ by: '7' }), { owner: '7' });
  assert.deepEqual(quadro.init({}), { owner: null });
  assert.deepEqual(quadro.init({ by: null }), { owner: null });
});

test('nao existe acao: validate sempre recusa, reduce nunca muda o estado', () => {
  const s = quadro.init({ by: '7' });
  assert.equal(typeof quadro.validate(s, { kind: 'qualquer' }), 'string');
  assert.notEqual(quadro.validate(s, {}), true);
  assert.equal(quadro.reduce(s, { kind: 'qualquer' }), s);
});

test('canAnnotateClear: so quem criou a janela ou o lider', () => {
  const s = quadro.init({ by: '7' });
  assert.equal(quadro.canAnnotateClear(s, '7', { isLeader: false }), true);
  assert.equal(quadro.canAnnotateClear(s, '9', { isLeader: true }), true);
  assert.equal(quadro.canAnnotateClear(s, '9', { isLeader: false }), false);
  assert.equal(quadro.canAnnotateClear(s, '9', {}), false);
});

test('o modulo nao declara canAnnotateDraw: o servidor deixa qualquer pessoa na Mesa desenhar', () => {
  assert.equal(quadro.canAnnotateDraw, undefined);
});

test('o estado (so o dono) cabe folgado no teto declarado', () => {
  const s = quadro.init({ by: '123456789012' });
  assert.ok(jsonBytes(s) <= quadro.maxStateBytes);
});

test('summary devolve um texto curto', () => {
  assert.equal(typeof quadro.summary(quadro.init({})), 'string');
});
