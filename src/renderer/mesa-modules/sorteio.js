// src/renderer/mesa-modules/sorteio.js
'use strict';
/* global module */

/*
 * Janela "Sorteio de times" da Mesa -- modulo PURO.
 *
 * Os nomes vem das pessoas da sala (`ctx.peers`, no `init` e na acao
 * `addPeers`) e/ou digitados. Quem entra pela sala guarda o `peerId`, para a
 * interface pintar o nome na cor da pessoa (`annotate.colorFor`).
 *
 * A sorte mora so no servidor: `prepare` embaralha os indices com
 * `ctx.random` e grava a permutacao na acao (`order`). `reduce` so reparte
 * essa ordem em times (um para cada time, em rodizio), entao todos os
 * clientes chegam aos mesmos times. "Sortear de novo" e so outro `draw`.
 *
 * Contrato: docs/superpowers/plans/2026-09-24-mesa-contrato.md (secao 1).
 */

(function (root) {
  const TYPE = 'sorteio';
  const MAX_ENTRIES = 40;
  const MAX_NAME = 40; // mesmo teto do nome de pessoa no servidor
  const MAX_PEER_ID = 16; // ids do servidor: ate 16 algarismos
  const MIN_TEAMS = 2;
  const MAX_TEAMS = 8;

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isInt(v, min, max) {
    return Number.isInteger(v) && v >= min && v <= max;
  }

  function cleanText(v, max) {
    if (typeof v !== 'string' || v.length > max * 4) return null;
    return v.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  function isPeerId(v) {
    return typeof v === 'string' && v.length > 0 && v.length <= MAX_PEER_ID;
  }

  /** Pessoas da sala (do servidor ou de uma acao ja preparada) -> entradas
   * limpas. Pessoa com id ou nome estranho e pulada, nao derruba o resto. */
  function peersToEntries(peers) {
    if (!Array.isArray(peers)) return null;
    const out = [];
    const seen = new Set();
    for (const p of peers.slice(0, MAX_ENTRIES * 2)) {
      if (!isObj(p) || !isPeerId(p.id) || seen.has(p.id)) continue;
      const name = cleanText(p.name, MAX_NAME);
      if (!name) continue;
      seen.add(p.id);
      out.push({ name: name.slice(0, MAX_NAME), peerId: p.id });
    }
    return out;
  }

  /** Quem da lista de pessoas ainda nao esta nas entradas. */
  function newcomers(state, peerEntries) {
    const have = new Set(state.entries.map((e) => e.peerId).filter((id) => id !== null));
    return peerEntries.filter((e) => !have.has(e.peerId));
  }

  function isPermutation(order, n) {
    if (!Array.isArray(order) || order.length !== n) return false;
    const seen = new Array(n).fill(false);
    for (const i of order) {
      if (!isInt(i, 0, n - 1) || seen[i]) return false;
      seen[i] = true;
    }
    return true;
  }

  /** Fisher-Yates com a sorte do servidor. `random` fora de [0, 1) e
   * tratado como 0 em vez de gerar indice fora do alcance. */
  function shuffle(n, random) {
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      let r = Number(random());
      if (!Number.isFinite(r) || r < 0 || r >= 1) r = 0;
      const j = Math.floor(r * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    return order;
  }

  function init(ctx) {
    const peers = peersToEntries(ctx && ctx.peers) || [];
    return { entries: peers.slice(0, MAX_ENTRIES), teamCount: 2, teams: null, round: 0 };
  }

  function parse(action) {
    if (!isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
    switch (action.kind) {
      case 'add': {
        const name = cleanText(action.name, MAX_NAME);
        if (name === null) return 'Nome inválido';
        if (!name) return 'O nome não pode ficar vazio';
        if (name.length > MAX_NAME) return `Nome longo demais (máx. ${MAX_NAME})`;
        return { kind: 'add', name };
      }
      case 'addPeers': {
        // `peers` so existe depois do prepare; antes, a acao e so o pedido.
        if (action.peers === undefined) return { kind: 'addPeers' };
        const peers = peersToEntries(action.peers);
        if (peers === null) return 'Lista de pessoas inválida';
        return { kind: 'addPeers', peers: peers.map((e) => ({ id: e.peerId, name: e.name })) };
      }
      case 'remove':
        if (!isInt(action.index, 0, MAX_ENTRIES - 1)) return 'Nome inválido';
        return { kind: 'remove', index: action.index };
      case 'clear':
        return { kind: 'clear' };
      case 'teams':
        if (!isInt(action.count, MIN_TEAMS, MAX_TEAMS)) return `De ${MIN_TEAMS} a ${MAX_TEAMS} times`;
        return { kind: 'teams', count: action.count };
      case 'draw':
        if (action.order === undefined) return { kind: 'draw' };
        if (!Array.isArray(action.order) || action.order.length > MAX_ENTRIES) return 'Sorteio inválido';
        return { kind: 'draw', order: action.order.slice() };
      default:
        return 'Ação desconhecida';
    }
  }

  function prepare(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return action;
    if (a.kind === 'addPeers') {
      const peers = peersToEntries(ctx && ctx.peers) || [];
      return { kind: 'addPeers', peers: peers.map((e) => ({ id: e.peerId, name: e.name })) };
    }
    if (a.kind === 'draw') {
      if (!ctx || typeof ctx.random !== 'function') return { kind: 'draw' };
      return { kind: 'draw', order: shuffle(state.entries.length, ctx.random) };
    }
    return a;
  }

  function validate(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return a;
    switch (a.kind) {
      case 'add':
        if (state.entries.length >= MAX_ENTRIES) return `A lista está cheia (máx. ${MAX_ENTRIES})`;
        return true;
      case 'addPeers': {
        // No servidor olha a sala de agora; no cliente, so a forma.
        const peers = a.peers
          ? a.peers.map((p) => ({ name: p.name, peerId: p.id }))
          : peersToEntries(ctx && ctx.peers);
        if (peers === null) return true;
        if (newcomers(state, peers).length === 0) return 'Todo mundo da sala já está na lista';
        if (state.entries.length >= MAX_ENTRIES) return `A lista está cheia (máx. ${MAX_ENTRIES})`;
        return true;
      }
      case 'remove':
        return a.index < state.entries.length ? true : 'Nome inválido';
      case 'draw':
        if (state.entries.length < 2) return 'Ponha pelo menos 2 nomes';
        if (state.entries.length < state.teamCount) return `Poucos nomes para ${state.teamCount} times`;
        if (a.order !== undefined && !isPermutation(a.order, state.entries.length)) return 'Sorteio inválido';
        return true;
      default:
        return true;
    }
  }

  function reduce(state, action) {
    const a = parse(action);
    if (typeof a === 'string') return state;
    switch (a.kind) {
      case 'add':
        if (state.entries.length >= MAX_ENTRIES) return state;
        return { ...state, entries: [...state.entries, { name: a.name, peerId: null }] };
      case 'addPeers': {
        if (!a.peers) return state;
        const extra = newcomers(state, a.peers.map((p) => ({ name: p.name, peerId: p.id })));
        const room = MAX_ENTRIES - state.entries.length;
        if (extra.length === 0 || room <= 0) return state;
        return { ...state, entries: [...state.entries, ...extra.slice(0, room)] };
      }
      case 'remove':
        if (a.index >= state.entries.length) return state;
        return { ...state, entries: state.entries.filter((_, i) => i !== a.index) };
      case 'clear':
        return { ...state, entries: [], teams: null };
      case 'teams':
        return { ...state, teamCount: a.count };
      case 'draw': {
        const n = state.entries.length;
        if (!a.order || n < 2 || n < state.teamCount || !isPermutation(a.order, n)) return state;
        const teams = Array.from({ length: state.teamCount }, () => []);
        a.order.forEach((idx, pos) => {
          const e = state.entries[idx];
          teams[pos % state.teamCount].push({ name: e.name, peerId: e.peerId });
        });
        return { ...state, teams, round: state.round + 1 };
      }
      default:
        return state;
    }
  }

  const MAX_SUMMARY = 100;

  /** "Ana, Bia × Caio, Duda" (cortado), ou "5 nomes, 2 times" antes de sortear. */
  function summary(state) {
    if (state.teams) {
      const line = state.teams.map((t) => t.map((e) => e.name).join(', ')).join(' × ');
      return line.length > MAX_SUMMARY ? `${line.slice(0, MAX_SUMMARY - 1)}…` : line;
    }
    const n = state.entries.length;
    return `${n} ${n === 1 ? 'nome' : 'nomes'}, ${state.teamCount} times`;
  }

  const api = {
    type: TYPE,
    title: 'Sorteio de times',
    group: 'noite',
    size: { w: 480, h: 420, minW: 340, minH: 300, aspect: null },
    maxStateBytes: 16384,
    MAX_ENTRIES, MAX_NAME, MAX_PEER_ID, MIN_TEAMS, MAX_TEAMS,
    init,
    prepare,
    validate,
    reduce,
    summary,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
