// src/renderer/mesa-modules/roleta.js
'use strict';
/* global module */

/*
 * Janela "Roleta" da Mesa -- modulo PURO.
 *
 * Opcoes digitadas; ao girar, TUDO que decide onde a roleta para sai do
 * servidor no `prepare`: a fatia sorteada (`index`), quantas voltas da antes
 * (`turns`), em que ponto da fatia o ponteiro para (`offset`, 0..1) e a hora
 * do servidor (`at`, para quem chega depois nao rever a animacao). Assim a
 * roleta gira igual em todas as telas e para no mesmo lugar. `spinAngle`
 * traduz isso no angulo final, para a interface so animar ate la.
 *
 * Mexer nas opcoes zera o giro (a geometria das fatias muda), mas o texto do
 * ultimo resultado fica em `last`.
 *
 * Contrato: docs/superpowers/plans/2026-09-24-mesa-contrato.md (secao 1).
 */

(function (root) {
  const TYPE = 'roleta';
  const MIN_SPIN_OPTIONS = 2;
  const MAX_OPTIONS = 16;
  const MAX_TEXT = 32;
  const MIN_TURNS = 3;
  const MAX_TURNS = 5;
  const MAX_PEER_ID = 16; // ids do servidor: ate 16 algarismos

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isInt(v, min, max) {
    return Number.isInteger(v) && v >= min && v <= max;
  }

  function isTime(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0;
  }

  function cleanText(v, max) {
    if (typeof v !== 'string' || v.length > max * 4) return null;
    return v.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  function isPeerId(v) {
    return typeof v === 'string' && v.length > 0 && v.length <= MAX_PEER_ID;
  }

  /** Texto de opcao -> texto limpo ou motivo. */
  function optionText(raw) {
    const t = cleanText(raw, MAX_TEXT);
    if (t === null) return { err: 'Opção inválida' };
    if (!t) return { err: 'Opção vazia' };
    if (t.length > MAX_TEXT) return { err: `Opção longa demais (máx. ${MAX_TEXT})` };
    return { text: t };
  }

  function rand01(random) {
    const r = Number(random());
    return Number.isFinite(r) && r >= 0 && r < 1 ? r : 0;
  }

  /** Angulo final em graus (sentido horario, ponteiro no topo, fatia 0
   * comecando no topo): as voltas inteiras mais o que falta para o ponto
   * `offset` da fatia `index` ficar sob o ponteiro. */
  function spinAngle(spin, optionCount) {
    const slice = 360 / optionCount;
    return spin.turns * 360 + (360 - (spin.index + spin.offset) * slice);
  }

  function init() {
    return { options: [], spin: null, spins: 0, last: null };
  }

  function parse(action) {
    if (!isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
    switch (action.kind) {
      case 'add': {
        const o = optionText(action.text);
        return o.err || { kind: 'add', text: o.text };
      }
      case 'edit': {
        if (!isInt(action.index, 0, MAX_OPTIONS - 1)) return 'Opção inválida';
        const o = optionText(action.text);
        return o.err || { kind: 'edit', index: action.index, text: o.text };
      }
      case 'remove':
        if (!isInt(action.index, 0, MAX_OPTIONS - 1)) return 'Opção inválida';
        return { kind: 'remove', index: action.index };
      case 'setOptions': {
        if (!Array.isArray(action.options) || action.options.length > MAX_OPTIONS) {
          return `Até ${MAX_OPTIONS} opções`;
        }
        const options = [];
        for (const raw of action.options) {
          const o = optionText(raw);
          if (o.err) return o.err;
          options.push(o.text);
        }
        return { kind: 'setOptions', options };
      }
      case 'spin': {
        const a = { kind: 'spin' };
        // O resultado so existe depois do prepare; antes, e so o pedido.
        if (action.index !== undefined) {
          if (!isInt(action.index, 0, MAX_OPTIONS - 1)) return 'Giro inválido';
          if (!isInt(action.turns, MIN_TURNS, MAX_TURNS)) return 'Giro inválido';
          if (typeof action.offset !== 'number' || !(action.offset >= 0 && action.offset <= 1)) return 'Giro inválido';
          a.index = action.index;
          a.turns = action.turns;
          a.offset = action.offset;
        }
        if (isTime(action.at)) a.at = action.at;
        if (isPeerId(action.by)) a.by = action.by;
        return a;
      }
      default:
        return 'Ação desconhecida';
    }
  }

  /** So no servidor: decide fatia, voltas, ponto de parada, hora e autor. */
  function prepare(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return action;
    if (a.kind !== 'spin') return a;
    const out = { kind: 'spin' };
    if (ctx && typeof ctx.random === 'function' && state.options.length > 0) {
      const n = state.options.length;
      out.index = Math.min(n - 1, Math.floor(rand01(ctx.random) * n));
      out.turns = MIN_TURNS + Math.min(MAX_TURNS - MIN_TURNS, Math.floor(rand01(ctx.random) * (MAX_TURNS - MIN_TURNS + 1)));
      // Longe das bordas, para ninguem ficar em duvida de qual fatia deu.
      out.offset = Math.round((0.15 + 0.7 * rand01(ctx.random)) * 1000) / 1000;
    }
    if (ctx && isTime(ctx.now)) out.at = ctx.now;
    if (ctx && isPeerId(ctx.from)) out.by = ctx.from;
    return out;
  }

  function validate(state, action) {
    const a = parse(action);
    if (typeof a === 'string') return a;
    switch (a.kind) {
      case 'add':
        return state.options.length >= MAX_OPTIONS ? `A roleta está cheia (máx. ${MAX_OPTIONS})` : true;
      case 'edit':
      case 'remove':
        return a.index < state.options.length ? true : 'Opção inválida';
      case 'spin':
        if (state.options.length < MIN_SPIN_OPTIONS) return `Ponha pelo menos ${MIN_SPIN_OPTIONS} opções`;
        if (a.index !== undefined && a.index >= state.options.length) return 'Giro inválido';
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
        if (state.options.length >= MAX_OPTIONS) return state;
        return { ...state, options: [...state.options, a.text], spin: null };
      case 'edit':
        if (a.index >= state.options.length) return state;
        return { ...state, options: state.options.map((o, i) => (i === a.index ? a.text : o)), spin: null };
      case 'remove':
        if (a.index >= state.options.length) return state;
        return { ...state, options: state.options.filter((_, i) => i !== a.index), spin: null };
      case 'setOptions':
        return { ...state, options: a.options, spin: null };
      case 'spin': {
        const n = state.options.length;
        if (a.index === undefined || n < MIN_SPIN_OPTIONS || a.index >= n) return state;
        const spin = {
          n: state.spins + 1,
          index: a.index,
          turns: a.turns,
          offset: a.offset,
          at: a.at === undefined ? null : a.at,
          by: a.by === undefined ? null : a.by,
        };
        return { ...state, spin, spins: spin.n, last: state.options[a.index] };
      }
      default:
        return state;
    }
  }

  function summary(state) {
    if (state.last !== null) return `Roleta: ${state.last}`;
    const n = state.options.length;
    return `${n} ${n === 1 ? 'opção' : 'opções'}, ainda não girou`;
  }

  const api = {
    type: TYPE,
    title: 'Roleta',
    group: 'noite',
    size: { w: 440, h: 520, minW: 320, minH: 380, aspect: null },
    maxStateBytes: 3072,
    MIN_SPIN_OPTIONS, MAX_OPTIONS, MAX_TEXT, MIN_TURNS, MAX_TURNS, MAX_PEER_ID,
    init,
    prepare,
    validate,
    reduce,
    summary,
    spinAngle,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
