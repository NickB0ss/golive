// src/renderer/mesa-modules/enquete.js
'use strict';

/*
 * Janela "Enquete" da Mesa -- modulo PURO.
 *
 * Uma pergunta, de 2 a 6 opcoes, um voto por pessoa (trocar pode, tirar o
 * voto tambem). Quem criou a janela ou o lider edita, encerra e zera; editar
 * so enquanto ninguem votou, para um voto nunca mudar de significado.
 *
 * O voto e de quem MANDOU a acao. O servidor sabe quem foi (`ctx.from`) e o
 * `prepare` grava isso em `action.by`; `reduce` le de la (e so cai no
 * `ctx.from` se a acao veio sem). Um cliente que mande `by` de outra pessoa
 * tem o campo sobrescrito no `prepare`.
 *
 * Os votos sao uma lista `[{ by, option }]` e nao um objeto por id, para um
 * id qualquer vindo da rede nunca virar chave de objeto.
 *
 * Contrato: docs/superpowers/plans/2026-09-24-mesa-contrato.md (secao 1).
 */

(function (root) {
  const TYPE = 'enquete';
  const MAX_QUESTION = 120;
  const MAX_OPTION = 40;
  const MIN_OPTIONS = 2;
  const MAX_OPTIONS = 6;
  const MAX_VOTERS = 64;
  const MAX_PEER_ID = 16; // ids do servidor: ate 16 algarismos
  const DEFAULT_OPTIONS = ['Sim', 'Não'];

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

  function voteOf(state, by) {
    const v = state.votes.find((x) => x.by === by);
    return v ? v.option : null;
  }

  /** Votos por opcao, na ordem das opcoes. */
  function tally(state) {
    const counts = state.options.map(() => 0);
    for (const v of state.votes) if (v.option < counts.length) counts[v.option]++;
    return counts;
  }

  function canManage(state, ctx) {
    if (!ctx) return false;
    if (ctx.isLeader === true) return true;
    return state.createdBy === null || (isPeerId(ctx.from) && ctx.from === state.createdBy);
  }

  function init(ctx) {
    const by = ctx && isPeerId(ctx.by) ? ctx.by : null;
    return { question: '', options: DEFAULT_OPTIONS.slice(), votes: [], closed: false, createdBy: by };
  }

  function parse(action) {
    if (!isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
    switch (action.kind) {
      case 'edit': {
        const question = cleanText(action.question, MAX_QUESTION);
        if (question === null) return 'Pergunta inválida';
        if (!question) return 'A pergunta não pode ficar vazia';
        if (question.length > MAX_QUESTION) return `Pergunta longa demais (máx. ${MAX_QUESTION})`;
        if (!Array.isArray(action.options)) return 'Opções inválidas';
        if (action.options.length < MIN_OPTIONS || action.options.length > MAX_OPTIONS) {
          return `De ${MIN_OPTIONS} a ${MAX_OPTIONS} opções`;
        }
        const options = [];
        for (const raw of action.options) {
          const o = cleanText(raw, MAX_OPTION);
          if (o === null) return 'Opção inválida';
          if (!o) return 'Opção vazia';
          if (o.length > MAX_OPTION) return `Opção longa demais (máx. ${MAX_OPTION})`;
          options.push(o);
        }
        const lower = options.map((o) => o.toLowerCase());
        if (new Set(lower).size !== lower.length) return 'Opções repetidas';
        return { kind: 'edit', question, options };
      }
      case 'vote': {
        if (!isInt(action.option, 0, MAX_OPTIONS - 1)) return 'Opção inválida';
        const a = { kind: 'vote', option: action.option };
        if (isPeerId(action.by)) a.by = action.by;
        return a;
      }
      case 'unvote':
        return isPeerId(action.by) ? { kind: 'unvote', by: action.by } : { kind: 'unvote' };
      case 'close':
        return { kind: 'close' };
      case 'reset':
        return { kind: 'reset' };
      default:
        return 'Ação desconhecida';
    }
  }

  /** So no servidor: grava quem votou. O `by` do cliente nao vale. */
  function prepare(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return action;
    if (a.kind === 'vote' || a.kind === 'unvote') {
      delete a.by;
      if (ctx && isPeerId(ctx.from)) a.by = ctx.from;
    }
    return a;
  }

  function validate(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return a;
    const from = ctx && isPeerId(ctx.from) ? ctx.from : null;
    switch (a.kind) {
      case 'edit':
        if (!canManage(state, ctx)) return 'Só quem criou ou o líder';
        if (state.closed) return 'A enquete foi encerrada';
        if (state.votes.length > 0) return 'Já tem voto; zere para editar';
        return true;
      case 'vote': {
        if (state.closed) return 'A enquete foi encerrada';
        if (!state.question) return 'A enquete ainda não tem pergunta';
        if (a.option >= state.options.length) return 'Opção inválida';
        const mine = from === null ? null : voteOf(state, from);
        if (mine === a.option) return 'Você já votou nessa opção';
        if (mine === null && state.votes.length >= MAX_VOTERS) return 'Votos demais';
        return true;
      }
      case 'unvote':
        if (state.closed) return 'A enquete foi encerrada';
        if (from !== null && voteOf(state, from) === null) return 'Você não votou';
        return true;
      case 'close':
        if (!canManage(state, ctx)) return 'Só quem criou ou o líder';
        if (state.closed) return 'A enquete já foi encerrada';
        return true;
      case 'reset':
        if (!canManage(state, ctx)) return 'Só quem criou ou o líder';
        return true;
      default:
        return true;
    }
  }

  function reduce(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return state;
    const by = a.by !== undefined ? a.by : (ctx && isPeerId(ctx.from) ? ctx.from : null);
    switch (a.kind) {
      case 'edit':
        if (state.closed || state.votes.length > 0) return state;
        return { ...state, question: a.question, options: a.options };
      case 'vote': {
        if (by === null || state.closed || !state.question || a.option >= state.options.length) return state;
        const mine = voteOf(state, by);
        if (mine === a.option) return state;
        if (mine === null) {
          if (state.votes.length >= MAX_VOTERS) return state;
          return { ...state, votes: [...state.votes, { by, option: a.option }] };
        }
        return { ...state, votes: state.votes.map((v) => (v.by === by ? { by, option: a.option } : v)) };
      }
      case 'unvote':
        if (by === null || state.closed || voteOf(state, by) === null) return state;
        return { ...state, votes: state.votes.filter((v) => v.by !== by) };
      case 'close':
        return state.closed ? state : { ...state, closed: true };
      case 'reset':
        return { ...state, votes: [], closed: false };
      default:
        return state;
    }
  }

  const MAX_SUMMARY = 100;

  /** "Pizza ou hambúrguer? Pizza 3 · Hambúrguer 1 (encerrada)". */
  function summary(state) {
    if (!state.question) return 'Enquete sem pergunta';
    const counts = tally(state);
    const parts = state.options.map((o, i) => `${o} ${counts[i]}`).join(' · ');
    let line = `${state.question} ${parts}`;
    if (line.length > MAX_SUMMARY) line = `${line.slice(0, MAX_SUMMARY - 1)}…`;
    return state.closed ? `${line} (encerrada)` : line;
  }

  const api = {
    type: TYPE,
    title: 'Enquete',
    group: 'noite',
    size: { w: 420, h: 400, minW: 320, minH: 280, aspect: null },
    maxStateBytes: 4096,
    MAX_QUESTION, MAX_OPTION, MIN_OPTIONS, MAX_OPTIONS, MAX_VOTERS, MAX_PEER_ID,
    init,
    prepare,
    validate,
    reduce,
    summary,
    tally,
    voteOf,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
