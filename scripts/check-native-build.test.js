'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { beforeBuild, missingNativeBuilds } = require('./check-native-build');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'golive-native-build-'));
}

test('lista o addon nativo ausente', () => {
  const rootDir = tmpDir();

  assert.deepEqual(missingNativeBuilds(rootDir), [
    path.join(rootDir, 'build', 'Release', 'golive_audio.node'),
  ]);
});

test('nao lista nada quando o addon nativo existe', () => {
  const rootDir = tmpDir();
  const addonPath = path.join(rootDir, 'build', 'Release', 'golive_audio.node');
  fs.mkdirSync(path.dirname(addonPath), { recursive: true });
  fs.writeFileSync(addonPath, '');

  assert.deepEqual(missingNativeBuilds(rootDir), []);
});

test('beforeBuild falha sem o addon e devolve true com ele', () => {
  const rootDir = tmpDir();
  assert.throws(() => beforeBuild({ appDir: rootDir }), /npm run build:native/);

  const addonPath = path.join(rootDir, 'build', 'Release', 'golive_audio.node');
  fs.mkdirSync(path.dirname(addonPath), { recursive: true });
  fs.writeFileSync(addonPath, '');
  // true mantem o install/rebuild do electron-builder (falsy o desliga).
  assert.equal(beforeBuild({ appDir: rootDir }), true);
});
