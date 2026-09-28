'use strict';

/*
 * Desenho de carta do baralho francês -- apoio das janelas de cartas da Mesa
 * (pôquer, blackjack...). NAO e tipo de janela: cada conteudo que usa carrega
 * este arquivo como carrega `comum.js` (lista GLOBAIS do `registrar`, com
 * 'cartas.js': 'mesaJanelasCartas').
 *
 * Carta = texto "As", "Td" (mesa-modules/baralho.js). `null` desenha o verso
 * (carta que voce nao pode ver). Rotulo falado em PT: "ás de espadas".
 */

(function (root) {
  const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SUIT_NAME = { s: 'espadas', h: 'copas', d: 'ouros', c: 'paus' };
  const RANK_TEXT = { T: '10' };
  const RANK_NAME = {
    2: 'dois', 3: 'três', 4: 'quatro', 5: 'cinco', 6: 'seis', 7: 'sete', 8: 'oito', 9: 'nove',
    T: 'dez', J: 'valete', Q: 'dama', K: 'rei', A: 'ás',
  };

  function isCard(c) {
    return typeof c === 'string' && c.length === 2 && c[0] in RANK_NAME && c[1] in SUIT_GLYPH;
  }

  /** Texto do canto: "10♥", "A♠". Pura. */
  function face(c) {
    return isCard(c) ? `${RANK_TEXT[c[0]] || c[0]}${SUIT_GLYPH[c[1]]}` : '';
  }

  /** Rotulo para leitor de tela. `null` = virada para baixo. Pura. */
  function rotulo(c) {
    if (c === null || c === undefined) return 'carta virada';
    return isCard(c) ? `${RANK_NAME[c[0]]} de ${SUIT_NAME[c[1]]}` : 'carta';
  }

  /** Rotulo de uma mao: "ás de espadas, rei de copas". Pura. */
  function rotuloMao(cards) {
    return Array.isArray(cards) && cards.length ? cards.map(rotulo).join(', ') : 'sem cartas';
  }

  /**
   * Elemento da carta. `opts.tamanho`: 'p' | 'm' (padrao) | 'g'.
   * `opts.destaque`: contorno (ex.: cartas da mao vencedora).
   */
  function carta(c, opts) {
    const o = opts || {};
    const doc = root.document;
    const node = doc.createElement('span');
    const virada = !isCard(c);
    node.className = `mj-carta mj-carta-${o.tamanho || 'm'}${virada ? ' is-verso' : ''}${!virada && (c[1] === 'h' || c[1] === 'd') ? ' is-vermelha' : ''}${o.destaque ? ' is-destaque' : ''}`;
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
