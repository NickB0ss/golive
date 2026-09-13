'use strict';

(function (root) {
  function createTracker() {
    return { lastNotifiedAt: new Map() };
  }

  function shouldNotify(tracker, peerId, {
    enabled,
    appFocused,
    joinedAtMs,
    nowMs,
    bootstrap = false,
    graceMs = 5000,
    cooldownMs = 30000,
  }) {
    if (bootstrap) return false;
    if (!enabled || appFocused) return false;
    if (nowMs - joinedAtMs < graceMs) return false;
    const lastNotifiedAt = tracker.lastNotifiedAt.get(peerId);
    return lastNotifiedAt === undefined || nowMs - lastNotifiedAt >= cooldownMs;
  }

  function markNotified(tracker, peerId, nowMs) {
    tracker.lastNotifiedAt.set(peerId, nowMs);
  }

  const api = { createTracker, shouldNotify, markNotified };

  root.GoLive = root.GoLive || {};
  root.GoLive.livenotify = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
