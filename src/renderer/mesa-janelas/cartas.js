'use strict';

/*
 * Desenho de carta do baralho francês -- apoio das janelas de cartas da Mesa
 * (pôquer, blackjack...). NAO e tipo de janela: cada conteudo que usa carrega
 * este arquivo como carrega `comum.js` (lista GLOBAIS do `registrar`, com
 * 'cartas.js': 'mesaJanelasCartas').
 *
 * Carta = texto "As", "Td" (mesa-modules/baralho.js). `null` desenha o verso
 * (carta que voce nao pode ver). Rotulo falado no idioma ativo: "ás de espadas".
 */

(function (root) {
  const { t } = root.GoLive.i18n;
  const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const RANK_TEXT = { T: '10' };
  const RANKS = '23456789TJQKA';

  function isCard(c) {
    return typeof c === 'string' && c.length === 2 && RANKS.includes(c[0]) && c[1] in SUIT_GLYPH;
  }

  /** Texto do canto: "10♥", "A♠". Pura. */
  function face(c) {
    return isCard(c) ? `${RANK_TEXT[c[0]] || c[0]}${SUIT_GLYPH[c[1]]}` : '';
  }

  /** Rotulo para leitor de tela, no idioma ativo. `null` = virada para baixo. */
  function rotulo(c) {
    if (c === null || c === undefined) return t('mesa.cartas.cartaVirada');
    if (!isCard(c)) return t('mesa.carta');
    return t('mesa.carta.nome', {
      valor: t(`mesa.carta.valor.${c[0]}`),
      naipe: t(`mesa.carta.naipe.${c[1]}`),
    });
  }

  /** Rotulo de uma mao: "ás de espadas, rei de copas". */
  function rotuloMao(cards) {
    return Array.isArray(cards) && cards.length ? cards.map(rotulo).join(', ') : t('mesa.cartas.semCartas');
  }

  /**
   * Elemento da carta. `opts.tamanho`: 'p' | 'm' (padrao) | 'g'.
   * `opts.destaque`: contorno (ex.: cartas da mao vencedora).
   * `opts.vira`: a carta gira ao aparecer (so a de face; verso nao gira).
   */
  function carta(c, opts) {
    const o = opts || {};
    const doc = root.document;
    const node = doc.createElement('span');
    const virada = !isCard(c);
    const classes = ['mj-carta', 'mj-volume', `mj-carta-${o.tamanho || 'm'}`];
    if (virada) classes.push('is-verso');
    if (!virada && (c[1] === 'h' || c[1] === 'd')) classes.push('is-vermelha');
    if (o.destaque) classes.push('is-destaque');
    // Carta que acabou de ser revelada gira de lado para a frente (cartas.css).
    if (o.vira && !virada) classes.push('is-vira');
    node.className = classes.join(' ');
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', rotulo(virada ? null : c));
    if (!virada) {
      const canto = doc.createElement('span');
      canto.className = 'mj-carta-canto';
      canto.textContent = face(c);
      const meio = doc.createElement('span');
      meio.className = 'mj-carta-naipe';
      meio.setAttribute('aria-hidden', 'true');
      meio.textContent = SUIT_GLYPH[c[1]];
      node.append(canto, meio);
    }
    return node;
  }

  /** Fileira de cartas (mao, mesa). `null` na lista = virada. */
  function mao(cards, opts) {
    const doc = root.document;
    const row = doc.createElement('span');
    row.className = 'mj-mao';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', rotuloMao(cards));
    for (const c of Array.isArray(cards) ? cards : []) row.append(carta(c, opts));
    return row;
  }

  const api = { isCard, face, rotulo, rotuloMao, carta, mao };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaJanelasCartas = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
