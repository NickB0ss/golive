'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setupAutoUpdater } = require('./updater');

// autoUpdater falso: EventEmitter + espioes nos metodos que o wrapper chama.
function fakeAutoUpdater() {
  const au = new EventEmitter();
  au.autoDownload = true;
  au.autoInstallOnAppQuit = true;
  au.calls = [];
  au.checkForUpdates = () => { au.calls.push('checkForUpdates'); return Promise.resolve(); };
  au.downloadUpdate = () => { au.calls.push('downloadUpdate'); return Promise.resolve(); };
  au.quitAndInstall = () => { au.calls.push('quitAndInstall'); };
  return au;
}

function collect() {
  const events = [];
  return { events, onStatus: (p) => events.push(p) };
}

test('desliga autoDownload e autoInstallOnAppQuit', () => {
  const au = fakeAutoUpdater();
  setupAutoUpdater(collect().onStatus, { autoUpdater: au });
  assert.equal(au.autoDownload, false);
  assert.equal(au.autoInstallOnAppQuit, false);
});

test('checkForUpdates(true) marca os eventos seguintes como manual', () => {
  const au = fakeAutoUpdater();
  const { events, onStatus } = collect();
  const u = setupAutoUpdater(onStatus, { autoUpdater: au });

  u.checkForUpdates(true);
  au.emit('checking-for-update');
  au.emit('update-not-available');

  assert.deepEqual(au.calls, ['checkForUpdates']);
  assert.deepEqual(events, [
    { manual: true, status: 'checking' },
    { manual: true, status: 'not-available' },
  ]);
});

test('checkForUpdates(false) marca os eventos como nao-manual', () => {
  const au = fakeAutoUpdater();
  const { events, onStatus } = collect();
  const u = setupAutoUpdater(onStatus, { autoUpdater: au });

  u.checkForUpdates(false);
  au.emit('update-not-available');

  assert.equal(events[0].manual, false);
});

test('download-progress vira downloading com progress inteiro', () => {
  const au = fakeAutoUpdater();
  const { events, onStatus } = collect();
  setupAutoUpdater(onStatus, { autoUpdater: au });

  au.emit('download-progress', { percent: 42.6 });
  assert.deepEqual(events[0], { manual: false, status: 'downloading', progress: 43 });
});

test('update-available e update-downloaded trazem a versao', () => {
  const au = fakeAutoUpdater();
  const { events, onStatus } = collect();
  setupAutoUpdater(onStatus, { autoUpdater: au });

  au.emit('update-available', { version: '9.9.9' });
  au.emit('update-downloaded', { version: '9.9.9' });

  assert.deepEqual(events, [
    { manual: false, status: 'available', version: '9.9.9' },
    { manual: false, status: 'downloaded', version: '9.9.9' },
  ]);
});

test('error traz a mensagem', () => {
  const au = fakeAutoUpdater();
  const { events, onStatus } = collect();
  setupAutoUpdater(onStatus, { autoUpdater: au });

  au.emit('error', new Error('sem rede'));
  assert.deepEqual(events[0], { manual: false, status: 'error', message: 'sem rede' });
});

test('downloadUpdate e quitAndInstall delegam pro autoUpdater', () => {
  const au = fakeAutoUpdater();
  const u = setupAutoUpdater(collect().onStatus, { autoUpdater: au });

  u.downloadUpdate();
  u.quitAndInstall();
  assert.deepEqual(au.calls, ['downloadUpdate', 'quitAndInstall']);
});

test('sem mock e sem build empacotado, checkForUpdates ainda da retorno sintetico', () => {
  const { events, onStatus } = collect();
  const u = setupAutoUpdater(onStatus, {}); // sem deps.autoUpdater -> stub de dev

  u.checkForUpdates(true);
  assert.deepEqual(events, [{ status: 'not-available', manual: true }]);
  // nao deve explodir
  u.downloadUpdate();
  u.quitAndInstall();
});
