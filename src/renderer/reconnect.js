'use strict';

(function (root) {
  // Uma queda de rota VPN de 1-2 min deve se recuperar sozinha.
  // Cada tentativa pode custar ate 8 s por causa do timeout de handshake.
  const RECONNECT_CAP_MS = 15000;
  const FALLBACK_CONNECT_TIMEOUT_MS = 8000;
  const signaling = root.GoLive && root.GoLive.signaling;
  const CONNECT_TIMEOUT_MS = signaling && Number.isFinite(signaling.CONNECT_TIMEOUT_MS)
    ? signaling.CONNECT_TIMEOUT_MS
    : FALLBACK_CONNECT_TIMEOUT_MS;

  function reconnectDelayMs(attempts) {
    const index = Number.isInteger(attempts) && attempts >= 0 ? attempts : 0;
    return Math.min(1000 * 2 ** index, RECONNECT_CAP_MS);
  }

  function worstCaseReconnectMs(n, connectTimeoutMs = CONNECT_TIMEOUT_MS) {
    const count = Number.isInteger(n) && n >= 0 ? n : 0;
    const timeout = Number.isFinite(connectTimeoutMs) ? connectTimeoutMs : CONNECT_TIMEOUT_MS;
    let total = 0;
    for (let attempt = 0; attempt < count; attempt += 1) {
      total += reconnectDelayMs(attempt) + timeout;
    }
    return total;
  }

  // Com timeout de 8 s, o menor valor e 7: atrasos 1,2,4,8,15,15,15 s
  // somam 60 s; mais 7 handshakes de 8 s dao 116 s. Com 6, da 93 s.
  let MAX_RECONNECT = 0;
  while (worstCaseReconnectMs(MAX_RECONNECT, CONNECT_TIMEOUT_MS) < 110000) {
    MAX_RECONNECT += 1;
  }

  const api = {
    RECONNECT_CAP_MS,
    CONNECT_TIMEOUT_MS,
    reconnectDelayMs,
    MAX_RECONNECT,
    worstCaseReconnectMs,
  };
  root.GoLive = root.GoLive || {};
  root.GoLive.reconnect = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
