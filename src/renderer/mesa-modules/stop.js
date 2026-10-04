'use strict';

/*
 * Stop / Adedonha -- modulo secreto da Mesa (contrato, secoes 1, 8 e 10).
 *
 * Escolhas classicas onde o contrato nao detalha: a rodada fixa quem estava
 * na sala ao comecar; o proprio autor da resposta tambem vota na anulacao;
 * o criador encerra a correcao para somar os pontos e abrir a proxima.
 * Quem sai deixa a rodada e seus votos, para a maioria continuar sendo de
 * quem esta nela. Cada resposta tem no maximo 40 caracteres e a rodada tem
 * no maximo 24 pessoas: juntos, esses limites mantem o estado inteiro bem
 * abaixo do teto de 16 KB da janela, inclusive com 10 categorias e votos.
 *
 * O estado inteiro so existe no servidor enquanto `phase === 'writing'`.
 * `view` entrega a cada pessoa somente suas proprias respostas; STOP ou os
 * tres minutos trocam para `review` e revelam tudo para a correcao.
 */

(function (root) {
  const { codigo } = (root.GoLive && root.GoLive.i18n)
    || (typeof module !== 'undefined' ? require('../i18n') : { codigo: (chave) => chave });
  const TYPE = 'stop';
  const ROUND_MS = 3 * 60 * 1000;
  const MAX_CATEGORIES = 10;
  const MAX_CATEGORY = 32;
  const MAX_ANSWER = 40;
  const MAX_PLAYERS = 24;
  const LETTERS = Object.freeze('ABCDEFGHIJLMNOPQRSTUVZ'.split(''));
  const DEFAULT_CATEGORIES = Object.freeze([
    codigo('mesa.stop.cat.nome'), codigo('mesa.stop.cat.animal'), codigo('mesa.stop.cat.cor'),
    codigo('mesa.stop.cat.fruta'), codigo('mesa.stop.cat.cidadeEstadoPais'), codigo('mesa.stop.cat.objeto'),
    codigo('mesa.stop.cat.profissao'), codigo('mesa.stop.cat.marca'),
  ]);

  function obj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function peerId(v) {
    return typeof v === 'string' && v.length > 0 && v.length <= 64;
  }

  function text(v, max) {
    if (typeof v !== 'string' || v.length > max * 4) return null;
    const clean = v.replace(/\p{Cc}/gu, ' ').replace(/\s+/gu, ' ').trim();
    return clean.length <= max ? clean : null;
  }

  function normalized(v) {
    return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  }

  function peersOf(ctx) {
    const seen = new Set();
    const out = [];
    for (const p of (ctx && Array.isArray(ctx.peers) ? ctx.peers : [])) {
      if (p && peerId(p.id) && !seen.has(p.id)) {
        seen.add(p.id);
        out.push({ id: p.id, name: typeof p.name === 'string' ? p.name : p.id });
      }
    }
    return out;
  }

  function activePlayers(state, ctx) {
    const live = new Set(peersOf(ctx).map((p) => p.id));
    return state.players.filter((id) => !live.size || live.has(id));
  }

  function parsedCategories(categories) {
    if (!Array.isArray(categories) || categories.length < 1) return codigo('mesa.stop.informeUma');
    if (categories.length > MAX_CATEGORIES) return codigo('mesa.stop.maxCategorias', { n: MAX_CATEGORIES });
    const out = [];
    for (const raw of categories) {
      const v = text(raw, MAX_CATEGORY);
      if (v === null) return codigo('mesa.stop.categoriaInvalida');
      if (!v) return codigo('mesa.stop.categoriaVazia');
      out.push(v);
    }
    if (new Set(out.map(normalized)).size !== out.length) return codigo('mesa.stop.categoriasRepetidas');
    return out;
  }

  function parse(action) {
    if (!obj(action) || typeof action.kind !== 'string') return codigo('mesa.jogo.acaoInvalida');
    switch (action.kind) {
      case 'categories': {
        const categories = parsedCategories(action.categories);
        return typeof categories === 'string' ? categories : { kind: 'categories', categories };
      }
      case 'start':
      case 'stop':
      case 'timeout':
      case 'finish':
        return { kind: action.kind };
      case 'answer': {
        if (!Array.isArray(action.answers)) return codigo('mesa.stop.respostasInvalidas');
        const answers = [];
        for (const raw of action.answers) {
          const v = text(raw, MAX_ANSWER);
          if (v === null) return codigo('mesa.stop.respostaLonga', { max: MAX_ANSWER });
          answers.push(v);
        }
        return { kind: 'answer', answers };
      }
      case 'vote':
        if (!peerId(action.player) || !Number.isInteger(action.category) || typeof action.annul !== 'boolean') {
          return codigo('mesa.stop.votoInvalido');
        }
        return { kind: 'vote', player: action.player, category: action.category, annul: action.annul };
      default:
        return codigo('mesa.jogo.acaoDesconhecida');
    }
  }

  function initialScores(players, old = {}) {
    const scores = {};
    for (const id of players) scores[id] = Number.isFinite(old[id]) ? old[id] : 0;
    return scores;
  }

  function init(ctx) {
    return {
      createdBy: ctx && peerId(ctx.by) ? ctx.by : null,
      categories: DEFAULT_CATEGORIES.slice(),
      phase: 'setup',
      letter: null,
      players: [],
      names: {},
      answers: {},
      votes: [],
      scores: {},
      deadline: null,
    };
  }

  function canManage(state, ctx) {
    const from = ctx && peerId(ctx.from) ? ctx.from : null;
    if (!from) return false;
    if (from === state.createdBy) return true;
    const creatorActive = peersOf(ctx).some((peer) => peer.id === state.createdBy);
    if (creatorActive) return false;
    return ctx && ctx.isLeader === true || state.players.includes(from);
  }

  function allAnswered(state, id) {
    const answers = state.answers[id];
    return Array.isArray(answers) && answers.length === state.categories.length && answers.every(Boolean);
  }

  function validate(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return a;
    const from = ctx && peerId(ctx.from) ? ctx.from : null;
    switch (a.kind) {
      case 'categories':
        if (!canManage(state, ctx)) return codigo('mesa.stop.soQuemCriou');
        return state.phase === 'setup' ? true : codigo('mesa.stop.trocarEntreRodadas');
      case 'start':
        if (!canManage(state, ctx)) return codigo('mesa.stop.soQuemCriou');
        if (state.phase !== 'setup') return codigo('mesa.stop.rodadaEmAndamento');
        if (peersOf(ctx).length < 1) return codigo('mesa.stop.ninguemNaSala');
        if (peersOf(ctx).length > MAX_PLAYERS) return codigo('mesa.stop.maxPessoas', { n: MAX_PLAYERS });
        return true;
      case 'answer':
        if (state.phase !== 'writing') {
          return state.phase === 'setup' ? codigo('mesa.stop.rodadaNaoComecou') : codigo('mesa.stop.rodadaParou');
        }
        if (!from || !activePlayers(state, ctx).includes(from)) return codigo('mesa.stop.naoEstaNaRodada');
        return a.answers.length === state.categories.length ? true : codigo('mesa.stop.respondaTodas');
      case 'stop':
        if (state.phase !== 'writing') return codigo('mesa.stop.rodadaParou');
        if (!from || !activePlayers(state, ctx).includes(from)) return codigo('mesa.stop.naoEstaNaRodada');
        return allAnswered(state, from) ? true : codigo('mesa.stop.preenchaTodas');
      case 'timeout':
        return state.phase === 'writing' ? true : codigo('mesa.stop.nadaCorrendo');
      case 'vote':
        if (state.phase !== 'review') return codigo('mesa.stop.aindaNaoCorrigir');
        if (!from || !activePlayers(state, ctx).includes(from)) return codigo('mesa.stop.naoEstaNaRodada');
        if (!activePlayers(state, ctx).includes(a.player) || a.category >= state.categories.length) {
          return codigo('mesa.stop.respostaInvalida');
        }
        return true;
      case 'finish':
        if (!canManage(state, ctx)) return codigo('mesa.stop.soQuemCriou');
        return state.phase === 'review' ? true : codigo('mesa.stop.nadaEncerrar');
      default:
        return codigo('mesa.jogo.acaoInvalida');
    }
  }

  function prepare(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return action;
    const from = ctx && peerId(ctx.from) ? ctx.from : null;
    if (a.kind === 'start') {
      const players = peersOf(ctx).slice(0, MAX_PLAYERS);
      const r = ctx && typeof ctx.random === 'function' ? Number(ctx.random()) : 0;
      const pos = Number.isFinite(r) && r >= 0 && r < 1 ? Math.floor(r * LETTERS.length) : 0;
      return { kind: 'start', players, letter: LETTERS[pos], at: Number(ctx && ctx.now) || 0 };
    }
    if (a.kind === 'answer') return { kind: 'answer', answers: a.answers, by: from };
    if (a.kind === 'vote') return { ...a, by: from };
    return a;
  }

  function voteOf(state, player, category) {
    return state.votes.find((v) => v.player === player && v.category === category) || null;
  }

  function isAnnulled(state, player, category) {
    const vote = voteOf(state, player, category);
    return !!vote && vote.yes.length > state.players.length / 2;
  }

  function points(state) {
    if (state.phase !== 'review') return [];
    const out = [];
    for (let category = 0; category < state.categories.length; category++) {
      const valid = new Map();
      for (const player of state.players) {
        const answer = state.answers[player]?.[category] || '';
        const norm = normalized(answer);
        if (norm && norm.startsWith(normalized(state.letter)) && !isAnnulled(state, player, category)) {
          valid.set(player, norm);
        }
      }
      for (const player of state.players) {
        const norm = valid.get(player);
        let value = 0;
        if (norm) value = [...valid.values()].filter((v) => v === norm).length === 1 ? 10 : 5;
        out.push({ player, category, points: value });
      }
    }
    return out;
  }

  function reduce(state, action) {
    const parsed = parse(action);
    if (typeof parsed === 'string') return state;
    // `prepare` acrescenta identidade, participantes, letra e hora. O
    // servidor reduz essa acao preparada; o parse continua validando apenas
    // a forma que pode vir do cliente.
    const a = { ...parsed };
    for (const key of ['by', 'players', 'letter', 'at']) if (obj(action) && key in action) a[key] = action[key];
    switch (a.kind) {
      case 'categories':
        return state.phase === 'setup' ? { ...state, categories: a.categories } : state;
      case 'start': {
        const players = a.players.map((p) => p.id);
        const names = Object.fromEntries(a.players.map((p) => [p.id, p.name]));
        return {
          ...state,
          phase: 'writing',
          letter: a.letter,
          players,
          names,
          answers: {},
          votes: [],
          scores: initialScores(players, state.scores),
          deadline: a.at + ROUND_MS,
        };
      }
      case 'answer':
        if (!peerId(a.by) || state.phase !== 'writing' || !state.players.includes(a.by)
          || a.answers.length !== state.categories.length) return state;
        return { ...state, answers: { ...state.answers, [a.by]: a.answers.slice() } };
      case 'stop':
      case 'timeout':
        return state.phase === 'writing' ? { ...state, phase: 'review', deadline: null } : state;
      case 'vote': {
        if (!peerId(a.by) || state.phase !== 'review' || !state.players.includes(a.by)) return state;
        const old = voteOf(state, a.player, a.category);
        const filtered = state.votes.filter((v) => v !== old);
        const yes = (old ? old.yes : []).filter((id) => id !== a.by);
        const no = (old ? old.no : []).filter((id) => id !== a.by);
        (a.annul ? yes : no).push(a.by);
        return { ...state, votes: [...filtered, { player: a.player, category: a.category, yes, no }] };
      }
      case 'finish': {
        if (state.phase !== 'review') return state;
        const scores = { ...state.scores };
        for (const p of points(state)) scores[p.player] = (scores[p.player] || 0) + p.points;
        return {
          ...state,
          phase: 'setup',
          letter: null,
          players: [],
          names: {},
          answers: {},
          votes: [],
          scores,
          deadline: null,
        };
      }
      default:
        return state;
    }
  }

  function timeoutAt(state) {
    return state.phase === 'writing' && Number.isFinite(state.deadline) ? state.deadline : null;
  }

  function dropPeer(state, id) {
    if (!peerId(id)) return state;
    const players = state.players.filter((player) => player !== id);
    const names = { ...state.names };
    delete names[id];
    const answers = { ...state.answers };
    delete answers[id];
    const scores = { ...state.scores };
    delete scores[id];
    const votes = state.votes
      .filter((v) => v.player !== id)
      .map((v) => ({ ...v, yes: v.yes.filter((p) => p !== id), no: v.no.filter((p) => p !== id) }))
      .filter((v) => v.yes.length || v.no.length);
    if (players.length === state.players.length && !(id in names) && !(id in scores) && state.createdBy !== id) return state;
    return { ...state, createdBy: state.createdBy === id ? null : state.createdBy, players, names, answers, votes, scores };
  }

  function migrate(state) {
    return {
      ...init({}),
      categories: state.categories.slice(),
      scores: { ...state.scores },
    };
  }

  function view(state, peer, ctx) {
    const players = activePlayers(state, ctx);
    const writing = state.phase === 'writing';
    const votes = state.votes.map((v) => ({
      player: v.player,
      category: v.category,
      yes: v.yes.length,
      no: v.no.length,
      mine: peerId(peer) ? (v.yes.includes(peer) ? true : v.no.includes(peer) ? false : null) : null,
      annulled: v.yes.length > players.length / 2,
    }));
    return {
      createdBy: state.createdBy,
      categories: state.categories.slice(),
      phase: state.phase,
      letter: state.letter,
      players,
      names: Object.fromEntries(players.map((id) => [id, state.names[id] || id])),
      scores: Object.fromEntries(players.map((id) => [id, state.scores[id] || 0])),
      deadline: state.deadline,
      answered: Object.fromEntries(players.map((id) => [id, allAnswered(state, id)])),
      myAnswers: writing && peerId(peer) && players.includes(peer) ? (state.answers[peer] || null) : null,
      answers: writing ? null : Object.fromEntries(players.map((id) => [id, (state.answers[id] || []).slice()])),
      votes,
      points: writing ? null : points({ ...state, players }),
      me: {
        canManage: canManage(state, { ...ctx, from: peer }),
        canStart: state.phase === 'setup' && canManage(state, { ...ctx, from: peer }),
        canFinish: state.phase === 'review' && canManage(state, { ...ctx, from: peer }),
        inRound: peerId(peer) && players.includes(peer),
      },
    };
  }

  function summary(state) {
    if (state.phase === 'writing') return { chave: 'mesa.resumo.stopEscrevendo', valores: { letra: state.letter } };
    if (state.phase === 'review') return { chave: 'mesa.resumo.stopCorrigindo', valores: { letra: state.letter } };
    return { chave: state.categories.length ? 'mesa.resumo.stopProxima' : 'mesa.titulo.stop' };
  }

  const api = {
    type: TYPE,
    title: 'mesa.titulo.stop',
    group: 'noite',
    size: { w: 720, h: 460, minW: 520, minH: 340, aspect: null },
    maxStateBytes: 16 * 1024,
    secret: true,
    init,
    prepare,
    validate,
    reduce,
    view,
    migrate,
    timeoutAt,
    dropPeer,
    summary,
    points,
    isAnnulled,
    ROUND_MS,
    MAX_CATEGORIES,
    MAX_ANSWER,
    MAX_PLAYERS,
    LETTERS,
    DEFAULT_CATEGORIES,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
