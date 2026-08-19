'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, load, serialize, videoConstraints, cameraConstraints, addRecentRoom } = require('./config');

test('load com null devolve os defaults', () => {
  const cfg = load(null);
  assert.deepEqual(cfg, DEFAULTS);
});

test('load com JSON invalido devolve os defaults', () => {
  const cfg = load('{ nao é json');
  assert.deepEqual(cfg, DEFAULTS);
});

test('load preenche campos ausentes de uma config antiga', () => {
  const old = JSON.stringify({ server: 'ws://26.0.0.1:9000', name: 'Nicolas', hostName: 'Nicolas' });
  const cfg = load(old);
  assert.equal(cfg.name, 'Nicolas');
  assert.equal(cfg.v, 1);
  assert.deepEqual(cfg.quality, DEFAULTS.quality);
  assert.deepEqual(cfg.camera, DEFAULTS.camera);
  assert.deepEqual(cfg.recentRooms, []);
});

test('load preserva campos de uma config na v1 completa', () => {
  const full = serialize({
    ...DEFAULTS,
    name: 'Ana',
    quality: { ...DEFAULTS.quality, fps: 30 },
    recentRooms: [{ address: 'ws://26.0.0.1:9000', name: 'sala do Nicolas' }],
  });
  const cfg = load(full);
  assert.equal(cfg.name, 'Ana');
  assert.equal(cfg.quality.fps, 30);
  assert.equal(cfg.quality.width, DEFAULTS.quality.width);
  assert.deepEqual(cfg.recentRooms, [{ address: 'ws://26.0.0.1:9000', name: 'sala do Nicolas' }]);
});

test('serialize sempre grava v:1', () => {
  const json = serialize(DEFAULTS);
  assert.equal(JSON.parse(json).v, 1);
});

test('videoConstraints usa largura, altura e fps da qualidade', () => {
  const c = videoConstraints({ width: 1920, height: 1080, fps: 60 });
  assert.deepEqual(c, {
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
    frameRate: { ideal: 60, max: 60 },
  });
});

test('cameraConstraints usa a config de camera', () => {
  const c = cameraConstraints({ width: 1280, height: 720, fps: 30 });
  assert.deepEqual(c, {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, max: 30 },
  });
});

test('addRecentRoom poe a sala nova no topo', () => {
  let cfg = load(null);
  cfg = addRecentRoom(cfg, { address: 'ws://26.0.0.1:9000', name: 'sala A' });
  cfg = addRecentRoom(cfg, { address: 'ws://26.0.0.2:9000', name: 'sala B' });
  assert.deepEqual(cfg.recentRooms.map((r) => r.address), [
    'ws://26.0.0.2:9000',
    'ws://26.0.0.1:9000',
  ]);
});

test('addRecentRoom deduplica por endereco, movendo pro topo', () => {
  let cfg = load(null);
  cfg = addRecentRoom(cfg, { address: 'ws://26.0.0.1:9000', name: 'sala A' });
  cfg = addRecentRoom(cfg, { address: 'ws://26.0.0.2:9000', name: 'sala B' });
  cfg = addRecentRoom(cfg, { address: 'ws://26.0.0.1:9000', name: 'sala A renomeada' });
  assert.deepEqual(cfg.recentRooms, [
    { address: 'ws://26.0.0.1:9000', name: 'sala A renomeada' },
    { address: 'ws://26.0.0.2:9000', name: 'sala B' },
  ]);
});

test('addRecentRoom limita a 5 entradas', () => {
  let cfg = load(null);
  for (let i = 0; i < 7; i++) {
    cfg = addRecentRoom(cfg, { address: `ws://26.0.0.${i}:9000`, name: `sala ${i}` });
  }
  assert.equal(cfg.recentRooms.length, 5);
  assert.equal(cfg.recentRooms[0].address, 'ws://26.0.0.6:9000');
});
