'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roomStatus } = require('./status');

const BASE = {
  inRoom: true,
  reconnecting: false,
  weAreLive: false,
  anyoneLive: false,
  presetDegraded: false,
  meshFallback: false,
  softwareEncoder: false,
  effectivePreset: '1080p60',
};

test('sem sala nao ha estado nenhum -- o ponto fica apagado', () => {
  assert.deepEqual(roomStatus({ ...BASE, inRoom: false }), { level: 'offline', label: '' });
});

test('na sala com ninguem transmitindo o acento NAO acende', () => {
  assert.equal(roomStatus(BASE).level, 'idle');
});

test('alguem ao vivo em qualidade cheia acende o acento, sem rotulo', () => {
  assert.deepEqual(roomStatus({ ...BASE, anyoneLive: true }), { level: 'live', label: '' });
});

test('reconectando vence qualquer outro estado', () => {
  const s = roomStatus({ ...BASE, reconnecting: true, anyoneLive: true, weAreLive: true, softwareEncoder: true });
  assert.equal(s.level, 'reconnecting');
  assert.match(s.label, /reconectando/i);
});

test('degradacao so conta quando quem transmite somos NOS', () => {
  // Assistindo alguem cujo encoder sofre: nao temos como saber, e nao e o
  // nosso problema de qualidade -- continua 'live'.
  const s = roomStatus({ ...BASE, anyoneLive: true, weAreLive: false, softwareEncoder: true, presetDegraded: true });
  assert.equal(s.level, 'live');
});

test('transmitindo degradado vira nivel degraded com preset e motivo', () => {
  const s = roomStatus({ ...BASE, anyoneLive: true, weAreLive: true, presetDegraded: true, effectivePreset: '1080p30' });
  assert.equal(s.level, 'degraded');
  assert.equal(s.label, '1080p30 · sala cheia');
});

test('precedencia dos motivos: encoder vence malha, malha vence sala', () => {
  const live = { ...BASE, anyoneLive: true, weAreLive: true, effectivePreset: '720p30' };
  assert.match(roomStatus({ ...live, softwareEncoder: true, meshFallback: true, presetDegraded: true }).label, /aceleração/);
  assert.match(roomStatus({ ...live, meshFallback: true, presetDegraded: true }).label, /recebendo de você/);
  assert.match(roomStatus({ ...live, presetDegraded: true }).label, /sala cheia/);
});

test('transmitindo sem degradacao nenhuma nao inventa rotulo', () => {
  assert.deepEqual(roomStatus({ ...BASE, anyoneLive: true, weAreLive: true }), { level: 'live', label: '' });
});

test('entrada indefinida nao lanca -- isto roda no caminho de render', () => {
  assert.equal(roomStatus(undefined).level, 'offline');
});

test('transmitindo mas pausado: nivel paused, selo diz pausado', () => {
  const s = roomStatus({ ...BASE, anyoneLive: true, weAreLive: true, paused: true });
  assert.equal(s.level, 'paused');
  assert.match(s.label, /pausad/i);
});

test('pausado vence degradacao -- pausado e o fato mais importante', () => {
  const s = roomStatus({ ...BASE, anyoneLive: true, weAreLive: true, paused: true, presetDegraded: true, effectivePreset: '1080p30' });
  assert.equal(s.level, 'paused');
});

test('pausado so conta pra quem transmite -- assistir alguem pausado nao existe', () => {
  const s = roomStatus({ ...BASE, anyoneLive: true, weAreLive: false, paused: true });
  assert.equal(s.level, 'live');
});

test('degrade automatico tem rotulo proprio, nao "sala cheia"', () => {
  const s = roomStatus({ ...BASE, anyoneLive: true, weAreLive: true, autoDegraded: true, presetDegraded: true, effectivePreset: '720p30' });
  assert.equal(s.level, 'degraded');
  assert.match(s.label, /limite/i);
  assert.doesNotMatch(s.label, /sala cheia/);
});

test('precedencia com auto: encoder e malha vencem auto, auto vence sala', () => {
  const base = { ...BASE, anyoneLive: true, weAreLive: true, effectivePreset: '720p30', autoDegraded: true, presetDegraded: true };
  assert.match(roomStatus({ ...base, softwareEncoder: true }).label, /aceleração/);
  assert.match(roomStatus({ ...base, meshFallback: true }).label, /recebendo de você/);
  assert.match(roomStatus(base).label, /limite/);
});
