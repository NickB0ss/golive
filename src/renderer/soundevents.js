// src/renderer/soundevents.js
'use strict';

(function (root) {
  const CHAT_SOUND_MIN_GAP_MS = 2000;

  // Traduz somente transicoes reais em nomes de som. Estado repetido e
  // retomada nao sao acontecimentos novos e, portanto, nao devem avisar.
  function soundForEvent(event, context = {}) {
    if (event === 'join') return context.reconnectWithOrphan ? null : 'entrou';
    if (event === 'leave') return 'saiu';
    if (event === 'chat') return context.isMine ? null : 'chat';
    if (event === 'moderated') return context.action === 'stop-share' ? 'interrompido' : 'removido';
    if (event === 'broadcast-state') {
      if (context.bootstrap) return null;
      if (context.live && !context.wasLive) return 'ao vivo';
      if (!context.live && context.wasLive) return 'parou';
    }
    return null;
  }

  // A decisao fica pura para ser coberta sem AudioContext ou janela real.
  function shouldPlay(name, state = {}) {
    if (!state.enabled) return { play: false, reason: 'sons desligados' };
    if (name !== 'chat') return { play: true, reason: 'pronto' };
    if (state.hasFocus) return { play: false, reason: 'janela em foco' };
    if (state.now - state.lastChatAt < CHAT_SOUND_MIN_GAP_MS) {
      return { play: false, reason: 'intervalo mínimo de chat' };
    }
    return { play: true, reason: 'pronto' };
  }

  const api = { CHAT_SOUND_MIN_GAP_MS, soundForEvent, shouldPlay };
  root.GoLive = root.GoLive || {};
  root.GoLive.soundevents = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
