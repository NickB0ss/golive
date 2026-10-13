'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create, startNativeNode, unwrapEnumeration } = require('./audio-capture');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// Web Audio e IPC sao as fronteiras externas; a sessao e o ciclo de vida sao reais.
function fixture(overrides = {}) {
  const connected = new Set();
  const stopped = [];
  const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
  const graph = { track, connect(capture) { connected.add(capture.pid); }, stop() { track.stop(); } };
  let tick;
  const options = {
    strategy: { mode: 'process', basePid: 12, baseExclude: false },
    prepareGraph: async () => graph,
    startProcess: async (pid) => ({ pid, stop() { stopped.push(pid); connected.delete(pid); } }),
    enumerate: async () => ({ renderPids: [], processes: [], ownPid: 99 }),
    setTimer(callback) { tick = callback; return 1; },
    clearTimer() { tick = null; },
    ...overrides,
  };
  const capture = create(options);
  return { capture, connected, stopped, track, options, tick: () => tick?.() };
}

test('base recusada nao entrega track silenciosa nem tenta Discord', async () => {
  const f = fixture({ startProcess: async () => null, discordPid: 20 });
  const result = await f.capture.ready;
  assert.equal(result.status, 'unavailable');
  assert.equal(result.track, null);
  assert.deepEqual(result.issues, ['base-refused']);
  assert.equal(f.track.readyState, 'ended');
});

test('Discord recusado preserva a base e devolve falha parcial', async () => {
  const f = fixture({ discordPid: 20 });
  f.options.startProcess = async (pid) => pid === 20 ? null : {
    pid, stop() { f.stopped.push(pid); f.connected.delete(pid); },
  };
  const result = await f.capture.ready;
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.issues, ['discord-refused']);
  assert.equal(result.track, f.track);
  assert.deepEqual([...f.connected], [12]);
  f.capture.stop();
});

test('Discord ausente nao e confundido com captura recusada', async () => {
  const f = fixture({ resolveDiscordPid: async () => 0 });
  assert.equal((await f.capture.ready).status, 'active');
  f.capture.stop();
});

test('erro ao localizar Discord nao descarta base valida', async () => {
  const f = fixture({ resolveDiscordPid: async () => { throw new Error('enumeracao'); } });
  assert.equal((await f.capture.ready).status, 'partial');
  assert.deepEqual([...f.connected], [12]);
  f.capture.stop();
});

test('lista vazia valida fica pending e aceita processo que toca depois', async () => {
  const f = fixture({ strategy: { mode: 'include-list' } });
  const result = await f.capture.ready;
  assert.equal(result.status, 'pending');
  assert.equal(result.track, f.track);
  assert.deepEqual(result.issues, []);
  f.options.enumerate = async () => ({ renderPids: [7], processes: [{ pid: 7, ppid: 1 }], ownPid: 99 });
  await f.capture.refresh();
  assert.equal(f.capture.state.status, 'active');
  assert.deepEqual([...f.connected], [7]);
  f.capture.stop();
});

test('include-list remove processo desaparecido e exclui todas as arvores Discord e GoLive', async () => {
  let pids = [7, 8, 9, 99, 100];
  const f = fixture({
    strategy: { mode: 'include-list' },
    enumerate: async () => ({ renderPids: pids, ownPid: 99, processes: [
      { pid: 7, ppid: 1, name: 'game.exe' }, { pid: 8, ppid: 1, name: 'DiscordCanary.exe' },
      { pid: 9, ppid: 8, name: 'helper.exe' }, { pid: 99, ppid: 1, name: 'GoLive.exe' },
      { pid: 100, ppid: 99, name: 'helper.exe' },
    ] }),
  });
  assert.equal((await f.capture.ready).status, 'active');
  assert.deepEqual([...f.connected], [7]);
  pids = [];
  await f.capture.refresh();
  assert.deepEqual(f.stopped, [7]);
  assert.equal(f.capture.state.status, 'pending');
  f.capture.stop();
});

test('falha de enumeracao nao vira pending nem silencio valido', async () => {
  const f = fixture({ strategy: { mode: 'include-list' }, enumerate: async () => {
    throw new Error('API recusada');
  } });
  const result = await f.capture.ready;
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.issues, ['enumeration-failed']);
  assert.equal(result.track, null);
});

test('falha de captura na lista distingue erro de lista vazia', async () => {
  const f = fixture({ strategy: { mode: 'include-list' }, startProcess: async () => null,
    enumerate: async () => ({ renderPids: [7], processes: [{ pid: 7, ppid: 1 }], ownPid: 99 }),
  });
  assert.equal((await f.capture.ready).status, 'unavailable');
  assert.deepEqual(f.capture.state.issues, ['process-refused']);
});

test('refresh concorrente compartilha a mesma varredura e nao duplica captura', async () => {
  const pending = deferred();
  let scans = 0;
  const f = fixture({ strategy: { mode: 'include-list' }, enumerate: async () => {
    scans += 1;
    return pending.promise;
  } });
  await Promise.resolve();
  const refresh = f.capture.refresh();
  pending.resolve({ renderPids: [7], processes: [{ pid: 7, ppid: 1 }], ownPid: 99 });
  await Promise.all([f.capture.ready, refresh]);
  assert.equal(scans, 1);
  assert.deepEqual([...f.connected], [7]);
  f.capture.stop();
});

test('cancelamento durante await de captura para resultado tardio sem conectar', async () => {
  const pending = deferred();
  const f = fixture({ startProcess: () => pending.promise });
  await Promise.resolve();
  f.capture.stop();
  pending.resolve({ pid: 12, stop() { f.stopped.push(12); } });
  assert.equal((await f.capture.ready).status, 'cancelled');
  assert.deepEqual(f.stopped, [12]);
  assert.equal(f.connected.size, 0);
  assert.equal(f.track.readyState, 'ended');
});

test('cancelamento durante preparo para destino tardio', async () => {
  const pending = deferred();
  const f = fixture({ prepareGraph: () => pending.promise });
  f.capture.stop();
  pending.resolve({ track: f.track, stop() { f.track.stop(); } });
  assert.equal((await f.capture.ready).status, 'cancelled');
  assert.equal(f.track.readyState, 'ended');
});

test('signal abortado antes da captura nao prepara grafo', async () => {
  const controller = new AbortController();
  controller.abort();
  const f = fixture({ signal: controller.signal, prepareGraph() { throw new Error('nao deve preparar'); } });
  assert.equal((await f.capture.ready).status, 'cancelled');
});

test('stop repetido libera cada recurso uma unica vez e cancela poll', async () => {
  const f = fixture();
  await f.capture.ready;
  f.capture.stop();
  f.capture.stop();
  assert.deepEqual(f.stopped, [12]);
  assert.equal(f.track.readyState, 'ended');
  assert.equal(f.capture.state.track, null);
});

test('adapter nativo para captureId tardio antes de criar worklet', async () => {
  const pending = deferred();
  const controller = new AbortController();
  const stopped = [];
  const result = startNativeNode({
    pid: 12, exclude: false, signal: controller.signal,
    api: { startProcessAudioCapture: () => pending.promise,
      stopProcessAudioCapture: async (id) => { stopped.push(id); } },
    createNode() { throw new Error('nao deve criar node'); },
  });
  controller.abort();
  pending.resolve({ ok: true, captureId: 42 });
  assert.equal(await result, null);
  assert.deepEqual(stopped, [42]);
});

test('adapter nativo libera captura se construcao do worklet falha', async () => {
  const stopped = [];
  await assert.rejects(startNativeNode({ pid: 12, exclude: false,
    api: { startProcessAudioCapture: async () => ({ ok: true, captureId: 42 }),
      stopProcessAudioCapture: async (id) => { stopped.push(id); } },
    createNode() { throw new Error('worklet'); },
  }), /worklet/);
  assert.deepEqual(stopped, [42]);
});

test('enum estruturada separa vazio valido de erro de API', () => {
  assert.deepEqual(unwrapEnumeration({ ok: true, items: [] }), []);
  assert.throws(() => unwrapEnumeration({ ok: false, error: 'HRESULT' }), /HRESULT/);
  assert.throws(() => unwrapEnumeration([]), /enumeration/);
});

test('include-list observa suporte de ativacao antes de aceitar silencio pending', async () => {
  let probes = 0;
  const f = fixture({ strategy: { mode: 'include-list', probePid: 99 },
    startProcess: async () => { probes += 1; return null; },
  });
  assert.equal((await f.capture.ready).status, 'unavailable');
  assert.equal(f.capture.state.track, null);
  assert.equal(probes, 1);
});

test('probe de suporte e parado antes de montar inclusoes e nunca e conectado', async () => {
  const f = fixture({ strategy: { mode: 'include-list', probePid: 99 } });
  assert.equal((await f.capture.ready).status, 'pending');
  assert.deepEqual(f.stopped, [99]);
  assert.equal(f.connected.size, 0);
  f.capture.stop();
});

// Uma falha terminal e evento da API, diferente de nenhum PCM durante silencio.
function failingFixture(overrides = {}) {
  const terminals = new Map();
  const starts = [];
  const stops = [];
  const f = fixture({ ...overrides,
    startProcess: async (pid) => {
      starts.push(pid);
      const capture = { pid, stop() { stops.push(pid); },
        onEnded(callback) { terminals.set(pid, callback); } };
      return capture;
    },
  });
  return { ...f, starts, stops, fail: (pid) => terminals.get(pid)?.('HRESULT') };
}

test('falha terminal da base depois de ready libera destino e informa unavailable', async () => {
  const f = failingFixture();
  assert.equal((await f.capture.ready).status, 'active');
  f.fail(12);
  assert.equal(f.capture.state.status, 'unavailable');
  assert.equal(f.capture.state.activeCount, 0);
  assert.equal(f.capture.state.track, null);
  assert.deepEqual(f.capture.state.issues, ['base-failed']);
  assert.deepEqual(f.stops, [12]);
  assert.equal(f.track.readyState, 'ended');
  f.capture.stop();
});

test('falha terminal do Discord opcional preserva base ativa com estado parcial', async () => {
  const f = failingFixture({ discordPid: 20 });
  await f.capture.ready;
  f.fail(20);
  assert.equal(f.capture.state.status, 'partial');
  assert.equal(f.capture.state.activeCount, 1);
  assert.equal(f.capture.state.track, f.track);
  assert.deepEqual(f.capture.state.issues, ['discord-refused']);
  assert.deepEqual(f.stops, [20]);
  f.capture.stop();
});

test('base terminal com Discord sobrevivente informa parcial e conserva track valida', async () => {
  const f = failingFixture({ discordPid: 20 });
  await f.capture.ready;
  f.fail(12);
  assert.equal(f.capture.state.status, 'partial');
  assert.equal(f.capture.state.activeCount, 1);
  assert.equal(f.capture.state.track, f.track);
  assert.deepEqual(f.capture.state.issues, ['base-failed']);
  f.capture.stop();
});

test('include-list remove captura terminal e tenta mesmo PID no proximo poll', async () => {
  const f = failingFixture({ strategy: { mode: 'include-list' }, enumerate: async () => ({
    renderPids: [7], processes: [{ pid: 7, ppid: 1 }], ownPid: 99,
  }) });
  await f.capture.ready;
  f.fail(7);
  assert.equal(f.capture.state.status, 'unavailable');
  assert.equal(f.capture.state.activeCount, 0);
  await f.capture.refresh();
  assert.equal(f.capture.state.status, 'active');
  assert.deepEqual(f.starts, [7, 7]);
  assert.deepEqual(f.stops, [7]);
  f.capture.stop();
});

test('evento terminal tardio depois de teardown nao duplica stop nem revive estado', async () => {
  const f = failingFixture();
  await f.capture.ready;
  f.capture.stop();
  f.fail(12);
  f.capture.stop();
  assert.equal(f.capture.state.status, 'cancelled');
  assert.deepEqual(f.stops, [12]);
});

test('adapter recebe evento terminal por captureId e cancela inscricao idempotentemente', async () => {
  let deliver;
  let unsubscribed = 0;
  const stopped = [];
  const node = { port: { close() {} }, disconnect() {} };
  const capture = await startNativeNode({ pid: 12, exclude: false,
    api: { startProcessAudioCapture: async () => ({ ok: true, captureId: 42 }),
      stopProcessAudioCapture: async (id) => stopped.push(id),
      onProcessAudioEnded(callback) { deliver = callback; return () => { unsubscribed += 1; }; } },
    createNode: () => node,
  });
  const failures = [];
  capture.onEnded((error) => failures.push(error));
  deliver(13, 'outro');
  assert.deepEqual(failures, []);
  deliver(42, 'HRESULT');
  capture.stop();
  deliver(42, 'tardio');
  assert.deepEqual(failures, ['HRESULT']);
  assert.deepEqual(stopped, [42]);
  assert.equal(unsubscribed, 1);
});

test('adapter nao perde falha terminal recebida antes da resposta de ativacao', async () => {
  const pending = deferred();
  let deliver;
  const stopped = [];
  const started = startNativeNode({ pid: 12, exclude: false,
    api: { startProcessAudioCapture: () => pending.promise,
      stopProcessAudioCapture: async (id) => stopped.push(id),
      onProcessAudioEnded(callback) { deliver = callback; return () => {}; } },
    createNode() { throw new Error('nao criar worklet terminal'); },
  });
  deliver(42, 'HRESULT');
  pending.resolve({ ok: true, captureId: 42 });
  assert.equal(await started, null);
  assert.deepEqual(stopped, [42]);
});
