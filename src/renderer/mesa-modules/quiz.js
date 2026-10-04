'use strict';

/*
 * Quiz -- modulo secreto da Mesa (contrato, secoes 1, 8 e 10).
 *
 * Escolha classica quando o contrato e omisso: todos os participantes da sala
 * entram na partida, nao ha cadeiras, e quem chega depois assiste ate a proxima
 * partida. Uma resposta fica oculta ate todos responderem ou os 20 s acabarem.
 * O desconto e um ponto por segundo, limitado a 500; respostas erradas valem 0.
 */

(function (root) {
  const banco = (root.GoLive && root.GoLive.mesaQuizPerguntas)
    || (typeof module !== 'undefined' ? require('./quiz-perguntas') : null);
  const { codigo } = (root.GoLive && root.GoLive.i18n)
    || (typeof module !== 'undefined' ? require('../i18n') : { codigo: (chave) => chave });
  const PERGUNTAS = banco.perguntas;
  const RODADAS = 10;
  const TEMPO_MS = 20 * 1000;

  function obj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function ids(ctx) {
    if (!Array.isArray(ctx && ctx.peers)) return [];
    return ctx.peers.filter((p) => obj(p) && typeof p.id === 'string').map((p) => p.id);
  }
  function rnd(random) {
    const n = typeof random === 'function' ? Number(random()) : Math.random();
    return Number.isFinite(n) && n >= 0 && n < 1 ? n : 0;
  }
  function sortear(random, temas) {
    const pool = PERGUNTAS.filter((q) => temas.includes(q.tema)).map((q) => q.id);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd(random) * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, RODADAS);
  }
  function embaralharAlternativas(random) {
    const ordem = [0, 1, 2, 3];
    for (let i = ordem.length - 1; i > 0; i--) {
      const j = Math.floor(rnd(random) * (i + 1));
      [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
    }
    return ordem;
  }
  function sortearPartida(random, temas) {
    const questions = sortear(random, temas);
    return { questions, ordens: questions.map(() => embaralharAlternativas(random)) };
  }
  function agora(ctx) { return Number.isFinite(ctx && ctx.now) ? ctx.now : 0; }
  function pergunta(state) {
    return banco.porId(state.questions[state.round]);
  }
  function participante(state, id) { return Array.isArray(state.players) && state.players.includes(id); }
  function resposta(state, id) { return state.answers.find((a) => a.by === id) || null; }
  function todosResponderam(state) {
    return state.players.length > 0 && state.players.every((id) => resposta(state, id));
  }
  function certa(state, q) {
    const ordem = state.ordens && state.ordens[state.round];
    return Array.isArray(ordem) ? ordem.indexOf(q.certa) : -1;
  }
  function pontuacao(answer, indiceCerto) {
    if (!answer || answer.option !== indiceCerto) return 0;
    return Math.max(500, 1000 - Math.min(500, Math.max(0, Number(answer.seconds) || 0)));
  }
  function placar(state, q) {
    const indiceCerto = certa(state, q);
    return state.players.map((by) => {
      const a = resposta(state, by);
      return {
        by, option: a ? a.option : null, correct: !!a && a.option === indiceCerto,
        points: pontuacao(a, indiceCerto),
      };
    });
  }
  function init(ctx) {
    return {
      setup: true,
      temas: banco.TEMAS.slice(),
      questions: [],
      ordens: [],
      round: 0,
      players: ids(ctx),
      scores: ids(ctx).map((by) => ({ by, points: 0 })),
      answers: [],
      history: [],
      deadline: null,
      finished: false,
    };
  }
  function temasValidos(temas) {
    const lista = Array.isArray(temas) ? banco.TEMAS.filter((t) => temas.includes(t)) : [];
    return lista.length ? lista : banco.TEMAS.slice();
  }
  function validate(state, action, ctx) {
    if (!obj(action) || typeof action.kind !== 'string') return codigo('mesa.jogo.acaoInvalida');
    const from = typeof ctx?.from === 'string' ? ctx.from : null;
    if (action.kind === 'temas') {
      if (!state.setup) return codigo('mesa.quiz.jaComecou');
      const t = action.temas;
      const bom = Array.isArray(t) && t.length > 0 && new Set(t).size === t.length
        && t.every((x) => banco.TEMAS.includes(x));
      return bom ? true : codigo('mesa.quiz.temasInvalidos');
    }
    if (action.kind === 'start') return state.setup ? true : codigo('mesa.quiz.jaComecou');
    if (action.kind === 'answer') {
      if (state.setup) return codigo('mesa.quiz.emPreparo');
      if (state.finished) return codigo('mesa.quiz.partidaAcabou');
      if (!from || !participante(state, from)) return codigo('mesa.quiz.entrouDepois');
      if (resposta(state, from)) return codigo('mesa.quiz.jaRespondeu');
      if (!Number.isInteger(action.option) || action.option < 0 || action.option >= 4) {
        return codigo('mesa.quiz.alternativaInvalida');
      }
      return true;
    }
    if (action.kind === 'timeout') {
      if (state.setup) return codigo('mesa.quiz.emPreparo');
      return state.finished || !state.deadline ? codigo('mesa.quiz.nadaCorrendo') : true;
    }
    if (action.kind === 'reset') return ctx && ctx.isLeader === true ? true : codigo('mesa.quiz.soLiderReinicia');
    return codigo('mesa.jogo.acaoDesconhecida');
  }
  function prepare(state, action, ctx) {
    if (!obj(action)) return action;
    if (action.kind === 'answer') {
      const started = state.deadline - TEMPO_MS;
      const seconds = Math.min(500, Math.max(0, Math.ceil(
        (agora(ctx) - started) / 1000)));
      return { kind: 'answer', by: ctx.from, option: action.option, seconds };
    }
    if (action.kind === 'timeout') return { kind: 'timeout' };
    if (action.kind === 'temas') return { kind: 'temas', temas: action.temas.slice() };
    if (action.kind === 'start') {
      return {
        kind: 'start', ...sortearPartida(ctx && ctx.random, state.temas), players: ids(ctx), at: agora(ctx),
      };
    }
    if (action.kind === 'reset') return { kind: 'reset', temas: state.temas.slice() };
    return { kind: action.kind };
  }
  function soma(scores, by, points) {
    return scores.map((s) => s.by === by ? { by, points: s.points + points } : s);
  }
  function avancar(state, at) {
    const q = pergunta(state);
    const rodada = {
      round: state.round, question: q.id, certa: certa(state, q), results: placar(state, q),
    };
    let scores = state.scores;
    for (const r of rodada.results) scores = soma(scores, r.by, r.points);
    const fim = state.round + 1 >= RODADAS;
    return {
      ...state,
      round: fim ? state.round : state.round + 1,
      scores,
      answers: [],
      history: [...state.history, rodada],
      deadline: fim ? null : at + TEMPO_MS,
      finished: fim,
    };
  }
  function reduce(state, action, ctx) {
    if (!obj(action)) return state;
    if (action.kind === 'temas') return { ...state, temas: action.temas };
    if (action.kind === 'start') {
      return {
        ...state,
        setup: false,
        questions: action.questions,
        ordens: action.ordens,
        players: action.players,
        scores: action.players.map((by) => ({ by, points: 0 })),
        answers: [],
        history: [],
        round: 0,
        deadline: action.at + TEMPO_MS,
        finished: false,
      };
    }
    if (action.kind === 'reset') {
      return {
        ...init({ peers: state.players.map((id) => ({ id })) }), temas: action.temas,
      };
    }
    if (state.setup) return state;
    if (action.kind === 'answer') {
      if (!participante(state, action.by) || resposta(state, action.by)) return state;
      const answers = [...state.answers, { by: action.by, option: action.option, seconds: action.seconds }];
      const next = { ...state, answers };
      return todosResponderam(next) ? avancar(next, agora(ctx)) : next;
    }
    if (action.kind === 'timeout') return avancar(state, agora(ctx));
    return state;
  }
  function view(state, peerId, ctx) {
    const q = pergunta(state);
    const ordem = state.ordens && state.ordens[state.round];
    const revealed = state.history[state.history.length - 1];
    const me = resposta(state, peerId);
    const players = state.players.map((by) => ({
      by,
      answered: !!resposta(state, by),
      score: (state.scores.find((s) => s.by === by) || {}).points || 0,
    }));
    return {
      round: state.round,
      total: RODADAS,
      setup: state.setup,
      temas: state.temas.slice(),
      question: q && Array.isArray(ordem) ? { id: q.id, tema: q.tema, ordem: ordem.slice() } : null,
      deadline: state.deadline,
      finished: state.finished,
      players,
      history: state.history.map((h) => ({
        round: h.round, question: h.question, certa: h.certa, results: h.results.map((r) => ({ ...r })),
      })),
      me: {
        answer: me ? me.option : null, answered: !!me,
        canAnswer: !!q && !state.finished && !me && participante(state, peerId),
      },
      revealed: revealed && revealed.round === state.round - 1 ? revealed.results.map((r) => ({ ...r })) : null,
      can: { reset: ctx && ctx.isLeader === true, start: state.setup },
    };
  }
  function timeoutAt(state) { return state.setup || state.finished ? null : state.deadline; }
  function dropPeer(state, peerId) {
    const players = state.players.filter((id) => id !== peerId);
    const scores = state.scores.filter((s) => s.by !== peerId);
    const answers = state.answers.filter((a) => a.by !== peerId);
    const next = { ...state, players, scores, answers };
    return todosResponderam(next) ? avancar(next, state.deadline || 0) : next;
  }
  function migrate(state) {
    return { ...init({ peers: [] }), temas: temasValidos(state && state.temas) };
  }
  function summary(state) {
    if (state.setup) return { chave: 'mesa.resumo.quizPreparo' };
    if (state.finished) {
      return { chave: 'mesa.resumo.quizTerminado', valores: { n: state.history.length, total: RODADAS } };
    }
    return { chave: 'mesa.resumo.quizPergunta', valores: { n: state.round + 1, total: RODADAS } };
  }

  const api = {
    type: 'quiz', title: 'mesa.titulo.quiz', group: 'jogos',
    size: { w: 560, h: 460, minW: 360, minH: 320, aspect: null },
    maxStateBytes: 16384, secret: true, init, prepare, validate, reduce, view,
    migrate, timeoutAt, dropPeer, summary, RODADAS, TEMPO_MS,
  };
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules.quiz = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
