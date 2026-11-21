'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const capturequality = require('./capturequality');
const config = require('./config');
const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
function functionSource(name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}

function setup() {
  const calls = [];
  const timers = new Map();
  let id = 0;
  let rejectFirst = false;
  const track = { readyState: 'live', applyConstraints(constraints) {
    calls.push(constraints);
    if (rejectFirst && calls.length === 1) return Promise.reject(new Error('captura ocupada'));
    return Promise.resolve();
  } };
  const controller = capturequality.create({
    setTimeout: fn => { timers.set(++id, fn); return id; },
    clearTimeout: key => timers.delete(key),
  });
  const ctx = vm.createContext({
    config, captureQuality: controller,
    localStream: { getVideoTracks: () => [track] }, captureTrack: track,
    currentSession: { mesh: { peers: new Map() } },
    qualityFor: () => ({ width: 1280, height: 720, fps: 30 }),
    cfg: { quality: { width: 1920, height: 1080, fps: 60 } },
    myRole: { screen: new Map() }, cameraStream: null,
    shareEpoch: 1, swapEpoch: 1, pendingShareAudioCaptures: new Set(), shareAudioCapture: null,
    console: { error() {} },
  });
  vm.runInContext(['reapplyAudienceQuality', 'applyLiveQuality', 'stopShare'].map(functionSource).join('\n'), ctx);
  return { ctx, calls, timers, track, controller, failFirst: () => { rejectFirst = true; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('reaplicador real retenta a mesma captura depois de falha sem novo evento de sala', async () => {
  const f = setup();
  f.failFirst();
  f.ctx.reapplyAudienceQuality();
  await flush();
  assert.equal(f.timers.size, 1);
  const [id, retry] = f.timers.entries().next().value;
  f.timers.delete(id);
  retry();
  await flush();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1], config.videoConstraints({ width: 1280, height: 720, fps: 30 }));
  f.controller.reset();
});

test('qualidade escolhida usa o piso real sem reconfiguracao direta concorrente', async () => {
  const f = setup();
  await f.ctx.applyLiveQuality();
  await flush();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], config.videoConstraints({ width: 1280, height: 720, fps: 30 }));
  f.controller.reset();
});

test('parar transmissao cancela retry mesmo sem localStream restante', async () => {
  const f = setup();
  f.failFirst();
  f.ctx.reapplyAudienceQuality();
  await flush();
  assert.equal(f.timers.size, 1);
  f.ctx.localStream = null;
  f.ctx.stopShare();
  assert.equal(f.timers.size, 0);
});

test('bootstrap carrega controlador de captura antes do app', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.ok(html.indexOf('src="capturequality.js"') >= 0);
  assert.ok(html.indexOf('src="capturequality.js"') < html.indexOf('src="app.js"'));
});
