(function (root) {
  'use strict';

  function createSpyState() {
    let currentTileId = null;
    return {
      open(tileId) {
        const action = currentTileId ? 'replace' : 'open';
        currentTileId = tileId;
        return { action, tileId };
      },
      closeFor(tileId) {
        if (currentTileId !== tileId) return false;
        currentTileId = null;
        return true;
      },
      closed(tileId) {
        return this.closeFor(tileId);
      },
      tileId: () => currentTileId,
    };
  }

  const api = { createSpyState };
  root.GoLive = root.GoLive || {};
  root.GoLive.espiar = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
