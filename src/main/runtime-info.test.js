'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { runtimeInfo } = require('./runtime-info');

test('runtime Node puro nao precisa importar Electron', () => {
  const result = runtimeInfo();
  assert.equal(result.node, process.versions.node);
  assert.equal(result.platform, process.platform);
  assert.equal(result.arch, process.arch);
  assert.equal(result.electron, null);
  // Uma instalacao do Electron no repo pai nao deve esconder um import indevido.
  const child = spawnSync(process.execPath, ['-e', `
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function(name, ...args) {
      if (name === 'electron') throw new Error('Electron indisponivel');
      return load.call(this, name, ...args);
    };
    console.log(JSON.stringify(require(${JSON.stringify(require.resolve('./runtime-info'))}).runtimeInfo()));
  `], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).electron, null);
});

test('runtime permite injetar metadados e seleciona somente dados publicos', () => {
  assert.deepEqual(runtimeInfo({ versions: { electron: '44.4.3', node: '24.0.0', chrome: '150.0.0', secret: 'nao-logar' }, platform: 'win32', arch: 'x64', appVersion: '0.25.0', packaged: true }), {
    appVersion: '0.25.0', electron: '44.4.3', node: '24.0.0', chrome: '150.0.0', platform: 'win32', arch: 'x64', packaged: true,
  });
});
