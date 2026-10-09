'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Executa os handlers reais sem iniciar Electron nem enumerar audio pessoal.
function handlers(audioAddon) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const start = source.indexOf("ipcMain.handle('audio:findDiscordPid'");
  const end = source.indexOf("ipcMain.handle('audio:pidForSource'", start);
  const result = new Map();
  vm.runInNewContext(source.slice(start, end), {
    audioAddon, process: { pid: 99 }, ipcMain: { handle: (name, fn) => result.set(name, fn) },
  });
  return result;
}

test('IPC diferencia enumeracao valida vazia de falha e addon ausente', () => {
  for (const [channel, method] of [['audio:listRenderPids', 'listAudioRenderPids'],
    ['audio:listProcessNames', 'listProcessNames']]) {
    const empty = handlers({ [method]: () => [] }).get(channel)();
    assert.equal(empty.ok, true);
    assert.equal(empty.items.length, 0);
    const failure = handlers({ [method]() { throw new Error('API failed'); } }).get(channel)();
    assert.equal(failure.ok, false);
    assert.equal(failure.error, 'API failed');
    assert.equal(handlers(null).get(channel)().ok, false);
  }
});

function captureHandlers(audioAddon) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const start = source.indexOf("ipcMain.handle('audio:startCapture'");
  const stop = source.indexOf("ipcMain.handle('audio:stopCapture'", start);
  const end = source.indexOf('\n});', stop) + 4;
  const activeCaptures = new Map();
  const result = new Map();
  vm.runInNewContext(source.slice(start, end), { audioAddon, activeCaptures, nextCaptureId: 1,
    console, ipcMain: { handle: (name, fn) => result.set(name, fn) } });
  return { result, activeCaptures };
}

test('IPC propaga falha depois de ready por captureId e libera registro uma vez', async () => {
  let notify;
  let stopped = 0;
  const sent = [];
  const { result, activeCaptures } = captureHandlers({ LoopbackCapture: class {
    constructor(_pid, _exclude, _onData, onReady) { notify = onReady; }
    stop() { stopped += 1; }
  } });
  const starting = result.get('audio:startCapture')({ sender: {
    isDestroyed: () => false, send: (...args) => sent.push(args),
  } }, { pid: 12 });
  notify(true, '');
  const activation = await starting;
  assert.equal(activation.ok, true);
  notify(false, 'GetBuffer HRESULT');
  assert.deepEqual(sent, [['audio:ended', activation.captureId, 'GetBuffer HRESULT']]);
  assert.equal(activeCaptures.size, 0);
  assert.equal(stopped, 1);
  notify(false, 'duplicado');
  result.get('audio:stopCapture')({}, activation.captureId);
  assert.equal(stopped, 1);
  assert.equal(sent.length, 1);
});

test('IPC deixa falha ao localizar Discord chegar ao resultado parcial do renderer', () => {
  const failure = handlers({ findDiscordRootPid() { throw new Error('snapshot'); } });
  assert.throws(() => failure.get('audio:findDiscordPid')(), /snapshot/);
});
