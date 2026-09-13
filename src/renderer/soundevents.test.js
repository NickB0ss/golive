'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { soundForEvent, shouldPlay } = require('./soundevents');

test('chat remoto fora de foco toca', () => {
  assert.deepEqual(soundForEvent('chat', { isMine: false }), 'chat');
  assert.deepEqual(shouldPlay('chat', { enabled: true, hasFocus: false, now: 3000, lastChatAt: 0 }), { play: true, reason: 'pronto' });
});

test('chat remoto em foco pula com motivo visivel', () => {
  assert.deepEqual(shouldPlay('chat', { enabled: true, hasFocus: true, now: 3000, lastChatAt: 0 }), { play: false, reason: 'janela em foco' });
});

test('chat proprio nao escolhe som', () => {
  assert.equal(soundForEvent('chat', { isMine: true }), null);
});

test('transicao para ao vivo escolhe som ao vivo', () => {
  assert.equal(soundForEvent('broadcast-state', { live: true, wasLive: false }), 'ao vivo');
});

test('transicao para parado escolhe som parado', () => {
  assert.equal(soundForEvent('broadcast-state', { live: false, wasLive: true }), 'parou');
});

test('retomada e estado repetido nao repetem entrar nem ao vivo', () => {
  assert.equal(soundForEvent('join', { reconnectWithOrphan: true }), null);
  assert.equal(soundForEvent('broadcast-state', { live: true, wasLive: true }), null);
});

test('sincronizacao bootstrap de transmissao nao toca som de ao vivo', () => {
  assert.equal(soundForEvent('broadcast-state', { live: true, wasLive: false, bootstrap: true }), null);
});

test('transmissao iniciada depois da migracao toca mesmo sem janela de tempo', () => {
  assert.equal(soundForEvent('broadcast-state', { live: true, wasLive: false, bootstrap: false }), 'ao vivo');
});

test('sons desligados pulam com motivo', () => {
  assert.deepEqual(shouldPlay('ao vivo', { enabled: false }), { play: false, reason: 'sons desligados' });
});

test('rajada de chat respeita intervalo de dois segundos', () => {
  assert.deepEqual(shouldPlay('chat', { enabled: true, hasFocus: false, now: 1999, lastChatAt: 1 }), { play: false, reason: 'intervalo mínimo de chat' });
  assert.deepEqual(shouldPlay('chat', { enabled: true, hasFocus: false, now: 2001, lastChatAt: 1 }), { play: true, reason: 'pronto' });
});
