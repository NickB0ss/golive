'use strict';

/*
 * Dominó duplo-seis com informação escondida.
 *
 * A preparação da mesa não está no contrato: adotamos a escolha clássica de
 * uma pessoa sentada dar "Nova mão" quando houver de duas a quatro pessoas.
 * A abertura seguinte é feita por quem venceu a mão anterior, com qualquer
 * peça. Uma pedra é [ladoA, ladoB]; a ordem no tabuleiro é a ordem visual.
 */

(function (root) {
  const C = (root.GoLive && root.GoLive.mesaCadeiras)
    || (typeof module !== 'undefined' ? module.require('./cadeiras') : null);
  const P = (root.GoLive && root.GoLive.mesaPedras)
    || (typeof module !== 'undefined' ? module.require('./pedras') : null);

  const LUGARES = 4;
  const TEMPO_DA_VEZ = 30000;

  function arrayDe(valor) {
    return Array(LUGARES).fill(valor);
  }

  function maosVazias() {
    return Array.from({ length: LUGARES }, () => []);
  }

  function init() {
    return {
      seats: arrayDe(null),
      names: arrayDe(null),
      hands: maosVazias(),
      stock: [],
      table: [],
      ends: null,
      scores: arrayDe(0),
      phase: 'waiting',
      turn: null,
      deadline: null,
      passes: 0,
      winner: null,
      result: null,
    };
  }

  function ocupante(state, lugar, ctx) {
    const id = state.seats[lugar];
    const peers = ctx && ctx.peers;
    if (!id) return null;
    if (!Array.isArray(peers)) return id;
    return peers.some((peer) => peer && peer.id === id) ? id : null;
  }

  function meuLugar(state, ctx) {
    return C.seatOf(state, C.fromOf(ctx));
  }

  function lugaresOcupados(state) {
    return state.seats.filter(Boolean).length;
  }

  function duplaDo(lugar, quantidade) {
    return quantidade === 4 ? lugar % 2 : lugar;
  }

  function pontosDaPedra(pedra) {
    return P.points(pedra);
  }

  function pontosNaMao(state, lugar) {
    return state.hands[lugar].reduce((total, pedra) => total + pontosDaPedra(pedra), 0);
  }

  function encaixaNaPonta(state, pedra) {
    if (!state.ends || !P.valid(pedra)) return false;
    return pedra.includes(state.ends[0]) || pedra.includes(state.ends[1]);
  }

  function encaixa(state, pedra, ponta) {
    if (!state.ends || !P.valid(pedra)) return false;
    if (ponta === 'left') return pedra.includes(state.ends[0]);
    if (ponta === 'right') return pedra.includes(state.ends[1]);
    return false;
  }

  function podeComprar(state, lugar) {
    return state.stock.length > 0 && !state.hands[lugar].some((pedra) => encaixaNaPonta(state, pedra));
  }

  function podePassar(state, lugar) {
    return state.stock.length === 0 && !state.hands[lugar].some((pedra) => encaixaNaPonta(state, pedra));
  }

  function validarLugar(state, action, ctx) {
    const meu = meuLugar(state, ctx);
    if (!Number.isInteger(action.seat) || action.seat < 0 || action.seat >= LUGARES) {
      return 'Cadeira inválida';
    }
    if (meu >= 0) return 'Você já está sentado';
    if (ocupante(state, action.seat, ctx)) return 'Cadeira ocupada';
    return true;
  }

  function validarJogada(state, action, ctx) {
    const meu = meuLugar(state, ctx);
    if (meu < 0) return 'Sente-se para jogar';
    if (state.phase === 'opening') {
      if (meu !== state.turn) return 'Não é a sua vez';
      if (action.kind !== 'open') return 'Escolha a pedra de abertura';
      return Number.isInteger(action.stone) && state.hands[meu][action.stone]
        ? true : 'Pedra inválida';
    }
    if (state.phase !== 'play') return 'Comece uma nova mão';
    if (meu !== state.turn) return 'Não é a sua vez';
    return action.kind === 'play' ? validarPedra(state, action, meu) : validarCompraOuPasse(state, action, meu);
  }

  function validarPedra(state, action, lugar) {
    if (!Number.isInteger(action.stone) || action.stone < 0) return 'Pedra inválida';
    if (!encaixa(state, state.hands[lugar][action.stone], action.end)) return 'Pedra não encaixa';
    return true;
  }

  function validarCompraOuPasse(state, action, lugar) {
    if (action.kind === 'draw') return podeComprar(state, lugar) ? true : 'Você já pode jogar ou não há monte';
    if (action.kind === 'pass') return podePassar(state, lugar) ? true : 'Ainda há jogada ou monte';
    return 'Ação desconhecida';
  }

  function validate(state, action, ctx) {
    return C.safe(() => {
      if (!C.isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
      if (action.kind === 'sit') return validarLugar(state, action, ctx);
      if (action.kind === 'stand') return meuLugar(state, ctx) >= 0 ? true : 'Você não está sentado';
      if (action.kind === 'reset') return C.canReset(state, ctx);
      if (action.kind === 'start') {
        const sentados = lugaresOcupados(state);
        return meuLugar(state, ctx) >= 0 && sentados >= 2 && state.phase !== 'play'
          ? true
          : 'São necessários 2 a 4 jogadores entre mãos';
      }
      if (action.kind === 'timeout') return state.phase === 'play' ? true : 'Nada correndo';
      return validarJogada(state, action, ctx);
    }, 'Ação inválida');
  }

  function prepararNovaMao(state, ctx) {
    const pedras = P.shuffle(P.newSet(), ctx && ctx.random);
    const hands = maosVazias();
    let indice = 0;
    for (let lugar = 0; lugar < LUGARES; lugar += 1) {
      if (!state.seats[lugar]) continue;
      hands[lugar] = pedras.slice(indice, indice + 7);
      indice += 7;
    }
    return {
      kind: 'start',
      hands,
      stock: lugaresOcupados(state) === 4 ? [] : pedras.slice(indice),
      at: ctx && ctx.now,
    };
  }

  function prepare(state, action, ctx) {
    if (!action || action.kind !== 'start') {
      return Object.assign({}, action, { at: ctx && ctx.now });
    }
    return prepararNovaMao(state, ctx);
  }

  function proximoLugar(state, atual) {
    for (let passo = 1; passo <= LUGARES; passo += 1) {
      const lugar = (atual + passo) % LUGARES;
      if (state.seats[lugar]) return lugar;
    }
    return atual;
  }

  function comProximaVez(state, atual, at) {
    return Object.assign({}, state, {
      turn: proximoLugar(state, atual),
      deadline: at + TEMPO_DA_VEZ,
    });
  }

  function maiorAbertura(hands) {
    let melhor = { lugar: 0, pedra: null, valor: -1 };
    hands.forEach((mao, lugar) => mao.forEach((pedra) => {
      const dupla = pedra[0] === pedra[1] ? 100 + pedra[0] : 0;
      const valor = dupla || pontosDaPedra(pedra);
      if (valor > melhor.valor) melhor = { lugar, pedra, valor };
    }));
    return melhor;
  }

  function abertura(state, hands) {
    if (Number.isInteger(state.winner) && hands[state.winner].length) {
      return { lugar: state.winner, pedra: hands[state.winner][0] };
    }
    return maiorAbertura(hands);
  }

  function iniciarMao(state, action) {
    const hands = action.hands.map((mao) => mao.filter(P.valid).map((pedra) => pedra.slice()));
    const base = Object.assign({}, state, {
      hands,
      stock: action.stock.filter(P.valid).map((pedra) => pedra.slice()),
      table: [],
      ends: null,
      passes: 0,
      result: null,
    });
    if (Number.isInteger(state.winner) && hands[state.winner].length) {
      return Object.assign({}, base, {
        phase: 'opening', turn: state.winner, deadline: numeroDaHora(action) + TEMPO_DA_VEZ,
      });
    }
    const abre = abertura(state, hands);
    const indice = hands[abre.lugar].findIndex((pedra) => pedra === abre.pedra);
    hands[abre.lugar].splice(indice, 1);
    const iniciada = Object.assign({}, base, {
      table: [{ stone: abre.pedra.slice(), end: 'right' }],
      ends: abre.pedra.slice(),
      phase: 'play',
      winner: null,
    });
    return comProximaVez(iniciada, abre.lugar, numeroDaHora(action));
  }

  function abrir(state, lugar, indice, at) {
    const hands = state.hands.map((mao) => mao.slice());
    const pedra = hands[lugar][indice];
    if (!P.valid(pedra)) return state;
    hands[lugar].splice(indice, 1);
    const iniciada = Object.assign({}, state, {
      hands, table: [{ stone: pedra.slice(), end: 'right' }], ends: pedra.slice(), phase: 'play', winner: null,
    });
    return comProximaVez(iniciada, lugar, at);
  }

  function numeroDaHora(action) {
    return Number.isFinite(action.at) ? action.at : 0;
  }

  function pedraOrientada(state, pedra, ponta) {
    const alvo = ponta === 'left' ? state.ends[0] : state.ends[1];
    if (ponta === 'left') return pedra[0] === alvo ? [pedra[1], pedra[0]] : pedra.slice();
    return pedra[0] === alvo ? pedra.slice() : [pedra[1], pedra[0]];
  }

  function terminar(state, motivo, vencedor) {
    const quantidade = lugaresOcupados(state);
    let ganhou = vencedor;
    if (ganhou === null) ganhou = vencedorDaTranca(state, quantidade);
    if (ganhou === null) {
      return Object.assign({}, state, {
        phase: 'done',
        deadline: null,
        result: { reason: motivo, winner: null, gain: 0, game: false },
      });
    }
    const duplaVencedora = duplaDo(ganhou, quantidade);
    let ganho = 0;
    const scores = state.scores.slice();
    for (let lugar = 0; lugar < LUGARES; lugar += 1) {
      if (!state.seats[lugar]) continue;
      if (duplaDo(lugar, quantidade) !== duplaVencedora) ganho += pontosNaMao(state, lugar);
    }
    for (let lugar = 0; lugar < LUGARES; lugar += 1) {
      if (state.seats[lugar] && duplaDo(lugar, quantidade) === duplaVencedora) scores[lugar] += ganho;
    }
    return Object.assign({}, state, {
      scores,
      phase: 'done',
      winner: ganhou,
      deadline: null,
      result: { reason: motivo, winner: ganhou, gain: ganho, game: scores[ganhou] >= 100 },
    });
  }

  function vencedorDaTranca(state, quantidade) {
    const totais = quantidade === 4
      ? [pontosNaMao(state, 0) + pontosNaMao(state, 2), pontosNaMao(state, 1) + pontosNaMao(state, 3)]
      : state.seats.map((id, lugar) => (id ? pontosNaMao(state, lugar) : Infinity));
    const menor = Math.min(...totais);
    if (totais.filter((valor) => valor === menor).length !== 1) return null;
    return totais.indexOf(menor);
  }

  function jogar(state, lugar, indice, ponta, at) {
    const pedra = state.hands[lugar][indice];
    if (!encaixa(state, pedra, ponta)) return state;
    const orientada = pedraOrientada(state, pedra, ponta);
    const hands = state.hands.map((mao) => mao.slice());
    hands[lugar].splice(indice, 1);
    const ends = ponta === 'left'
      ? [orientada[0], state.ends[1]]
      : [state.ends[0], orientada[1]];
    const table = ponta === 'left'
      ? [{ stone: orientada, end: ponta }].concat(state.table)
      : state.table.concat([{ stone: orientada, end: ponta }]);
    const next = Object.assign({}, state, { hands, ends, table, passes: 0 });
    return hands[lugar].length === 0 ? terminar(next, 'bateu', lugar) : comProximaVez(next, lugar, at);
  }

  function comprar(state, lugar, at) {
    if (!state.stock.length) return state;
    const hands = state.hands.map((mao) => mao.slice());
    hands[lugar].push(state.stock[0]);
    return Object.assign({}, state, {
      hands,
      stock: state.stock.slice(1),
      deadline: at + TEMPO_DA_VEZ,
    });
  }

  function passar(state, lugar, at) {
    const next = Object.assign({}, state, { passes: state.passes + 1 });
    return next.passes >= lugaresOcupados(state)
      ? terminar(next, 'trancou', null)
      : comProximaVez(next, lugar, at);
  }

  function timeout(state, at) {
    const lugar = state.turn;
    if (state.phase === 'opening') return abrir(state, lugar, 0, at);
    const indice = state.hands[lugar].findIndex((pedra) => encaixaNaPonta(state, pedra));
    if (indice >= 0) {
      const pedra = state.hands[lugar][indice];
      const ponta = pedra.includes(state.ends[0]) ? 'left' : 'right';
      return jogar(state, lugar, indice, ponta, at);
    }
    return state.stock.length ? comprar(state, lugar, at) : passar(state, lugar, at);
  }

  function sentar(state, action, ctx) {
    const seats = state.seats.slice();
    const names = state.names.slice();
    const preparado = C.prepareSeat(state, action, ctx);
    seats[action.seat] = C.fromOf(ctx);
    names[action.seat] = preparado.name;
    return Object.assign({}, state, { seats, names });
  }

  function reduce(state, action, ctx) {
    return C.safe(() => {
      const lugar = meuLugar(state, ctx);
      const at = numeroDaHora(action);
      switch (action.kind) {
        case 'sit': return sentar(state, action, ctx);
        case 'stand': return dropPeer(state, state.seats[lugar]);
        case 'start': return iniciarMao(state, action);
        case 'open': return abrir(state, lugar, action.stone, at);
        case 'play': return jogar(state, lugar, action.stone, action.end, at);
        case 'draw': return comprar(state, lugar, at);
        case 'pass': return passar(state, lugar, at);
        case 'timeout': return timeout(state, at);
        case 'reset': return init();
        default: return state;
      }
    }, state);
  }

  function dropPeer(state, peerId) {
    const lugar = C.seatOf(state, peerId);
    if (lugar < 0) return state;
    const seats = state.seats.slice();
    const names = state.names.slice();
    const hands = state.hands.map((mao) => mao.slice());
    seats[lugar] = null;
    names[lugar] = null;
    hands[lugar] = [];
    const next = Object.assign({}, state, { seats, names, hands });
    if (state.phase === 'play' && state.turn === lugar) return Object.assign({}, next, { turn: proximoLugar(next, lugar) });
    return next;
  }

  function view(state, peerId, ctx) {
    return C.safe(() => {
      const lugar = C.seatOf(state, peerId);
      const seats = state.seats.map((id, indice) => ocupante(state, indice, ctx));
      const validar = (action) => peerId
        ? validate(state, action, Object.assign({}, ctx, { from: peerId })) === true
        : false;
      return {
        seats,
        names: state.names.map((name, indice) => (seats[indice] ? name : null)),
        counts: state.hands.map((mao) => mao.length),
        hand: lugar >= 0 ? state.hands[lugar].map((pedra) => pedra.slice()) : [],
        stock: state.stock.length,
        table: state.table.map((item) => ({ stone: item.stone.slice(), end: item.end })),
        ends: state.ends && state.ends.slice(),
        scores: state.scores.slice(),
        phase: state.phase,
        turn: state.turn,
        deadline: state.deadline,
        result: state.result,
        me: {
          seat: lugar,
          can: {
            sit: Array.from({ length: LUGARES }, (_, indice) => validar({ kind: 'sit', seat: indice })),
            stand: validar({ kind: 'stand' }),
            start: validar({ kind: 'start' }),
            open: validar({ kind: 'open', stone: 0 }),
            draw: validar({ kind: 'draw' }),
            pass: validar({ kind: 'pass' }),
            reset: validar({ kind: 'reset' }),
          },
        },
      };
    }, null);
  }

  function migrate(state) {
    return Object.assign(init(), {
      seats: state.seats.slice(),
      names: state.names.slice(),
      scores: state.scores.slice(),
    });
  }

  function timeoutAt(state) {
    return ['play', 'opening'].includes(state.phase) && Number.isFinite(state.deadline) ? state.deadline : null;
  }

  function summary(state) {
    if (state.result) return state.result.winner === null ? 'Mão trancada' : 'Mão encerrada';
    return state.phase === 'play' ? 'Partida em andamento' : 'Aguardando jogadores';
  }

  const mod = {
    type: 'domino',
    title: 'Dominó',
    group: 'jogos',
    size: { w: 720, h: 480, minW: 420, minH: 300, aspect: null },
    maxStateBytes: 8192,
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
    TEMPO_DA_VEZ,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules.domino = mod;
  if (typeof module !== 'undefined') module.exports = mod;
})(typeof window !== 'undefined' ? window : global);
