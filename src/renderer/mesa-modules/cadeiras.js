'use strict';

/*
 * Cadeiras dos jogos de 2 pessoas da mesa -- a parte comum a velha, lig4,
 * damas e xadrez. NAO e um tipo de janela: registra em
 * GoLive.mesaCadeiras (e nao em GoLive.mesaModules) e cada jogo o carrega
 * por `module.require('./cadeiras')` no Node; no renderer este arquivo vem
 * por <script> ANTES dos jogos.
 *
 * Todo estado de jogo leva `seats: [peerId|null, peerId|null]` e
 * `names: [nome|null, nome|null]` (o nome e guardado ao sentar, para o
 * resumo nao depender de quem ainda esta na sala). So quem esta sentado
 * joga, e so na sua vez; o resto assiste. Quem sai da sala libera a
 * cadeira por `dropPeer`, que o servidor chama.
 *
 * Nada aqui lanca excecao por causa de mensagem malformada: a acao ruim
 * vira um motivo curto em portugues e e recusada.
 */

(function (root) {
  const NAME_MAX = 32;

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function ctxOf(ctx) {
    return isObj(ctx) ? ctx : {};
  }

  /** Quem mandou a acao, ou null se o contexto nao disser. */
  function fromOf(ctx) {
    const from = ctxOf(ctx).from;
    return typeof from === 'string' && from ? from : null;
  }

  function seatOf(state, peerId) {
    if (!state || !Array.isArray(state.seats) || typeof peerId !== 'string') return -1;
    return state.seats.indexOf(peerId);
  }

  function peerName(ctx, peerId) {
    const peers = ctxOf(ctx).peers;
    if (!Array.isArray(peers)) return null;
    for (const p of peers) {
      if (isObj(p) && p.id === peerId && typeof p.name === 'string' && p.name.trim()) {
        return p.name.trim().slice(0, NAME_MAX);
      }
    }
    return null;
  }

  /** Cadeiras vazias, para o `init` de cada jogo. */
  function emptySeats() {
    return { seats: [null, null], names: [null, null] };
  }

  function isSeatAction(action) {
    return isObj(action) && (action.kind === 'sit' || action.kind === 'stand');
  }

  /** Valida `sit` / `stand`. Devolve true ou o motivo da recusa. */
  function validateSeat(state, action, ctx) {
    const from = fromOf(ctx);
    if (!from) return 'Quem mandou?';
    if (action.kind === 'sit') {
      if (action.seat !== 0 && action.seat !== 1) return 'Cadeira inválida';
      if (seatOf(state, from) >= 0) return 'Você já está sentado';
      if (state.seats[action.seat] !== null) return 'Cadeira ocupada';
      return true;
    }
    if (seatOf(state, from) < 0) return 'Você não está sentado';
    return true;
  }

  function withSeat(state, seat, peerId, name) {
    const seats = state.seats.slice();
    const names = state.names.slice();
    seats[seat] = peerId;
    names[seat] = name;
    return Object.assign({}, state, { seats, names });
  }

  /** Aplica `sit` / `stand` ja validados. */
  function reduceSeat(state, action, ctx) {
    const from = fromOf(ctx);
    if (action.kind === 'sit') return withSeat(state, action.seat, from, peerName(ctx, from));
    return withSeat(state, seatOf(state, from), null, null);
  }

  /** Quem saiu da sala libera a cadeira. A partida fica como estava:
   * outra pessoa pode sentar e continuar dali. */
  function dropPeer(state, peerId) {
    const seat = seatOf(state, peerId);
    if (seat < 0) return state;
    return withSeat(state, seat, null, null);
  }

  /** Nova partida: pode quem esta sentado ou o lider. */
  function canReset(state, ctx) {
    if (ctxOf(ctx).isLeader === true) return true;
    const from = fromOf(ctx);
    if (from && seatOf(state, from) >= 0) return true;
    return 'Só quem está sentado ou o líder recomeça';
  }

  /** Pode jogar agora? `turnSeat` e a cadeira da vez. */
  function canPlay(state, ctx, turnSeat) {
    if (state.result) return 'A partida acabou';
    const from = fromOf(ctx);
    const seat = seatOf(state, from);
    if (seat < 0) return 'Sente-se para jogar';
    if (state.seats[1 - seat] === null) return 'Espere alguém sentar na outra cadeira';
    if (seat !== turnSeat) return 'Não é a sua vez';
    return true;
  }

  /** Desistir: quem esta sentado, com a partida em andamento. */
  function canResign(state, ctx) {
    if (state.result) return 'A partida acabou';
    if (seatOf(state, fromOf(ctx)) < 0) return 'Só quem está sentado desiste';
    return true;
  }

  /** Nome para o resumo: o guardado ao sentar, o atual da sala se vier a
   * lista, ou o rotulo da cor ("Brancas", "X"...). */
  function nameOf(state, seat, labels, peers) {
    const id = state.seats && state.seats[seat];
    if (id && Array.isArray(peers)) {
      const live = peerName({ peers }, id);
      if (live) return live;
    }
    const saved = state.names && state.names[seat];
    return saved || labels[seat];
  }

  /** Resumo de partida em andamento: quem esta sentado e de quem e a vez. */
  function describePlaying(state, turnSeat, labels, peers) {
    const a = state.seats[0] !== null;
    const b = state.seats[1] !== null;
    if (!a && !b) return 'Cadeiras livres';
    if (a !== b) return `${nameOf(state, a ? 0 : 1, labels, peers)} espera adversário`;
    const n0 = nameOf(state, 0, labels, peers);
    const n1 = nameOf(state, 1, labels, peers);
    return `${n0} × ${n1} — vez de ${turnSeat === 0 ? n0 : n1}`;
  }

  /** Roda `fn` e troca qualquer excecao por `fallback`: estado ou mensagem
   * estranha nunca derruba o servidor nem o renderer. */
  function safe(fn, fallback) {
    try {
      return fn();
    } catch {
      return fallback;
    }
  }

  const api = {
    NAME_MAX,
    isObj,
    fromOf,
    seatOf,
    emptySeats,
    isSeatAction,
    validateSeat,
    reduceSeat,
    dropPeer,
    canReset,
    canPlay,
    canResign,
    nameOf,
    describePlaying,
    safe,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaCadeiras = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
