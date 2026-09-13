'use strict';

(function (root) {
  function decideAudioStrategy({ shareSound, isWindowSource, includeDiscord, windowPid, ownPid, allowSystemLoopback = false }) {
    if (!shareSound) return { mode: 'none' };
    // Falha da captura por processo nao pode vazar para o sistema inteiro.
    if ((isWindowSource && !windowPid) || (!isWindowSource && !ownPid)) {
      return allowSystemLoopback && !isWindowSource ? { mode: 'system-loopback' } : { mode: 'none', audioUnavailable: true };
    }
    if (isWindowSource) return { mode: 'process', basePid: windowPid, baseExclude: false };
    if (includeDiscord) return { mode: 'process', basePid: ownPid, baseExclude: true };
    return { mode: 'include-list' };
  }

  function wantsSeparateDiscordCapture({ isWindowSource, includeDiscord, discordPid, basePid }) {
    return Boolean(isWindowSource && includeDiscord && discordPid && discordPid !== basePid);
  }

  function planSwap({ fromSourceId, toSourceId }) {
    const fromIsWindow = fromSourceId.startsWith('window:');
    const toIsWindow = toSourceId.startsWith('window:');
    return { fromIsWindow, toIsWindow, overlayShouldReopen: !toIsWindow };
  }

  function shouldPauseNewScreenSender({ kind, sharePaused, hasLocalStream }) {
    return kind === 'screen' && sharePaused && hasLocalStream;
  }

  function canContinueSwap({ currentSession, session, currentStream, streamAtStart, activeEpoch, swapEpoch }) {
    return currentSession === session
      && currentStream === streamAtStart
      && activeEpoch === swapEpoch;
  }

  function canUseCapturedVideo(track) {
    return Boolean(track && track.readyState !== 'ended');
  }

  // Depois do commit, a captura pertence a transmissao atual. Um abort da
  // troca pode limpar so recursos que ainda nao foram promovidos.
  function shouldStopTemporaryCapture({ promoted }) {
    return promoted !== true;
  }

  // Decide o commit sem tocar em MediaStream: ate a captura nova estar pronta,
  // a fonte antiga continua sendo a unica que pode ser descartada depois.
  function decideSwapCommit({ videoReady, audioRequested, audioReady }) {
    if (!videoReady) {
      return { commitVideo: false, audio: 'keep', discardOldVideo: false, discardOldAudio: false };
    }
    if (!audioRequested || audioReady) {
      return { commitVideo: true, audio: audioRequested ? 'replace' : 'keep', discardOldVideo: true, discardOldAudio: audioRequested };
    }
    return { commitVideo: true, audio: 'disable', discardOldVideo: true, discardOldAudio: true };
  }

  const api = { decideAudioStrategy, wantsSeparateDiscordCapture, planSwap, shouldPauseNewScreenSender, canContinueSwap, canUseCapturedVideo, shouldStopTemporaryCapture, decideSwapCommit };

  root.GoLive = root.GoLive || {};
  root.GoLive.sourceswap = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
