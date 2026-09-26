'use strict';

/*
 * Blackjack -- modulo de janela da mesa com informacao escondida (contrato:
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secoes 1, 8 e 9).
 *
 * Regras de cassino, a banca e o app (o servidor joga por ela):
 *   - 1 a 5 lugares; quem senta recebe 1 000 fichas; aposta de 10 a 500;
 *   - sapato de 6 baralhos, embaralhado de novo na rodada seguinte a passar
 *     de 75 % (carta de corte: menos de 78 cartas no sapato);
 *   - a banca recebe uma carta aberta e uma fechada e confere o blackjack
 *     (olha a fechada) quando a aberta e as ou vale 10;
 *   - banca para em todo 17, inclusive o macio (S17); blackjack paga 3:2
 *     (arredondado para baixo: fichas inteiras), vitoria 1:1, empate devolve;
 *   - seguro quando a banca mostra as: ate metade da aposta, paga 2:1;
 *   - dobrar em quaisquer duas primeiras cartas, inclusive depois de dividir;
 *   - dividir cartas de mesmo valor (J e K) ate 4 maos; ases divididos
 *     recebem uma carta so e nao se dividem de novo; 21 depois de dividir
 *     nao e blackjack; sem rendicao;
 *   - prazos: apostas 20 s depois da primeira aposta (ou quando todos
 *     apostaram); 30 s por decisao. Estourou o prazo: a mao para (e quem
 *     nao apostou fica fora da rodada).
 *
 * O sapato mora no estado do SERVIDOR e nunca sai dele: `view(state, peerId)`
 * da a cada um o que pode ver (a carta fechada da banca vira `null` ate a vez
 * dela; do sapato so a contagem). Sorte e hora entram em `prepare`: a acao
 * preparada leva `at` (hora do servidor) e, quando o sapato precisa ser
 * trocado, `fresh` (um sapato novo ja embaralhado com `ctx.random`). O
 * `reduce` so le o que veio na acao, e o jogo da banca inteiro acontece nele.
 *
 * Estado (so no servidor):
 *   seats/names/chips/bets/insurance/insuranceNet: 5 posicoes cada;
 *   phase: 'bets' | 'insurance' | 'play' | 'dealer';
 *   deadline: hora do servidor do prazo atual (null = sem prazo);
 *   shoe: cartas do sapato; shuffles: quantas vezes embaralhou;
 *   dealer: { cards, revealed }; hands: [{ seat, cards, bet, split, aces,
 *   doubled, done, result, win }]; turn: indice em `hands` ou null;
 *   round: numero da rodada; reshuffled: a ultima rodada trocou o sapato.
 * Em 'bets', `hands` e `dealer` sao os da rodada anterior (com resultado),
 * para a mesa mostrar como acabou ate as proximas cartas.
 *
 * Acoes: { kind: 'sit', seat } | { kind: 'leave' } (levantar) |
 *   { kind: 'rebuy' } | { kind: 'bet', amount } (0 tira a aposta) |
 *   { kind: 'insurance', amount } (0 recusa) | { kind: 'hit' } |
 *   { kind: 'stand' } (parar) | { kind: 'double' } | { kind: 'split' } |
 *   { kind: 'timeout' }.
 * `stand` aqui e "parar", como no cassino; sair do lugar e `leave`.
 */

(function (root) {
  const B = (root.GoLive && root.GoLive.mesaBaralho)
    || (globalThis.GoLive && globalThis.GoLive.mesaBaralho)
    || (typeof module !== 'undefined' && typeof module.require === 'function' ? module.require('./baralho') : null);

  const SEATS = 5;
  const DECKS = 6;
  const SHOE_SIZE = 52 * DECKS;
  const CUT_LEFT = Math.round(SHOE_SIZE * 0.25); // 78: passou de 75 %, embaralha
  const LOW_LEFT = 40; // no meio da rodada, abaixo disto o prepare manda reserva
  const START_CHIPS = 1000;
  const MIN_BET = 10;
  const MAX_BET = 500;
  const MAX_HANDS = 4;
  const BET_MS = 20000;
  const DECISION_MS = 30000;
  const NAME_MAX = 32;
  const KINDS = ['sit', 'leave', 'rebuy', 'bet', 'insurance', 'hit', 'stand', 'double', 'split', 'timeout'];

  // ---------- Puras: valor das cartas e regras da banca ----------

  /** Valor de uma carta: as 11, figuras e 10 valem 10. */
  function cardValue(c) {
    const r = typeof c === 'string' ? c[0] : '';
    if (r === 'A') return 11;
    if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10;
    const n = Number(r);
    return Number.isInteger(n) && n >= 2 && n <= 9 ? n : 0;
  }

  /** Total da mao: `{ total, soft }`. Cada as vale 11 enquanto nao estoura;
   * `soft` = ainda ha um as contando 11 ("17 macio"). */
  function handValue(cards) {
    let total = 0;
    let aces = 0;
    for (const c of Array.isArray(cards) ? cards : []) {
      const v = cardValue(c);
      total += v;
      if (v === 11) aces += 1;
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces -= 1;
    }
    return { total, soft: aces > 0 };
  }

  /** Blackjack natural: duas cartas somando 21 (as + dez). Quem chama diz
   * se a mao veio de divisao (ai nao e blackjack). */
  function isBlackjack(cards, fromSplit) {
    return !fromSplit && Array.isArray(cards) && cards.length === 2 && handValue(cards).total === 21;
  }

  function isBust(cards) {
    return handValue(cards).total > 21;
  }

  /** S17: a banca pede com 16 ou menos e para em todo 17, macio inclusive. */
  function dealerShouldHit(cards) {
    return handValue(cards).total < 17;
  }

  /** A banca confere o blackjack quando a carta aberta e as ou vale 10. */
  function dealerPeeks(upCard) {
    return cardValue(upCard) >= 10;
  }

  /** Da para dividir: duas cartas de mesmo valor (J e K contam). */
  function samePair(cards) {
    return Array.isArray(cards) && cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]);
  }

  /** Quanto volta para quem apostou `bet`, pelo resultado (aposta inclusa). */
  function payout(result, bet) {
    if (result === 'blackjack') return bet + Math.floor((bet * 3) / 2);
    if (result === 'win') return bet * 2;
    if (result === 'push') return bet;
    return 0;
  }

  /** Resultado de uma mao contra a banca, ja com as duas maos completas. */
  function outcome(hand, dealerCards) {
    const me = handValue(hand.cards).total;
    if (me > 21) return 'bust';
    const bj = isBlackjack(hand.cards, hand.split);
    const dealerBj = isBlackjack(dealerCards, false);
    if (bj && dealerBj) return 'push';
    if (bj) return 'blackjack';
    if (dealerBj) return 'lose';
    const d = handValue(dealerCards).total;
    if (d > 21 || me > d) return 'win';
    if (me === d) return 'push';
    return 'lose';
  }

  // ---------- Apoio ----------

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function fromOf(ctx) {
    const from = isObj(ctx) ? ctx.from : null;
    return typeof from === 'string' && from ? from : null;
  }

  function seatOf(state, peerId) {
    if (!state || !Array.isArray(state.seats) || typeof peerId !== 'string') return -1;
    return state.seats.indexOf(peerId);
  }

  function peerName(ctx, peerId) {
    const peers = isObj(ctx) ? ctx.peers : null;
    if (!Array.isArray(peers)) return null;
    for (const p of peers) {
      if (isObj(p) && p.id === peerId && typeof p.name === 'string' && p.name.trim()) {
        return p.name.trim().slice(0, NAME_MAX);
      }
    }
    return null;
  }

  function safe(fn, fallback) {
    try {
      return fn();
    } catch {
      return fallback;
    }
  }

  /** Copia funda do estado (JSON puro): o reduce mexe na copia, nunca no
   * estado recebido (que pode estar congelado). */
  function clone(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function fill(v) {
    return Array.from({ length: SEATS }, () => v);
  }

  function newShoe(random) {
    return B.shuffle(B.newDeck(DECKS), random);
  }

  function init(ctx) {
    const random = isObj(ctx) && typeof ctx.random === 'function' ? ctx.random : null;
    return {
      seats: fill(null),
      names: fill(null),
      chips: fill(null),
      bets: fill(0),
      insurance: fill(null),
      insuranceNet: fill(null),
      phase: 'bets',
      deadline: null,
      shoe: random ? newShoe(random) : [],
      shuffles: random ? 1 : 0,
      dealer: { cards: [], revealed: false },
      hands: [],
      turn: null,
      round: 0,
      reshuffled: false,
    };
  }

  const inRound = (state) => state.phase !== 'bets';
  const handsOf = (state, seat) => state.hands.filter((h) => h.seat === seat);
  const playing = (state, seat) => inRound(state) && state.hands.some((h) => h.seat === seat);

  /** Quem pode apostar nesta rodada: sentado e com fichas para o minimo. */
  function canAfford(state, seat) {
    return state.seats[seat] !== null && (state.chips[seat] || 0) + (state.bets[seat] || 0) >= MIN_BET;
  }

  /** Todos os que podem apostar ja apostaram (e ha ao menos uma aposta). */
  function allBet(state) {
    let any = false;
    for (let i = 0; i < SEATS; i += 1) {
      if (state.bets[i] > 0) any = true;
      else if (canAfford(state, i)) return false;
    }
    return any;
  }

  function currentHand(state) {
    return state.phase === 'play' && state.turn !== null ? state.hands[state.turn] || null : null;
  }

  function canDouble(state, hand) {
    return !!hand && hand.cards.length === 2 && !hand.aces && (state.chips[hand.seat] || 0) >= hand.bet;
  }

  function canSplit(state, hand) {
    return !!hand && samePair(hand.cards) && !hand.aces
      && handsOf(state, hand.seat).length < MAX_HANDS && (state.chips[hand.seat] || 0) >= hand.bet;
  }

  function insuranceMax(state, seat) {
    const bet = handsOf(state, seat).reduce((s, h) => s + h.bet, 0);
    return Math.max(0, Math.min(Math.floor(bet / 2), state.chips[seat] || 0));
  }

  function undecided(state, seat) {
    return state.phase === 'insurance' && state.insurance[seat] === null && handsOf(state, seat).length > 0;
  }

  /** O que `seat` pode fazer agora (a mesma conta do validate), para a view. */
  function actionsFor(state, seat) {
    const out = [];
    if (seat < 0) {
      if (state.seats.includes(null)) out.push('sit');
      return out;
    }
    if (!playing(state, seat)) out.push('leave');
    if (!playing(state, seat) && (state.chips[seat] || 0) < MIN_BET && !state.bets[seat]) out.push('rebuy');
    if (state.phase === 'bets' && canAfford(state, seat)) out.push('bet');
    if (undecided(state, seat)) out.push('insurance');
    const hand = currentHand(state);
    if (hand && hand.seat === seat) {
      out.push('hit', 'stand');
      if (canDouble(state, hand)) out.push('double');
      if (canSplit(state, hand)) out.push('split');
    }
    return out;
  }

  // ---------- validate ----------

  /** Lugares de quem nao esta na sala (`ctx.peers`): depois de uma
   * migracao os ids mudam, e o lugar do id antigo conta como livre
   * (contrato, secao 5). Sem a lista, confia no que esta no lugar. */
  function ghostSeats(state, ctx) {
    const peers = isObj(ctx) ? ctx.peers : null;
    if (!Array.isArray(peers) || !peers.length) return [];
    const ids = new Set(peers.filter(isObj).map((p) => p.id));
    const out = [];
    state.seats.forEach((id, i) => { if (id !== null && !ids.has(id)) out.push(i); });
    return out;
  }

  /** O estado com esses lugares liberados, como se cada um tivesse saido. */
  function withoutGhosts(state, seats) {
    let s = state;
    for (const i of seats) {
      const id = Number.isInteger(i) && i >= 0 && i < SEATS ? s.seats[i] : null;
      if (typeof id === 'string') s = dropPeer(s, id);
    }
    return s;
  }

  function validate(state, action, ctx) {
    return safe(() => {
      if (!isObj(action) || !KINDS.includes(action.kind)) return 'Ação desconhecida';
      const ghosts = ghostSeats(state, ctx);
      if (ghosts.length) state = withoutGhosts(state, ghosts);
      const from = fromOf(ctx);
      if (!from) return 'Quem mandou?';
      const seat = seatOf(state, from);
      const k = action.kind;
      if (k === 'timeout') {
        const now = isObj(ctx) ? ctx.now : undefined;
        const due = timeoutAt(state);
        if (due === null) return 'Não há prazo correndo';
        if (typeof now !== 'number' || !Number.isFinite(now)) return 'Sem a hora da sala';
        if (now < due) return 'Ainda há tempo';
        return true;
      }
      if (k === 'sit') {
        if (!Number.isInteger(action.seat) || action.seat < 0 || action.seat >= SEATS) return 'Lugar inválido';
        if (seat >= 0) return 'Você já está sentado';
        if (state.seats[action.seat] !== null) return 'Lugar ocupado';
        return true;
      }
      if (seat < 0) return 'Sente-se para jogar';
      if (k === 'leave') return playing(state, seat) ? 'Espere a rodada acabar para levantar' : true;
      if (k === 'rebuy') {
        if (playing(state, seat) || state.bets[seat] > 0) return 'Recompra só entre rodadas';
        if ((state.chips[seat] || 0) >= MIN_BET) return 'Recompra só sem fichas';
        return true;
      }
      if (k === 'bet') {
        if (state.phase !== 'bets') return 'As apostas estão fechadas';
        const a = action.amount;
        if (!Number.isInteger(a)) return 'Aposta inválida';
        if (a === 0) return state.bets[seat] > 0 ? true : 'Você não apostou';
        if (a < MIN_BET || a > MAX_BET) return `Aposta de ${MIN_BET} a ${MAX_BET}`;
        if (a > (state.chips[seat] || 0) + state.bets[seat]) return 'Fichas insuficientes';
        return true;
      }
      if (k === 'insurance') {
        if (state.phase !== 'insurance') return 'Seguro só quando a banca mostra ás';
        if (!handsOf(state, seat).length) return 'Você não está nesta rodada';
        if (state.insurance[seat] !== null) return 'Você já decidiu o seguro';
        const a = action.amount;
        if (!Number.isInteger(a) || a < 0) return 'Seguro inválido';
        if (a > insuranceMax(state, seat)) return 'Seguro vai até metade da aposta';
        return true;
      }
      // hit, stand, double, split
      if (state.phase !== 'play') return 'Não é hora de jogar';
      const hand = currentHand(state);
      if (!hand || hand.seat !== seat) return 'Não é a sua vez';
      if (k === 'double' && !canDouble(state, hand)) {
        return hand.cards.length !== 2 ? 'Dobrar só com duas cartas' : 'Fichas insuficientes para dobrar';
      }
      if (k === 'split' && !canSplit(state, hand)) {
        if (!samePair(hand.cards)) return 'Dividir só com duas cartas de mesmo valor';
        if (hand.aces) return 'Ases divididos não se dividem de novo';
        if (handsOf(state, seat).length >= MAX_HANDS) return 'No máximo 4 mãos';
        return 'Fichas insuficientes para dividir';
      }
      return true;
    }, 'Ação inválida');
  }

  // ---------- prepare (so no servidor) ----------

  /** Precisa de sapato novo? Na hora de dar as cartas, passada a carta de
   * corte; no meio da rodada, quando esta perto de acabar (reserva). */
  function needsFresh(state) {
    const left = Array.isArray(state.shoe) ? state.shoe.length : 0;
    return state.phase === 'bets' ? left < CUT_LEFT : left < LOW_LEFT;
  }

  /** Refaz a acao so com os campos conhecidos (o cliente nunca manda `at`
   * nem `fresh` que valham), com a hora do servidor e, se precisar, o
   * sapato novo ja embaralhado. */
  function prepare(state, action, ctx) {
    return safe(() => {
      const out = { kind: action.kind };
      if (action.kind === 'sit') {
        out.seat = action.seat;
        out.name = peerName(ctx, fromOf(ctx));
      }
      if (action.kind === 'bet' || action.kind === 'insurance') out.amount = action.amount;
      const now = isObj(ctx) && typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : 0;
      out.at = now;
      const ghosts = ghostSeats(state, ctx);
      if (ghosts.length) out.ghosts = ghosts;
      if (isObj(ctx) && typeof ctx.random === 'function' && needsFresh(state)) out.fresh = newShoe(ctx.random);
      return out;
    }, action);
  }

  // ---------- reduce (rascunho mutavel: `s` e sempre copia) ----------

  function draw(s, action) {
    if (!s.shoe.length) {
      // Reserva do prepare; sem ela (nao deveria acontecer), um sapato na
      // ordem, para nunca travar a rodada.
      s.shoe = Array.isArray(action.fresh) && action.fresh.length ? action.fresh.slice() : B.newDeck(DECKS);
      s.shuffles += 1;
      s.reshuffled = true;
    }
    return s.shoe.shift();
  }

  function freeSeat(s, seat) {
    s.seats[seat] = null;
    s.names[seat] = null;
    s.chips[seat] = null;
    s.bets[seat] = 0;
    s.insurance[seat] = null;
    s.insuranceNet[seat] = null;
  }

  /** Volta para as apostas sem pagar nada (a rodada acabou ou foi cancelada). */
  function toBets(s) {
    s.phase = 'bets';
    s.turn = null;
    s.deadline = null;
    s.bets = fill(0);
  }

  function deal(s, action, at) {
    s.reshuffled = false;
    if (s.shoe.length < CUT_LEFT && Array.isArray(action.fresh) && action.fresh.length) {
      s.shoe = action.fresh.slice();
      s.shuffles += 1;
      s.reshuffled = true;
    }
    s.round += 1;
    s.hands = [];
    s.insurance = fill(null);
    s.insuranceNet = fill(null);
    for (let i = 0; i < SEATS; i += 1) {
      if (s.bets[i] > 0) s.hands.push({ seat: i, cards: [], bet: s.bets[i], split: false, aces: false, doubled: false, done: false, result: null, win: null });
    }
    s.bets = fill(0);
    s.dealer = { cards: [], revealed: false };
    for (const h of s.hands) h.cards.push(draw(s, action));
    s.dealer.cards.push(draw(s, action));
    for (const h of s.hands) h.cards.push(draw(s, action));
    s.dealer.cards.push(draw(s, action));
    for (const h of s.hands) if (isBlackjack(h.cards, false)) h.done = true;
    if (cardValue(s.dealer.cards[0]) === 11) {
      s.phase = 'insurance';
      s.turn = null;
      s.deadline = at + DECISION_MS;
      for (const h of s.hands) if ((s.chips[h.seat] || 0) < 1) s.insurance[h.seat] = 0;
      afterInsurance(s, action, at);
      return;
    }
    afterPeek(s, action, at);
  }

  /** Todos decidiram o seguro: confere o blackjack da banca. */
  function afterInsurance(s, action, at) {
    if (s.hands.some((h) => s.insurance[h.seat] === null)) return;
    const dealerBj = isBlackjack(s.dealer.cards, false);
    for (let i = 0; i < SEATS; i += 1) {
      const ins = s.insurance[i];
      if (!ins) continue;
      if (dealerBj) {
        s.chips[i] += ins * 3;
        s.insuranceNet[i] = ins * 2;
      } else {
        s.insuranceNet[i] = -ins;
      }
    }
    afterPeek(s, action, at);
  }

  /** Depois de conferir (ou sem conferir): banca com blackjack encerra a
   * rodada; senao, a vez vai para a primeira mao. */
  function afterPeek(s, action, at) {
    if (dealerPeeks(s.dealer.cards[0]) && isBlackjack(s.dealer.cards, false)) {
      settle(s);
      return;
    }
    s.phase = 'play';
    s.turn = -1;
    advance(s, action, at);
  }

  /** Passa a vez para a proxima mao nao terminada; sem nenhuma, joga a banca. */
  function advance(s, action, at) {
    let i = s.turn === null ? 0 : s.turn;
    if (i >= 0 && s.hands[i] && !s.hands[i].done) {
      s.deadline = at + DECISION_MS;
      return;
    }
    for (i = Math.max(0, i + 1); i < s.hands.length; i += 1) {
      if (!s.hands[i].done) {
        s.turn = i;
        s.deadline = at + DECISION_MS;
        return;
      }
    }
    dealerPlay(s, action);
  }

  /** A banca vira a fechada e, se sobrou mao viva (nem estourada nem
   * blackjack), pede ate 17 (S17). Depois paga. */
  function dealerPlay(s, action) {
    s.phase = 'dealer';
    s.turn = null;
    s.dealer.revealed = true;
    const alive = s.hands.some((h) => !isBust(h.cards) && !isBlackjack(h.cards, h.split));
    if (alive) while (dealerShouldHit(s.dealer.cards)) s.dealer.cards.push(draw(s, action));
    settle(s);
  }

  function settle(s) {
    s.dealer.revealed = true;
    for (const h of s.hands) {
      h.done = true;
      h.result = outcome(h, s.dealer.cards);
      const back = payout(h.result, h.bet);
      s.chips[h.seat] += back;
      h.win = back - h.bet;
    }
    for (let i = 0; i < SEATS; i += 1) if (s.insurance[i] && s.insuranceNet[i] === null) s.insuranceNet[i] = -s.insurance[i];
    toBets(s);
  }

  /** A mao atual terminou por 21 automatico? (21 para sozinho.) */
  function closeIf21(hand) {
    if (handValue(hand.cards).total >= 21) hand.done = true;
  }

  function play(s, action, at, seat) {
    const hand = s.hands[s.turn];
    const k = action.kind;
    if (k === 'stand' || k === 'timeout') {
      hand.done = true;
    } else if (k === 'hit') {
      hand.cards.push(draw(s, action));
      closeIf21(hand);
    } else if (k === 'double') {
      s.chips[seat] -= hand.bet;
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(draw(s, action));
      hand.done = true;
    } else if (k === 'split') {
      s.chips[seat] -= hand.bet;
      const aces = cardValue(hand.cards[0]) === 11;
      const other = { seat, cards: [hand.cards[1]], bet: hand.bet, split: true, aces, doubled: false, done: false, result: null, win: null };
      hand.cards = [hand.cards[0]];
      hand.split = true;
      hand.aces = aces;
      s.hands.splice(s.turn + 1, 0, other);
      for (const h of [hand, other]) {
        h.cards.push(draw(s, action));
        if (aces) h.done = true;
        else closeIf21(h);
      }
    }
    advance(s, action, at);
  }

  function timeout(s, action, at) {
    if (s.phase === 'bets') {
      deal(s, action, at);
    } else if (s.phase === 'insurance') {
      for (const h of s.hands) if (s.insurance[h.seat] === null) s.insurance[h.seat] = 0;
      afterInsurance(s, action, at);
    } else if (s.phase === 'play') {
      play(s, action, at, s.hands[s.turn].seat);
    } else {
      dealerPlay(s, action);
    }
  }

  function reduce(state, action, ctx) {
    return safe(() => {
      const at = isObj(action) && typeof action.at === 'number' && Number.isFinite(action.at) ? action.at : 0;
      // Os lugares de quem ja nao esta na sala (o prepare viu `ctx.peers`)
      // saem antes da acao.
      const base = isObj(action) && Array.isArray(action.ghosts) ? withoutGhosts(state, action.ghosts) : state;
      if (validate(base, action, Object.assign({}, ctx, { now: at, peers: null })) !== true) return state;
      const s = clone(base);
      const from = fromOf(ctx);
      const seat = seatOf(s, from);
      switch (action.kind) {
        case 'sit': {
          const name = typeof action.name === 'string' ? action.name.trim().slice(0, NAME_MAX) || null : null;
          s.seats[action.seat] = from;
          s.names[action.seat] = name;
          s.chips[action.seat] = START_CHIPS;
          s.bets[action.seat] = 0;
          s.insurance[action.seat] = null;
          s.insuranceNet[action.seat] = null;
          break;
        }
        case 'leave':
          freeSeat(s, seat);
          if (s.phase === 'bets') {
            if (!s.bets.some((b) => b > 0)) s.deadline = null;
            else if (allBet(s)) deal(s, action, at);
          }
          break;
        case 'rebuy':
          s.chips[seat] = START_CHIPS;
          break;
        case 'bet':
          s.chips[seat] += s.bets[seat] - action.amount;
          s.bets[seat] = action.amount;
          if (!s.bets.some((b) => b > 0)) s.deadline = null;
          else if (s.deadline === null) s.deadline = at + BET_MS;
          if (allBet(s)) deal(s, action, at);
          break;
        case 'insurance':
          s.chips[seat] -= action.amount;
          s.insurance[seat] = action.amount;
          afterInsurance(s, action, at);
          break;
        case 'timeout':
          timeout(s, action, at);
          break;
        default:
          play(s, action, at, seat);
      }
      return s;
    }, state);
  }

  // ---------- Prazos, saida, migracao ----------

  /** Hora do servidor em que o prazo atual estoura (null = sem prazo). */
  function timeoutAt(state) {
    return safe(() => (typeof state.deadline === 'number' && Number.isFinite(state.deadline) ? state.deadline : null), null);
  }

  /** Quem sai da sala libera o lugar e as maos dele saem da rodada (a
   * aposta vai junto: a pessoa ja foi). Sem sorte e sem hora: nunca tira
   * carta. Se era a vez dela, a proxima mao ganha o prazo que restava mais
   * 30 s; se o que falta e so a banca (ou dar as cartas), o prazo vence na
   * hora (0) e o primeiro `timeout` faz o resto. */
  function dropPeer(state, peerId) {
    return safe(() => {
      const seat = seatOf(state, peerId);
      if (seat < 0) return state;
      const s = clone(state);
      freeSeat(s, seat);
      if (s.phase === 'bets') {
        if (!s.bets.some((b) => b > 0)) s.deadline = null;
        else if (allBet(s)) s.deadline = 0;
        return s;
      }
      const cur = s.phase === 'play' && s.turn !== null ? s.hands[s.turn] : null;
      const wasTurn = !!cur && cur.seat === seat;
      // A proxima mao viva depois da atual, de outra pessoa (as maos de um
      // lugar ficam juntas na lista).
      const next = cur ? s.hands.find((h, i) => i > s.turn && h.seat !== seat && !h.done) || null : null;
      s.hands = s.hands.filter((h) => h.seat !== seat);
      if (!s.hands.length) {
        s.dealer = { cards: s.dealer.cards, revealed: true };
        toBets(s);
        return s;
      }
      if (s.phase === 'insurance') {
        if (!s.hands.some((h) => s.insurance[h.seat] === null)) s.deadline = 0;
      } else if (s.phase === 'play') {
        if (wasTurn) {
          const old = typeof s.deadline === 'number' ? s.deadline : 0;
          if (next) {
            s.turn = s.hands.indexOf(next);
            s.deadline = old + DECISION_MS;
          } else {
            s.phase = 'dealer';
            s.turn = null;
            s.deadline = 0;
          }
        } else {
          s.turn = s.hands.indexOf(cur);
        }
      }
      return s;
    }, state);
  }

  /** Retrato para a migracao (vai para todos): cancela a rodada, devolve as
   * apostas e os seguros, e tira o sapato. Fichas e lugares ficam. */
  function migrate(state) {
    return safe(() => {
      const s = clone(state);
      for (let i = 0; i < SEATS; i += 1) {
        if (s.seats[i] === null) continue;
        s.chips[i] += s.bets[i] || 0;
        if (inRound(s)) {
          s.chips[i] += handsOf(s, i).reduce((t, h) => t + h.bet, 0);
          if (s.insurance[i] && s.insuranceNet[i] === null) s.chips[i] += s.insurance[i];
        }
      }
      if (inRound(s)) {
        s.hands = [];
        s.dealer = { cards: [], revealed: false };
        s.insurance = fill(null);
        s.insuranceNet = fill(null);
      }
      toBets(s);
      s.shoe = [];
      s.reshuffled = false;
      return s;
    }, state);
  }

  // ---------- view ----------

  function describeHand(h, hidden) {
    const v = handValue(h.cards);
    return {
      seat: h.seat,
      cards: h.cards.slice(),
      bet: h.bet,
      total: v.total,
      soft: v.soft && v.total < 21,
      blackjack: !hidden && isBlackjack(h.cards, h.split),
      bust: v.total > 21,
      split: h.split,
      aces: h.aces,
      doubled: h.doubled,
      done: h.done,
      result: h.result,
      win: h.win,
    };
  }

  /** O que `peerId` pode ver (null = quem so assiste). A carta fechada da
   * banca e `null` ate a vez dela; do sapato so a contagem. `ctx.peers`
   * (do servidor) faz o lugar de quem nao esta na sala aparecer livre. */
  function view(state, peerId, ctx) {
    return safe(() => {
      state = withoutGhosts(state, ghostSeats(state, ctx));
      const shown = state.dealer.revealed ? state.dealer.cards.slice() : state.dealer.cards.map((c, i) => (i === 1 ? null : c));
      const visible = shown.filter((c) => c !== null);
      const dv = handValue(visible);
      const seat = typeof peerId === 'string' ? seatOf(state, peerId) : -1;
      const hand = currentHand(state);
      const chips = seat >= 0 ? state.chips[seat] || 0 : 0;
      return {
        phase: state.phase,
        round: state.round,
        deadline: timeoutAt(state),
        seats: state.seats.slice(),
        names: state.names.slice(),
        chips: state.chips.slice(),
        bets: state.bets.slice(),
        insurance: state.insurance.slice(),
        insuranceNet: state.insuranceNet.slice(),
        dealer: {
          cards: shown,
          revealed: !!state.dealer.revealed,
          total: dv.total,
          soft: dv.soft && dv.total < 21,
          blackjack: !!state.dealer.revealed && isBlackjack(state.dealer.cards, false),
          bust: dv.total > 21,
        },
        hands: state.hands.map((h) => describeHand(h, false)),
        turn: state.phase === 'play' ? state.turn : null,
        shoeLeft: Array.isArray(state.shoe) ? state.shoe.length : 0,
        shoeTotal: SHOE_SIZE,
        reshuffled: !!state.reshuffled,
        me: {
          seat,
          chips,
          bet: seat >= 0 ? state.bets[seat] || 0 : 0,
          actions: actionsFor(state, seat),
          minBet: MIN_BET,
          maxBet: seat >= 0 ? Math.max(0, Math.min(MAX_BET, chips + (state.bets[seat] || 0))) : 0,
          insuranceMax: seat >= 0 && undecided(state, seat) ? insuranceMax(state, seat) : 0,
          hand: hand && hand.seat === seat ? state.turn : null,
        },
      };
    }, { phase: 'bets', seats: fill(null), hands: [], me: { seat: -1, actions: [] } });
  }

  // ---------- Resumo ----------

  function nameAt(state, seat, peers) {
    const id = state.seats[seat];
    return (id && peerName({ peers }, id)) || state.names[seat] || `Lugar ${seat + 1}`;
  }

  function summary(state, peers) {
    return safe(() => {
      const n = state.seats.filter((x) => x !== null).length;
      if (!n) return 'Blackjack — lugares livres';
      const mesa = n === 1 ? '1 na mesa' : `${n} na mesa`;
      if (state.phase === 'bets') return `Blackjack — ${mesa}, apostas abertas`;
      if (state.phase === 'insurance') return `Blackjack — ${mesa}, seguro`;
      const h = currentHand(state);
      if (h) return `Blackjack — vez de ${nameAt(state, h.seat, peers)}`;
      return `Blackjack — ${mesa}, vez da banca`;
    }, 'Blackjack');
  }

  const mod = {
    type: 'blackjack',
    title: 'Blackjack',
    group: 'jogos',
    secret: true,
    size: { w: 680, h: 440, minW: 420, minH: 320, aspect: null },
    maxStateBytes: 12288,
    SEATS, DECKS, SHOE_SIZE, CUT_LEFT, LOW_LEFT, START_CHIPS, MIN_BET, MAX_BET, MAX_HANDS, BET_MS, DECISION_MS,
    init,
    prepare,
    validate,
    reduce,
    view,
    migrate,
    timeoutAt,
    dropPeer,
    summary,
    cardValue,
    handValue,
    isBlackjack,
    isBust,
    dealerShouldHit,
    dealerPeeks,
    samePair,
    payout,
    outcome,
    actionsFor,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules.blackjack = mod;

  if (typeof module !== 'undefined') module.exports = mod;
})(typeof window !== 'undefined' ? window : global);
