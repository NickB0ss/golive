'use strict';

(function (root) {
  const STABLE_TO_RESTORE_MS = 10000;

  function createMeshFallbackQuality({ now = () => Date.now() } = {}) {
    let degraded = false;
    let stableSince = null;
    return {
      enter() {
        if (degraded) return false;
        degraded = true;
        stableSince = now();
        return true;
      },
      topologyChanged() {
        if (degraded) stableSince = now();
      },
      canRestore() {
        return degraded && stableSince != null && now() - stableSince >= STABLE_TO_RESTORE_MS;
      },
      restore() {
        if (!this.canRestore()) return false;
        degraded = false;
        stableSince = null;
        return true;
      },
      isDegraded() { return degraded; },
      remainingMs() {
        if (!degraded || stableSince == null) return 0;
        return Math.max(0, STABLE_TO_RESTORE_MS - (now() - stableSince));
      },
    };
  }

  const api = { createMeshFallbackQuality, STABLE_TO_RESTORE_MS };
  root.GoLive = root.GoLive || {};
  root.GoLive.meshfallbackquality = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
