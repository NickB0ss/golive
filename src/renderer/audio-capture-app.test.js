'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const audioCapture = require('./audio-capture');
const sourceswap = require('./sourceswap');
const pcmPlanar = require('./pcm-planar');
const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function functionSource(name) {
  const match = new RegExp(`  (?:async )?function ${name}\\(`).exec(source);
  if (!match) return '';
  return source.slice(match.index, source.indexOf('\n  }', match.index) + 4);
}

function setup({ windowPid = 12, refuse = [], videoFailure = false } = {}) {
  const tracks = [];
  const stopped = [];
  const selected = [];
  const toasts = [];
  function track(kind) {
    const result = { kind, readyState: 'live', stop() { this.readyState = 'ended'; },
      applyConstraints: async () => {}, addEventListener() {}, removeEventListener() {} };
    tracks.push(result);
    return result;
  }
  function stream() {
    const list = [track('video')];
    return { getTracks: () => list, getAudioTracks: () => list.filter((t) => t.kind === 'audio'),
      getVideoTracks: () => list.filter((t) => t.kind === 'video'),
      addTrack: (t) => list.push(t), removeTrack: (t) => list.splice(list.indexOf(t), 1) };
  }
  const noop = () => {};
  const ctx = vm.createContext({ audioCapture, sourceswap, AbortController, Map, Set, console,
    sharing: false, swapping: false, localStream: null, currentSourceId: '', shareEpoch: 1, swapEpoch: 1,
    pendingShareAudioCaptures: new Set(), shareAudioCapture: null, stopNativeAudioFns: [],
    currentAudioMode: 'none', currentShareSound: false, currentIncludeDiscord: false,
    currentSession: { sig: { isOpen: () => true, send: noop }, mesh: {
      peers: new Map(), replaceLocalTrack: noop } },
    cfg: { quality: { fps: 60 }, annotations: { allow: false }, reactions: { allow: true } },
    config: { videoConstraints: () => ({ width: { max: 1920 }, height: { max: 1080 } }) },
    broadcastguards: { isCurrentEpoch: (a, b) => a === b },
    window: { golive: { pidForSource: async () => windowPid, findDiscordPid: async () => 20,
      selectSource: async (...args) => { selected.push(args); },
      listAudioRenderPids: async () => ({ ok: true, items: [] }),
      listProcessNames: async () => ({ ok: true, items: [] }) } },
    getOwnPidCached: async () => 99,
    ensurePcmWorklet: async () => ({ createMediaStreamDestination() {
      const audio = track('audio');
      return { stream: { getTracks: () => [audio], getAudioTracks: () => [audio] }, disconnect: noop };
    } }),
    startNativeProcessAudioNode: async (_ctx, pid) => refuse.includes(pid) ? null : {
      node: { connect: noop }, stop: () => stopped.push(pid) },
    navigator: { mediaDevices: { getDisplayMedia: async () => {
      if (videoFailure) throw new Error('video');
      return stream();
    } } },
    t: (key) => key, showToast: (key) => toasts.push(key),
    screenrelay: { create: () => null }, screenRelay: null, captureTrack: null,
    startSoundMeter: noop, watchCaptureTrack: noop, stopShare: noop, persist: noop,
    startAnnotOverlay: async () => {}, stopAnnotOverlay: noop, sendCameraState: noop, cameraStream: null,
    broadcastWatchers: noop, recomputeTree: noop, renderMembersPanel: noop, startStatsLoop: noop,
    qualityFor: noop, reapplyAudienceQuality: noop,
    annotate: { surfaceKey: noop }, myId: 'me',
    ui: { grid: { showTile: noop }, annotations: { setSurface: noop, clearSurface: noop },
      reactions: { setSurface: noop }, setToggleState: noop },
    $: () => ({ classList: { remove: noop } }), INCLUDE_LIST_POLL_MS: 5000,
    setTimeout, clearTimeout,
  });
  vm.runInContext(['showShareAudioState', 'createShareAudioCapture', 'startShare', 'swapShare', 'stopShare']
    .map(functionSource).join('\n'), ctx);
  return { ctx, stopped, selected, toasts, tracks };
}

// O adapter e o lifecycle sao reais; apenas transporte IPC e Web Audio
// ficam simulados para nao iniciar captura pessoal durante os testes.
function nativeSetup() {
  const f = setup();
  const listeners = new Set();
  Object.assign(f.ctx.window.golive, {
    onProcessAudioEnded(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    startProcessAudioCapture: async (pid) => ({ ok: true, captureId: pid }),
    stopProcessAudioCapture: async (id) => f.stopped.push(id),
  });
  f.ctx.window.GoLive = { pcmPlanar };
  Object.assign(f.ctx, { PCM_DROP_LOG_MS: 10000, pcmNodesByCapture: new Map(), pcmPoolsByCapture: new Map(),
    AudioWorkletNode: class {
      constructor() { this.port = { onmessage: null, close() {} }; }
      connect() {}
      disconnect() {}
    },
  });
  vm.runInContext(functionSource('startNativeProcessAudioNode'), f.ctx);
  return { ...f, fail: (id) => [...listeners].forEach((callback) => callback(id, 'HRESULT')) };
}

test('evento IPC terminal da base depois do start atualiza currentShareSound e libera PCM', async () => {
  const f = nativeSetup();
  await f.ctx.startShare('window:1', true, false);
  assert.equal(f.ctx.currentShareSound, true);
  f.fail(12);
  assert.equal(f.ctx.currentShareSound, false);
  assert.equal(f.ctx.shareAudioCapture.state.status, 'unavailable');
  assert.equal(f.ctx.pcmNodesByCapture.size, 0);
  assert.equal(f.ctx.localStream.getAudioTracks()[0].readyState, 'ended');
  f.ctx.stopNativeAudioFns.forEach((stop) => stop());
  f.fail(12);
  assert.deepEqual(f.stopped, [12]);
});

test('eventos terminais Discord e base nao mantem aviso de fonte ativa depois de perder ambas', async () => {
  const f = nativeSetup();
  await f.ctx.startShare('window:1', true, true);
  f.fail(20);
  assert.equal(f.ctx.currentShareSound, true);
  assert.equal(f.ctx.shareAudioCapture.state.status, 'partial');
  assert.equal(f.toasts.at(-1), 'erro.capturarSomDiscord');
  f.fail(12);
  assert.equal(f.ctx.currentShareSound, false);
  assert.equal(f.ctx.shareAudioCapture.state.status, 'unavailable');
  assert.equal(f.toasts.at(-1), 'erro.capturarSomFonte');
  f.ctx.stopNativeAudioFns.forEach((stop) => stop());
});

test('start real permite video com base recusada sem anunciar audio nem anexar silencio', async () => {
  const f = setup({ refuse: [12] });
  await f.ctx.startShare('window:1', true, true);
  assert.ok(f.ctx.localStream);
  assert.equal(f.ctx.localStream.getAudioTracks().length, 0);
  assert.equal(f.ctx.currentShareSound, false);
  assert.ok(f.toasts.includes('erro.capturarSomFonte'));
});

test('start real nao amplia janela sem PID para sistema inteiro', async () => {
  const f = setup({ windowPid: 0 });
  await f.ctx.startShare('window:1', true, true);
  assert.deepEqual(f.selected, [['window:1', 'none']]);
  assert.equal(f.ctx.currentShareSound, false);
});

test('start real anuncia Discord parcial e preserva base valida', async () => {
  const f = setup({ refuse: [20] });
  await f.ctx.startShare('window:1', true, true);
  assert.equal(f.ctx.localStream.getAudioTracks().length, 1);
  assert.equal(f.ctx.currentShareSound, true);
  assert.ok(f.toasts.includes('erro.capturarSomDiscord'));
  f.ctx.stopNativeAudioFns.forEach((stop) => stop());
});

test('swap real preserva video e audio anteriores quando captura de video falha', async () => {
  const f = setup({ videoFailure: true });
  const old = { getVideoTracks: () => [f.tracks[0]], getAudioTracks: () => [] };
  f.ctx.localStream = old;
  await f.ctx.swapShare('window:2', true, true);
  assert.equal(f.ctx.localStream, old);
  assert.deepEqual(f.toasts, ['erro.trocarFonteMantemAnterior']);
});

test('swap real substitui audio base e avisa Discord recusado sem perder video novo', async () => {
  const f = setup({ refuse: [20] });
  await f.ctx.startShare('window:1', true, false);
  const oldVideo = f.ctx.localStream.getVideoTracks()[0];
  const oldAudio = f.ctx.localStream.getAudioTracks()[0];
  await f.ctx.swapShare('window:2', true, true);
  assert.notEqual(f.ctx.localStream.getVideoTracks()[0], oldVideo);
  assert.equal(oldVideo.readyState, 'ended');
  assert.equal(oldAudio.readyState, 'ended');
  assert.equal(f.ctx.localStream.getAudioTracks().length, 1);
  assert.equal(f.ctx.currentShareSound, true);
  assert.ok(f.toasts.includes('erro.capturarSomDiscord'));
  f.ctx.stopNativeAudioFns.forEach((stop) => stop());
});

test('stop real antes do commit cancela ativacao pendente e descarta retorno tardio', async () => {
  const f = setup();
  let resolveCapture;
  let activationStarted;
  const started = new Promise((resolve) => { activationStarted = resolve; });
  f.ctx.startNativeProcessAudioNode = () => {
    activationStarted();
    return new Promise((resolve) => { resolveCapture = resolve; });
  };
  const starting = f.ctx.startShare('window:1', true, false);
  await started;
  f.ctx.stopShare();
  resolveCapture({ node: { connect() { throw new Error('nao conectar'); } },
    stop: () => f.stopped.push(12) });
  await starting;
  assert.equal(f.ctx.localStream, null);
  assert.equal(f.ctx.pendingShareAudioCaptures.size, 0);
  assert.deepEqual(f.stopped, [12]);
  assert.ok(f.tracks.every((track) => track.readyState === 'ended'));
});

test('swap obsoleto descarta audio tardio e preserva captura anterior', async () => {
  const f = setup();
  await f.ctx.startShare('window:1', true, false);
  const oldVideo = f.ctx.localStream.getVideoTracks()[0];
  const oldAudio = f.ctx.localStream.getAudioTracks()[0];
  let resolveCapture;
  let activationStarted;
  const started = new Promise((resolve) => { activationStarted = resolve; });
  f.ctx.startNativeProcessAudioNode = () => {
    activationStarted();
    return new Promise((resolve) => { resolveCapture = resolve; });
  };
  const swapping = f.ctx.swapShare('window:2', true, false);
  await started;
  f.ctx.swapEpoch += 1;
  resolveCapture({ node: { connect() { throw new Error('nao conectar'); } },
    stop: () => f.stopped.push(88) });
  await swapping;
  assert.equal(f.ctx.localStream.getVideoTracks()[0], oldVideo);
  assert.equal(oldAudio.readyState, 'live');
  assert.equal(f.ctx.pendingShareAudioCaptures.size, 0);
  assert.deepEqual(f.stopped, [88]);
  f.ctx.stopNativeAudioFns.forEach((stop) => stop());
});

test('poll real distingue pending valido de falha posterior e atualiza estado de audio', async () => {
  const f = setup();
  f.ctx.window.golive.listAudioRenderPids = async () => ({ ok: true, items: [7] });
  f.ctx.window.golive.listProcessNames = async () => ({ ok: true, items: [{ pid: 7, ppid: 1 }] });
  await f.ctx.startShare('screen:1', true, false);
  try {
    assert.equal(f.ctx.shareAudioCapture.state.status, 'active');
    assert.equal(f.ctx.currentShareSound, true);
    f.ctx.window.golive.listAudioRenderPids = async () => ({ ok: false, error: 'API unavailable' });
    await f.ctx.shareAudioCapture.refresh();
    assert.equal(f.ctx.shareAudioCapture.state.status, 'unavailable');
    assert.equal(f.ctx.currentShareSound, false);
    assert.ok(f.toasts.includes('erro.enumerarSomFonte'));
    assert.deepEqual(f.stopped, [99, 7]);
    f.ctx.window.golive.listAudioRenderPids = async () => ({ ok: true, items: [] });
    await f.ctx.shareAudioCapture.refresh();
    assert.equal(f.ctx.shareAudioCapture.state.status, 'pending');
    assert.equal(f.ctx.currentShareSound, true, 'pending conserva ativacao valida sem prometer som audivel');
  } finally {
    f.ctx.stopNativeAudioFns.forEach((stop) => stop());
  }
});

test('video que termina durante ativacao de audio nao descarta a fonte anterior', async () => {
  const f = setup();
  await f.ctx.startShare('window:1', true, false);
  const oldVideo = f.ctx.localStream.getVideoTracks()[0];
  const oldAudio = f.ctx.localStream.getAudioTracks()[0];
  let resolveCapture;
  let activationStarted;
  const started = new Promise((resolve) => { activationStarted = resolve; });
  f.ctx.startNativeProcessAudioNode = () => {
    activationStarted();
    return new Promise((resolve) => { resolveCapture = resolve; });
  };
  const swapping = f.ctx.swapShare('window:2', true, false);
  await started;
  f.tracks.find((track) => track.kind === 'video' && track !== oldVideo).stop();
  resolveCapture({ node: { connect() {} }, stop: () => f.stopped.push(88) });
  await swapping;
  try {
    assert.equal(f.ctx.localStream.getVideoTracks()[0], oldVideo);
    assert.equal(oldVideo.readyState, 'live');
    assert.equal(oldAudio.readyState, 'live');
    assert.ok(f.toasts.includes('erro.trocarFonteMantemAnterior'));
    assert.deepEqual(f.stopped, [88]);
  } finally {
    f.ctx.stopNativeAudioFns.forEach((stop) => stop());
  }
});
