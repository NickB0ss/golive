'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setupAutoUpdater, updateErrorReason } = require('./updater');

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

// --- updateErrorReason: por que a busca falhou, como codigo estavel ------
// O toast antigo dizia so "Nao consegui verificar a atualizacao", entao um
// release incompleto no GitHub e um cabo de rede solto eram indistinguiveis
// pra quem usa -- e pra quem tem de consertar.

test('release sem latest.yml vira o codigo release-incompleto', () => {
  const err = new Error('Cannot find latest.yml in the latest release artifacts (...)');
  err.code = 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND';
  assert.equal(updateErrorReason(err), 'release-incompleto');
});

test('repositorio sem release publicado vira sem-release', () => {
  for (const code of ['ERR_UPDATER_LATEST_VERSION_NOT_FOUND', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS']) {
    const err = new Error('...');
    err.code = code;
    assert.equal(updateErrorReason(err), 'sem-release');
  }
});

test('feed de releases quebrado vira feed-quebrado', () => {
  const err = new Error('Cannot parse releases feed');
  err.code = 'ERR_UPDATER_INVALID_RELEASE_FEED';
  assert.equal(updateErrorReason(err), 'feed-quebrado');
});

test('erro de rede vira sem-rede, nao um problema de release', () => {
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE']) {
    const err = new Error('socket hang up');
    err.code = code;
    assert.equal(updateErrorReason(err), 'sem-rede');
  }
});

test('limite de pedidos do GitHub (403/429) vira limite', () => {
  for (const statusCode of [403, 429]) {
    const err = new Error('rate limit');
    err.statusCode = statusCode;
    assert.equal(updateErrorReason(err), 'limite');
  }
});

test('erro desconhecido nao inventa motivo', () => {
  assert.equal(updateErrorReason(new Error('vish')), null);
  assert.equal(updateErrorReason(null), null);
});

test('o evento de erro carrega o motivo junto da mensagem tecnica', () => {
  const au = fakeAutoUpdater();
  const { events, onStatus } = collect();
  setupAutoUpdater(onStatus, { autoUpdater: au });

  const err = new Error('Cannot find latest.yml in the latest release artifacts');
  err.code = 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND';
  au.emit('error', err);

  assert.deepEqual(events[0], {
    manual: false,
    status: 'error',
    message: 'Cannot find latest.yml in the latest release artifacts',
    reason: 'release-incompleto',
  });
});
