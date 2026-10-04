'use strict';

/*
 * Desenha e adivinha -- jogo `secret` da Mesa (contrato,
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secoes 1, 7, 8 e 10),
 * por cima do Quadro: o desenho em si vai pelo MESMO canal do rabisco
 * (`annotate: true`, ver mesa-modules/quadro.js), so que so quem esta
 * desenhando pode rabiscar (`canAnnotateDraw`, abaixo). Este modulo cuida
 * do jogo -- vez, palavra secreta, palpites, pontos -- nunca do traco; a
 * troca de rodada e o sinal (o campo `round`) pro conteudo saber que o
 * Quadro por cima tem de nascer limpo de novo.
 *
 * Regras (decisao do Nicolas, 2026-09-26):
 *   - A vez de desenhar gira entre quem ENTROU na rodada (`join`, so vale
 *     na fase 'lobby'; a lista fica fixa quando o jogo comeca com `start`).
 *   - Quem desenha escolhe 1 de 3 palavras sorteadas (lista em portugues
 *     embutida, PALAVRAS abaixo); so ele ve as 3 e a escolhida, ate alguem
 *     acertar (ou a rodada acabar, quando ela vira publica em `lastRound`).
 *   - 15 s pra escolher (CHOOSE_MS); se estourar, vai a primeira opcao.
 *     Depois ha 80 s pra desenhar (DRAW_MS). Palpite (`guess`) so na janela; o
 *     servidor compara sem acento e sem caixa (`normalizar`).
 *   - Acertou: pontos pelo tempo que sobrou (100 a 10); quem desenha ganha
 *     10 por acerto. "Quase" (uma letra de diferenca -- `dentroDe1`) avisa
 *     SO quem chutou (`lastEvent.kind === 'close'`, filtrado na `view`).
 *   - A rodada acaba quando todo mundo acerta ou o tempo esgota
 *     (`timeout`); o jogo acaba depois que todos desenharem duas vezes
 *     (`drawCounts`).
 *
 * Estado inteiro (so no servidor): `players` (ordem = ordem da vez),
 * `phase` ('lobby'|'choosing'|'drawing'|'gameend'), `drawerIdx`, `round`
 * (sobe a cada rodada nova), `drawCounts`, `options` (as 3 palavras, so na
 * fase 'choosing'), `word` (so na 'drawing'), `guessedBy`, `seq`,
 * `lastEvent`, `deadline`, `startedAt`, `lastRound` (o que resta visivel de
 * uma rodada que ja acabou: a palavra e quem desenhou -- nao e mais
 * segredo de ninguem).
 */

(function (root) {
  const DRAW_MS = 80 * 1000;
  const CHOOSE_MS = 15 * 1000;
  const MAX_PLAYERS = 8;
  const MIN_SCORE = 10;
  const MAX_SCORE = 100;
  const DRAWER_BONUS = 10;
  const DRAWS_PER_PLAYER = 2;

  // Lista embutida, em portugues, substantivos concretos e faceis de
  // desenhar -- nada ofensivo, nada de nome de pessoa real. >= 150 palavras
  // (contrato, secao 10).
  const PALAVRAS = Object.freeze([
    // Animais (40)
    'cachorro', 'gato', 'elefante', 'girafa', 'leão', 'tigre', 'urso', 'coelho', 'cavalo', 'vaca',
    'porco', 'galinha', 'pato', 'peixe', 'tubarão', 'baleia', 'golfinho', 'polvo', 'caranguejo', 'borboleta',
    'abelha', 'aranha', 'formiga', 'coruja', 'águia', 'pinguim', 'macaco', 'zebra', 'rinoceronte', 'hipopótamo',
    'canguru', 'camelo', 'raposa', 'lobo', 'cobra', 'tartaruga', 'sapo', 'jacaré', 'morcego', 'esquilo',
    // Objetos e casa (30)
    'cadeira', 'mesa', 'cama', 'sofá', 'janela', 'porta', 'espelho', 'relógio', 'telefone', 'computador',
    'televisão', 'geladeira', 'fogão', 'panela', 'garfo', 'faca', 'colher', 'copo', 'prato', 'guarda-chuva',
    'escova', 'sabonete', 'chave', 'tesoura', 'lápis', 'caneta', 'livro', 'mochila', 'óculos', 'chapéu',
    // Comida (20)
    'pizza', 'hambúrguer', 'sorvete', 'bolo', 'pão', 'queijo', 'maçã', 'banana', 'laranja', 'morango',
    'uva', 'melancia', 'abacaxi', 'cenoura', 'batata', 'tomate', 'cebola', 'chocolate', 'pipoca', 'café',
    // Natureza e lugares (20)
    'sol', 'lua', 'estrela', 'nuvem', 'chuva', 'arco-íris', 'montanha', 'praia', 'floresta', 'rio',
    'cachoeira', 'vulcão', 'deserto', 'ilha', 'castelo', 'ponte', 'foguete', 'avião', 'barco', 'farol',
    // Profissões (15)
    'médico', 'professor', 'bombeiro', 'policial', 'cozinheiro', 'pintor', 'músico', 'palhaço', 'astronauta', 'pirata',
    'bailarina', 'mágico', 'fazendeiro', 'cientista', 'dentista',
    // Veículos (10)
    'carro', 'ônibus', 'bicicleta', 'moto', 'trem', 'caminhão', 'helicóptero', 'submarino', 'patinete', 'trator',
    // Roupas (10)
    'camiseta', 'calça', 'sapato', 'meia', 'boné', 'luva', 'cachecol', 'vestido', 'casaco', 'gravata',
    // Esportes e instrumentos (15)
    'futebol', 'basquete', 'violão', 'piano', 'bateria', 'tênis', 'natação', 'vôlei', 'bola', 'skate',
    'guitarra', 'flauta', 'trombeta', 'xadrez', 'boliche',
  ]);

  // ---------------------------------------------------------------------
  // Puras: texto (normalizacao, distancia de 1 letra) e sorte
  // ---------------------------------------------------------------------

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /** Sem acento, sem caixa, espacos colapsados -- o que o servidor compara. */
  function normalizar(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /** Distancia de edicao <= 1 (uma letra a mais, a menos, ou trocada). */
  function dentroDe1(a, b) {
    if (a === b) return true;
    const la = a.length;
    const lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    if (la === lb) {
      let diffs = 0;
      for (let i = 0; i < la; i++) {
        if (a[i] !== b[i]) {
          diffs += 1;
          if (diffs > 1) return false;
        }
      }
      return diffs === 1;
    }
    const curta = la < lb ? a : b;
    const longa = la < lb ? b : a;
    let i = 0;
    let j = 0;
    let pulou = false;
    while (i < curta.length && j < longa.length) {
      if (curta[i] === longa[j]) {
        i += 1;
        j += 1;
        continue;
      }
      if (pulou) return false;
      pulou = true;
      j += 1;
    }
    return true;
  }

  function rnd(random) {
    const r = typeof random === 'function' ? Number(random()) : Math.random();
    return Number.isFinite(r) && r >= 0 && r < 1 ? r : 0;
  }

  /** 3 palavras distintas, sorteadas (Fisher-Yates parcial). Com um
   * `random` ruim (sempre 0), ainda sai 3 palavras distintas (as 3
   * primeiras da lista) -- nunca undefined. */
  function sorteiaOpcoes(random) {
    const pool = PALAVRAS.slice();
    const out = [];
    for (let k = 0; k < 3 && pool.length; k++) {
      const i = Math.floor(rnd(random) * pool.length);
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }

  function pontosPeloTempo(state, at) {
    const inicio = Number.isFinite(state.startedAt) ? state.startedAt : at;
    const decorrido = Math.max(0, at - inicio);
    const frac = Math.min(1, decorrido / DRAW_MS);
    return Math.max(MIN_SCORE, Math.round(MAX_SCORE - frac * (MAX_SCORE - MIN_SCORE)));
  }

  function withScore(players, id, delta) {
    return players.map((p) => (p.id === id ? { ...p, score: p.score + delta } : p));
  }

  function drawerIdOf(state) {
    return state.phase !== 'lobby' && state.players[state.drawerIdx] ? state.players[state.drawerIdx].id : null;
  }

  // ---------------------------------------------------------------------
  // Modulo
  // ---------------------------------------------------------------------

  function init() {
    return {
      players: [],
      phase: 'lobby',
      drawerIdx: -1,
      round: 0,
      drawCounts: {},
      options: null,
      word: null,
      guessedBy: [],
      seq: 0,
      lastEvent: null,
      deadline: null,
      startedAt: null,
      lastRound: null,
    };
  }

  function validate(state, action, ctx) {
    if (!isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
    const from = ctx && ctx.from;
    if (!from) return 'Quem mandou?';
    switch (action.kind) {
      case 'join':
        if (state.phase !== 'lobby') return 'O jogo já começou';
        if (state.players.some((p) => p.id === from)) return 'Você já entrou';
        if (state.players.length >= MAX_PLAYERS) return 'A rodada está cheia';
        return true;
      case 'leave':
        if (state.phase !== 'lobby') return 'O jogo já começou';
        if (!state.players.some((p) => p.id === from)) return 'Você não entrou';
        return true;
      case 'start':
        if (state.phase !== 'lobby') return 'O jogo já começou';
        if (state.players.length < 2) return 'Precisa de pelo menos 2 pessoas';
        return true;
      case 'choose': {
        if (state.phase !== 'choosing') return 'Não é hora de escolher';
        if (from !== drawerIdOf(state)) return 'Só quem vai desenhar escolhe';
        if (action.index !== 0 && action.index !== 1 && action.index !== 2) return 'Palavra inválida';
        return true;
      }
      case 'guess': {
        if (state.phase !== 'drawing') return 'Ninguém está desenhando agora';
        if (!state.players.some((p) => p.id === from)) return 'Você não entrou';
        if (from === drawerIdOf(state)) return 'Quem desenha não chuta';
        if (state.guessedBy.includes(from)) return 'Você já acertou';
        if (typeof action.text !== 'string' || !action.text.trim()) return 'Escreva um palpite';
        return true;
      }
      case 'timeout':
        return state.phase === 'choosing' || state.phase === 'drawing' ? true : 'Nada correndo';
      default:
        return 'Ação desconhecida';
    }
  }

  /** So no servidor: sorte (as 3 palavras da proxima escolha) e hora vao
   * DENTRO da acao. `guess`/`timeout` sempre levam `nextOptions` -- mais
   * simples (nao duplica no `prepare` a logica de "esta rodada vai
   * acabar?") do que decidir aqui se ESTE palpite fecha a rodada. */
  function prepare(state, action, ctx) {
    const random = ctx && ctx.random;
    const at = ctx && Number.isFinite(ctx.now) ? ctx.now : 0;
    switch (action.kind) {
      case 'join': {
        const peers = (ctx && ctx.peers) || [];
        const achou = peers.find((p) => p && p.id === (ctx && ctx.from));
        const nome = achou && typeof achou.name === 'string' && achou.name.trim() ? achou.name : 'Alguém';
        return { kind: 'join', name: nome };
      }
      case 'start':
        return { kind: 'start', options: sorteiaOpcoes(random), at };
      case 'choose':
        return { kind: 'choose', index: action.index, at };
      case 'guess':
        return { kind: 'guess', text: typeof action.text === 'string' ? action.text.slice(0, 40) : '', at, nextOptions: sorteiaOpcoes(random) };
      case 'timeout':
        return { kind: 'timeout', at, nextOptions: sorteiaOpcoes(random) };
      default:
        return { kind: action.kind };
    }
  }

  /** Fecha a rodada corrente (todos acertaram, o tempo esgotou, ou o
   * desenhista saiu no meio): marca `drawCounts`, revela em `lastRound`
   * (a palavra deixa de ser segredo -- a rodada ja acabou), e decide se o
   * jogo acabou (todo mundo ja desenhou DRAWS_PER_PLAYER vezes) ou passa a
   * vez pra quem vem depois. `nextOptions` vem do `prepare` (sorteado com
   * `ctx.random`); sem ele (dropPeer nao tem sorte nenhuma pra usar), cai
   * nas 3 primeiras palavras da lista -- deterministico, nunca undefined. */
  function endRound(state, nextOptions, at) {
    const id = drawerIdOf(state);
    const drawCounts = id ? { ...state.drawCounts, [id]: (state.drawCounts[id] || 0) + 1 } : { ...state.drawCounts };
    const lastRound = state.word ? { round: state.round, word: state.word, drawerId: id } : state.lastRound;
    const acabouPraTodos = state.players.length > 0
      && state.players.every((p) => (drawCounts[p.id] || 0) >= DRAWS_PER_PLAYER);
    if (acabouPraTodos || state.players.length < 2) {
      return {
        ...state, phase: 'gameend', word: null, options: null, guessedBy: [], deadline: null,
        drawCounts, lastRound, drawerIdx: -1,
      };
    }
    const proximo = (state.drawerIdx + 1) % state.players.length;
    const opcoes = Array.isArray(nextOptions) && nextOptions.length === 3 ? nextOptions : PALAVRAS.slice(0, 3);
    return {
      ...state, phase: 'choosing', drawerIdx: proximo, word: null, options: opcoes,
      guessedBy: [], deadline: at + CHOOSE_MS, drawCounts, lastRound, round: state.round + 1,
    };
  }

  function startDrawing(state, word, at, by) {
    return {
      ...state, phase: 'drawing', word, options: null, guessedBy: [],
      deadline: at + DRAW_MS, startedAt: at, seq: state.seq + 1,
      lastEvent: { seq: state.seq + 1, kind: 'started', by },
    };
  }

  function reduce(state, action, ctx) {
    if (!isObj(action)) return state;
    const from = ctx && ctx.from;
    switch (action.kind) {
      case 'join': {
        if (state.phase !== 'lobby' || state.players.some((p) => p.id === from)) return state;
        const players = state.players.concat([{ id: from, name: action.name || 'Alguém', score: 0 }]);
        return { ...state, players };
      }
      case 'leave': {
        if (state.phase !== 'lobby') return state;
        const players = state.players.filter((p) => p.id !== from);
        if (players.length === state.players.length) return state;
        return { ...state, players };
      }
      case 'start': {
        if (state.phase !== 'lobby' || state.players.length < 2) return state;
        const opcoes = Array.isArray(action.options) && action.options.length === 3 ? action.options : PALAVRAS.slice(0, 3);
        const at = Number.isFinite(action.at) ? action.at : 0;
        return {
          ...state, phase: 'choosing', drawerIdx: 0, options: opcoes, drawCounts: {}, round: 1,
          guessedBy: [], word: null, deadline: at + CHOOSE_MS, lastEvent: null, lastRound: null,
        };
      }
      case 'choose': {
        if (state.phase !== 'choosing' || from !== drawerIdOf(state)) return state;
        const escolhida = Array.isArray(state.options) ? state.options[action.index] : null;
        if (typeof escolhida !== 'string') return state;
        const at = Number.isFinite(action.at) ? action.at : 0;
        return startDrawing(state, escolhida, at, from);
      }
      case 'guess': {
        if (state.phase !== 'drawing') return state;
        const dono = drawerIdOf(state);
        if (!dono || from === dono || state.guessedBy.includes(from)) return state;
        const palpite = normalizar(action.text);
        const alvo = normalizar(state.word || '');
        if (!palpite || !alvo) return state;
        const seq = state.seq + 1;
        const at = Number.isFinite(action.at) ? action.at : 0;
        if (palpite === alvo) {
          const pts = pontosPeloTempo(state, at);
          let players = withScore(state.players, from, pts);
          players = withScore(players, dono, DRAWER_BONUS);
          const guessedBy = state.guessedBy.concat([from]);
          let next = { ...state, players, guessedBy, seq, lastEvent: { seq, kind: 'correct', by: from } };
          if (guessedBy.length >= state.players.length - 1) next = endRound(next, action.nextOptions, at);
          return next;
        }
        if (dentroDe1(palpite, alvo)) {
          return { ...state, seq, lastEvent: { seq, kind: 'close', by: from } };
        }
        return { ...state, seq, lastEvent: { seq, kind: 'wrong', by: from, text: String(action.text).slice(0, 40) } };
      }
      case 'timeout':
        if (state.phase === 'choosing') {
          const escolhida = Array.isArray(state.options) ? state.options[0] : null;
          if (typeof escolhida !== 'string') return state;
          const at = Number.isFinite(action.at) ? action.at : 0;
          // A escolha automatica usa a primeira opcao, sem expor a palavra aos outros.
          return startDrawing(state, escolhida, at, drawerIdOf(state));
        }
        if (state.phase !== 'drawing') return state;
        return endRound(state, action.nextOptions, Number.isFinite(action.at) ? action.at : 0);
      default:
        return state;
    }
  }

  /** Quem sai da sala (contrato, secao 8): tira das cadeiras/jogadores. Na
   * fase lobby e so tirar da lista. No meio do jogo, se quem saiu era o
   * desenhista, a rodada acaba na hora (ninguem desenhando); sem gente
   * suficiente pra continuar, o jogo volta pro lobby (os pontos ficam). */
  function dropPeer(state, peerId) {
    if (!state.players.some((p) => p.id === peerId)) return state;
    const eraDesenhista = state.phase !== 'lobby' && drawerIdOf(state) === peerId;
    const idx = state.players.findIndex((p) => p.id === peerId);
    const players = state.players.filter((p) => p.id !== peerId);
    const drawCounts = { ...state.drawCounts };
    delete drawCounts[peerId];
    const guessedBy = state.guessedBy.filter((id) => id !== peerId);
    if (state.phase === 'lobby') return { ...state, players, drawCounts, guessedBy };
    if (players.length < 2) {
      return {
        ...state, players, drawCounts, guessedBy, phase: 'lobby', drawerIdx: -1,
        word: null, options: null, deadline: null, lastEvent: null,
      };
    }
    let drawerIdx = state.drawerIdx;
    if (idx < drawerIdx) drawerIdx -= 1;
    else if (idx === drawerIdx) drawerIdx %= players.length;
    if (eraDesenhista) return endRound({ ...state, players, drawCounts, guessedBy, drawerIdx }, null, 0);
    const next = { ...state, players, drawCounts, guessedBy, drawerIdx };
    if (next.phase === 'drawing' && next.guessedBy.length >= next.players.length - 1) return endRound(next, null, 0);
    return next;
  }

  function timeoutAt(state) {
    return (state.phase === 'choosing' || state.phase === 'drawing') && Number.isFinite(state.deadline)
      ? state.deadline
      : null;
  }

  /** O que `peerId` (null = so assiste) pode ver (contrato, secao 8): a
   * palavra so pra quem desenha ou ja acertou; as 3 opcoes so pro
   * desenhista; o "quase" so pra quem chutou (o resto do `lastEvent`,
   * 'correct'/'wrong'/'started', e seguro pra todo mundo -- nunca leva a
   * palavra). `wordLen` da o tamanho da palavra pra quem ainda nao
   * acertou, pista comum do genero, sem entregar letra nenhuma. */
  function view(state, peerId, ctx) {
    const roomIds = ctx && Array.isArray(ctx.peers) ? new Set(ctx.peers.map((p) => p.id)) : null;
    const players = state.players.map((p) => ({
      id: p.id, name: p.name, score: p.score, draws: state.drawCounts[p.id] || 0,
      naSala: roomIds ? roomIds.has(p.id) : true,
    }));
    const souEu = typeof peerId === 'string' ? peerId : null;
    const dono = drawerIdOf(state);
    const souDesenhista = souEu !== null && souEu === dono;
    const jaAcertei = souEu !== null && state.guessedBy.includes(souEu);
    const revelaPalavra = state.phase === 'drawing' && (souDesenhista || jaAcertei);
    const event = state.lastEvent && (state.lastEvent.kind !== 'close' || state.lastEvent.by === souEu)
      ? state.lastEvent : null;
    const pode = (action) => (souEu ? validate(state, action, { from: souEu, isLeader: false }) === true : false);
    return {
      phase: state.phase,
      players,
      drawerId: dono,
      round: state.round,
      deadline: state.deadline,
      guessedCount: state.guessedBy.length,
      iGuessed: jaAcertei,
      lastRound: state.lastRound,
      word: revelaPalavra ? state.word : null,
      wordLen: state.phase === 'drawing' && typeof state.word === 'string' ? state.word.length : null,
      options: state.phase === 'choosing' && souDesenhista ? state.options : null,
      event,
      me: {
        isDrawer: souDesenhista,
        joined: souEu !== null && state.players.some((p) => p.id === souEu),
        can: {
          join: pode({ kind: 'join' }),
          leave: pode({ kind: 'leave' }),
          start: pode({ kind: 'start' }),
          choose: [0, 1, 2].map((i) => pode({ kind: 'choose', index: i })),
          guess: pode({ kind: 'guess', text: 'x' }),
        },
      },
    };
  }

  /** Migracao (contrato, secao 8): o retrato vai pra TODOS, entao a rodada
   * em andamento e cancelada -- a palavra fica no servidor que caiu. Os
   * ids de pessoa mudam no servidor novo, entao os participantes tambem
   * voltam ao lobby para entrar de novo, sem jogadores-fantasma. */
  function migrate() {
    return init();
  }

  /** So o desenhista rabisca, e so durante a fase de desenho (contrato,
   * secao 10, "Desenha e adivinha"). Sem rodada correndo, ninguem
   * desenha -- inclusive pra nao deixar tracos orfaos entre uma escolha e
   * a proxima. */
  function canAnnotateDraw(state, from) {
    return state.phase === 'drawing' && drawerIdOf(state) === from;
  }

  function nomeDe(state, id) {
    const p = state.players.find((x) => x.id === id);
    return p ? p.name : 'Alguém';
  }

  function summary(state) {
    if (state.phase === 'lobby') return state.players.length ? `Esperando começar (${state.players.length} na rodada)` : 'Esperando gente entrar';
    if (state.phase === 'gameend') return 'Fim de jogo';
    if (state.phase === 'choosing') return `${nomeDe(state, drawerIdOf(state))} está escolhendo a palavra`;
    return `${nomeDe(state, drawerIdOf(state))} está desenhando`;
  }

  const mod = {
    type: 'desenha',
    title: 'mesa.titulo.desenha',
    group: 'jogos',
    size: { w: 720, h: 560, minW: 460, minH: 400, aspect: null },
    maxStateBytes: 8192,
    secret: true,
    annotate: true,
    init,
    validate,
    prepare,
    reduce,
    view,
    migrate,
    timeoutAt,
    dropPeer,
    canAnnotateDraw,
    summary,
    // Para os testes e a janela.
    DRAW_MS,
    CHOOSE_MS,
    MAX_PLAYERS,
    DRAWS_PER_PLAYER,
    PALAVRAS,
    normalizar,
    dentroDe1,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules.desenha = mod;

  if (typeof module !== 'undefined') module.exports = mod;
})(typeof window !== 'undefined' ? window : global);
