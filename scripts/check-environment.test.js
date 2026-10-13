'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkEnvironment } = require('./check-environment');

function fixture(t, installed = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'golive-env-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value));
  };
  const manifest = { name: 'golive-lan', version: '1.0.0', engines: { node: '^22.13.0 || >=24' }, devDependencies: { electron: '^44.4.1' }, dependencies: { ws: '^8.21.3' } };
  const lock = { lockfileVersion: 3, packages: { '': manifest, 'node_modules/electron': { version: '44.4.3' }, 'node_modules/ws': { version: '8.21.3' } } };
  write('package.json', manifest);
  write('package-lock.json', lock);
  if (installed) {
    write('node_modules/electron/package.json', { version: '44.4.3' });
    write('node_modules/ws/package.json', { version: '8.21.3' });
  }
  return { root, write, manifest, lock };
}

test('pacotes locais ausentes nao sao resolvidos pelo diretorio pai', (t) => {
  const { root, write } = fixture(t, false);
  write('node_modules/electron/package.json', { version: '32.3.3' });
  write('nested/package.json', { name: 'golive-lan', version: '1.0.0', devDependencies: { electron: '^44.4.1' } });
  write('nested/package-lock.json', { lockfileVersion: 3, packages: { '': { name: 'golive-lan', version: '1.0.0', devDependencies: { electron: '^44.4.1' } }, 'node_modules/electron': { version: '44.4.3' } } });
  const result = checkEnvironment(path.join(root, 'nested'));
  assert.equal(result.ok, false);
  assert.equal(result.electron.installed, null);
  assert.ok(result.diagnostics.some((d) => d.code === 'PACKAGE_MISSING' && d.package === 'electron'));
});

test('instalacao divergente identifica versoes instalada e resolvida', (t) => {
  const { root, write } = fixture(t);
  write('node_modules/electron/package.json', { version: '32.3.3' });
  const result = checkEnvironment(root);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.code === 'PACKAGE_VERSION_MISMATCH' && d.expected === '44.4.3' && d.actual === '32.3.3'));
});

test('manifesto, lock e instalacao coerentes nao exigem binario por padrao', (t) => {
  const { root } = fixture(t);
  const result = checkEnvironment(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.electron.binaryChecked, false);
});

test('qualquer dependencia declarada ausente reprova o ambiente', (t) => {
  const { root } = fixture(t);
  fs.unlinkSync(path.join(root, 'node_modules/ws/package.json'));
  assert.ok(checkEnvironment(root).diagnostics.some((d) => d.code === 'PACKAGE_MISSING' && d.package === 'ws'));
});

test('root do lock divergente e reportado mesmo com instalacao coerente', (t) => {
  const { root, write, lock, manifest } = fixture(t);
  write('package-lock.json', { ...lock, packages: { ...lock.packages, '': { ...manifest, devDependencies: { electron: '^32.3.3' } } } });
  assert.ok(checkEnvironment(root).diagnostics.some((d) => d.code === 'LOCK_ROOT_MISMATCH'));
});

test('lock invalido retorna diagnostico sem excecao', (t) => {
  const { root, write } = fixture(t);
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{');
  assert.ok(checkEnvironment(root).diagnostics.some((d) => d.code === 'LOCK_INVALID'));
  write('package-lock.json', { lockfileVersion: 3 });
  assert.ok(checkEnvironment(root).diagnostics.some((d) => d.code === 'LOCK_INVALID'));
});

test('checagem explicita rejeita binario ausente e versao de dist antiga', (t) => {
  const { root } = fixture(t);
  assert.ok(checkEnvironment(root, { checkBinary: true }).diagnostics.some((d) => d.code === 'ELECTRON_BINARY_MISSING'));
  const electron = path.join(root, 'node_modules/electron');
  fs.mkdirSync(path.join(electron, 'dist'));
  fs.writeFileSync(path.join(electron, 'path.txt'), 'electron.exe');
  fs.writeFileSync(path.join(electron, 'dist/electron.exe'), 'fixture');
  fs.writeFileSync(path.join(electron, 'dist/version'), '32.3.3');
  assert.ok(checkEnvironment(root, { checkBinary: true }).diagnostics.some((d) => d.code === 'ELECTRON_BINARY_VERSION_MISMATCH'));
  fs.writeFileSync(path.join(electron, 'dist/version'), '44.4.3');
  assert.equal(checkEnvironment(root, { checkBinary: true }).ok, true);
});

test('CLI retorna erro em divergencia e sucesso em coerencia', (t) => {
  const { root, write } = fixture(t);
  const script = path.join(__dirname, 'check-environment.js');
  assert.equal(spawnSync(process.execPath, [script], { cwd: root }).status, 0);
  assert.equal(spawnSync(process.execPath, [script, '--binary'], { cwd: root }).status, 1);
  write('node_modules/electron/package.json', { version: '32.3.3' });
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /PACKAGE_VERSION_MISMATCH/);
});
