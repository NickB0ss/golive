'use strict';

/*
 * Batalha naval -- modulo de janela da mesa com informacao escondida
 * (contrato em docs/superpowers/plans/2026-09-24-mesa-contrato.md, secoes 1,
 * 7 e 8). E o jogo pequeno que prova o `secret` de ponta a ponta: os navios
 * de cada um so existem no servidor e, pelo `view`, na tela do dono.
 *
 * Regras classicas: mar de 10x10, frota de 5 navios (porta-avioes 5,
 * encouracado 4, cruzador 3, submarino 3, destroier 2), navios retos que
 * nao se encostam (nem na diagonal). O servidor sorteia a frota de cada um
 * ao sentar ("Sortear de novo" troca enquanto a pessoa nao disse
 * "Pronto"). Com os dois prontos, tiro por vez, alternado (acertar NAO da
 * outro tiro). Afundou os 5, venceu. Navio afundado aparece inteiro para
 * todos; no fim, as duas frotas aparecem.
 *
 * Estado inteiro (so no servidor):
 *   seats, names          -- cadeiras (cadeiras.js)
 *   phase                 -- 'setup' (posicionando) | 'play'
 *   fleets: [frota|null, frota|null]   frota = [[casa...] x 5], na ordem de FLEET
 *   ready: [bool, bool]
 *   shots: [[casa...], [casa...]]      tiros que CAIRAM no mar da cadeira i
 *   turn, result, deadline, last
 * Casa = linha * 10 + coluna.
 *
 * Acoes: sit {seat} | stand | shuffle | ready | fire {cell} | timeout |
 *        resign | reset
 * `prepare` (so no servidor) poe a frota sorteada (sit, shuffle, reset), a
 * casa do tiro de tempo esgotado (timeout) e a hora (`at`).
 */

(function (root) {
  const C = (root.GoLive && root.GoLive.mesaCadeiras)
    || (typeof module !== 'undefined' && typeof module.require === 'function' ? module.require('./cadeiras') : null);

  const N = 10;
  const CELLS = N * N;
  const FLEET = Object.freeze([5, 4, 3, 3, 2]);
  const SHIP_NAMES = Object.freeze(['Porta-aviões', 'Encouraçado', 'Cruzador', 'Submarino', 'Destróier']);
  const TOTAL = FLEET.reduce((a, b) => a + b, 0);
  const LABELS = ['Frota 1', 'Frota 2'];
  // Tempo de cada tiro. Estourou, o tiro sai sozinho numa casa sorteada.
  const TURN_MS = 60 * 1000;

  // ---------------------------------------------------------------------
  // Frota
  // ---------------------------------------------------------------------

  function rnd(random) {
    const r = typeof random === 'function' ? Number(random()) : Math.random();
    return Number.isFinite(r) && r >= 0 && r < 1 ? r : 0;
  }

  function vizinhas(cell) {
    const l = Math.floor(cell / N);
    const c = cell % N;
    const out = [];
    for (let dl = -1; dl <= 1; dl++) {
      for (let dc = -1; dc <= 1; dc++) {
        const ll = l + dl;
        const cc = c + dc;
        if (ll >= 0 && ll < N && cc >= 0 && cc < N) out.push(ll * N + cc);
      }
    }
    return out;
  }

  /** Frota sorteada: navios retos, dentro do mar, sem se encostar. Com um
   * `random` ruim (sempre 0) cai no arranjo fixo de reserva, que tambem e
   * valido: nunca fica sem frota. */
  function randomFleet(random) {
    for (let tentativa = 0; tentativa < 60; tentativa++) {
      const bloqueada = new Set();
      const frota = [];
      for (const size of FLEET) {
        let posto = null;
        for (let t = 0; t < 200 && !posto; t++) {
          const deitado = rnd(random) < 0.5;
          const l = Math.floor(rnd(random) * (deitado ? N : N - size + 1));
          const c = Math.floor(rnd(random) * (deitado ? N - size + 1 : N));
          const casas = [];
          for (let k = 0; k < size; k++) casas.push(deitado ? l * N + c + k : (l + k) * N + c);
          if (casas.every((x) => !bloqueada.has(x))) posto = casas;
        }
        if (!posto) break;
        frota.push(posto);
        for (const x of posto) for (const v of vizinhas(x)) bloqueada.add(v);
      }
      if (frota.length === FLEET.length) return frota;
    }
    // Reserva: um navio por linha par, encostados a esquerda.
    return FLEET.map((size, i) => Array.from({ length: size }, (_, k) => i * 2 * N + k));
  }

  /** Confere uma frota (a que vem do prepare ou da semente). */
  function isFleet(frota) {
    if (!Array.isArray(frota) || frota.length !== FLEET.length) return false;
    const usadas = new Set();
    for (let i = 0; i < FLEET.length; i++) {
      const casas = frota[i];
      if (!Array.isArray(casas) || casas.length !== FLEET[i]) return false;
      if (!casas.every((x) => Number.isInteger(x) && x >= 0 && x < CELLS)) return false;
      const ord = casas.slice().sort((a, b) => a - b);
      const deitado = ord.every((x, k) => x === ord[0] + k && Math.floor(x / N) === Math.floor(ord[0] / N));
      const empe = ord.every((x, k) => x === ord[0] + k * N);
      if (!deitado && !empe) return false;
      for (const x of casas) {
        if (usadas.has(x)) return false;
        usadas.add(x);
      }
    }
    return true;
  }

  function shipAt(frota, cell) {
    if (!Array.isArray(frota)) return -1;
    return frota.findIndex((casas) => Array.isArray(casas) && casas.includes(cell));
  }

  function isSunk(frota, i, tiros) {
    return frota[i].every((x) => tiros.includes(x));
  }

  function sunkCount(frota, tiros) {
    if (!Array.isArray(frota)) return 0;
    let n = 0;
    for (let i = 0; i < frota.length; i++) if (isSunk(frota, i, tiros)) n++;
    return n;
  }

  // ---------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------

  function freshGame() {
    return {
      phase: 'setup',
      fleets: [null, null],
      ready: [false, false],
      shots: [[], []],
      turn: 0,
      result: null,
      deadline: null,
      last: null,
    };
  }

  function init() {
    return Object.assign(C.emptySeats(), freshGame());
  }

  /** Quem esta na cadeira E na sala. Depois de uma migracao os ids mudam:
   * cadeira de quem nao esta em `ctx.peers` conta como livre (contrato,
   * secao 5). Sem `peers` (cliente), confia no que esta na cadeira. */
  function occupant(state, seat, ctx) {
    const id = state.seats[seat];
    if (id === null || id === undefined) return null;
    const peers = C.isObj(ctx) ? ctx.peers : null;
    if (Array.isArray(peers) && !peers.some((p) => C.isObj(p) && p.id === id)) return null;
    return id;
  }

  function mySeat(state, ctx) {
    const from = C.fromOf(ctx);
    return from ? C.seatOf(state, from) : -1;
  }

  function validate(state, action, ctx) {
    return C.safe(() => {
      if (!C.isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
      const from = C.fromOf(ctx);
      if (!from) return 'Quem mandou?';
      const eu = mySeat(state, ctx);
      switch (action.kind) {
        case 'sit':
          if (action.seat !== 0 && action.seat !== 1) return 'Cadeira inválida';
          if (eu >= 0) return 'Você já está sentado';
          if (occupant(state, action.seat, ctx) !== null) return 'Cadeira ocupada';
          return true;
        case 'stand':
          return eu >= 0 ? true : 'Você não está sentado';
        case 'shuffle':
          if (eu < 0) return 'Sente-se para jogar';
          if (state.phase !== 'setup') return 'A partida já começou';
          if (state.ready[eu]) return 'Você já disse que está pronto';
          return true;
        case 'ready':
          if (eu < 0) return 'Sente-se para jogar';
          if (state.phase !== 'setup') return 'A partida já começou';
          if (state.ready[eu]) return 'Você já está pronto';
          if (!state.fleets[eu]) return 'Sorteie a sua frota';
          return true;
        case 'fire': {
          if (state.result) return 'A partida acabou';
          if (eu < 0) return 'Sente-se para jogar';
          if (state.phase !== 'play') return 'Esperando os dois ficarem prontos';
          if (occupant(state, 1 - eu, ctx) === null) return 'Espere alguém sentar na outra cadeira';
          if (state.turn !== eu) return 'Não é a sua vez';
          const cell = action.cell;
          if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return 'Casa inválida';
          if (state.shots[1 - eu].includes(cell)) return 'Você já atirou aí';
          return true;
        }
        case 'timeout':
          // O prazo e conferido pelo servidor, com a hora dele (contrato,
          // secao 8); aqui so se ha uma vez correndo.
          if (state.result || state.phase !== 'play') return 'Nada correndo';
          if (occupant(state, 0, ctx) === null || occupant(state, 1, ctx) === null) return 'Nada correndo';
          return true;
        case 'resign':
          if (state.result) return 'A partida acabou';
          if (eu < 0) return 'Só quem está sentado desiste';
          if (state.phase !== 'play') return 'A partida ainda não começou';
          return true;
        case 'reset':
          return C.canReset(state, ctx);
        default:
          return 'Ação desconhecida';
      }
    }, 'Ação inválida');
  }

  /** So no servidor: sorte (frota, casa do tiro de tempo esgotado), hora e
   * o nome de quem senta vao DENTRO da acao. O que o cliente mandou alem do
   * que a acao precisa e jogado fora aqui -- ninguem escolhe a propria
   * frota mandando uma `fleet` pronta. */
  function prepare(state, action, ctx) {
    return C.safe(() => {
      const random = C.isObj(ctx) ? ctx.random : null;
      const at = C.isObj(ctx) && Number.isFinite(ctx.now) ? ctx.now : 0;
      switch (action.kind) {
        case 'sit': {
          const out = { kind: 'sit', seat: action.seat, name: C.prepareSeat(state, action, ctx).name, at };
          if (state.phase === 'setup') out.fleet = randomFleet(random);
          return out;
        }
        case 'shuffle':
          return { kind: 'shuffle', fleet: randomFleet(random) };
        case 'ready':
          return { kind: 'ready', at };
        case 'fire':
          return { kind: 'fire', cell: action.cell, at };
        case 'timeout': {
          const alvo = 1 - state.turn;
          const livres = [];
          for (let x = 0; x < CELLS; x++) if (!state.shots[alvo].includes(x)) livres.push(x);
          const cell = livres.length ? livres[Math.floor(rnd(random) * livres.length)] : 0;
          return { kind: 'timeout', cell, at };
        }
        case 'reset':
          return { kind: 'reset', fleets: [randomFleet(random), randomFleet(random)] };
        default:
          return { kind: action.kind };
      }
    }, action);
  }

  function withIndex(arr, i, v) {
    const out = arr.slice();
    out[i] = v;
    return out;
  }

  function atOf(action) {
    return Number.isFinite(action.at) ? action.at : 0;
  }

  /** Um tiro da cadeira da vez (fire ou tempo esgotado). */
  function shoot(state, cell, at) {
    const quem = state.turn;
    const alvo = 1 - quem;
    if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS || state.shots[alvo].includes(cell)) return state;
    const tiros = state.shots[alvo].concat([cell]);
    const frota = state.fleets[alvo];
    const navio = shipAt(frota, cell);
    const afundou = navio >= 0 && isSunk(frota, navio, tiros);
    const fim = navio >= 0 && sunkCount(frota, tiros) === FLEET.length;
    return Object.assign({}, state, {
      shots: withIndex(state.shots, alvo, tiros),
      last: { seat: quem, cell, hit: navio >= 0, sunk: afundou ? navio : null },
      turn: fim ? quem : alvo,
      result: fim ? { winner: quem, reason: 'afundou' } : null,
      deadline: fim ? null : at + TURN_MS,
    });
  }

  function reduce(state, action, ctx) {
    return C.safe(() => {
      if (!C.isObj(action)) return state;
      const eu = mySeat(state, ctx);
      switch (action.kind) {
        case 'sit': {
          let s = C.reduceSeat(state, action, ctx);
          if (state.phase === 'setup') {
            s = Object.assign({}, s, {
              fleets: withIndex(s.fleets, action.seat, isFleet(action.fleet) ? action.fleet : null),
              ready: withIndex(s.ready, action.seat, false),
            });
          } else if (!s.result) {
            // Sentou no lugar de quem saiu no meio da partida: continua dali,
            // com a vez correndo de novo.
            s = Object.assign({}, s, { deadline: atOf(action) + TURN_MS });
          }
          return s;
        }
        case 'stand':
          return leave(state, eu);
        case 'shuffle':
          if (eu < 0 || !isFleet(action.fleet)) return state;
          return Object.assign({}, state, { fleets: withIndex(state.fleets, eu, action.fleet) });
        case 'ready': {
          if (eu < 0 || !state.fleets[eu]) return state;
          const ready = withIndex(state.ready, eu, true);
          if (!(ready[0] && ready[1])) return Object.assign({}, state, { ready });
          return Object.assign({}, state, { ready, phase: 'play', turn: 0, deadline: atOf(action) + TURN_MS, last: null });
        }
        case 'fire':
          if (eu !== state.turn) return state;
          return shoot(state, action.cell, atOf(action));
        case 'timeout':
          return shoot(state, action.cell, atOf(action));
        case 'resign':
          if (eu < 0) return state;
          return Object.assign({}, state, { result: { winner: 1 - eu, reason: 'abandono' }, deadline: null });
        case 'reset': {
          const fleets = Array.isArray(action.fleets) ? action.fleets : [];
          return Object.assign({}, state, freshGame(), {
            fleets: [0, 1].map((i) => (state.seats[i] !== null && isFleet(fleets[i]) ? fleets[i] : null)),
          });
        }
        default:
          return state;
      }
    }, state);
  }

  /** Quem levanta (ou sai da sala) libera a cadeira. Posicionando, a frota
   * vai junto (quem sentar ganha outra); no meio da partida ela fica, e
   * quem sentar continua dali. */
  function leave(state, seat) {
    if (seat < 0) return state;
    const s = C.dropPeer(state, state.seats[seat]);
    if (state.phase !== 'setup') return s;
    return Object.assign({}, s, {
      fleets: withIndex(state.fleets, seat, null),
      ready: withIndex(state.ready, seat, false),
    });
  }

  function dropPeer(state, peerId) {
    return C.safe(() => leave(state, C.seatOf(state, peerId)), state);
  }

  function timeoutAt(state) {
    return C.safe(() => {
      if (state.result || state.phase !== 'play') return null;
      if (state.seats[0] === null || state.seats[1] === null) return null;
      return Number.isFinite(state.deadline) ? state.deadline : null;
    }, null);
  }

  // ---------------------------------------------------------------------
  // O que cada um ve (contrato, secao 8)
  // ---------------------------------------------------------------------

  /** Mar da cadeira `i` visto por `eu` (-1 = quem assiste): os tiros que
   * cairam nele (com acerto), os navios afundados inteiros, e os navios
   * inteiros so para o dono -- ou para todos quando a partida acabou. */
  function boardView(state, i, eu) {
    const frota = state.fleets[i];
    const tiros = state.shots[i];
    const mostraTudo = i === eu || !!state.result;
    const ships = [];
    if (Array.isArray(frota)) {
      frota.forEach((casas, k) => {
        const sunk = isSunk(frota, k, tiros);
        if (sunk || mostraTudo) ships.push({ size: casas.length, cells: casas.slice(), sunk });
      });
    }
    return {
      shots: tiros.map((x) => [x, shipAt(frota, x) >= 0 ? 1 : 0]),
      ships,
      left: Array.isArray(frota) ? FLEET.length - sunkCount(frota, tiros) : null,
      hasFleet: Array.isArray(frota),
    };
  }

  function view(state, peerId, ctx) {
    return C.safe(() => {
      const c = Object.assign({}, C.isObj(ctx) ? ctx : {}, { from: typeof peerId === 'string' ? peerId : null });
      const eu = typeof peerId === 'string' ? C.seatOf(state, peerId) : -1;
      // Cadeira de quem nao esta mais na sala aparece livre.
      const seats = [0, 1].map((i) => occupant(state, i, c));
      const pode = (action) => (c.from ? validate(state, action, c) === true : false);
      return {
        seats,
        names: [0, 1].map((i) => (seats[i] !== null ? state.names[i] : null)),
        phase: state.phase,
        ready: state.ready.slice(),
        turn: state.turn,
        result: state.result,
        deadline: state.deadline,
        last: state.last,
        boards: [boardView(state, 0, eu), boardView(state, 1, eu)],
        // O cliente nao tem o estado inteiro para rodar o validate: o que
        // a interface precisa para ligar e desligar botoes vem pronto.
        me: {
          seat: eu,
          can: {
            sit: [pode({ kind: 'sit', seat: 0 }), pode({ kind: 'sit', seat: 1 })],
            stand: pode({ kind: 'stand' }),
            shuffle: pode({ kind: 'shuffle' }),
            ready: pode({ kind: 'ready' }),
            fire: eu >= 0 && pode({ kind: 'fire', cell: firstFree(state, 1 - eu) }),
            resign: pode({ kind: 'resign' }),
            reset: pode({ kind: 'reset' }),
          },
        },
      };
    }, null);
  }

  function firstFree(state, alvo) {
    for (let x = 0; x < CELLS; x++) if (!state.shots[alvo].includes(x)) return x;
    return -1;
  }

  /** Migracao (contrato, secao 8): o retrato vai para todos, entao a
   * partida em andamento e cancelada -- as frotas ficam no servidor que
   * caiu. As cadeiras ficam; o servidor novo da ids novos, entao cada um
   * senta de novo (cadeira de quem nao esta na sala conta como livre). */
  function migrate(state) {
    return Object.assign({}, init(), {
      seats: state.seats.slice(),
      names: state.names.slice(),
    });
  }

  /** Resumo curto. Serve para o estado inteiro e para a `view`. */
  function summary(state, peers) {
    return C.safe(() => {
      const r = state.result;
      if (r) return `${C.nameOf(state, r.winner, LABELS, peers)} venceu`;
      if (state.phase === 'setup') {
        const sentados = state.seats.filter((x) => x !== null).length;
        return sentados === 2 ? 'Posicionando as frotas' : C.describePlaying(state, state.turn, LABELS, peers);
      }
      return C.describePlaying(state, state.turn, LABELS, peers);
    }, 'Batalha naval');
  }

  const mod = {
    type: 'batalha',
    title: 'Batalha naval',
    group: 'jogos',
    size: { w: 720, h: 460, minW: 420, minH: 300, aspect: null },
    maxStateBytes: 4096,
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
    // Para os testes e a janela.
    N,
    FLEET,
    SHIP_NAMES,
    TOTAL,
    TURN_MS,
    randomFleet,
    isFleet,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules.batalha = mod;

  if (typeof module !== 'undefined') module.exports = mod;
})(typeof window !== 'undefined' ? window : global);
