'use strict';

(function (root) {
  // Fonte unica para mesh.js e app.js: a histerese precisa sempre exceder a
  // carencia de desconexao, senao uma reeleicao troca relay antes do ICE ter
  // a chance de se recuperar sozinho.
  const DISCONNECT_GRACE_MS = 15000;
  const REELECTION_HYSTERESIS_MS = DISCONNECT_GRACE_MS + 3000;

  const api = { DISCONNECT_GRACE_MS, REELECTION_HYSTERESIS_MS };
  root.GoLive = root.GoLive || {};
  root.GoLive.networktiming = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
