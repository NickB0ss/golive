'use strict';

/*
 * Pôquer (Texas Hold'em sem limite, fichas de mentira) -- modulo de janela
 * da mesa (contrato em docs/superpowers/plans/2026-09-24-mesa-contrato.md,
 * secoes 1, 8 e 9). Modulo `secret`: o estado inteiro (baralho, cartas de
 * todo mundo) so existe no servidor; cada pessoa recebe `view(state, id)`.
 *
 * Regras (secao 9): 2 a 8 cadeiras, 1 000 fichas ao sentar, blinds 10/20
 * (o lider troca entre maos: 5/10, 10/20, 25/50, 50/100). Botao do dealer
 * gira a cada mao; mano a mano o botao paga o small blind e fala primeiro no
 * pre-flop e por ultimo depois. Queima uma carta antes de cada rodada
 * comunitaria. Aposta minima = big blind; aumento minimo = o maior aumento
 * da rodada; all-in menor que um aumento completo nao reabre a acao para
 * quem ja agiu. Potes paralelos; empate divide, a ficha que sobra vai para o
 * primeiro a esquerda do botao. 30 s por decisao: estourou, passa se puder,
 * senao desiste. Recompra (volta a 1 000) com zero fichas, fora da mao.
 * Quem sai (Levantar ou saiu da sala) no meio da mao desiste dela.
 *
 * Estado (so no servidor):
 *   seats[8], names[8], stacks[8] (fichas atras, fora do que ja apostou),
 *   level (indice em LEVELS), button (cadeira, -1 antes da 1a mao), handNo,
 *   ev: o ultimo acontecimento, para o anuncio ({ n, seat, name, kind, to, amount }),
 *   hand: null | {
 *     no, ids[8] (quem estava em cada cadeira ao dar as cartas),
 *     deck (o resto do baralho; SEGREDO), holes[8] ([c, c] | null; SEGREDO),
 *     board, street ('preflop'|'flop'|'turn'|'river'|'fim'),
 *     status[8] ('in' | 'allin' | 'folded' | null = fora da mao),
 *     bets[8] (desta rodada), contrib[8] (da mao inteira, apostas desta
 *     rodada inclusive), currentBet, fullBet (a aposta do ultimo aumento
 *     completo), minRaise (tamanho do maior aumento da rodada),
 *     acted[8] (null = nao agiu nesta rodada; senao o `fullBet` de quando
 *     agiu: pode aumentar de novo so se o `fullBet` subiu depois),
 *     toAct (cadeira da vez, -1 = ninguem), deadline (hora do servidor),
 *     sbSeat, bbSeat, sb, bb,
 *     result: null | { byFold, pots: [{ amount, winners, name }], shown, hands }
 *   }
 *
 * Acoes (`to` = total apostado NESTA rodada depois da acao, "aumentar para"):
 *   { kind: 'sit', seat: 0..7 } | { kind: 'stand' } | { kind: 'deal' } |
 *   { kind: 'rebuy' } | { kind: 'blinds', level: 0..3 } (lider, fora da mao) |
 *   { kind: 'fold' } | { kind: 'check' } | { kind: 'call' } |
 *   { kind: 'bet', to } | { kind: 'raise', to } | { kind: 'allin' } |
 *   { kind: 'timeout' }
 * `prepare` (so no servidor) poe `at` (ctx.now) em toda acao, o `name` no
 * `sit` e o baralho embaralhado (ctx.random) no `deal`.
 */

(function (root) {
  const req = (name) => (typeof module !== 'undefined' && typeof module.require === 'function' ? module.require(name) : null);
  const B = (root.GoLive && root.GoLive.mesaBaralho) || req('./baralho');
  const M = (root.GoLive && root.GoLive.mesaPoquerMaos) || req('./poquer-maos');

  const N = 8;
  const STACK = 1000;
  const TURN_MS = 30000;
  const LEVELS = Object.freeze([[5, 10], [10, 20], [25, 50], [50, 100]].map((l) => Object.freeze(l)));
  const DEFAULT_LEVEL = 1;
  const NAME_MAX = 32;
  const TURN_KINDS = Object.freeze(['fold', 'check', 'call', 'bet', 'raise', 'allin']);
  const KINDS = Object.freeze(['sit', 'stand', 'deal', 'rebuy', 'blinds', 'timeout', ...TURN_KINDS]);

  // ---------- Pequenas ----------

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function fromOf(ctx) {
    const f = isObj(ctx) ? ctx.from : null;
    return typeof f === 'string' && f ? f : null;
  }

  function fill(v) {
    return new Array(N).fill(v);
  }

  function clone(s) {
    return JSON.parse(JSON.stringify(s));
  }

  function safe(fn, fallback) {
    try {
      return fn();
    } catch {
      return fallback;
    }
  }

  function seatOf(state, peerId) {
    return typeof peerId === 'string' ? state.seats.indexOf(peerId) : -1;
  }

  /** Proxima cadeira depois de `from`, no sentido horario (indice
   * crescente), que satisfaz `pred`; -1 se nenhuma. `from` volta por ultimo. */
  function nextSeat(from, pred) {
    for (let k = 1; k <= N; k += 1) {
      const s = (((from + k) % N) + N) % N;
      if (pred(s)) return s;
    }
    return -1;
  }

  function sum(list) {
    return list.reduce((a, b) => a + b, 0);
  }

  // ---------- Mao ----------

  function active(h) {
    return !!h && !h.result;
  }

  /** A cadeira ainda disputa o pote (nao desistiu). */
  function live(h, i) {
    return h.status[i] === 'in' || h.status[i] === 'allin';
  }

  function countStatus(h, st) {
    return h.status.filter((x) => x === st).length;
  }

  /** Precisa falar nesta rodada: nao igualou a aposta, ou ainda nao agiu e
   * tem com quem disputar (alguem mais que ainda pode apostar). */
  function needsAct(h, i) {
    if (h.status[i] !== 'in') return false;
    if (h.bets[i] < h.currentBet) return true;
    return h.acted[i] === null && countStatus(h, 'in') >= 2;
  }

  /** Pode aumentar (ou apostar): ainda nao agiu, ou houve aumento completo
   * depois que agiu; e tem alguem mais com fichas para responder. */
  function canRaise(state, h, i) {
    const others = h.status.some((st, j) => j !== i && st === 'in');
    const reopened = h.acted[i] === null || h.acted[i] < h.fullBet;
    return others && reopened && state.stacks[i] > h.currentBet - h.bets[i];
  }

  /** Menor "aumentar para" possivel (sem contar o all-in curto). */
  function minTo(h) {
    return h.currentBet === 0 ? h.bb : h.currentBet + h.minRaise;
  }

  /**
   * Potes a partir do que cada cadeira pos (`contrib`) e de quem ainda
   * disputa (`live`): [{ amount, seats }]. Cada nivel de all-in abre um pote
   * paralelo; o que quem desistiu pos acima do ultimo nivel vai para o
   * ultimo pote. Pote com uma cadeira so e aposta que ninguem pagou (volta).
   */
  function computePots(contrib, liveSeats) {
    const levels = [...new Set(liveSeats.map((i) => contrib[i]).filter((v) => v > 0))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const L of levels) {
      let amount = 0;
      for (let i = 0; i < contrib.length; i += 1) amount += Math.max(0, Math.min(contrib[i], L) - prev);
      const seats = liveSeats.filter((i) => contrib[i] >= L);
      if (amount > 0) pots.push({ amount, seats });
      prev = L;
    }
    const rest = sum(contrib.map((c) => Math.max(0, c - prev)));
    if (rest > 0) {
      if (pots.length) pots[pots.length - 1].amount += rest;
      else pots.push({ amount: rest, seats: liveSeats.slice() });
    }
    return pots;
  }

  /** Divide `amount` entre `winners`; a sobra, ficha a ficha, a partir do
   * primeiro a esquerda do botao. Devolve [{ seat, amount }]. */
  function split(amount, winners, button) {
    const order = winners.slice().sort((a, b) => ((a - button - 1 + 2 * N) % N) - ((b - button - 1 + 2 * N) % N));
    const each = Math.floor(amount / order.length);
    let odd = amount - each * order.length;
    return order.map((seat) => {
      const extra = odd > 0 ? 1 : 0;
      odd -= extra;
      return { seat, amount: each + extra };
    });
  }

  function put(state, h, i, amount) {
    const a = Math.max(0, Math.min(amount, state.stacks[i]));
    state.stacks[i] -= a;
    h.bets[i] += a;
    h.contrib[i] += a;
    if (state.stacks[i] === 0 && h.status[i] === 'in') h.status[i] = 'allin';
    return a;
  }

  function drawCards(h, n) {
    const d = B.draw(h.deck, n);
    h.deck = d.rest;
    return d.cards;
  }

  function newRound(h) {
    h.bets = fill(0);
    h.currentBet = 0;
    h.fullBet = 0;
    h.minRaise = h.bb;
    h.acted = fill(null);
  }

  function finish(state, h, result) {
    h.result = result;
    h.street = 'fim';
    h.toAct = -1;
    h.deadline = null;
    h.deck = [];
    h.bets = fill(0);
  }

  /** Todos desistiram menos um: leva tudo sem mostrar. */
  function finishByFold(state, h) {
    const w = h.status.findIndex((st, i) => live(h, i));
    const amount = sum(h.contrib);
    state.stacks[w] += amount;
    finish(state, h, { byFold: true, pots: [{ amount, winners: [w], name: null }], shown: [], hands: {} });
  }

  /** Mostra as maos que chegaram e paga pote a pote. */
  function showdown(state, h) {
    const liveSeats = [];
    for (let i = 0; i < N; i += 1) if (live(h, i)) liveSeats.push(i);
    const hands = {};
    for (const i of liveSeats) {
      const b = M.best(h.holes[i].concat(h.board));
      hands[i] = { name: b.name, category: b.category, cards: b.cards, score: b.score };
    }
    const pots = [];
    for (const pot of computePots(h.contrib, liveSeats)) {
      const idx = M.winners(pot.seats.map((i) => hands[i]));
      const winners = idx.map((k) => pot.seats[k]);
      for (const p of split(pot.amount, winners, state.button)) state.stacks[p.seat] += p.amount;
      pots.push({ amount: pot.amount, winners, name: pot.seats.length > 1 ? hands[winners[0]].name : null });
    }
    for (const i of liveSeats) delete hands[i].score;
    finish(state, h, { byFold: false, pots, shown: liveSeats, hands });
  }

  /** Fim da rodada de apostas: proxima carta comunitaria, corrida ate o
   * fim (ninguem mais pode apostar) ou showdown. */
  function endRound(state, h, at) {
    newRound(h);
    if (h.street === 'river') {
      showdown(state, h);
      return;
    }
    const next = { preflop: ['flop', 3], flop: ['turn', 1], turn: ['river', 1] }[h.street];
    drawCards(h, 1); // queima
    h.board = h.board.concat(drawCards(h, next[1]));
    h.street = next[0];
    const first = nextSeat(state.button, (i) => needsAct(h, i));
    if (first < 0) {
      endRound(state, h, at);
      return;
    }
    h.toAct = first;
    h.deadline = at + TURN_MS;
  }

  /** Depois de uma acao ou de uma saida: acabou por desistencia? quem fala
   * agora (a partir de `from`, inclusive)? ou a rodada acabou? */
  function settle(state, h, from, at, keepDeadline) {
    if (h.status.filter((st, i) => live(h, i)).length <= 1) {
      finishByFold(state, h);
      return;
    }
    const nxt = needsAct(h, from) ? from : nextSeat(from, (i) => needsAct(h, i));
    if (nxt >= 0) {
      if (!(keepDeadline && nxt === h.toAct)) h.deadline = at + TURN_MS;
      h.toAct = nxt;
      return;
    }
    endRound(state, h, at);
  }

  function startHand(state, deck, at) {
    const inPlay = (i) => state.seats[i] !== null && state.stacks[i] > 0;
    const button = nextSeat(state.button, inPlay);
    const players = [];
    for (let k = 1; k <= N; k += 1) {
      const s = (button + k) % N;
      if (inPlay(s)) players.push(s);
    }
    const headsUp = players.length === 2;
    const sbSeat = headsUp ? button : nextSeat(button, inPlay);
    const bbSeat = nextSeat(sbSeat, inPlay);
    const [sb, bb] = LEVELS[state.level];
    state.button = button;
    state.handNo += 1;
    const h = {
      no: state.handNo,
      ids: state.seats.map((id, i) => (inPlay(i) ? id : null)),
      deck: deck.slice(),
      holes: fill(null),
      board: [],
      street: 'preflop',
      status: state.seats.map((id, i) => (inPlay(i) ? 'in' : null)),
      bets: fill(0),
      contrib: fill(0),
      currentBet: 0,
      fullBet: 0,
      minRaise: bb,
      acted: fill(null),
      toAct: -1,
      deadline: null,
      sbSeat,
      bbSeat,
      sb,
      bb,
      result: null,
    };
    // Duas voltas de uma carta, a partir do small blind.
    const order = [];
    for (let k = 0; k < N; k += 1) {
      const s = (sbSeat + k) % N;
      if (h.status[s]) order.push(s);
    }
    for (let r = 0; r < 2; r += 1) {
      for (const s of order) h.holes[s] = (h.holes[s] || []).concat(drawCards(h, 1));
    }
    put(state, h, sbSeat, sb);
    put(state, h, bbSeat, bb);
    h.currentBet = bb;
    h.fullBet = bb;
    state.hand = h;
    state.ev = { n: (state.ev ? state.ev.n : 0) + 1, seat: button, kind: 'deal', hand: h.no };
    settle(state, h, nextSeat(bbSeat, () => true), at, false);
  }

  /** A cadeira sai da mao (Levantar, saiu da sala): desiste, e as fichas
   * que pos ficam no pote. */
  function leaveHand(state, seat, at) {
    const h = state.hand;
    if (!active(h) || !live(h, seat) || h.ids[seat] !== state.seats[seat]) return;
    h.status[seat] = 'folded';
    h.bets[seat] = 0;
    h.holes[seat] = null;
    settle(state, h, h.toAct === seat ? nextSeat(seat, () => true) : h.toAct, at, h.toAct !== seat);
  }

  // ---------- Contrato ----------

  function init() {
    return {
      seats: fill(null),
      names: fill(null),
      stacks: fill(0),
      level: DEFAULT_LEVEL,
      button: -1,
      handNo: 0,
      hand: null,
      ev: null,
    };
  }

  function turnCheck(state, action, ctx) {
    const h = state.hand;
    if (!active(h)) return 'Nenhuma mão em andamento';
    const seat = seatOf(state, fromOf(ctx));
    if (seat < 0) return 'Sente-se para jogar';
    if (h.toAct !== seat || h.ids[seat] !== state.seats[seat]) return 'Não é a sua vez';
    const toCall = h.currentBet - h.bets[seat];
    const all = h.bets[seat] + state.stacks[seat];
    switch (action.kind) {
      case 'fold':
        return true;
      case 'check':
        return toCall === 0 ? true : 'Há aposta para pagar';
      case 'call':
        return toCall > 0 ? true : 'Não há o que pagar; passe';
      case 'allin':
        if (state.stacks[seat] <= toCall || canRaise(state, h, seat)) return true;
        return 'Não dá para aumentar agora; pague ou desista';
      case 'bet':
      case 'raise': {
        if (action.kind === 'bet' && h.currentBet > 0) return 'Já há aposta; aumente';
        if (action.kind === 'raise' && h.currentBet === 0) return 'Ninguém apostou; aposte';
        if (!Number.isInteger(action.to)) return 'Valor inválido';
        if (!canRaise(state, h, seat)) return 'Não dá para aumentar agora; pague ou desista';
        if (action.to > all) return 'Você não tem fichas para isso';
        if (action.to < minTo(h) && action.to !== all) return `O mínimo é ${minTo(h)}`;
        if (action.to <= h.currentBet) return `O mínimo é ${minTo(h)}`;
        return true;
      }
      default:
        return 'Ação inválida';
    }
  }

  function validate(state, action, ctx) {
    return safe(() => {
      if (!isObj(action) || !KINDS.includes(action.kind)) return 'Ação inválida';
      const from = fromOf(ctx);
      if (!from) return 'Quem mandou?';
      const seat = seatOf(state, from);
      const h = state.hand;
      switch (action.kind) {
        case 'sit':
          if (!Number.isInteger(action.seat) || action.seat < 0 || action.seat >= N) return 'Cadeira inválida';
          if (seat >= 0) return 'Você já está sentado';
          if (state.seats[action.seat] !== null) return 'Cadeira ocupada';
          return true;
        case 'stand':
          return seat >= 0 ? true : 'Você não está sentado';
        case 'deal': {
          if (seat < 0) return 'Sente-se para dar as cartas';
          if (active(h)) return 'A mão ainda não acabou';
          const ready = state.seats.filter((id, i) => id !== null && state.stacks[i] > 0).length;
          return ready >= 2 ? true : 'Precisa de 2 pessoas com fichas';
        }
        case 'rebuy':
          if (seat < 0) return 'Sente-se primeiro';
          if (state.stacks[seat] > 0) return 'Recompra só com zero fichas';
          if (active(h) && live(h, seat) && h.ids[seat] === from) return 'Espere a mão acabar';
          return true;
        case 'blinds': {
          if (!isObj(ctx) || ctx.isLeader !== true) return 'Só o líder troca os blinds';
          if (!Number.isInteger(action.level) || action.level < 0 || action.level >= LEVELS.length) return 'Blinds inválidos';
          if (active(h)) return 'Troque os blinds entre as mãos';
          return true;
        }
        case 'timeout': {
          if (!active(h) || h.toAct < 0) return 'Ninguém está com a vez';
          const now = Number(ctx.now);
          if (!Number.isFinite(now) || now < h.deadline) return 'Ainda há tempo';
          return true;
        }
        default:
          return turnCheck(state, action, ctx);
      }
    }, 'Ação inválida');
  }

  /** So no servidor: hora em toda acao, nome no `sit`, baralho no `deal`.
   * Guarda so os campos conhecidos. */
  function prepare(state, action, ctx) {
    return safe(() => {
      const at = Number(ctx && ctx.now);
      const out = { kind: action.kind, at: Number.isFinite(at) ? at : 0 };
      if (action.kind === 'sit') {
        out.seat = action.seat;
        const p = (Array.isArray(ctx.peers) ? ctx.peers : []).find((x) => isObj(x) && x.id === fromOf(ctx));
        out.name = p && typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, NAME_MAX) : null;
      } else if (action.kind === 'deal') {
        out.deck = B.shuffle(B.newDeck(1), ctx.random);
      } else if (action.kind === 'bet' || action.kind === 'raise') {
        out.to = action.to;
      } else if (action.kind === 'blinds') {
        out.level = action.level;
      }
      return out;
    }, action);
  }

  function event(state, seat, kind, extra) {
    state.ev = Object.assign({ n: (state.ev ? state.ev.n : 0) + 1, seat, kind, name: state.names[seat] || null }, extra || {});
  }

  function playTurn(state, seat, kind, action, at) {
    const h = state.hand;
    const toCall = h.currentBet - h.bets[seat];
    let evKind = kind;
    if (kind === 'fold') {
      h.status[seat] = 'folded';
      event(state, seat, 'fold');
    } else if (kind === 'check') {
      h.acted[seat] = h.fullBet;
      event(state, seat, 'check');
    } else if (kind === 'call') {
      const paid = put(state, h, seat, toCall);
      h.acted[seat] = h.fullBet;
      event(state, seat, h.status[seat] === 'allin' ? 'allin' : 'call', { amount: paid, to: h.bets[seat] });
    } else {
      const to = kind === 'allin' ? h.bets[seat] + state.stacks[seat] : action.to;
      put(state, h, seat, to - h.bets[seat]);
      const raise = to - h.currentBet;
      if (raise > 0) {
        if (raise >= h.minRaise) {
          // Aumento completo: reabre a acao para todos.
          h.minRaise = Math.max(h.minRaise, raise);
          h.fullBet = to;
        }
        if (kind === 'allin') evKind = 'allin';
        else evKind = h.currentBet === 0 ? 'bet' : 'raise';
        h.currentBet = to;
      } else {
        evKind = 'allin';
      }
      h.acted[seat] = h.fullBet;
      event(state, seat, evKind, { to: h.bets[seat] });
    }
    settle(state, h, nextSeat(seat, () => true), at, false);
  }

  function reduce(state, action, ctx) {
    return safe(() => {
      // O servidor ja conferiu o prazo do `timeout` com a hora dele antes do
      // `prepare`; aqui so as outras regras (o `ctx` do reduce nao tem hora).
      if (validate(state, action, Object.assign({}, ctx, { now: Number.MAX_SAFE_INTEGER })) !== true) return state;
      const s = clone(state);
      const from = fromOf(ctx);
      const seat = seatOf(s, from);
      const at = Number.isFinite(action.at) ? action.at : 0;
      switch (action.kind) {
        case 'sit': {
          s.seats[action.seat] = from;
          s.names[action.seat] = typeof action.name === 'string' && action.name.trim() ? action.name.trim().slice(0, NAME_MAX) : null;
          s.stacks[action.seat] = STACK;
          event(s, action.seat, 'sit');
          return s;
        }
        case 'stand':
          event(s, seat, 'stand');
          leaveHand(s, seat, at);
          s.seats[seat] = null;
          s.names[seat] = null;
          s.stacks[seat] = 0;
          return s;
        case 'deal': {
          const deck = Array.isArray(action.deck) && action.deck.length === 52 && new Set(action.deck).size === 52
            && action.deck.every(B.isCard) ? action.deck : B.newDeck(1);
          startHand(s, deck, at);
          return s;
        }
        case 'rebuy':
          s.stacks[seat] = STACK;
          event(s, seat, 'rebuy');
          return s;
        case 'blinds':
          s.level = action.level;
          event(s, -1, 'blinds', { level: action.level });
          return s;
        case 'timeout': {
          const h = s.hand;
          const who = h.toAct;
          const kind = h.currentBet - h.bets[who] === 0 ? 'check' : 'fold';
          playTurn(s, who, kind, action, at);
          s.ev.timeout = true;
          return s;
        }
        default:
          playTurn(s, seat, action.kind, action, at);
          return s;
      }
    }, state);
  }

  /** O que `peerId` pode ver (null = quem so assiste). Nunca leva o
   * baralho nem cartas alheias antes do showdown. */
  function view(state, peerId) {
    return safe(() => {
      const h = state.hand;
      const seat = seatOf(state, peerId);
      const [sb, bb] = LEVELS[state.level];
      const out = {
        seats: state.seats.slice(),
        names: state.names.slice(),
        stacks: state.stacks.slice(),
        level: state.level,
        blinds: { sb, bb },
        levels: LEVELS.map((l) => l.slice()),
        button: state.button,
        handNo: state.handNo,
        ev: state.ev ? clone(state.ev) : null,
        hand: null,
        me: null,
      };
      if (h) {
        const r = h.result;
        const shown = r ? r.shown : [];
        const liveSeats = [];
        for (let i = 0; i < N; i += 1) if (live(h, i)) liveSeats.push(i);
        const collected = h.contrib.map((c, i) => c - h.bets[i]);
        out.hand = {
          no: h.no,
          street: h.street,
          board: h.board.slice(),
          status: h.status.map((st, i) => (st && h.ids[i] === state.seats[i] ? st : st ? 'folded' : null)),
          ids: h.ids.slice(),
          cards: h.holes.map((c, i) => (c && live(h, i) ? c.length : 0)),
          holes: h.holes.map((c, i) => (c && (shown.includes(i) || (peerId && h.ids[i] === peerId && state.seats[i] === peerId)) ? c.slice() : null)),
          bets: h.bets.slice(),
          currentBet: h.currentBet,
          toAct: h.toAct,
          deadline: h.deadline,
          sbSeat: h.sbSeat,
          bbSeat: h.bbSeat,
          sb: h.sb,
          bb: h.bb,
          pot: sum(h.contrib),
          pots: r ? [] : computePots(collected, liveSeats).filter((p) => p.seats.length > 0),
          result: r ? clone(r) : null,
        };
      }
      out.me = meOf(state, seat, peerId);
      return out;
    }, null);
  }

  /** O que a pessoa pode fazer agora, ja calculado (a interface nao tem o
   * estado inteiro para rodar `validate`). */
  function meOf(state, seat, peerId) {
    const me = {
      seat, actions: [], toCall: 0, minRaise: 0, maxRaise: 0, canCheck: false,
      myTurn: false, inHand: false, stack: seat >= 0 ? state.stacks[seat] : 0,
    };
    if (!peerId) return me;
    const ctx = { from: peerId };
    const h = state.hand;
    const freeSeat = state.seats.indexOf(null);
    const cands = [
      { kind: 'sit', seat: freeSeat }, { kind: 'stand' }, { kind: 'deal' }, { kind: 'rebuy' },
      { kind: 'fold' }, { kind: 'check' }, { kind: 'call' }, { kind: 'allin' },
    ];
    if (seat >= 0 && active(h) && h.toAct === seat) {
      const all = h.bets[seat] + state.stacks[seat];
      const lo = Math.min(minTo(h), all);
      me.toCall = Math.min(h.currentBet - h.bets[seat], state.stacks[seat]);
      me.minRaise = lo;
      me.maxRaise = all;
      cands.push({ kind: 'bet', to: lo }, { kind: 'raise', to: lo });
    }
    for (const a of cands) if (validate(state, a, ctx) === true) me.actions.push(a.kind);
    me.canCheck = me.actions.includes('check');
    me.myTurn = seat >= 0 && active(h) && h.toAct === seat;
    me.inHand = seat >= 0 && active(h) && live(h, seat) && h.ids[seat] === peerId;
    if (!me.actions.includes('bet') && !me.actions.includes('raise')) {
      me.minRaise = 0;
      me.maxRaise = 0;
    }
    return me;
  }

  /** Migracao (o retrato vai para todos): a mao em andamento e cancelada e
   * as apostas voltam para quem apostou; fichas e cadeiras ficam. */
  function migrate(state) {
    return safe(() => {
      const s = clone(state);
      const h = s.hand;
      if (active(h)) {
        for (let i = 0; i < N; i += 1) {
          if (s.seats[i] !== null && h.ids[i] === s.seats[i]) s.stacks[i] += h.contrib[i];
        }
      }
      s.hand = null;
      s.ev = null;
      return s;
    }, init());
  }

  function timeoutAt(state) {
    const h = state && state.hand;
    return active(h) && h.toAct >= 0 && Number.isFinite(h.deadline) ? h.deadline : null;
  }

  /** Quem saiu da sala desiste da mao e libera a cadeira. `now` (opcional)
   * e a hora do servidor, para o prazo de quem fala depois; sem ela, o
   * prazo novo conta do prazo anterior. */
  function dropPeer(state, peerId, now) {
    return safe(() => {
      const seat = seatOf(state, peerId);
      if (seat < 0) return state;
      const s = clone(state);
      const h = s.hand;
      const at = Number.isFinite(now) ? now : (h && Number.isFinite(h.deadline) ? h.deadline : 0);
      leaveHand(s, seat, at);
      s.seats[seat] = null;
      s.names[seat] = null;
      s.stacks[seat] = 0;
      return s;
    }, state);
  }

  function summary(state) {
    return safe(() => {
      const n = state.seats.filter((x) => x !== null).length;
      if (!n) return 'Pôquer — cadeiras livres';
      const [sb, bb] = LEVELS[state.level];
      const gente = n === 1 ? '1 na mesa' : `${n} na mesa`;
      const h = state.hand;
      if (active(h)) {
        const who = h.toAct >= 0 ? state.names[h.toAct] : null;
        return `Pôquer ${sb}/${bb} — ${gente}, mão ${h.no}${who ? `, vez de ${who}` : ''}`;
      }
      return `Pôquer ${sb}/${bb} — ${gente}`;
    }, 'Pôquer');
  }

  const mod = {
    type: 'poquer',
    title: 'Pôquer',
    group: 'jogos',
    secret: true,
    size: { w: 720, h: 460, minW: 540, minH: 345, aspect: 720 / 460 },
    maxStateBytes: 8192,
    init,
    prepare,
    validate,
    reduce,
    view,
    migrate,
    timeoutAt,
    dropPeer,
    summary,
    // Para testes e para a interface:
    N, STACK, TURN_MS, LEVELS, computePots, split,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules.poquer = mod;

  if (typeof module !== 'undefined') module.exports = mod;
})(globalThis);
