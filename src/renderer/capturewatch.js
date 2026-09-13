'use strict';

// Vigia so a entrega da track de captura. Eventos e relogio entram por
// parametro para a regra ser testavel sem MediaStreamTrack nem DOM.
(function (root) {
  const DEFAULTS = { muteWindowMs: 20000, muteCount: 3, continuousMuteMs: 3000, stableAfterMs: 15000 };

  function createCaptureWatch(opts = {}) {
    const muteWindowMs = opts.muteWindowMs ?? DEFAULTS.muteWindowMs;
    const muteCount = opts.muteCount ?? DEFAULTS.muteCount;
    const continuousMuteMs = opts.continuousMuteMs ?? DEFAULTS.continuousMuteMs;
    const stableAfterMs = opts.stableAfterMs ?? DEFAULTS.stableAfterMs;
    let state = 'ok';
    let mutedAt = null;
    let lastUnmuteAt = null;
    let mutes = [];

    function recentMutes(now) {
      mutes = mutes.filter((at) => now - at <= muteWindowMs);
      return mutes.length;
    }

    function becomeUnstable(now) {
      if (state === 'instavel') return null;
      state = 'instavel';
      return { state, mutes: recentMutes(now) };
    }

    function event(type, now) {
      if (type === 'mute') {
        if (mutedAt === null) {
          mutedAt = now;
          mutes.push(now);
        }
        if (recentMutes(now) >= muteCount) return becomeUnstable(now);
        return null;
      }
      if (type === 'unmute') {
        mutedAt = null;
        lastUnmuteAt = now;
      }
      return null;
    }

    function tick(now) {
      if (state === 'ok' && mutedAt !== null && now - mutedAt >= continuousMuteMs) {
        return becomeUnstable(now);
      }
      if (state === 'instavel' && mutedAt === null && lastUnmuteAt !== null && now - lastUnmuteAt >= stableAfterMs) {
        state = 'ok';
        mutes = [];
        return { state };
      }
      return null;
    }

    return { event, tick };
  }

  const api = { createCaptureWatch, DEFAULTS };
  root.GoLive = root.GoLive || {};
  root.GoLive.capturewatch = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
