'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, QUALITY_PRESETS, load, serialize, videoConstraints, cameraConstraints } = require('./config');

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
});

test('load preserva campos de uma config na v1 completa', () => {
  const full = serialize({
    ...DEFAULTS,
    name: 'Ana',
    quality: QUALITY_PRESETS['1080p30'],
  });
  const cfg = load(full);
  assert.equal(cfg.name, 'Ana');
  assert.equal(cfg.quality.fps, 30);
  assert.equal(cfg.quality.width, DEFAULTS.quality.width);
});

test('load migra config antigo (pre-preset) pro preset mais proximo', () => {
  const old = serialize({ ...DEFAULTS, quality: { width: 1280, height: 720, fps: 30, bitrate: 3_000_000, codec: 'video/H264' } });
  const cfg = load(old);
  assert.equal(cfg.quality.preset, '720p30');
  assert.deepEqual(cfg.quality, { ...QUALITY_PRESETS['720p30'], preset: '720p30', codec: 'video/H264' });
});

test('load com preset desconhecido cai no padrao', () => {
  const old = serialize({ ...DEFAULTS, quality: { preset: 'inexistente' } });
  const cfg = load(old);
  assert.equal(cfg.quality.preset, '1080p60');
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

test('network.tree comeca desligado e config antigo migra pra false', () => {
  const fresh = load(null);
  assert.equal(fresh.network.tree, false);

  const old = serialize({ ...DEFAULTS, network: { advertise: true } }); // sem 'tree'
  const cfg = load(old);
  assert.equal(cfg.network.tree, false);
  assert.equal(cfg.network.advertise, true);
});

test('network.tree e preservado quando ja esta salvo como true', () => {
  const saved = serialize({ ...DEFAULTS, network: { advertise: true, tree: true } });
  const cfg = load(saved);
  assert.equal(cfg.network.tree, true);
});
