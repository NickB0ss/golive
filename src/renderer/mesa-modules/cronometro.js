// src/renderer/mesa-modules/cronometro.js
'use strict';

/*
 * Janela "Cronometro" da Mesa -- modulo PURO.
 *
 * Regressivo ("pausa de 5 min") ou progressivo. O estado nao guarda o tempo
 * que falta: guarda `elapsed` (tempo ja corrido ate a ultima pausa) e, quando
 * esta correndo, `startedAt` -- a hora do SERVIDOR em que voltou a correr,
 * posta na acao por `prepare`. Cada cliente calcula o que mostrar com
 * `remaining(state, agoraDoServidor)`, usando o relogio da sala (mensagem
 * `time`). Assim ninguem precisa de mensagem por segundo e todos veem o mesmo
 * numero, e `reduce` nunca le relogio: so a hora que veio na acao.
 *
 * Contrato: docs/superpowers/plans/2026-09-24-mesa-contrato.md (secao 1).
 */

(function (root) {
  const TYPE = 'cronometro';
  const MIN_DURATION = 1000;
  const MAX_MS = 24 * 60 * 60 * 1000; // 24 h: teto de duracao e de ajuste
  const DEFAULT_DURATION = 5 * 60 * 1000;
  const MAX_LABEL = 40;
  const MODES = ['down', 'up'];

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

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  // ---------- Leitura do tempo (pura; o `now` e o do servidor) ----------

  /** Tempo corrido em ms na hora `serverNow`. No regressivo para na duracao. */
  function elapsedAt(state, serverNow) {
    let ms = state.elapsed;
    if (state.running && isTime(state.startedAt) && isTime(serverNow)) {
      ms += Math.max(0, serverNow - state.startedAt);
    }
    return state.mode === 'down' ? clamp(ms, 0, state.duration) : clamp(ms, 0, MAX_MS);
  }

  /** Quanto falta em ms (regressivo). No progressivo nao ha fim: null. */
  function remaining(state, serverNow) {
    if (state.mode !== 'down') return null;
    return Math.max(0, state.duration - elapsedAt(state, serverNow));
  }

  /** O numero que a janela mostra: o que falta (regressivo) ou o corrido. */
  function displayMs(state, serverNow) {
    return state.mode === 'down' ? remaining(state, serverNow) : elapsedAt(state, serverNow);
  }

  function isFinished(state, serverNow) {
    return state.mode === 'down' && remaining(state, serverNow) === 0;
  }

  /** "04:32" ou "1:04:32". Regressivo arredonda para cima: 00:00 so no fim. */
  function formatMs(ms, roundUp) {
    const total = roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return h > 0 ? `${h}:${mmss}` : mmss;
  }

  // ---------- Modulo ----------

  function init() {
    return {
      mode: 'down',
      duration: DEFAULT_DURATION,
      elapsed: 0,
      running: false,
      startedAt: null,
      label: '',
    };
  }

  /** Forma da acao. `at` so e lido nas que o `prepare` carimba. */
  function parse(action) {
    if (!isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
    switch (action.kind) {
      case 'start':
      case 'pause':
        return isTime(action.at) ? { kind: action.kind, at: action.at } : { kind: action.kind };
      case 'reset':
        return { kind: 'reset' };
      case 'set': {
        if (!MODES.includes(action.mode)) return 'Modo inválido';
        if (action.duration === undefined && action.mode === 'up') return { kind: 'set', mode: 'up' };
        if (!isInt(action.duration, MIN_DURATION, MAX_MS)) return 'Duração de 1 s a 24 h';
        return { kind: 'set', mode: action.mode, duration: action.duration };
      }
      case 'adjust': {
        if (!isInt(action.delta, -MAX_MS, MAX_MS) || action.delta === 0) return 'Ajuste inválido';
        const a = { kind: 'adjust', delta: action.delta };
        if (isTime(action.at)) a.at = action.at;
        return a;
      }
      case 'label': {
        const text = cleanText(action.text, MAX_LABEL);
        if (text === null) return 'Texto inválido';
        if (text.length > MAX_LABEL) return `Texto longo demais (máx. ${MAX_LABEL})`;
        return { kind: 'label', text };
      }
      default:
        return 'Ação desconhecida';
    }
  }

  /** So no servidor: carimba a hora do servidor em quem depende dela. */
  function prepare(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return action;
    if (a.kind === 'start' || a.kind === 'pause' || a.kind === 'adjust') {
      const now = ctx && ctx.now;
      if (isTime(now)) return { ...a, at: now };
      delete a.at; // hora que o cliente mandou nao vale
    }
    return a;
  }

  function validate(state, action) {
    const a = parse(action);
    if (typeof a === 'string') return a;
    if (a.kind === 'start' && state.running) return 'Já está correndo';
    if (a.kind === 'pause' && !state.running) return 'Já está parado';
    if (a.kind === 'set' && state.running) return 'Pause antes de mudar';
    return true;
  }

  function reduce(state, action) {
    const a = parse(action);
    if (typeof a === 'string') return state;
    switch (a.kind) {
      case 'start': {
        if (state.running || a.at === undefined) return state;
        // Regressivo que ja acabou: iniciar de novo recomeca do zero.
        const elapsed = state.mode === 'down' && state.elapsed >= state.duration ? 0 : state.elapsed;
        return { ...state, elapsed, running: true, startedAt: a.at };
      }
      case 'pause':
        if (!state.running || a.at === undefined) return state;
        return { ...state, elapsed: elapsedAt(state, a.at), running: false, startedAt: null };
      case 'reset':
        return { ...state, elapsed: 0, running: false, startedAt: null };
      case 'set':
        if (state.running) return state;
        return {
          ...state,
          mode: a.mode,
          duration: a.duration === undefined ? state.duration : a.duration,
          elapsed: 0,
          startedAt: null,
        };
      case 'adjust': {
        if (state.mode === 'down') {
          // Regressivo: mexe na duracao ("+1 min"); o corrido fica.
          return { ...state, duration: clamp(state.duration + a.delta, MIN_DURATION, MAX_MS) };
        }
        // Progressivo: mexe no corrido. Correndo, dobra o trecho ate `at`
        // para o ajuste valer sobre o total e nao so sobre a parte parada.
        if (state.running) {
          if (a.at === undefined) return state;
          return { ...state, elapsed: clamp(elapsedAt(state, a.at) + a.delta, 0, MAX_MS), startedAt: a.at };
        }
        return { ...state, elapsed: clamp(state.elapsed + a.delta, 0, MAX_MS) };
      }
      case 'label':
        return { ...state, label: a.text };
      default:
        return state;
    }
  }

  /** "Pausa · 04:32 (pausado)". Sem `serverNow`, correndo diz so "correndo". */
  function summary(state, serverNow) {
    const prefix = state.label ? `${state.label} · ` : '';
    const down = state.mode === 'down';
    if (state.running && !isTime(serverNow)) {
      return `${prefix}${down ? 'regressivo' : 'progressivo'} correndo`;
    }
    if (isFinished(state, serverNow)) return `${prefix}tempo esgotado`;
    const shown = formatMs(displayMs(state, serverNow), down);
    if (state.running) return `${prefix}${shown}`;
    return `${prefix}${shown} (${state.elapsed > 0 ? 'pausado' : 'parado'})`;
  }

  const api = {
    type: TYPE,
    title: 'Cronômetro',
    group: 'noite',
    size: { w: 360, h: 220, minW: 260, minH: 160, aspect: null },
    maxStateBytes: 512,
    MIN_DURATION, MAX_MS, MAX_LABEL, DEFAULT_DURATION,
    init,
    prepare,
    validate,
    reduce,
    summary,
    elapsedAt,
    remaining,
    displayMs,
    isFinished,
    formatMs,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
