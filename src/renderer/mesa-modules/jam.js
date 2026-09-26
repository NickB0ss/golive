'use strict';

/*
 * Janela "Spotify Jam" da Mesa -- modulo PURO (sem DOM, sem relogio, sem
 * sorte). Pesquisa: docs/2026-09-24-pesquisa-janelas-da-mesa.md, secao 1.2.
 *
 * Quem tem Premium cria um Jam no Spotify e cola o link aqui. A janela so
 * guarda o link e quem marcou "Entrei": a musica toca no Spotify de cada
 * um, sincronizada pelo proprio Spotify. Sem API do Spotify, sem login,
 * nada tocando dentro do app.
 *
 * O link e conferido de forma estrita (so os dois formatos que o Spotify
 * da para o Jam) e guardado na forma canonica, sem query nem fragmento:
 *   https://spotify.link/<codigo>
 *   https://open.spotify.com/socialsession/<id>
 * O processo principal confere de novo antes de abrir no navegador
 * (src/main/linksexternos.js, `linkDaMesa`).
 *
 * Contrato: docs/superpowers/plans/2026-09-24-mesa-contrato.md (secao 1).
 */

(function (root) {
  const TYPE = 'jam';
  const MAX_INPUT = 300;
  const MAX_JOINED = 24;
  const MAX_PEER_ID = 16;
  const HOST_CURTO = 'spotify.link';
  const HOST_ABERTO = 'open.spotify.com';
  const CODIGO_RE = /^[A-Za-z0-9]{5,32}$/;
  const SESSAO_RE = /^[A-Za-z0-9-]{8,64}$/;
  // open.spotify.com/intl-pt/socialsession/<id> (o prefixo de idioma cai).
  const CAMINHO_ABERTO_RE = /^\/(?:intl-[a-z]{2}(?:-[A-Za-z]{2})?\/)?socialsession\/([^/]+)\/?$/;

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isPeerId(v) {
    return typeof v === 'string' && v.length > 0 && v.length <= MAX_PEER_ID;
  }

  /** Texto colado -> link canonico do Jam, ou `null`. So `https://`, so os
   * dois hosts, sem usuario/senha/porta, sem espaco no meio. */
  function parseJamUrl(input) {
    if (typeof input !== 'string' || input.length > MAX_INPUT) return null;
    const raw = input.trim();
    if (!/^https:\/\//i.test(raw) || /[\s\p{Cc}\\]/u.test(raw)) return null;
    let u;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    if (u.hostname === HOST_CURTO) {
      const m = /^\/([^/]+)\/?$/.exec(u.pathname);
      if (!m || !CODIGO_RE.test(m[1])) return null;
      return `https://${HOST_CURTO}/${m[1]}`;
    }
    if (u.hostname === HOST_ABERTO) {
      const m = CAMINHO_ABERTO_RE.exec(u.pathname);
      if (!m || !SESSAO_RE.test(m[1])) return null;
      return `https://${HOST_ABERTO}/socialsession/${m[1]}`;
    }
    return null;
  }

  function init() {
    return { link: null, by: null, joined: [], rev: 0 };
  }

  /** Forma da acao, sem olhar o estado: a acao normalizada ou o motivo. */
  function parse(action) {
    if (!isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
    switch (action.kind) {
      case 'set': {
        const link = parseJamUrl(action.url);
        if (!link) return 'Cole o link do Jam (spotify.link/… ou open.spotify.com/socialsession/…)';
        return { kind: 'set', url: link };
      }
      case 'clear':
      case 'join':
      case 'leave':
        return { kind: action.kind };
      default:
        return 'Ação desconhecida';
    }
  }

  function validate(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return a;
    const from = ctx && isPeerId(ctx.from) ? ctx.from : null;
    switch (a.kind) {
      case 'set':
        if (a.url === state.link) return 'Este Jam já está na janela';
        return true;
      case 'clear':
        return state.link ? true : 'Não há Jam para tirar';
      case 'join':
        if (!state.link) return 'Ainda não tem Jam';
        if (from !== null && state.joined.includes(from)) return 'Você já está na lista';
        if (state.joined.length >= MAX_JOINED) return 'A lista está cheia';
        return true;
      case 'leave':
        if (from !== null && !state.joined.includes(from)) return 'Você não está na lista';
        return true;
      default:
        return 'Ação desconhecida';
    }
  }

  function reduce(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return state;
    const from = ctx && ctx.from != null && isPeerId(String(ctx.from)) ? String(ctx.from) : null;
    switch (a.kind) {
      case 'set':
        // Jam novo: a lista de quem entrou recomeca, com quem colou nela.
        return { link: a.url, by: from, joined: from ? [from] : [], rev: state.rev + 1 };
      case 'clear':
        return { link: null, by: null, joined: [], rev: state.rev + 1 };
      case 'join':
        if (!state.link || from === null || state.joined.includes(from) || state.joined.length >= MAX_JOINED) return state;
        return { ...state, joined: [...state.joined, from], rev: state.rev + 1 };
      case 'leave':
        if (from === null || !state.joined.includes(from)) return state;
        return { ...state, joined: state.joined.filter((id) => id !== from), rev: state.rev + 1 };
      default:
        return state;
    }
  }

  /** Quem saiu da sala sai da lista (contrato, secao 8). */
  function dropPeer(state, peerId) {
    const id = String(peerId);
    if (!state.joined.includes(id)) return state;
    return { ...state, joined: state.joined.filter((x) => x !== id), rev: state.rev + 1 };
  }

  function summary(state) {
    if (!state.link) return 'Nenhum Jam ainda';
    const n = state.joined.length;
    return n === 0 ? 'Jam aberto' : `Jam aberto · ${n} ${n === 1 ? 'pessoa entrou' : 'pessoas entraram'}`;
  }

  const api = {
    type: TYPE,
    title: 'Spotify Jam',
    group: 'assistir',
    size: { w: 360, h: 280, minW: 260, minH: 200, aspect: null },
    // link (~90) + 24 ids de 16 + envelope: 1 KB sobra.
    maxStateBytes: 1024,
    MAX_INPUT, MAX_JOINED, HOST_CURTO, HOST_ABERTO,
    parseJamUrl,
    init,
    validate,
    reduce,
    dropPeer,
    summary,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
