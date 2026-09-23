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

  // Vigia de vida da sinalizacao depois de aberta. O servidor manda um
  // `{type:'hb'}` a cada 5 s pra quem esta na sala (signaling-core.js,
  // `livenessMs`); 15 s sem NENHUMA mensagem = tres hb perdidos seguidos, e
  // a conexao e dada como morta. Antes disso o cliente so sabia pelo close
  // do navegador, que numa rede que sumiu sem FIN chega em ~25 s ou mais
  // (log de 21/09: o vigia de congelamento pediu reoferta por um socket que
  // ja estava morto).
  const SILENCE_TIMEOUT_MS = 15000;

  /** Abre a conexao de sinalizacao. `opts` e so pra teste: `WebSocket`
   * injeta um socket falso (o padrao e o do navegador), `connectTimeoutMs`
   * troca o prazo do handshake e `silenceTimeoutMs` o do vigia de vida. O
   * app.js chama so com (url, handlers). */
  function connect(url, { onOpen, onMessage, onError, onClose } = {}, opts = {}) {
    const WS = opts.WebSocket || root.WebSocket;
    const timeoutMs = Number.isFinite(opts.connectTimeoutMs) ? opts.connectTimeoutMs : CONNECT_TIMEOUT_MS;
    const silenceMs = Number.isFinite(opts.silenceTimeoutMs) ? opts.silenceTimeoutMs : SILENCE_TIMEOUT_MS;
    const ws = new WS(url);
    // Depois que o vigia de silencio declarou a conexao morta, o que o
    // socket ainda disser (o close de verdade, que pode levar ate um minuto
    // numa rede morta) ja foi respondido -- o app.js nao pode ver duas quedas.
    let abandoned = false;

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

    let silenceTimer = null;
    function clearSilenceTimer() {
      if (silenceTimer === null) return;
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    // Rearmado a cada mensagem. Quando estoura, a queda e entregue NA HORA,
    // como 1006 nao limpo (o mesmo ramo de reconexao de uma queda de rede no
    // app.js): o `ws.close()` de um socket aberto espera o handshake de
    // close, que numa rede morta nunca volta e o Chromium so desiste depois
    // de ate 60 s.
    function armSilenceTimer() {
      clearSilenceTimer();
      silenceTimer = setTimeout(() => {
        silenceTimer = null;
        if (ws.readyState !== WS.OPEN) return;
        console.warn(`[signaling] sem nenhuma mensagem em ${silenceMs} ms, dando a conexao como morta`);
        abandoned = true;
        try { ws.close(); } catch { /* ja fechando */ }
        if (onClose) onClose({ code: 1006, reason: 'silence', wasClean: false });
      }, silenceMs);
    }

    ws.addEventListener('open', () => {
      if (abandoned) return;
      clearConnectTimer();
      armSilenceTimer();
      if (onOpen) onOpen();
    });
    ws.addEventListener('message', (event) => {
      if (abandoned) return;
      armSilenceTimer();
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return; // frame malformado, ignora
      }
      // O hb so existe pra rearmar o vigia acima; o app.js nao precisa ver.
      if (data?.type === 'hb') return;
      if (onMessage) onMessage(data);
    });
    ws.addEventListener('error', () => {
      if (abandoned) return;
      clearConnectTimer();
      if (onError) onError();
    });
    ws.addEventListener('close', (event) => {
      clearConnectTimer();
      clearSilenceTimer();
      if (abandoned) return;
      if (onClose) onClose({ code: event.code, reason: event.reason, wasClean: event.wasClean });
    });

    return {
      send(payload) {
        if (ws.readyState === WS.OPEN) ws.send(JSON.stringify(payload));
      },
      close() {
        // Saida deliberada: nem o prazo do handshake nem o vigia de vida tem
        // mais o que vigiar.
        clearConnectTimer();
        clearSilenceTimer();
        ws.close();
      },
      isOpen() {
        return !abandoned && ws.readyState === WS.OPEN;
      },
    };
  }

  const api = { connect, CONNECT_TIMEOUT_MS, SILENCE_TIMEOUT_MS };
  root.GoLive = root.GoLive || {};
  root.GoLive.signaling = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
