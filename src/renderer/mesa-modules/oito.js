'use strict';

/*
 * Oito maluco -- modulo secreto da Mesa (contrato, secoes 1, 8 e 10).
 *
 * Regras: 2 a 8 pessoas; sete cartas com duas pessoas, cinco com mais;
 * carta de mesmo naipe/valor ou 8, que escolhe o naipe; compra ate conseguir
 * jogar; 8 vale 50, figuras 10, as 1 e numeros seu valor; vence aos 100.
 * Cada decisao dura 30 s e o timeout compra uma carta (se houver) e passa.
 *
 * Escolhas classicas que o contrato nao detalha: se a carta inicial for 8,
 * seu naipe impresso vale para a primeira vez; a acao de comprar baixa logo
 * a primeira carta jogavel (o naipe enviado escolhe o de um 8 comprado).
 * Ao esgotar o monte, reembaralhamos o descarte menos a carta de cima; se
 * ainda nao houver carta, a pessoa passa. Mudar de rodada por saida tambem
 * cancela as maos, para que segredo algum fique no estado aproveitavel.
 */

(function (root) {
  const req = (name) => (
    typeof module !== 'undefined' && typeof module.require === 'function'
      ? module.require(name)
      : null
  );
  const B = (root.GoLive && root.GoLive.mesaBaralho) || req('./baralho');
  const N = 8;
  const TURN_MS = 30000;
  const SUITS = ['s', 'h', 'd', 'c'];
  const KINDS = ['sit', 'stand', 'start', 'play', 'draw', 'timeout', 'reset'];

  const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const fromOf = (ctx) => (
    obj(ctx) && typeof ctx.from === 'string' && ctx.from ? ctx.from : null
  );
  const liveIds = (ctx) => new Set(
    Array.isArray(ctx && ctx.peers)
      ? ctx.peers.map((p) => p && p.id).filter((id) => typeof id === 'string')
      : [],
  );
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const fill = (v) => Array.from({ length: N }, () => Array.isArray(v) ? v.slice() : v);
  const seatOf = (s, id) => (
    typeof id === 'string' && Array.isArray(s && s.seats) ? s.seats.indexOf(id) : -1
  );
  const occupied = (s, i, ctx) => {
    const id = s.seats[i];
    return id !== null && (!Array.isArray(ctx && ctx.peers) || liveIds(ctx).has(id));
  };
  const players = (s, ctx) => Array.from({ length: N }, (_, i) => i).filter((i) => occupied(s, i, ctx));
  const next = (s, seat, ctx) => {
    const p = players(s, ctx);
    if (!p.length) return -1;
    for (let k = 1; k <= N; k += 1) {
      const i = (seat + k) % N;
      if (p.includes(i)) return i;
    }
    return -1;
  };
  const nameOf = (ctx, id) => (
    Array.isArray(ctx && ctx.peers)
      ? ctx.peers.find((p) => p && p.id === id)
      : null
  )?.name || null;
  const canPlay = (card, suit, top) => B.isCard(card)
    && (card[0] === '8' || card[1] === suit || (B.isCard(top) && card[0] === top[0]));
  const value = (card) => {
    if (card[0] === '8') return 50;
    if (['K', 'Q', 'J'].includes(card[0])) return 10;
    if (card[0] === 'A') return 1;
    return Number(card[0] === 'T' ? 10 : card[0]);
  };
  const points = (hand) => hand.reduce((sum, card) => sum + value(card), 0);
  const cleanRound = (s, phase = 'waiting') => Object.assign({}, s, {
    phase, hands: fill([]), deck: [], discard: [], suit: null, turn: -1, deadline: null, last: null,
  });

  function init() {
    return {
      seats: fill(null),
      names: fill(null),
      scores: fill(0),
      phase: 'waiting',
      hands: fill([]),
      deck: [],
      discard: [],
      suit: null,
      turn: -1,
      deadline: null,
      last: null,
      winner: null,
    };
  }

  function validate(s, action, ctx) {
    try {
      if (!obj(s) || !obj(action) || !KINDS.includes(action.kind)) return 'Ação inválida';
      const from = fromOf(ctx);
      if (!from) return 'Quem mandou?';
      const me = seatOf(s, from);
      if (action.kind === 'sit') {
        if (!Number.isInteger(action.seat) || action.seat < 0 || action.seat >= N) {
          return 'Lugar inválido';
        }
        if (me >= 0 && occupied(s, me, ctx)) return 'Você já está jogando';
        return occupied(s, action.seat, ctx) ? 'Lugar ocupado' : true;
      }
      if (action.kind === 'stand') return me >= 0 && occupied(s, me, ctx) ? true : 'Você não está jogando';
      if (action.kind === 'reset') {
        return ctx && ctx.isLeader === true
          ? true
          : (me >= 0 ? true : 'Só quem joga ou o líder reinicia');
      }
      if (action.kind === 'start') {
        if (s.phase === 'play') return 'A rodada ainda está correndo';
        return players(s, ctx).length >= 2 ? true : 'Precisa de 2 pessoas';
      }
      if (s.phase !== 'play') return 'A rodada não está correndo';
      if (action.kind === 'timeout') return true;
      if (me !== s.turn || !occupied(s, me, ctx)) return 'Não é a sua vez';
      if (action.kind === 'play') {
        if (!B.isCard(action.card) || !s.hands[me].includes(action.card)) return 'Carta inválida';
        if (!canPlay(action.card, s.suit, s.discard.at(-1))) return 'Essa carta não combina';
        if (action.card[0] === '8' && !SUITS.includes(action.suit)) return 'Escolha um naipe';
        return true;
      }
      if (action.kind === 'draw') {
        return s.hands[me].some((c) => canPlay(c, s.suit, s.discard.at(-1)))
          ? 'Você já pode jogar'
          : true;
      }
      return 'Ação inválida';
    } catch { return 'Ação inválida'; }
  }

  function prepare(s, action, ctx) {
    const at = Number.isFinite(ctx && ctx.now) ? ctx.now : 0;
    if (!obj(action)) return action;
    if (action.kind === 'sit') {
      return { kind: 'sit', seat: action.seat, name: nameOf(ctx, fromOf(ctx)) };
    }
    if (action.kind === 'start') {
      return { kind: 'start', deck: B.shuffle(B.newDeck(1), ctx.random), at };
    }
    if (action.kind === 'play') {
      return { kind: 'play', card: action.card, suit: action.suit, at };
    }
    if (action.kind === 'timeout') return { kind: 'timeout', at };
    if (action.kind !== 'draw') return { kind: action.kind, at };
    let deck = s.deck.slice();
    let discard = s.discard.slice();
    const bought = [];
    const random = typeof ctx.random === 'function' ? ctx.random : () => 0;
    while (true) {
      if (!deck.length && discard.length > 1) {
        deck = B.shuffle(discard.slice(0, -1), random);
        discard = [discard.at(-1)];
      }
      if (!deck.length) break;
      const card = deck.shift();
      bought.push(card);
      if (canPlay(card, s.suit, discard.at(-1))) break;
    }
    return { kind: 'draw', cards: bought, deck, discard, suit: action.suit, at };
  }

  function finishRound(s, winner) {
    const gained = s.hands.reduce((sum, hand, i) => sum + (i === winner ? 0 : points(hand)), 0);
    s.scores[winner] += gained;
    s.last = { winner, points: gained };
    s.phase = s.scores[winner] >= 100 ? 'finished' : 'waiting';
    s.winner = s.phase === 'finished' ? winner : null;
    s.hands = fill([]);
    s.deck = [];
    s.discard = [];
    s.suit = null;
    s.turn = -1;
    s.deadline = null;
  }
  function putCard(s, seat, card, chosen, at, ctx) {
    s.hands[seat].splice(s.hands[seat].indexOf(card), 1);
    s.discard.push(card);
    s.suit = card[0] === '8' ? chosen : card[1];
    if (!s.hands[seat].length) {
      finishRound(s, seat);
      return;
    }
    s.turn = next(s, seat, ctx);
    s.deadline = s.turn < 0 ? null : at + TURN_MS;
  }
  function reduce(s, action, ctx) {
    try {
      if (!obj(s) || !obj(action)) return s;
      const from = fromOf(ctx);
      const me = seatOf(s, from);
      const at = Number.isFinite(action.at) ? action.at : 0;
      const out = clone(s);
      switch (action.kind) {
        case 'sit':
          out.seats[action.seat] = from;
          out.names[action.seat] = typeof action.name === 'string'
            ? action.name.slice(0, 32)
            : null;
          return out;
        case 'stand':
          out.seats[me] = null;
          out.names[me] = null;
          return cleanRound(out);
        case 'reset':
          return Object.assign(init(), {
            seats: out.seats,
            names: out.names,
            scores: fill(0),
          });
        case 'start': {
          const deck = Array.isArray(action.deck)
            && action.deck.length === 52
            && action.deck.every(B.isCard)
            ? action.deck.slice()
            : B.newDeck();
          const p = players(out, ctx);
          const count = p.length === 2 ? 7 : 5;
          out.hands = fill([]);
          out.deck = deck;
          for (let n = 0; n < count; n += 1) {
            for (const i of p) out.hands[i].push(out.deck.shift());
          }
          let top = out.deck.shift();
          if (!top) top = 'As';
          out.discard = [top];
          out.suit = top[1];
          out.phase = 'play';
          out.turn = p[0];
          out.deadline = at + TURN_MS;
          out.last = null;
          out.winner = null;
          return out;
        }
        case 'play':
          putCard(out, me, action.card, action.suit, at, ctx);
          return out;
        case 'draw': {
          const cards = Array.isArray(action.cards) && action.cards.every(B.isCard) ? action.cards : [];
          out.deck = Array.isArray(action.deck) ? action.deck.slice() : out.deck;
          out.discard = Array.isArray(action.discard) ? action.discard.slice() : out.discard;
          out.hands[me] = out.hands[me].concat(cards);
          const playable = cards.find((card) => canPlay(card, out.suit, out.discard.at(-1)));
          if (playable) putCard(out, me, playable, SUITS.includes(action.suit) ? action.suit : 's', at, ctx);
          else {
            out.turn = next(out, me, ctx);
            out.deadline = out.turn < 0 ? null : at + TURN_MS;
          }
          return out;
        }
        case 'timeout': {
          if (out.phase !== 'play' || out.turn < 0) return out;
          if (out.deck.length) out.hands[out.turn].push(out.deck.shift());
          out.turn = next(out, out.turn, ctx);
          out.deadline = out.turn < 0 ? null : at + TURN_MS;
          return out;
        }
        default: return out;
      }
    } catch { return s; }
  }

  function timeoutAt(s) {
    return s && s.phase === 'play' && Number.isFinite(s.deadline) ? s.deadline : null;
  }
  function dropPeer(s, peer) {
    const i = seatOf(s, peer);
    if (i < 0) return s;
    const out = clone(s);
    out.seats[i] = null;
    out.names[i] = null;
    return cleanRound(out);
  }
  function migrate(s) {
    return cleanRound(Object.assign(init(), {
      seats: s.seats.slice(),
      names: s.names.slice(),
      scores: s.scores.slice(),
    }));
  }
  function view(s, peer, ctx) {
    try {
      const ids = liveIds(ctx);
      const seats = s.seats.map((id) => (
        id && (!Array.isArray(ctx && ctx.peers) || ids.has(id)) ? id : null
      ));
      const me = seats.indexOf(peer);
      const can = (a) => peer && validate(
        Object.assign({}, s, { seats }),
        a,
        Object.assign({}, ctx, { from: peer }),
      ) === true;
      return {
        seats,
        names: s.names.map((n, i) => (seats[i] === null ? null : n)),
        scores: s.scores.slice(),
        phase: s.phase,
        counts: s.hands.map((h, i) => (seats[i] === null ? 0 : h.length)),
        hand: me >= 0 ? s.hands[me].slice() : [],
        discard: s.discard.length ? s.discard.at(-1) : null,
        suit: s.suit,
        turn: s.turn,
        deadline: s.deadline,
        last: s.last && clone(s.last),
        winner: s.winner,
        me: {
          seat: me,
          can: {
            sit: Array.from({ length: N }, (_, i) => can({ kind: 'sit', seat: i })),
            stand: can({ kind: 'stand' }),
            start: can({ kind: 'start' }),
            play: me === s.turn,
            draw: can({ kind: 'draw' }),
            reset: can({ kind: 'reset' }),
          },
        },
      };
    } catch { return null; }
  }
  function summary(s) {
    const n = s && s.seats ? s.seats.filter(Boolean).length : 0;
    return n ? `Oito maluco — ${n} jogando` : 'Oito maluco — lugares livres';
  }

  const mod = {
    type: 'oito',
    title: 'Oito maluco',
    group: 'jogos',
    size: { w: 640, h: 400, minW: 420, minH: 280, aspect: 1.6 },
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
    N,
    TURN_MS,
    points,
    canPlay,
  };
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules.oito = mod;
  if (typeof module !== 'undefined') module.exports = mod;
})(globalThis);
