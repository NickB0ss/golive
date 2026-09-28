// src/renderer/mesa-modules/placar.js
'use strict';

/*
 * Janela "Placar" da Mesa -- modulo PURO (sem DOM, sem relogio, sem sorte).
 *
 * Dois a quatro times com nome editavel, +1/-1 (nunca negativo), zerar e um
 * "melhor de N" opcional. Tudo que chega aqui veio da rede: `validate` recusa
 * com um motivo curto e `reduce` repete as checagens de FORMA (nao as de
 * permissao) para nunca lancar nem gravar lixo, mesmo chamado sem validate.
 *
 * Contrato: docs/superpowers/plans/2026-09-24-mesa-contrato.md (secao 1).
 */

(function (root) {
  const TYPE = 'placar';
  const MIN_TEAMS = 2;
  const MAX_TEAMS = 4;
  const MAX_NAME = 24;
  const MAX_SCORE = 999;
  // "Melhor de N": N impar, de 3 a 21. null = sem serie, so contagem.
  const MIN_BEST_OF = 3;
  const MAX_BEST_OF = 21;
  const DEFAULT_NAMES = ['Azul', 'Vermelho', 'Verde', 'Amarelo'];

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isInt(v, min, max) {
    return Number.isInteger(v) && v >= min && v <= max;
  }

  /** Texto de rede -> texto de uma linha, sem caractere de controle. O teto
   * bruto corta antes da regex para uma string enorme nao custar nada. */
  function cleanText(v, max) {
    if (typeof v !== 'string' || v.length > max * 4) return null;
    return v.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  function isBestOf(n) {
    return n === null || (isInt(n, MIN_BEST_OF, MAX_BEST_OF) && n % 2 === 1);
  }

  /** Vitorias que fecham a serie (melhor de 3 -> 2). */
  function target(bestOf) {
    return bestOf === null ? null : Math.floor(bestOf / 2) + 1;
  }

  /** Indice do time que ja fechou a serie, ou -1. */
  function winner(state) {
    const goal = target(state.bestOf);
    if (goal === null) return -1;
    return state.teams.findIndex((t) => t.score >= goal);
  }

  function init() {
    return {
      teams: [
        { name: DEFAULT_NAMES[0], score: 0 },
        { name: DEFAULT_NAMES[1], score: 0 },
      ],
      bestOf: null,
    };
  }

  /** Forma da acao, sem olhar o estado. Devolve a acao normalizada ou o motivo. */
  function parse(action) {
    if (!isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
    switch (action.kind) {
      case 'score':
        if (!isInt(action.team, 0, MAX_TEAMS - 1)) return 'Time inválido';
        if (action.delta !== 1 && action.delta !== -1) return 'Só dá para somar 1 ou tirar 1';
        return { kind: 'score', team: action.team, delta: action.delta };
      case 'rename': {
        if (!isInt(action.team, 0, MAX_TEAMS - 1)) return 'Time inválido';
        const name = cleanText(action.name, MAX_NAME);
        if (name === null) return 'Nome inválido';
        if (!name) return 'O nome não pode ficar vazio';
        if (name.length > MAX_NAME) return `Nome longo demais (máx. ${MAX_NAME})`;
        return { kind: 'rename', team: action.team, name };
      }
      case 'reset':
        return { kind: 'reset' };
      case 'teams':
        if (!isInt(action.count, MIN_TEAMS, MAX_TEAMS)) return `De ${MIN_TEAMS} a ${MAX_TEAMS} times`;
        return { kind: 'teams', count: action.count };
      case 'bestOf':
        if (!isBestOf(action.n)) return `Melhor de N: número ímpar de ${MIN_BEST_OF} a ${MAX_BEST_OF}`;
        return { kind: 'bestOf', n: action.n };
      default:
        return 'Ação desconhecida';
    }
  }

  function validate(state, action) {
    const a = parse(action);
    if (typeof a === 'string') return a;
    if ((a.kind === 'score' || a.kind === 'rename') && a.team >= state.teams.length) return 'Time inválido';
    if (a.kind === 'score') {
      const score = state.teams[a.team].score;
      if (a.delta < 0 && score <= 0) return 'O placar não fica negativo';
      if (a.delta > 0 && score >= MAX_SCORE) return 'Placar no máximo';
      if (a.delta > 0 && winner(state) !== -1) return 'A série acabou; zere para recomeçar';
    }
    return true;
  }

  function reduce(state, action) {
    const a = parse(action);
    if (typeof a === 'string') return state;
    switch (a.kind) {
      case 'score': {
        if (a.team >= state.teams.length) return state;
        if (a.delta > 0 && winner(state) !== -1) return state;
        const cur = state.teams[a.team].score;
        const score = Math.min(MAX_SCORE, Math.max(0, cur + a.delta));
        if (score === cur) return state;
        const teams = state.teams.map((t, i) => (i === a.team ? { ...t, score } : t));
        return { ...state, teams };
      }
      case 'rename': {
        if (a.team >= state.teams.length) return state;
        const teams = state.teams.map((t, i) => (i === a.team ? { ...t, name: a.name } : t));
        return { ...state, teams };
      }
      case 'reset':
        return { ...state, teams: state.teams.map((t) => ({ ...t, score: 0 })) };
      case 'teams': {
        const teams = state.teams.slice(0, a.count);
        for (let i = teams.length; i < a.count; i++) teams.push({ name: DEFAULT_NAMES[i], score: 0 });
        return { ...state, teams };
      }
      case 'bestOf':
        return { ...state, bestOf: a.n };
      default:
        return state;
    }
  }

  /** "Azul 2 × 1 Vermelho"; com 3 ou 4 times, "Azul 2 · Vermelho 1 · Verde 0". */
  function summary(state) {
    const t = state.teams;
    const line = t.length === 2
      ? `${t[0].name} ${t[0].score} × ${t[1].score} ${t[1].name}`
      : t.map((x) => `${x.name} ${x.score}`).join(' · ');
    const w = winner(state);
    if (w !== -1) return `${line} — ${t[w].name} venceu`;
    return state.bestOf === null ? line : `${line} (melhor de ${state.bestOf})`;
  }

  const api = {
    type: TYPE,
    title: 'Placar',
    group: 'noite',
    size: { w: 420, h: 240, minW: 300, minH: 180, aspect: null },
    maxStateBytes: 1024,
    MIN_TEAMS, MAX_TEAMS, MAX_NAME, MAX_SCORE, MIN_BEST_OF, MAX_BEST_OF,
    init,
    validate,
    reduce,
    summary,
    winner,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
