'use strict';

/*
 * Avaliador de maos do pôquer (Texas Hold'em) -- apoio PURO do modulo
 * `poquer`. NAO e tipo de janela (HELPER_NAMES no registro): registra em
 * GoLive.mesaPoquerMaos; no renderer vem por <script> ANTES de poquer.js, no
 * Node o modulo o carrega por `module.require`.
 *
 * Carta = texto "As", "Td" (mesa-modules/baralho.js). A mao avaliada e o
 * melhor jogo de 5 entre as cartas dadas (5 a 7: as 2 da pessoa e as da
 * mesa). Regras (contrato da Mesa, secao 9):
 *   carta alta < par < dois pares < trinca < sequencia < flush < full house
 *   < quadra < straight flush (royal e o maior straight flush).
 * A sequencia A-2-3-4-5 vale e e a mais baixa (o as conta como 1).
 *
 * `score` e uma lista de numeros comparada em ordem: [categoria, ...valores]
 * (valores 0..12, 2 = 0 e A = 12; na sequencia A-2-3-4-5 o topo e o 5).
 * Duas maos com o mesmo `score` empatam de verdade (os naipes nao desempatam).
 */

(function (root) {
  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc';

  const CATEGORIAS = Object.freeze([
    'Carta alta', 'Par', 'Dois pares', 'Trinca', 'Sequência', 'Flush', 'Full house', 'Quadra', 'Straight flush',
  ]);
  const CAT = Object.freeze({
    ALTA: 0, PAR: 1, DOIS_PARES: 2, TRINCA: 3, SEQUENCIA: 4, FLUSH: 5, FULL: 6, QUADRA: 7, STRAIGHT_FLUSH: 8,
  });

  // Nomes no plural e no singular para a frase do showdown ("Par de reis").
  const NOME_PLURAL = ['dois', 'três', 'quatros', 'cincos', 'seis', 'setes', 'oitos', 'noves', 'dez', 'valetes', 'damas', 'reis', 'ases'];
  const NOME_UM = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'valete', 'dama', 'rei', 'ás'];

  function isCard(c) {
    return typeof c === 'string' && c.length === 2 && RANKS.includes(c[0]) && SUITS.includes(c[1]);
  }

  function rankOf(c) {
    return RANKS.indexOf(c[0]);
  }

  /** Topo da sequencia nos valores (distintos, em ordem decrescente), ou -1.
   * A-2-3-4-5 devolve 3 (o 5). */
  function straightTop(desc) {
    const set = new Set(desc);
    for (let top = 12; top >= 4; top -= 1) {
      let ok = true;
      for (let k = 0; k < 5; k += 1) if (!set.has(top - k)) { ok = false; break; }
      if (ok) return top;
    }
    if (set.has(12) && set.has(0) && set.has(1) && set.has(2) && set.has(3)) return 3;
    return -1;
  }

  /** Avalia exatamente 5 cartas: `{ cat, score }`. */
  function eval5(cards) {
    const ranks = cards.map(rankOf).sort((a, b) => b - a);
    const flush = cards.every((c) => c[1] === cards[0][1]);
    const counts = new Map();
    for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
    // Grupos por (quantidade desc, valor desc): [[valor, qtd], ...]
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const distinct = groups.length === 5;
    const top = distinct ? straightTop(ranks) : -1;
    if (flush && top >= 0) return { cat: CAT.STRAIGHT_FLUSH, score: [CAT.STRAIGHT_FLUSH, top] };
    if (groups[0][1] === 4) return { cat: CAT.QUADRA, score: [CAT.QUADRA, groups[0][0], groups[1][0]] };
    if (groups[0][1] === 3 && groups[1][1] === 2) return { cat: CAT.FULL, score: [CAT.FULL, groups[0][0], groups[1][0]] };
    if (flush) return { cat: CAT.FLUSH, score: [CAT.FLUSH, ...ranks] };
    if (top >= 0) return { cat: CAT.SEQUENCIA, score: [CAT.SEQUENCIA, top] };
    if (groups[0][1] === 3) return { cat: CAT.TRINCA, score: [CAT.TRINCA, groups[0][0], groups[1][0], groups[2][0]] };
    if (groups[0][1] === 2 && groups[1][1] === 2) {
      return { cat: CAT.DOIS_PARES, score: [CAT.DOIS_PARES, groups[0][0], groups[1][0], groups[2][0]] };
    }
    if (groups[0][1] === 2) return { cat: CAT.PAR, score: [CAT.PAR, ...groups.map((g) => g[0])] };
    return { cat: CAT.ALTA, score: [CAT.ALTA, ...ranks] };
  }

  /** -1, 0 ou 1: `a` perde, empata ou ganha de `b` (scores ou maos). */
  function compare(a, b) {
    const sa = Array.isArray(a) ? a : a.score;
    const sb = Array.isArray(b) ? b : b.score;
    const n = Math.max(sa.length, sb.length);
    for (let i = 0; i < n; i += 1) {
      const x = sa[i] === undefined ? -1 : sa[i];
      const y = sb[i] === undefined ? -1 : sb[i];
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  /** As 5 cartas em ordem de leitura: grupos maiores primeiro, depois valor
   * (na sequencia A-2-3-4-5, o as vai por ultimo). */
  function ordenar(cards, cat) {
    const counts = new Map();
    for (const c of cards) counts.set(rankOf(c), (counts.get(rankOf(c)) || 0) + 1);
    const out = cards.slice().sort((a, b) => counts.get(rankOf(b)) - counts.get(rankOf(a)) || rankOf(b) - rankOf(a)
      || SUITS.indexOf(a[1]) - SUITS.indexOf(b[1]));
    if ((cat === CAT.SEQUENCIA || cat === CAT.STRAIGHT_FLUSH) && rankOf(out[0]) === 12 && rankOf(out[1]) === 3) {
      out.push(out.shift());
    }
    return out;
  }

  /** Frase curta do jogo: "Par de reis", "Flush", "Full house de damas com setes". */
  function nomeDoJogo(cat, score) {
    switch (cat) {
      case CAT.STRAIGHT_FLUSH: return score[1] === 12 ? 'Royal flush' : 'Straight flush';
      case CAT.QUADRA: return `Quadra de ${NOME_PLURAL[score[1]]}`;
      case CAT.FULL: return `Full house de ${NOME_PLURAL[score[1]]} com ${NOME_PLURAL[score[2]]}`;
      case CAT.FLUSH: return 'Flush';
      case CAT.SEQUENCIA: return `Sequência até o ${NOME_UM[score[1]]}`;
      case CAT.TRINCA: return `Trinca de ${NOME_PLURAL[score[1]]}`;
      case CAT.DOIS_PARES: return `Dois pares, ${NOME_PLURAL[score[1]]} e ${NOME_PLURAL[score[2]]}`;
      case CAT.PAR: return `Par de ${NOME_PLURAL[score[1]]}`;
      default: return `Carta alta, ${NOME_UM[score[1]]}`;
    }
  }

  /**
   * Melhor jogo de 5 entre 5 a 7 cartas:
   * `{ cat, name, category, score, cards }` (`category` = nome da categoria,
   * "Flush"; `name` = frase com os valores, "Par de reis"; `cards` = as 5 que
   * formam o jogo). Cartas invalidas, repetidas ou fora de 5..7 -> null.
   */
  function best(cards) {
    if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7) return null;
    if (!cards.every(isCard) || new Set(cards).size !== cards.length) return null;
    const n = cards.length;
    let melhor = null;
    let melhorCards = null;
    // Todas as combinacoes de 5 (no maximo 21).
    for (let a = 0; a < n; a += 1) {
      for (let b = a + 1; b < n; b += 1) {
        for (let c = b + 1; c < n; c += 1) {
          for (let d = c + 1; d < n; d += 1) {
            for (let e = d + 1; e < n; e += 1) {
              const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
              const r = eval5(five);
              if (!melhor || compare(r.score, melhor.score) > 0) {
                melhor = r;
                melhorCards = five;
              }
            }
          }
        }
      }
    }
    return {
      cat: melhor.cat,
      category: CATEGORIAS[melhor.cat],
      name: nomeDoJogo(melhor.cat, melhor.score),
      score: melhor.score,
      cards: ordenar(melhorCards, melhor.cat),
    };
  }

  /** Quem ganha entre varias maos: indices (na lista dada) das melhores.
   * `null` na lista = quem nao disputa. Empate exato devolve varios. */
  function winners(hands) {
    let top = null;
    let out = [];
    hands.forEach((h, i) => {
      if (!h) return;
      const cmp = top ? compare(h.score, top.score) : 1;
      if (cmp > 0) { top = h; out = [i]; } else if (cmp === 0) out.push(i);
    });
    return out;
  }

  const api = { CATEGORIAS, CAT, isCard, eval5, best, compare, winners, nomeDoJogo };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaPoquerMaos = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
