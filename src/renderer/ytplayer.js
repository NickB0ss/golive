'use strict';

/*
 * Player do YouTube SEM o script do YouTube -- `GoLive.ytplayer`.
 *
 * Spec 2026-09-24-sala-em-dois-modos-design.md, secao 4.5: carregar a IFrame
 * API (www.youtube.com/iframe_api) poria codigo de terceiros na pagina que
 * enxerga `window.golive`. Entao o app faz o que a IFrame API faz, a mao: um
 * <iframe> de youtube-nocookie.com com `enablejsapi=1` e o protocolo de
 * postMessage do "widget":
 *
 *   pagina -> player  {"event":"listening","id":1,"channel":"widget"}  (repete
 *                     ate o player responder, como a IFrame API)
 *   player -> pagina  initialDelivery / onReady / infoDelivery {currentTime,
 *                     playerState, playbackRate, duration, videoData, ...} /
 *                     onStateChange / onError / onPlaybackRateChange
 *   pagina -> player  {"event":"command","func":"playVideo","args":[],...}
 *
 * Toda mensagem que chega e conferida: `event.origin` tem de ser
 * https://www.youtube-nocookie.com e `event.source` o contentWindow DESTE
 * iframe (outro iframe da mesma origem nao fala por ele).
 *
 * Atributos do iframe (medidos com o YouTube falso de tools/midia; ver
 * docs/2026-09-24-midia-na-mesa.md):
 *   sandbox="allow-scripts allow-same-origin allow-popups"
 *     - sem allow-same-origin a origem do player vira "null" e nao da para
 *       conferir quem fala; sem allow-popups o clique no logo/titulo nem
 *       chega ao setWindowOpenHandler do main (que abre no navegador).
 *   allow="autoplay; encrypted-media"
 *     - nada de camera, microfone, captura de tela ou tela cheia.
 *   referrerpolicy="strict-origin-when-cross-origin" (o YouTube exige Referer:
 *     sem ele, erro 153).
 *
 * A parte pura (URL, mensagens, relogio do player, textos de erro) e
 * testada com `node --test`; `create()` precisa de DOM.
 */

(function (root) {
  const YT_ORIGIN = 'https://www.youtube-nocookie.com';
  const SANDBOX = 'allow-scripts allow-same-origin allow-popups';
  const ALLOW = 'autoplay; encrypted-media';
  const LISTEN_MS = 250;
  const READY_TIMEOUT_MS = 15000;
  // Sem infoDelivery ha mais que isso, a posicao para de ser extrapolada.
  const MAX_EXTRAPOLATE_S = 2;
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

  const STATE_NAMES = { '-1': 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };

  // ---------- Parte pura ----------

  function embedUrl(videoId, opts) {
    if (!VIDEO_ID_RE.test(videoId || '')) throw new Error('videoId invalido');
    const o = opts || {};
    const origin = typeof o.origin === 'string' && o.origin ? o.origin : 'http://localhost';
    let url = `${YT_ORIGIN}/embed/${videoId}?enablejsapi=1&origin=${encodeURIComponent(origin)}&playsinline=1&controls=0&rel=0`;
    const start = Math.floor(Number(o.start) || 0);
    if (start > 0) url += `&start=${start}`;
    if (o.mute) url += '&mute=1';
    return url;
  }

  function listeningJson(id) {
    return JSON.stringify({ event: 'listening', id, channel: 'widget' });
  }

  function commandJson(func, args, id) {
    return JSON.stringify({ event: 'command', func, args: Array.isArray(args) ? args : [], id, channel: 'widget' });
  }

  /** Mensagem do player, ja conferida (origem e janela de quem mandou), ou null. */
  function readMessage(ev, expectedSource) {
    if (!ev || ev.origin !== YT_ORIGIN) return null;
    if (!expectedSource || ev.source !== expectedSource) return null;
    let d = ev.data;
    if (typeof d === 'string') {
      if (d.length > 65536) return null;
      try {
        d = JSON.parse(d);
      } catch {
        return null;
      }
    }
    if (!d || typeof d !== 'object' || typeof d.event !== 'string') return null;
    return d;
  }

  function stateName(code) {
    return Object.prototype.hasOwnProperty.call(STATE_NAMES, code) ? STATE_NAMES[code] : 'unknown';
  }

  /** Texto para quem esta vendo, por codigo de erro do player. */
  function errorText(code) {
    switch (code) {
      case 2: return 'Link de vídeo inválido.';
      case 5: return 'O player do YouTube não conseguiu tocar este vídeo neste PC.';
      case 100: return 'Vídeo não encontrado: foi removido ou é privado.';
      case 101:
      case 150: return 'O dono deste vídeo não deixa tocar fora do YouTube.';
      case 152:
      case 153: return 'O YouTube recusou o player deste app (erro de configuração). Atualize o GoLive; se continuar, avise.';
      case 'offline':
      case 'timeout': return 'Sem internet: o YouTube não carregou neste PC.';
      default: return 'O YouTube não conseguiu tocar este vídeo.';
    }
  }

  /** Erros que dizem respeito ao video (pular no Radio), nao ao PC. */
  function isVideoError(code) {
    return code === 2 || code === 100 || code === 101 || code === 150;
  }

  /** O que o player contou por ultimo, com a posicao extrapolada entre os
   * infoDelivery (chegam a cada ~250-500 ms). `now` em ms, monotonico. */
  function createClock() {
    const s = { time: null, at: 0, state: 'unknown', rate: 1, duration: 0, title: '', videoId: null, muted: null, volume: null };

    function apply(info, now) {
      if (!info || typeof info !== 'object') return;
      if (typeof info.playerState === 'number') s.state = stateName(info.playerState);
      if (typeof info.playbackRate === 'number' && info.playbackRate > 0) s.rate = info.playbackRate;
      if (typeof info.duration === 'number' && info.duration >= 0) s.duration = info.duration;
      if (typeof info.muted === 'boolean') s.muted = info.muted;
      if (typeof info.volume === 'number') s.volume = info.volume;
      const vd = info.videoData;
      if (vd && typeof vd === 'object') {
        if (typeof vd.title === 'string') s.title = vd.title.slice(0, 200);
        if (typeof vd.video_id === 'string' && VIDEO_ID_RE.test(vd.video_id)) s.videoId = vd.video_id;
      }
      if (typeof info.currentTime === 'number' && Number.isFinite(info.currentTime)) {
        s.time = info.currentTime;
        s.at = now;
      }
    }

    function setState(code) {
      s.state = stateName(code);
    }

    function currentTime(now) {
      if (s.time === null) return null;
      if (s.state !== 'playing') return s.time;
      const dt = Math.min(MAX_EXTRAPOLATE_S, Math.max(0, (now - s.at) / 1000));
      return s.time + dt * s.rate;
    }

    /** Depois de um seek nosso: a posicao nova vale ja (o player demora a contar). */
    function assume(time, now) {
      s.time = time;
      s.at = now;
    }

    return { apply, setState, currentTime, assume, snapshot: () => ({ ...s }) };
  }

  // ---------- Parte com DOM ----------

  /**
   * Cria o player dentro de `container`.
   * opts: { container, videoId, start?, origin?, title?, mute?,
   *         onReady(), onState(nome), onError(codigo, texto), onInfo(snapshot),
   *         win?, doc?, now?, readyTimeoutMs? }
   */
  function create(opts) {
    const o = opts || {};
    const win = o.win || root;
    const doc = o.doc || win.document;
    const now = o.now || (() => win.performance.now());
    const clock = createClock();
    const iframe = doc.createElement('iframe');
    iframe.className = 'ytp-frame';
    iframe.setAttribute('sandbox', SANDBOX);
    iframe.setAttribute('allow', ALLOW);
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    iframe.setAttribute('title', o.title || 'Player do YouTube');
    iframe.setAttribute('tabindex', '-1'); // os controles sao os do app
    iframe.src = embedUrl(o.videoId, { origin: o.origin || win.location.origin, start: o.start, mute: o.mute });
    let ready = false;
    let destroyed = false;
    let listenTimer = null;
    let failTimer = null;
    let videoId = o.videoId;
    const msgId = 1;

    function post(json) {
      if (destroyed || !iframe.contentWindow) return;
      try {
        iframe.contentWindow.postMessage(json, YT_ORIGIN);
      } catch {
        // iframe navegou para a pagina de erro (sem internet): a origem nao bate
      }
    }

    function command(func, args) {
      if (!ready) return false;
      post(commandJson(func, args, msgId));
      return true;
    }

    function fail(code) {
      if (destroyed) return;
      stopListening();
      if (typeof o.onError === 'function') o.onError(code, errorText(code));
    }

    function stopListening() {
      if (listenTimer) win.clearInterval(listenTimer);
      if (failTimer) win.clearTimeout(failTimer);
      listenTimer = null;
      failTimer = null;
    }

    function onMessage(ev) {
      const d = readMessage(ev, iframe.contentWindow);
      if (!d) return;
      const t = now();
      switch (d.event) {
        case 'initialDelivery':
        case 'onReady':
          clock.apply(d.info, t);
          if (!ready) {
            ready = true;
            stopListening();
            // A IFrame API registra os eventos que quer; sem isso o player
            // nao manda onStateChange/onError (o infoDelivery vem sempre).
            for (const name of ['onStateChange', 'onError', 'onPlaybackRateChange']) post(commandJson('addEventListener', [name], msgId));
            if (typeof o.onReady === 'function') o.onReady();
          }
          break;
        case 'infoDelivery': {
          const before = clock.snapshot().state;
          clock.apply(d.info, t);
          const after = clock.snapshot().state;
          if (after !== before && typeof o.onState === 'function') o.onState(after);
          if (typeof o.onInfo === 'function') o.onInfo(clock.snapshot());
          break;
        }
        case 'onStateChange': {
          const before = clock.snapshot().state;
          clock.setState(d.info);
          const after = clock.snapshot().state;
          if (after !== before && typeof o.onState === 'function') o.onState(after);
          break;
        }
        case 'onPlaybackRateChange':
          clock.apply({ playbackRate: d.info }, t);
          break;
        case 'onError':
          if (typeof o.onError === 'function') o.onError(d.info, errorText(d.info));
          break;
        default:
          break;
      }
    }

    win.addEventListener('message', onMessage);
    iframe.addEventListener('load', () => {
      if (!ready) post(listeningJson(msgId));
    });
    listenTimer = win.setInterval(() => post(listeningJson(msgId)), LISTEN_MS);
    failTimer = win.setTimeout(() => {
      if (!ready) fail(win.navigator && win.navigator.onLine === false ? 'offline' : 'timeout');
    }, o.readyTimeoutMs || READY_TIMEOUT_MS);
    o.container.appendChild(iframe);

    return {
      iframe,
      get ready() { return ready; },
      get videoId() { return videoId; },
      play: () => command('playVideo', []),
      pause: () => command('pauseVideo', []),
      seek: (sec) => {
        const ok = command('seekTo', [Math.max(0, sec), true]);
        if (ok) clock.assume(Math.max(0, sec), now());
        return ok;
      },
      setRate: (r) => command('setPlaybackRate', [r]),
      mute: () => command('mute', []),
      unMute: () => command('unMute', []),
      setVolume: (v) => command('setVolume', [Math.max(0, Math.min(100, Math.round(v)))]),
      load: (id, start) => {
        if (!VIDEO_ID_RE.test(id || '')) return false;
        videoId = id;
        clock.assume(Math.max(0, start || 0), now());
        return command('loadVideoById', [id, Math.max(0, start || 0)]);
      },
      currentTime: () => clock.currentTime(now()),
      playerState: () => clock.snapshot().state,
      rate: () => clock.snapshot().rate,
      duration: () => clock.snapshot().duration,
      title: () => clock.snapshot().title,
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        stopListening();
        win.removeEventListener('message', onMessage);
        iframe.remove();
      },
    };
  }

  const api = {
    YT_ORIGIN, SANDBOX, ALLOW, READY_TIMEOUT_MS,
    embedUrl, listeningJson, commandJson, readMessage, stateName, errorText, isVideoError, createClock, create,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.ytplayer = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
