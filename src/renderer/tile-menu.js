'use strict';

(function (root) {
  function menuItems({ id, kind, watched, mesa }) {
    const items = ['volume'];
    if (watched) items.push('espiar');
    if (kind === 'screen' && id !== 'me') items.push('qualidade');
    if (!mesa && watched) items.push('parar');
    return items;
  }

  function qualityLabel(id) {
    const labels = {
      auto: 'Auto',
      '1080p': '1080p',
      '720p': '720p',
      '480p': '480p',
    };
    return labels[id] || id;
  }

  function positionPopover({ x, y, width, height, viewportWidth, viewportHeight, gap = 8 }) {
    return {
      x: Math.max(gap, Math.min(x, viewportWidth - width - gap)),
      y: Math.max(gap, Math.min(y, viewportHeight - height - gap)),
    };
  }

  const api = { menuItems, positionPopover, qualityLabel };
  root.GoLive = root.GoLive || {};
  root.GoLive.tileMenu = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
