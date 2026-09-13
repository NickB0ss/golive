'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decideAudioStrategy, wantsSeparateDiscordCapture, planSwap, shouldPauseNewScreenSender, canContinueSwap, canUseCapturedVideo, decideSwapCommit, shouldStopTemporaryCapture } = require('./sourceswap');

test('decideSwapCommit preserva a fonte antiga quando a nova captura falha', () => {
  assert.deepEqual(decideSwapCommit({ videoReady: false, audioRequested: true, audioReady: false }), {
    commitVideo: false,
    audio: 'keep',
    discardOldVideo: false,
    discardOldAudio: false,
  });
});

test('decideSwapCommit troca apenas o video quando o audio da janela falha', () => {
  assert.deepEqual(decideSwapCommit({ videoReady: true, audioRequested: true, audioReady: false }), {
    commitVideo: true,
    audio: 'disable',
    discardOldVideo: true,
    discardOldAudio: true,
  });
});

test('decideSwapCommit descarta as tracks antigas quando a nova fonte esta pronta', () => {
  assert.deepEqual(decideSwapCommit({ videoReady: true, audioRequested: true, audioReady: true }), {
    commitVideo: true,
    audio: 'replace',
    discardOldVideo: true,
    discardOldAudio: true,
  });
});

test('decideAudioStrategy nunca amplia janela sem PID para o audio do sistema', () => {
  assert.deepEqual(decideAudioStrategy({ shareSound: false }), { mode: 'none' });
  assert.deepEqual(decideAudioStrategy({ shareSound: true, isWindowSource: true, windowPid: 0 }), { mode: 'none', audioUnavailable: true });
  assert.deepEqual(decideAudioStrategy({ shareSound: true, isWindowSource: false, ownPid: 0 }), { mode: 'none', audioUnavailable: true });
  assert.deepEqual(decideAudioStrategy({ shareSound: true, isWindowSource: false, ownPid: 0, allowSystemLoopback: true }), { mode: 'system-loopback' });
  assert.deepEqual(decideAudioStrategy({ shareSound: true, isWindowSource: true, windowPid: 12 }), { mode: 'process', basePid: 12, baseExclude: false });
  assert.deepEqual(decideAudioStrategy({ shareSound: true, isWindowSource: false, ownPid: 34, includeDiscord: true }), { mode: 'process', basePid: 34, baseExclude: true });
  assert.deepEqual(decideAudioStrategy({ shareSound: true, isWindowSource: false, ownPid: 34, includeDiscord: false }), { mode: 'include-list' });
});

test('shouldPauseNewScreenSender preserva pausa em cada sender de tela novo', () => {
  assert.equal(shouldPauseNewScreenSender({ kind: 'screen', sharePaused: true, hasLocalStream: true }), true);
  assert.equal(shouldPauseNewScreenSender({ kind: 'camera', sharePaused: true, hasLocalStream: true }), false);
  assert.equal(shouldPauseNewScreenSender({ kind: 'screen', sharePaused: false, hasLocalStream: true }), false);
  assert.equal(shouldPauseNewScreenSender({ kind: 'screen', sharePaused: true, hasLocalStream: false }), false);
});

test('canContinueSwap aborta captura obsoleta, parada ou desconectada', () => {
  const session = {};
  const stream = {};
  assert.equal(canContinueSwap({ currentSession: session, session, currentStream: stream, streamAtStart: stream, activeEpoch: 7, swapEpoch: 7 }), true);
  assert.equal(canContinueSwap({ currentSession: session, session, currentStream: stream, streamAtStart: stream, activeEpoch: 8, swapEpoch: 7 }), false);
  assert.equal(canContinueSwap({ currentSession: session, session, currentStream: null, streamAtStart: stream, activeEpoch: 7, swapEpoch: 7 }), false);
  assert.equal(canContinueSwap({ currentSession: {}, session, currentStream: stream, streamAtStart: stream, activeEpoch: 7, swapEpoch: 7 }), false);
});

test('migracao no final da troca nao para a captura ja promovida', () => {
  const sessionAntesDaMigracao = {};
  const sessionMigrada = {};
  const stream = {};

  assert.equal(canContinueSwap({
    currentSession: sessionMigrada,
    session: sessionAntesDaMigracao,
    currentStream: stream,
    streamAtStart: stream,
    activeEpoch: 7,
    swapEpoch: 7,
  }), false);
  assert.equal(shouldStopTemporaryCapture({ promoted: true }), false);
});

test('canUseCapturedVideo recusa fonte fechada antes da troca', () => {
  assert.equal(canUseCapturedVideo({ readyState: 'live' }), true);
  assert.equal(canUseCapturedVideo({ readyState: 'ended' }), false);
  assert.equal(canUseCapturedVideo(null), false);
});

test('wantsSeparateDiscordCapture so soma Discord para outra janela', () => {
  assert.equal(wantsSeparateDiscordCapture({ isWindowSource: true, includeDiscord: true, discordPid: 5, basePid: 4 }), true);
  assert.equal(wantsSeparateDiscordCapture({ isWindowSource: false, includeDiscord: true, discordPid: 5, basePid: 4 }), false);
  assert.equal(wantsSeparateDiscordCapture({ isWindowSource: true, includeDiscord: true, discordPid: 4, basePid: 4 }), false);
});

test('planSwap identifica janelas e reabre overlay somente para tela', () => {
  assert.deepEqual(planSwap({ fromSourceId: 'screen:1', toSourceId: 'screen:2' }), { fromIsWindow: false, toIsWindow: false, overlayShouldReopen: true });
  assert.deepEqual(planSwap({ fromSourceId: 'screen:1', toSourceId: 'window:2' }), { fromIsWindow: false, toIsWindow: true, overlayShouldReopen: false });
  assert.deepEqual(planSwap({ fromSourceId: 'window:1', toSourceId: 'screen:2' }), { fromIsWindow: true, toIsWindow: false, overlayShouldReopen: true });
  assert.deepEqual(planSwap({ fromSourceId: 'window:1', toSourceId: 'window:2' }), { fromIsWindow: true, toIsWindow: true, overlayShouldReopen: false });
});
