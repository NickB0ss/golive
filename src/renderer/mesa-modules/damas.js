'use strict';

/*
 * Damas, regra brasileira -- modulo de janela da mesa (contrato em
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secao 1).
 *
 * Regra:
 *   - 8 x 8, pecas nas casas escuras ((linha + coluna) impar), 12 de cada.
 *   - Pedra anda uma casa na diagonal para a frente; captura para a frente
 *     e para tras, pulando a peca adversaria para a casa livre logo depois.
 *   - Dama anda longe (voa) em qualquer diagonal e captura a distancia:
 *     passa por casas livres, pula UMA peca adversaria e para em qualquer
 *     casa livre depois dela.
 *   - Captura obrigatoria e em sequencia. Lei da maioria: vale so a
 *     sequencia que captura MAIS pecas (pedra e dama contam igual).
 *   - Durante a sequencia as pecas capturadas continuam no tabuleiro (nao
 *     se pula a mesma duas vezes, e elas bloqueiam) e saem todas no fim.
 *   - Promocao so se a pedra TERMINAR o lance na ultima fileira; passar por
 *     ela no meio de uma captura nao promove.
 *   - Vence quem deixa o adversario sem lance (sem pecas ou bloqueado).
 *   - Empate: 20 lances seguidos (de qualquer dos dois) so de damas, sem
 *     captura e sem mexer pedra.
 *
 * Estado: `board` sao 8 strings de 8 casas, da linha de CIMA (0) para a de
 * baixo (7): '.' vazia, 'c'/'C' pedra/dama clara (cadeira 0, comeca, sobe
 * para a linha 0), 'e'/'E' pedra/dama escura (cadeira 1, desce para a 7).
 * `kingMoves` conta os lances seguidos so de damas sem captura. `last` e o
 * ultimo lance ({ path, captures }), para a interface destacar.
 *
 * Acoes: { kind: 'sit', seat } | { kind: 'stand' } | { kind: 'reset' } |
 *        { kind: 'resign' } | { kind: 'move', path: [[l, c], [l, c], ...] }
 * `path` e o caminho completo: a casa de saida e cada casa onde a peca para.
 * `legalMoves(state)` devolve os lances permitidos agora, para a interface
 * marcar as casas.
 */

(function (root) {
  const C = (root.GoLive && root.GoLive.mesaCadeiras)
    || (typeof module !== 'undefined' && typeof module.require === 'function' ? module.require('./cadeiras') : null);

  const N = 8;
  const LABELS = ['Claras', 'Escuras'];
  const KINGS = ['C', 'E'];
  const FORWARD = [-1, 1];
  const PROMOTE_ROW = [0, N - 1];
  const KING_ONLY_DRAW = 20;
  const MAX_PATH = 16;
  const DIAGONALS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  function initialBoard() {
    const rows = [];
    for (let r = 0; r < N; r++) {
      let row = '';
      for (let c = 0; c < N; c++) {
        const dark = (r + c) % 2 === 1;
        row += !dark ? '.' : r < 3 ? 'e' : r > 4 ? 'c' : '.';
      }
      rows.push(row);
    }
    return rows;
  }

  function freshGame() {
    return { board: initialBoard(), turn: 0, moves: 0, kingMoves: 0, result: null, last: null };
  }

  function init() {
    return Object.assign(C.emptySeats(), freshGame());
  }

  function inside(r, c) {
    return r >= 0 && r < N && c >= 0 && c < N;
  }

  function ownerOf(ch) {
    if (ch === 'c' || ch === 'C') return 0;
    if (ch === 'e' || ch === 'E') return 1;
    return -1;
  }

  function isKing(ch) {
    return ch === 'C' || ch === 'E';
  }

  /** Todas as sequencias de captura que saem de (r, c), ja completas (a
   * peca parou porque nao ha mais o que capturar). */
  function captureSequences(grid, r, c, seat, king) {
    const out = [];
    const taken = new Set();
    const key = (rr, cc) => rr * N + cc;
    const enemyAt = (rr, cc) => ownerOf(grid[rr][cc]) === 1 - seat && !taken.has(key(rr, cc));

    function dfs(r0, c0, path, captures) {
      let extended = false;
      for (const [dr, dc] of DIAGONALS) {
        if (king) {
          let rr = r0 + dr;
          let cc = c0 + dc;
          while (inside(rr, cc) && grid[rr][cc] === '.') { rr += dr; cc += dc; }
          if (!inside(rr, cc) || !enemyAt(rr, cc)) continue;
          const mr = rr;
          const mc = cc;
          rr += dr;
          cc += dc;
          while (inside(rr, cc) && grid[rr][cc] === '.') {
            extended = true;
            taken.add(key(mr, mc));
            dfs(rr, cc, path.concat([[rr, cc]]), captures.concat([[mr, mc]]));
            taken.delete(key(mr, mc));
            rr += dr;
            cc += dc;
          }
        } else {
          const mr = r0 + dr;
          const mc = c0 + dc;
          const lr = mr + dr;
          const lc = mc + dc;
          if (!inside(lr, lc) || !enemyAt(mr, mc) || grid[lr][lc] !== '.') continue;
          extended = true;
          taken.add(key(mr, mc));
          dfs(lr, lc, path.concat([[lr, lc]]), captures.concat([[mr, mc]]));
          taken.delete(key(mr, mc));
        }
      }
      if (!extended && captures.length) out.push({ path, captures });
    }

    dfs(r, c, [[r, c]], []);
    return out;
  }

  function simpleMoves(grid, r, c, seat, king) {
    const out = [];
    for (const [dr, dc] of DIAGONALS) {
      if (!king && dr !== FORWARD[seat]) continue;
      let rr = r + dr;
      let cc = c + dc;
      while (inside(rr, cc) && grid[rr][cc] === '.') {
        out.push({ path: [[r, c], [rr, cc]], captures: [] });
        if (!king) break;
        rr += dr;
        cc += dc;
      }
    }
    return out;
  }

  /** Lances permitidos para `seat` no tabuleiro `board` (8 strings). */
  function movesFor(board, seat) {
    const grid = board.map((row) => row.split(''));
    const captures = [];
    const simples = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const ch = grid[r][c];
        if (ownerOf(ch) !== seat) continue;
        const king = isKing(ch);
        grid[r][c] = '.'; // a peca pode passar pela casa de onde saiu
        for (const m of captureSequences(grid, r, c, seat, king)) captures.push(m);
        grid[r][c] = ch;
        if (!captures.length) {
          for (const m of simpleMoves(grid, r, c, seat, king)) simples.push(m);
        }
      }
    }
    if (!captures.length) return simples;
    const best = Math.max(...captures.map((m) => m.captures.length));
    return captures.filter((m) => m.captures.length === best);
  }

  /** Lances permitidos agora (vazio se a partida acabou). */
  function legalMoves(state) {
    return C.safe(() => (state.result ? [] : movesFor(state.board, state.turn)), []);
  }

  function samePath(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
    }
    return true;
  }

  function isPath(path) {
    return Array.isArray(path) && path.length >= 2 && path.length <= MAX_PATH
      && path.every((p) => Array.isArray(p) && p.length === 2
        && Number.isInteger(p[0]) && Number.isInteger(p[1]) && inside(p[0], p[1]));
  }

  function findMove(state, path) {
    const legal = movesFor(state.board, state.turn);
    const hit = legal.find((m) => samePath(m.path, path));
    return { legal, hit };
  }

  function checkMove(state, action) {
    if (!isPath(action.path)) return 'Caminho inválido';
    const { legal, hit } = findMove(state, action.path);
    if (hit) return true;
    const need = legal.length ? legal[0].captures.length : 0;
    if (need === 1) return 'Captura obrigatória';
    if (need > 1) return `Captura obrigatória de ${need} peças (lei da maioria)`;
    return 'Lance inválido';
  }

  function validate(state, action, ctx) {
    return C.safe(() => {
      if (!C.isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
      if (C.isSeatAction(action)) return C.validateSeat(state, action, ctx);
      if (action.kind === 'reset') return C.canReset(state, ctx);
      if (action.kind === 'resign') return C.canResign(state, ctx);
      if (action.kind === 'move') {
        const ok = C.canPlay(state, ctx, state.turn);
        return ok === true ? checkMove(state, action) : ok;
      }
      return 'Ação desconhecida';
    }, 'Ação inválida');
  }

  function play(state, move) {
    const seat = state.turn;
    const grid = state.board.map((row) => row.split(''));
    const [r0, c0] = move.path[0];
    const [r1, c1] = move.path[move.path.length - 1];
    const piece = grid[r0][c0];
    const wasKing = isKing(piece);
    grid[r0][c0] = '.';
    for (const [r, c] of move.captures) grid[r][c] = '.';
    grid[r1][c1] = !wasKing && r1 === PROMOTE_ROW[seat] ? KINGS[seat] : piece;
    const board = grid.map((row) => row.join(''));

    const kingMoves = wasKing && !move.captures.length ? state.kingMoves + 1 : 0;
    let result = null;
    if (!movesFor(board, 1 - seat).length) result = { winner: seat, reason: 'sem-lances' };
    else if (kingMoves >= KING_ONLY_DRAW) result = { winner: null, reason: 'damas' };

    return Object.assign({}, state, {
      board,
      kingMoves,
      result,
      moves: state.moves + 1,
      turn: result ? seat : 1 - seat,
      last: { path: move.path.map((p) => [p[0], p[1]]), captures: move.captures },
    });
  }

  function reduce(state, action, ctx) {
    return C.safe(() => {
      if (validate(state, action, ctx) !== true) return state;
      if (C.isSeatAction(action)) return C.reduceSeat(state, action, ctx);
      if (action.kind === 'reset') return Object.assign({}, state, freshGame());
      if (action.kind === 'resign') {
        const seat = C.seatOf(state, C.fromOf(ctx));
        return Object.assign({}, state, { result: { winner: 1 - seat, reason: 'abandono' } });
      }
      return play(state, findMove(state, action.path).hit);
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
        if (r.reason === 'damas') return `Empate, ${KING_ONLY_DRAW} lances só de damas`;
        const winner = C.nameOf(state, r.winner, LABELS, peers);
        if (r.reason === 'abandono') return `${C.nameOf(state, 1 - r.winner, LABELS, peers)} desistiu, ${winner} venceu`;
        return `${winner} venceu`;
      }
      return C.describePlaying(state, state.turn, LABELS, peers);
    }, 'Damas');
  }

  const mod = {
    type: 'damas',
    title: 'Damas',
    group: 'jogos',
    size: { w: 480, h: 480, minW: 240, minH: 240, aspect: 1 },
    maxStateBytes: 2048,
    KING_ONLY_DRAW,
    init,
    validate,
    reduce,
    dropPeer,
    summary,
    legalMoves,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules.damas = mod;

  if (typeof module !== 'undefined') module.exports = mod;
})(typeof window !== 'undefined' ? window : global);
