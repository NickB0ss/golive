// src/renderer/signaling.js
'use strict';

(function (root) {
  // Quanto esperar o handshake do WebSocket antes de desistir da tentativa.
  // O Chromium so desiste sozinho em ~240 s, e no Windows um host fora do ar
  // na LAN virtual so da erro quando o SYN esgota as retransmissoes (~21 s):
  // os logs de usuarios mostram cada retry da reconexao levando 22-29 s pra
  // falhar. Numa LAN virtual o handshake de verdade leva poucas centenas de
  // ms; 8 s cobre o SYN perdido + a primeira retransmissao e devolve o
  // controle pro backoff do app.js quase 3x mais cedo.
  const CONNECT_TIMEOUT_MS = 8000;

  /** Abre a conexao de sinalizacao. `opts` e so pra teste: `WebSocket`
   * injeta um socket falso (o padrao e o do navegador) e `connectTimeoutMs`
   * troca o prazo do handshake. O app.js chama so com (url, handlers). */
  function connect(url, { onOpen, onMessage, onError, onClose } = {}, opts = {}) {
    const WS = opts.WebSocket || root.WebSocket;
    const timeoutMs = Number.isFinite(opts.connectTimeoutMs) ? opts.connectTimeoutMs : CONNECT_TIMEOUT_MS;
    const ws = new WS(url);

    // close() num socket ainda CONNECTING "falha a conexao" (spec WHATWG):
    // sai error + close com 1006/wasClean=false -- exatamente o caminho que
    // o onClose do app.js ja trata como queda e manda pro retry com backoff.
    let connectTimer = setTimeout(() => {
      connectTimer = null;
      if (ws.readyState !== WS.CONNECTING) return;
      console.warn(`[signaling] sem handshake em ${timeoutMs} ms, desistindo desta tentativa`);
      ws.close();
    }, timeoutMs);
    function clearConnectTimer() {
      if (connectTimer === null) return;
      clearTimeout(connectTimer);
      connectTimer = null;
    }

    ws.addEventListener('open', () => {
      clearConnectTimer();
      if (onOpen) onOpen();
    });
    ws.addEventListener('message', (event) => {
      if (!onMessage) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return; // frame malformado, ignora
      }
      onMessage(data);
    });
    ws.addEventListener('error', () => {
      clearConnectTimer();
      if (onError) onError();
    });
    ws.addEventListener('close', (event) => {
      clearConnectTimer();
      if (onClose) onClose({ code: event.code, reason: event.reason, wasClean: event.wasClean });
    });

    return {
      send(payload) {
        if (ws.readyState === WS.OPEN) ws.send(JSON.stringify(payload));
      },
      close() {
        // Saida deliberada: o prazo do handshake nao tem mais o que vigiar.
        clearConnectTimer();
        ws.close();
      },
      isOpen() {
        return ws.readyState === WS.OPEN;
      },
    };
  }

  const api = { connect, CONNECT_TIMEOUT_MS };
  root.GoLive = root.GoLive || {};
  root.GoLive.signaling = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
