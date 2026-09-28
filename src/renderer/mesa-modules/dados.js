// src/renderer/mesa-modules/dados.js
'use strict';

/*
 * Janela "Dados e moeda" da Mesa -- modulo PURO.
 *
 * De 1 a 6 dados de 4, 6, 8, 10, 12 ou 20 lados, e uma moeda. O resultado sai
 * do SERVIDOR: `prepare` sorteia com `ctx.random` e grava os valores na acao,
 * para ninguem "rolar de novo" em segredo e todos verem o mesmo numero.
 * `reduce` so confere os valores (inteiros dentro do dado) e guarda no
 * historico curto (os ultimos 10).
 *
 * Contrato: docs/superpowers/plans/2026-09-24-mesa-contrato.md (secao 1).
 */

(function (root) {
  const TYPE = 'dados';
  const SIDES = Object.freeze([4, 6, 8, 10, 12, 20]);
  const MIN_DICE = 1;
  const MAX_DICE = 6;
  const MAX_HISTORY = 10;
  const MAX_PEER_ID = 16; // ids do servidor: ate 16 algarismos
  const COIN = Object.freeze(['cara', 'coroa']);

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isInt(v, min, max) {
    return Number.isInteger(v) && v >= min && v <= max;
  }

  function isPeerId(v) {
    return typeof v === 'string' && v.length > 0 && v.length <= MAX_PEER_ID;
  }

  /** Inteiro em [0, n) com a sorte do servidor. Sorte fora de [0, 1) vira 0
   * em vez de dar indice fora do alcance. */
  function pick(random, n) {
    let r = Number(random());
    if (!Number.isFinite(r) || r < 0 || r >= 1) r = 0;
    return Math.floor(r * n);
  }

  function init() {
    return { count: 2, sides: 6, history: [], rolls: 0 };
  }

  function parse(action) {
    if (!isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
    const by = isPeerId(action.by) ? action.by : undefined;
    switch (action.kind) {
      case 'config':
        if (!isInt(action.count, MIN_DICE, MAX_DICE)) return `De ${MIN_DICE} a ${MAX_DICE} dados`;
        if (!SIDES.includes(action.sides)) return 'Dado inválido';
        return { kind: 'config', count: action.count, sides: action.sides };
      case 'roll': {
        const a = { kind: 'roll' };
        // `sides` e `values` so existem depois do prepare.
        if (action.values !== undefined || action.sides !== undefined) {
          if (!SIDES.includes(action.sides)) return 'Dado inválido';
          if (!Array.isArray(action.values) || action.values.length < MIN_DICE || action.values.length > MAX_DICE) {
            return 'Rolagem inválida';
          }
          if (!action.values.every((v) => isInt(v, 1, action.sides))) return 'Rolagem inválida';
          a.sides = action.sides;
          a.values = action.values.slice();
        }
        if (by !== undefined) a.by = by;
        return a;
      }
      case 'coin': {
        const a = { kind: 'coin' };
        if (action.value !== undefined) {
          if (!COIN.includes(action.value)) return 'Moeda inválida';
          a.value = action.value;
        }
        if (by !== undefined) a.by = by;
        return a;
      }
      case 'clear':
        return { kind: 'clear' };
      default:
        return 'Ação desconhecida';
    }
  }

  /** So no servidor: o resultado nasce aqui e vai pronto na acao. */
  function prepare(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return action;
    if (a.kind !== 'roll' && a.kind !== 'coin') return a;
    const out = { kind: a.kind };
    if (ctx && isPeerId(ctx.from)) out.by = ctx.from;
    if (!ctx || typeof ctx.random !== 'function') return out;
    if (a.kind === 'roll') {
      out.sides = state.sides;
      out.values = Array.from({ length: state.count }, () => 1 + pick(ctx.random, state.sides));
    } else {
      out.value = COIN[pick(ctx.random, 2)];
    }
    return out;
  }

  function validate(state, action) {
    const a = parse(action);
    return typeof a === 'string' ? a : true;
  }

  function reduce(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return state;
    const by = a.by !== undefined ? a.by : (ctx && isPeerId(ctx.from) ? ctx.from : null);
    let entry;
    switch (a.kind) {
      case 'config':
        return { ...state, count: a.count, sides: a.sides };
      case 'clear':
        return { ...state, history: [] };
      case 'roll':
        if (!a.values) return state;
        entry = { n: state.rolls + 1, kind: 'dice', by, sides: a.sides, values: a.values };
        break;
      case 'coin':
        if (!a.value) return state;
        entry = { n: state.rolls + 1, kind: 'coin', by, value: a.value };
        break;
      default:
        return state;
    }
    return { ...state, history: [...state.history, entry].slice(-MAX_HISTORY), rolls: state.rolls + 1 };
  }

  function total(entry) {
    return entry.values.reduce((s, v) => s + v, 0);
  }

  /** "2d6: 3 + 5 = 8", "1d20: 17", "Moeda: cara". */
  function describe(entry) {
    if (entry.kind === 'coin') return `Moeda: ${entry.value}`;
    const head = `${entry.values.length}d${entry.sides}`;
    if (entry.values.length === 1) return `${head}: ${entry.values[0]}`;
    return `${head}: ${entry.values.join(' + ')} = ${total(entry)}`;
  }

  function summary(state) {
    const last = state.history[state.history.length - 1];
    return last ? describe(last) : 'Nenhuma rolagem ainda';
  }

  const api = {
    type: TYPE,
    title: 'Dados e moeda',
    group: 'noite',
    size: { w: 400, h: 320, minW: 300, minH: 240, aspect: null },
    maxStateBytes: 2048,
    SIDES, MIN_DICE, MAX_DICE, MAX_HISTORY, MAX_PEER_ID,
    init,
    prepare,
    validate,
    reduce,
    summary,
    describe,
    total,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
