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
  function sortear(random) {
    const pool = PERGUNTAS.map((q) => q.id);
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
  function sortearPartida(random) {
    const questions = sortear(random);
    return { questions, ordens: questions.map(() => embaralharAlternativas(random)) };
  }
  function agora(ctx) { return Number.isFinite(ctx && ctx.now) ? ctx.now : 0; }
  function pergunta(state) {
    return PERGUNTAS[state.questions[state.round]] || null;
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
    const partida = sortearPartida(ctx && ctx.random);
    return {
      ...partida,
      round: 0,
      players: ids(ctx),
      scores: ids(ctx).map((by) => ({ by, points: 0 })),
      answers: [],
      history: [],
      deadline: agora(ctx) + TEMPO_MS,
      finished: false,
    };
  }
  function validate(state, action, ctx) {
    if (!obj(action) || typeof action.kind !== 'string') return 'Acao invalida';
    const from = typeof ctx?.from === 'string' ? ctx.from : null;
    if (action.kind === 'answer') {
      if (state.finished) return 'A partida acabou';
      if (!from || !participante(state, from)) return 'Voce entrou depois da partida';
      if (resposta(state, from)) return 'Voce ja respondeu';
      if (!Number.isInteger(action.option) || action.option < 0 || action.option >= 4) {
        return 'Alternativa invalida';
      }
      return true;
    }
    if (action.kind === 'timeout') return state.finished || !state.deadline ? 'Nada correndo' : true;
    if (action.kind === 'reset') return ctx && ctx.isLeader === true ? true : 'So o lider pode reiniciar';
    return 'Acao desconhecida';
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
    if (action.kind === 'reset') {
      const partida = sortearPartida(ctx && ctx.random);
      return {
        kind: 'reset', ...partida, players: ids(ctx), at: agora(ctx),
      };
    }
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
    if (action.kind === 'reset') {
      return {
        ...init({ peers: (action.players || []).map((id) => ({ id })), random: null, now: action.at }),
        questions: action.questions, ordens: action.ordens, players: action.players,
      };
    }
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
      question: q && Array.isArray(ordem) ? {
        pergunta: q.pergunta, alternativas: ordem.map((indice) => q.alternativas[indice]),
      } : null,
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
      can: { reset: ctx && ctx.isLeader === true },
    };
  }
  function timeoutAt(state) { return state.finished ? null : state.deadline; }
  function dropPeer(state, peerId) {
    const players = state.players.filter((id) => id !== peerId);
    const scores = state.scores.filter((s) => s.by !== peerId);
    const answers = state.answers.filter((a) => a.by !== peerId);
    const next = { ...state, players, scores, answers };
    return todosResponderam(next) ? avancar(next, state.deadline || 0) : next;
  }
  function migrate(state) {
    const { ordens, ...publico } = state;
    return { ...publico, players: [], scores: [], answers: [], deadline: null, finished: true };
  }
  function summary(state) {
    return state.finished ? `Quiz terminado (${state.history.length}/${RODADAS})`
      : `Pergunta ${state.round + 1}/${RODADAS}`;
  }

  const api = {
    type: 'quiz', title: 'Quiz', group: 'jogos',
    size: { w: 560, h: 460, minW: 360, minH: 320, aspect: null },
    maxStateBytes: 16384, secret: true, init, prepare, validate, reduce, view,
    migrate, timeoutAt, dropPeer, summary, RODADAS, TEMPO_MS,
  };
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules.quiz = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
