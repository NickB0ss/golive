'use strict';

/*
 * Contrato com tools/media-bench (somente leitura): o spike importa flags, CPU,
 * a cena sintetica e o runtimeInfo do app. Se a assinatura de algum mudar, este
 * teste quebra no `node --test`, e nao so numa execucao real do Electron.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BENCH = path.resolve(__dirname, '..', '..', 'media-bench');

test('lib/flags: applyBenchFlags(commandLine, logger) devolve o formato que o relatorio grava', () => {
  const { applyBenchFlags } = require('../../media-bench/lib/flags');
  assert.equal(typeof applyBenchFlags, 'function');
  assert.equal(applyBenchFlags.length, 2);
  const switches = new Map();
  const commandLine = {
    appendSwitch: (name, value = '') => { switches.set(name, value); },
    hasSwitch: (name) => switches.has(name),
    getSwitchValue: (name) => switches.get(name) || '',
  };
  const out = applyBenchFlags(commandLine, { error: () => {}, warn: () => {}, log: () => {} });
  assert.deepEqual(Object.keys(out).sort(), ['chromiumFlagsValid', 'disableFeatures', 'enableFeatures', 'topSwitches']);
  assert.ok(Array.isArray(out.topSwitches) && out.topSwitches.every((x) => typeof x.name === 'string' && typeof x.present === 'boolean'));
});

test('lib/cpu: bucketMetrics(metrics) -> { byType, total } e summarizeCpu(samples, from, to)', () => {
  const { bucketMetrics, summarizeCpu } = require('../../media-bench/lib/cpu');
  assert.equal(bucketMetrics.length, 1);
  assert.equal(summarizeCpu.length, 3);
  const b = bucketMetrics([{ type: 'GPU', cpu: { percentCPUUsage: 2 } }, { type: 'Tab', cpu: { percentCPUUsage: 3 } }]);
  assert.deepEqual(b, { byType: { GPU: 2, Tab: 3 }, total: 5 });
  const s = summarizeCpu([{ t: 10, ...b }, { t: 20, ...b }], 0, 30);
  assert.deepEqual(Object.keys(s).sort(), ['byTypeMean', 'samples', 'totalMax', 'totalMean']);
  assert.equal(summarizeCpu([], 0, 1), null);
});

test('src/main/runtime-info: runtimeInfo({ appVersion, packaged }) com os campos usados no relatorio', () => {
  const { runtimeInfo } = require('../../../src/main/runtime-info');
  const info = runtimeInfo({ appVersion: '1.2.3', packaged: false });
  for (const key of ['appVersion', 'electron', 'node', 'chrome', 'platform', 'arch', 'packaged']) assert.ok(key in info, key);
  assert.equal(info.appVersion, '1.2.3');
});

test('scene-math + renderer/scene: MediaBench.scene.create({ width, height, fps }) -> { track, start, stop, stats }', () => {
  const calls = { requestFrame: 0, stopped: 0 };
  const track = { requestFrame: () => { calls.requestFrame += 1; }, stop: () => { calls.stopped += 1; } };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx, captureStream: () => ({ getVideoTracks: () => [track] }) }),
  };
  const sandbox = { setTimeout, clearTimeout, performance: { now: () => Date.now() }, document };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // A ordem importa (e a mesma de renderer/index.html): scene.js depende de MediaBench.sceneMath.
  for (const rel of ['shared/scene-math.js', 'renderer/scene.js']) {
    vm.runInContext(fs.readFileSync(path.join(BENCH, rel), 'utf8'), sandbox, { filename: rel });
  }
  assert.equal(typeof sandbox.MediaBench.sceneMath.frameState, 'function');
  const scene = sandbox.MediaBench.scene.create({ width: 64, height: 36, fps: 30 });
  assert.deepEqual(Object.keys(scene).sort(), ['canvas', 'start', 'stats', 'stop', 'track']);
  assert.equal(scene.track, track);
  scene.start();
  scene.stop();
  assert.deepEqual(Object.keys(scene.stats()).sort(), ['framesDrawn', 'lateResets']);
  assert.equal(calls.stopped, 1);
});
