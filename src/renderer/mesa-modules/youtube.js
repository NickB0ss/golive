'use strict';

/*
 * Janela "Video do YouTube" da Mesa -- modulo PURO (contrato:
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secao 1; spec
 * 2026-09-24-sala-em-dois-modos-design.md, secao 4.5).
 *
 * Cada PC toca o proprio video; a sala so guarda
 * `{ videoId, playing, pos, at, rate }`: `pos` e a posicao (s) na hora do
 * SERVIDOR `at` (ms), carimbada por `prepare`. Cada cliente acha onde o
 * video deveria estar com `positionAt(state, agoraDoServidor)` e corrige a
 * deriva do proprio player (mesa-sync-media.js). `rate` fica em 1 (reservado).
 *
 * Acoes:
 *   { kind: 'load', url | videoId }   poe um video (tocando, do `t=` do link)
 *   { kind: 'play', pos? }            volta a tocar (de `pos` ou de onde parou)
 *   { kind: 'pause', pos? }           pausa em `pos` (a do player de quem clicou)
 *   { kind: 'seek', pos }             pula; tocando continua tocando
 *   { kind: 'ended', videoId?, pos? } o video acabou (idempotente)
 */

(function (root) {
  const L = (root.GoLive && root.GoLive.mesaMidiaLinks)
    || (typeof module !== 'undefined' && typeof module.require === 'function' ? module.require('./midialinks') : null);

  const TYPE = 'youtube';

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function init() {
    return { videoId: null, playing: false, pos: 0, at: null, rate: 1 };
  }

  function optPos(action) {
    if (action.pos === undefined || action.pos === null) return { ok: true, pos: undefined };
    return L.isPos(action.pos) ? { ok: true, pos: action.pos } : { ok: false };
  }

  /** Forma da acao (ou o motivo da recusa). `at` so e lido depois do prepare. */
  function parse(action) {
    if (!isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
    const at = L.isTime(action.at) ? action.at : undefined;
    const withAt = (a) => (at === undefined ? a : { ...a, at });
    switch (action.kind) {
      case 'load': {
        const src = typeof action.videoId === 'string' ? action.videoId : action.url;
        const link = L.parseYouTube(src);
        if (!link) return 'Link do YouTube não reconhecido';
        // A acao preparada leva `videoId` + `start` (o link ja foi lido).
        const start = link.start || (L.isPos(action.start) ? Math.floor(action.start) : 0);
        return withAt({ kind: 'load', videoId: link.videoId, start });
      }
      case 'play':
      case 'pause':
      case 'seek': {
        const p = optPos(action);
        if (!p.ok) return 'Posição inválida';
        if (action.kind === 'seek' && p.pos === undefined) return 'Posição inválida';
        const a = { kind: action.kind };
        if (p.pos !== undefined) a.pos = p.pos;
        return withAt(a);
      }
      case 'ended': {
        const p = optPos(action);
        if (!p.ok) return 'Posição inválida';
        if (action.videoId !== undefined && !L.isVideoId(action.videoId)) return 'Vídeo inválido';
        const a = { kind: 'ended' };
        if (action.videoId !== undefined) a.videoId = action.videoId;
        if (p.pos !== undefined) a.pos = p.pos;
        return withAt(a);
      }
      default:
        return 'Ação desconhecida';
    }
  }

  /** So no servidor: carimba a hora do servidor (a do cliente nao vale). */
  function prepare(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return action;
    delete a.at;
    if (ctx && L.isTime(ctx.now)) a.at = ctx.now;
    return a;
  }

  function validate(state, action) {
    const a = parse(action);
    if (typeof a === 'string') return a;
    if (a.kind === 'load') return true;
    if (!state.videoId) return 'Nenhum vídeo';
    if (a.kind === 'play' && state.playing) return 'Já está tocando';
    if (a.kind === 'pause' && !state.playing) return 'Já está pausado';
    return true;
  }

  function reduce(state, action) {
    const a = parse(action);
    if (typeof a === 'string' || a.at === undefined) return state;
    switch (a.kind) {
      case 'load':
        return { videoId: a.videoId, playing: true, pos: a.start, at: a.at, rate: 1 };
      case 'play':
        if (!state.videoId || state.playing) return state;
        return { ...state, playing: true, pos: a.pos !== undefined ? a.pos : state.pos, at: a.at };
      case 'pause':
        if (!state.videoId || !state.playing) return state;
        return { ...state, playing: false, pos: a.pos !== undefined ? a.pos : L.positionAt(state, a.at), at: a.at };
      case 'seek':
        if (!state.videoId) return state;
        return { ...state, pos: a.pos, at: a.at };
      case 'ended':
        // Cada PC avisa quando o proprio player acaba: so o primeiro muda algo.
        if (!state.videoId || !state.playing) return state;
        if (a.videoId !== undefined && a.videoId !== state.videoId) return state;
        return { ...state, playing: false, pos: a.pos !== undefined ? a.pos : L.positionAt(state, a.at), at: a.at };
      default:
        return state;
    }
  }

  function summary(state, serverNow) {
    if (!state || !state.videoId) return 'Nenhum vídeo';
    const pos = L.formatPos(L.positionAt(state, serverNow));
    return state.playing ? `Tocando · ${pos}` : `Pausado · ${pos}`;
  }

  const api = {
    type: TYPE,
    title: 'Vídeo do YouTube',
    group: 'assistir',
    size: { w: 640, h: 360, minW: 320, minH: 180, aspect: 16 / 9 },
    maxStateBytes: 256,
    init,
    prepare,
    validate,
    reduce,
    summary,
    positionAt: L.positionAt,
    parseLink: L.parseYouTube,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
