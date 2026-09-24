'use strict';

/*
 * Jogo da velha -- modulo de janela da mesa (contrato em
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secao 1).
 *
 * Estado: `board` e uma string de 9 casas, linha a linha de cima para
 * baixo ('.' vazia, 'X' da cadeira 0, 'O' da cadeira 1). A cadeira 0 (X)
 * comeca. `line` guarda as 3 casas da vitoria, para a interface riscar.
 *
 * Acoes: { kind: 'sit', seat } | { kind: 'stand' } | { kind: 'reset' } |
 *        { kind: 'move', cell: 0..8 }
 */

(function (root) {
  const C = (root.GoLive && root.GoLive.mesaCadeiras)
    || (typeof module !== 'undefined' && typeof module.require === 'function' ? module.require('./cadeiras') : null);

  const MARKS = ['X', 'O'];
  const LABELS = ['X', 'O'];
  const EMPTY_BOARD = '.........';
  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  function freshGame() {
    return { board: EMPTY_BOARD, turn: 0, moves: 0, result: null, line: null };
  }

  function init() {
    return Object.assign(C.emptySeats(), freshGame());
  }

  function winLine(board, mark) {
    for (const line of LINES) {
      if (line.every((i) => board[i] === mark)) return line.slice();
    }
    return null;
  }

  function checkMove(state, action) {
    const cell = action.cell;
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) return 'Casa inválida';
    if (state.board[cell] !== '.') return 'Casa ocupada';
    return true;
  }

  function validate(state, action, ctx) {
    return C.safe(() => {
      if (!C.isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
      if (C.isSeatAction(action)) return C.validateSeat(state, action, ctx);
      if (action.kind === 'reset') return C.canReset(state, ctx);
      if (action.kind === 'move') {
        const ok = C.canPlay(state, ctx, state.turn);
        return ok === true ? checkMove(state, action) : ok;
      }
      return 'Ação desconhecida';
    }, 'Ação inválida');
  }

  function play(state, cell) {
    const mark = MARKS[state.turn];
    const board = state.board.slice(0, cell) + mark + state.board.slice(cell + 1);
    const moves = state.moves + 1;
    const line = winLine(board, mark);
    let result = null;
    if (line) result = { winner: state.turn, reason: 'linha' };
    else if (moves === 9) result = { winner: null, reason: 'velha' };
    return Object.assign({}, state, { board, moves, line, result, turn: result ? state.turn : 1 - state.turn });
  }

  function reduce(state, action, ctx) {
    return C.safe(() => {
      if (validate(state, action, ctx) !== true) return state;
      if (C.isSeatAction(action)) return C.reduceSeat(state, action, ctx);
      if (action.kind === 'reset') return Object.assign({}, state, freshGame());
      return play(state, action.cell);
    }, state);
  }

  function dropPeer(state, peerId) {
    return C.safe(() => C.dropPeer(state, peerId), state);
  }

  /** Resumo curto em portugues. `peers` e opcional (nomes atuais). */
  function summary(state, peers) {
    return C.safe(() => {
      const r = state.result;
      if (r) {
        if (r.winner === null) return 'Deu velha';
        return `${C.nameOf(state, r.winner, LABELS, peers)} venceu`;
      }
      return C.describePlaying(state, state.turn, LABELS, peers);
    }, 'Jogo da velha');
  }

  const mod = {
    type: 'velha',
    title: 'Jogo da velha',
    group: 'jogos',
    size: { w: 360, h: 360, minW: 180, minH: 180, aspect: 1 },
    maxStateBytes: 1024,
    init,
    validate,
    reduce,
    dropPeer,
    summary,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules.velha = mod;

  if (typeof module !== 'undefined') module.exports = mod;
})(typeof window !== 'undefined' ? window : global);
