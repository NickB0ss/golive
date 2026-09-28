'use strict';

/*
 * Lig 4 -- modulo de janela da mesa (contrato em
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secao 1).
 *
 * Tabuleiro de 7 colunas por 6 linhas, com gravidade: a peca cai ate a casa
 * livre mais baixa da coluna. Quatro em linha (horizontal, vertical ou
 * diagonal) vence; tabuleiro cheio sem isso empata.
 *
 * Estado: `board` sao 6 strings de 7 casas, da linha de CIMA (0) para a de
 * baixo (5): '.' vazia, 'V' da cadeira 0 (vermelhas, comecam), 'A' da
 * cadeira 1 (amarelas). `last` = [linha, coluna] da ultima peca; `line` =
 * casas da sequencia vencedora, para a interface destacar.
 *
 * Acoes: { kind: 'sit', seat } | { kind: 'stand' } | { kind: 'reset' } |
 *        { kind: 'move', col: 0..6 }
 */

(function (root) {
  const C = (root.GoLive && root.GoLive.mesaCadeiras)
    || (typeof module !== 'undefined' && typeof module.require === 'function' ? module.require('./cadeiras') : null);

  const COLS = 7;
  const ROWS = 6;
  const MARKS = ['V', 'A'];
  const LABELS = ['Vermelhas', 'Amarelas'];
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function freshGame() {
    const board = [];
    for (let r = 0; r < ROWS; r++) board.push('.'.repeat(COLS));
    return { board, turn: 0, moves: 0, result: null, last: null, line: null };
  }

  function init() {
    return Object.assign(C.emptySeats(), freshGame());
  }

  /** Linha onde a peca para na coluna, ou -1 se a coluna esta cheia. */
  function landingRow(board, col) {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r][col] === '.') return r;
    }
    return -1;
  }

  /** Sequencia de 4+ que passa por (r, c), ou null. */
  function winLine(board, r, c) {
    const mark = board[r][c];
    const at = (rr, cc) => rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === mark;
    for (const [dr, dc] of DIRS) {
      let r0 = r;
      let c0 = c;
      while (at(r0 - dr, c0 - dc)) { r0 -= dr; c0 -= dc; }
      const cells = [];
      for (let rr = r0, cc = c0; at(rr, cc); rr += dr, cc += dc) cells.push([rr, cc]);
      if (cells.length >= 4) return cells;
    }
    return null;
  }

  function checkMove(state, action) {
    const col = action.col;
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return 'Coluna inválida';
    if (landingRow(state.board, col) < 0) return 'Coluna cheia';
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

  function play(state, col) {
    const r = landingRow(state.board, col);
    const board = state.board.slice();
    board[r] = board[r].slice(0, col) + MARKS[state.turn] + board[r].slice(col + 1);
    const moves = state.moves + 1;
    const line = winLine(board, r, col);
    let result = null;
    if (line) result = { winner: state.turn, reason: 'linha' };
    else if (moves === ROWS * COLS) result = { winner: null, reason: 'empate' };
    return Object.assign({}, state, {
      board, moves, line, result, last: [r, col], turn: result ? state.turn : 1 - state.turn,
    });
  }

  function reduce(state, action, ctx) {
    return C.safe(() => {
      if (validate(state, action, ctx) !== true) return state;
      if (C.isSeatAction(action)) return C.reduceSeat(state, action, ctx);
      if (action.kind === 'reset') return Object.assign({}, state, freshGame());
      return play(state, action.col);
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
        if (r.winner === null) return 'Empate, tabuleiro cheio';
        return `${C.nameOf(state, r.winner, LABELS, peers)} venceu`;
      }
      return C.describePlaying(state, state.turn, LABELS, peers);
    }, 'Lig 4');
  }

  /** So no servidor: o nome de quem senta vai na acao `sit`. */
  function prepare(state, action, ctx) {
    return C.safe(() => (C.isSeatAction(action) ? C.prepareSeat(state, action, ctx) : action), action);
  }

  const mod = {
    type: 'lig4',
    title: 'Lig 4',
    group: 'jogos',
    size: { w: 420, h: 360, minW: 210, minH: 180, aspect: COLS / ROWS },
    maxStateBytes: 1024,
    COLS,
    ROWS,
    init,
    prepare,
    validate,
    reduce,
    dropPeer,
    summary,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules.lig4 = mod;

  if (typeof module !== 'undefined') module.exports = mod;
})(typeof window !== 'undefined' ? window : global);
