'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { beforeBuild, missingNativeBuilds, missingOptionalNativeBuilds } = require('./check-native-build');

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

test('o golive-media e opcional: listado quando ausente, sem bloquear o beforeBuild', () => {
  const rootDir = tmpDir();
  const exe = path.join('build', 'Release', process.platform === 'win32' ? 'golive-media.exe' : 'golive-media');
  assert.deepEqual(missingOptionalNativeBuilds(rootDir), [path.join(rootDir, exe)]);
  assert.ok(!missingNativeBuilds(rootDir).some((f) => f.includes('golive-media')));

  fs.mkdirSync(path.join(rootDir, 'build', 'Release'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'build', 'Release', 'golive_audio.node'), '');
  assert.equal(beforeBuild({ appDir: rootDir }), true);

  fs.writeFileSync(path.join(rootDir, exe), '');
  assert.deepEqual(missingOptionalNativeBuilds(rootDir), []);
});
