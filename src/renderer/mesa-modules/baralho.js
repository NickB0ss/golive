'use strict';

/*
 * Baralho francês -- apoio PURO dos jogos de cartas da Mesa (pôquer,
 * blackjack, oito maluco...). NAO e tipo de janela (HELPER_NAMES no registro).
 *
 * Carta = texto de dois caracteres: valor + naipe. Valores "23456789TJQKA"
 * (T = 10), naipes "shdc" (espadas, copas, ouros, paus). Ex.: "As", "Td", "7c".
 * Texto curto porque o estado da janela tem teto de bytes e vai no welcome.
 *
 * Embaralhar recebe a sorte de fora (`random`, a do servidor em `prepare` ou
 * `init`): nada aqui le Math.random, para os testes serem deterministicos.
 */

(function (root) {
  const { codigo } = (root.GoLive && root.GoLive.i18n)
    || (typeof module !== 'undefined' ? require('../i18n') : { codigo: (chave) => chave });
  const RANKS = Object.freeze(['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']);
  const SUITS = Object.freeze(['s', 'h', 'd', 'c']);
  const SUIT_NAMES = Object.freeze({ s: 's', h: 'h', d: 'd', c: 'c' });
  const RANK_NAMES = Object.freeze({
    2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', T: 'T', J: 'J', Q: 'Q', K: 'K', A: 'A',
  });
  const MAX_DECKS = 8;

  function isCard(c) {
    return typeof c === 'string' && c.length === 2 && RANKS.includes(c[0]) && SUITS.includes(c[1]);
  }

  function rankOf(c) {
    return c[0];
  }

  function suitOf(c) {
    return c[1];
  }

  /** 2 = 0 ... A = 12, para comparar valores. */
  function rankIndex(c) {
    return RANKS.indexOf(c[0]);
  }

  /** `decks` baralhos de 52 cartas, na ordem (sem embaralhar). */
  function newDeck(decks = 1) {
    const n = Number.isInteger(decks) && decks >= 1 && decks <= MAX_DECKS ? decks : 1;
    const out = [];
    for (let d = 0; d < n; d += 1) {
      for (const s of SUITS) for (const r of RANKS) out.push(r + s);
    }
    return out;
  }

  /** Inteiro em [0, n) com a sorte recebida; sorte fora de [0, 1) vira 0. */
  function pick(random, n) {
    let r = Number(random());
    if (!Number.isFinite(r) || r < 0 || r >= 1) r = 0;
    return Math.floor(r * n);
  }

  /** Fisher-Yates sobre uma copia. Nao mexe no array recebido. */
  function shuffle(cards, random) {
    const out = cards.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = pick(random, i + 1);
      const t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    return out;
  }

  /** Tira `n` cartas do topo: `{ cards, rest }`, sem mutar. */
  function draw(deck, n = 1) {
    const k = Math.max(0, Math.min(deck.length, n));
    return { cards: deck.slice(0, k), rest: deck.slice(k) };
  }

  /** "ás de espadas", "dez de copas". */
  function cardName(c, t) {
    if (!isCard(c)) return t ? t('mesa.carta') : codigo('mesa.carta');
    const valores = {
      valor: t ? t(`mesa.carta.valor.${RANK_NAMES[c[0]]}`) : codigo(`mesa.carta.valor.${RANK_NAMES[c[0]]}`),
      naipe: t ? t(`mesa.carta.naipe.${SUIT_NAMES[c[1]]}`) : codigo(`mesa.carta.naipe.${SUIT_NAMES[c[1]]}`),
    };
    return t ? t('mesa.carta.nome', valores) : codigo('mesa.carta.nome', valores);
  }

  /** Copas e ouros sao vermelhos. */
  function isRed(c) {
    return c[1] === 'h' || c[1] === 'd';
  }

  const api = {
    RANKS, SUITS, SUIT_NAMES, RANK_NAMES, MAX_DECKS,
    isCard, rankOf, suitOf, rankIndex, newDeck, shuffle, draw, cardName, isRed,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaBaralho = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
