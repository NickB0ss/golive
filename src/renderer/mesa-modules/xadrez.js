'use strict';

/*
 * Xadrez -- modulo de janela da mesa (contrato em
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secao 1).
 *
 * A regra e toda do chess.js (src/renderer/vendor/chess.js, BSD-2): aqui so
 * entram as cadeiras, a vez e o formato do estado. No renderer o
 * vendor/chess.js vem por <script> ANTES deste arquivo (GoLive.chessjs); no
 * Node vem por `module.require`.
 *
 * Estado:
 *   - `fen`: a posicao atual (a interface desenha so por ela);
 *   - `seen`: marcas curtas (hash) das posicoes desde o ultimo lance
 *     irreversivel (peao ou captura, quando o contador de meios-lances
 *     zera), a atual inclusive. Posicao de antes de um lance irreversivel
 *     nunca volta, entao basta isso para a repeticao tripla; e nunca passa
 *     de 101 marcas, porque ai a regra dos 50 lances encerra. A posicao da
 *     marca sao os 4 primeiros campos do FEN do chess.js (pecas, vez,
 *     roques e en passant so quando da para capturar): o criterio da FIDE.
 *     Guardar a lista de lances e refazer a partida no chess.js a cada
 *     lance custava ate ~40 ms por lance; assim custa um lance so;
 *   - `san`: os ultimos lances em SAN, para mostrar ('e4', 'Nf3', 'O-O');
 *   - `turn`: cadeira da vez (0 = brancas, comecam); `check`: em xeque;
 *   - `last`: { from, to } do ultimo lance, para destacar.
 * Fim automatico por xeque-mate, afogamento, material insuficiente,
 * repeticao tripla e regra dos 50 lances. Sem relogio.
 *
 * Acoes: { kind: 'sit', seat } | { kind: 'stand' } | { kind: 'reset' } |
 *        { kind: 'resign' } | { kind: 'move', from: 'e2', to: 'e4', promotion?: 'q'|'r'|'b'|'n' }
 */

(function (root) {
  const C = (root.GoLive && root.GoLive.mesaCadeiras)
    || (typeof module !== 'undefined' && typeof module.require === 'function' ? module.require('./cadeiras') : null);
  const chessjs = (root.GoLive && root.GoLive.chessjs)
    || (typeof module !== 'undefined' && typeof module.require === 'function' ? module.require('../vendor/chess.js') : null);

  const LABELS = ['Brancas', 'Pretas'];
  const SAN_MAX = 40;
  const SQUARE = /^[a-h][1-8]$/;
  const PROMOTIONS = ['q', 'r', 'b', 'n'];
  // O mesmo que chessjs.DEFAULT_POSITION; literal para o arquivo carregar
  // mesmo se o vendor faltar (ai so os lances e que falham, sem lancar).
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  function freshGame() {
    return {
      fen: START_FEN, seen: [positionMark(START_FEN)], san: [],
      turn: 0, moves: 0, check: false, result: null, last: null,
    };
  }

  function init() {
    return Object.assign(C.emptySeats(), freshGame());
  }

  /** Marca curta da posicao para a repeticao: cyrb53 (hash de 53 bits,
   * dominio publico) dos 4 primeiros campos do FEN, em base 36. */
  function positionMark(fen) {
    const key = fen.split(' ').slice(0, 4).join(' ');
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < key.length; i++) {
      const ch = key.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  function checkMove(state, action) {
    const { from, to, promotion } = action;
    if (typeof from !== 'string' || !SQUARE.test(from)) return 'Casa de saída inválida';
    if (typeof to !== 'string' || !SQUARE.test(to)) return 'Casa de chegada inválida';
    if (promotion !== undefined && !PROMOTIONS.includes(promotion)) return 'Peça de promoção inválida';
    const game = new chessjs.Chess(state.fen);
    const cands = game.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!cands.length) return 'Lance inválido';
    const promo = cands.some((m) => m.promotion);
    if (promo && promotion === undefined) return 'Escolha a peça da promoção';
    if (!promo && promotion !== undefined) return 'Só o peão na última fileira promove';
    return true;
  }

  /** Lances legais de uma casa, para a interface marcar os destinos:
   * `[{ to, promotion }]`. Casa invalida ou estado quebrado da lista vazia. */
  function legalMoves(state, from) {
    return C.safe(() => {
      if (typeof from !== 'string' || !SQUARE.test(from)) return [];
      return new chessjs.Chess(state.fen).moves({ square: from, verbose: true })
        .map((m) => ({ to: m.to, promotion: m.promotion || null }));
    }, []);
  }

  /** `true` se `peerId` pode lancar agora (sentado, com adversario, na vez),
   * ou o motivo. Para a interface, sem montar um lance de mentira. */
  function canPlay(state, peerId) {
    return C.safe(() => C.canPlay(state, { from: peerId }, state.turn), 'Ação inválida');
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

  function resultOf(game, seat, seen, mark) {
    if (game.isCheckmate()) return { winner: seat, reason: 'mate' };
    if (game.isStalemate()) return { winner: null, reason: 'afogamento' };
    if (game.isInsufficientMaterial()) return { winner: null, reason: 'material' };
    if (seen.filter((m) => m === mark).length >= 3) return { winner: null, reason: 'repeticao' };
    if (game.isDrawByFiftyMoves()) return { winner: null, reason: 'cinquenta' };
    return null;
  }

  function play(state, action) {
    const seat = state.turn;
    const game = new chessjs.Chess(state.fen);
    const move = { from: action.from, to: action.to };
    if (action.promotion !== undefined) move.promotion = action.promotion;
    const done = game.move(move);
    const fen = game.fen();
    const halfMoves = Number(fen.split(' ')[4]);
    const mark = positionMark(fen);
    const seen = halfMoves === 0 ? [mark] : state.seen.concat([mark]);
    const result = resultOf(game, seat, seen, mark);
    return Object.assign({}, state, {
      fen,
      seen,
      san: state.san.concat([done.san]).slice(-SAN_MAX),
      turn: game.turn() === 'w' ? 0 : 1,
      moves: state.moves + 1,
      check: !result && game.inCheck(),
      result,
      last: { from: done.from, to: done.to },
    });
  }

  function reduce(state, action, ctx) {
    return C.safe(() => {
      if (validate(state, action, ctx) !== true) return state;
      if (C.isSeatAction(action)) return C.reduceSeat(state, action, ctx);
      if (action.kind === 'reset') return Object.assign({}, state, freshGame());
      if (action.kind === 'resign') {
        const seat = C.seatOf(state, C.fromOf(ctx));
        return Object.assign({}, state, { check: false, result: { winner: 1 - seat, reason: 'abandono' } });
      }
      return play(state, action);
    }, state);
  }

  function dropPeer(state, peerId) {
    return C.safe(() => C.dropPeer(state, peerId), state);
  }

  const DRAWS = {
    afogamento: 'Afogamento, empate',
    material: 'Empate por material insuficiente',
    repeticao: 'Empate por repetição',
    cinquenta: 'Empate pela regra dos 50 lances',
  };

  /** Resumo curto em portugues. `peers` e opcional (nomes atuais). */
  function summary(state, peers) {
    return C.safe(() => {
      const r = state.result;
      if (r) {
        if (DRAWS[r.reason]) return DRAWS[r.reason];
        const winner = C.nameOf(state, r.winner, LABELS, peers);
        if (r.reason === 'mate') return `Xeque-mate, ${winner} venceu`;
        return `${C.nameOf(state, 1 - r.winner, LABELS, peers)} desistiu, ${winner} venceu`;
      }
      const text = C.describePlaying(state, state.turn, LABELS, peers);
      return state.check && state.seats[0] && state.seats[1] ? `${text} (xeque)` : text;
    }, 'Xadrez');
  }

  /** So no servidor: o nome de quem senta vai na acao `sit`. */
  function prepare(state, action, ctx) {
    return C.safe(() => (C.isSeatAction(action) ? C.prepareSeat(state, action, ctx) : action), action);
  }

  const mod = {
    type: 'xadrez',
    title: 'Xadrez',
    group: 'jogos',
    size: { w: 480, h: 480, minW: 240, minH: 240, aspect: 1 },
    maxStateBytes: 4096,
    init,
    prepare,
    validate,
    reduce,
    dropPeer,
    legalMoves,
    canPlay,
    summary,
    positionMark,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules.xadrez = mod;

  if (typeof module !== 'undefined') module.exports = mod;
})(typeof window !== 'undefined' ? window : global);
