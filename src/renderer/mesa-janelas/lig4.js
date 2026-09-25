'use strict';
/* global module */

/*
 * Conteudo da janela "Lig 4" (contrato da Mesa, secoes 6 e 7). Cada
 * COLUNA e um botao (e onde se joga: a peca cai ate a casa livre mais
 * baixa); setas esquerda/direita andam entre as colunas, Enter solta. A
 * ultima peca e a sequencia vencedora ganham contorno.
 */

(function (root) {
  const TYPE = 'lig4';
  const LABELS = ['Vermelhas', 'Amarelas'];

  function mod() {
    return root.GoLive.mesaModules[TYPE];
  }

  // ---------- Puras ----------

  function livresNaColuna(board, col) {
    let n = 0;
    for (const linha of board) if (linha[col] === '.') n++;
    return n;
  }

  /** "Coluna 3: 2 casas livres" / "Coluna 3: cheia". */
  function rotuloColuna(board, col) {
    const n = livresNaColuna(board, col);
    return `Coluna ${col + 1}: ${n === 0 ? 'cheia' : n === 1 ? '1 casa livre' : `${n} casas livres`}`;
  }

  function empate() {
    return 'Empate, tabuleiro cheio';
  }

  // ---------- DOM ----------

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const T = root.GoLive.mesaJanelasTabuleiro;
    const m = mod();
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;

    const mold = T.moldura(b, api, { labels: LABELS, empate });
    const grade = el('div', { class: 'mj-lig4-grade', attrs: { role: 'group', 'aria-label': 'Lig 4: escolha a coluna' } });
    mold.placa.append(grade);
    mold.placa.addEventListener('pointerdown', (e) => e.stopPropagation());
    const colunas = Array.from({ length: m.COLS }, (_, c) => {
      const bt = el('button', { class: 'mj-lig4-col', attrs: { type: 'button', 'data-casa': String(c) } });
      const furos = Array.from({ length: m.ROWS }, () => {
        const f = el('span', { class: 'mj-lig4-furo' }, el('i'));
        bt.append(f);
        return f;
      });
      b.clique(bt, mold.zona, () => b.acao(mold.zona, { kind: 'move', col: c }));
      grade.append(bt);
      return { bt, furos };
    });
    const tecl = T.gradeTeclado(grade, () => colunas.map((x) => x.bt), m.COLS);

    function update(novo, meta) {
      state = novo;
      mold.update(state, meta);
      const linha = new Set((state.line || []).map(([r, c]) => `${r},${c}`));
      const ultima = state.last ? `${state.last[0]},${state.last[1]}` : '';
      colunas.forEach(({ bt, furos }, c) => {
        furos.forEach((f, r) => {
          const v = state.board[r][c];
          f.dataset.v = v;
          f.classList.toggle('is-linha', linha.has(`${r},${c}`));
          f.classList.toggle('is-ultima', ultima === `${r},${c}`);
        });
        bt.setAttribute('aria-label', rotuloColuna(state.board, c));
        C.ligado(bt, C.podeFazer(api, { kind: 'move', col: c }), '');
      });
      tecl.marcar();
    }

    return { update, destroy: b.destruir, focus() { colunas[tecl.atual].bt.focus(); } };
  }

  // ---------- Registro ----------
  // A Vista carrega so `mesa-janelas/<tipo>.js` (contrato, secao 6); o
  // apoio (comum.js, tabuleiro.js) vem daqui, uma vez, da mesma pasta. O
  // registro e imediato: se o apoio ainda nao chegou, a janela monta vazia,
  // guarda o ultimo `update` e so desenha quando ele chegar.
  function registrar(api, arquivos) {
    const G = (root.GoLive = root.GoLive || {});
    G.mesaJanelas = G.mesaJanelas || {};
    const GLOBAIS = { 'comum.js': 'mesaJanelasComum', 'tabuleiro.js': 'mesaJanelasTabuleiro' };
    const doc = root.document;
    const falta = () => arquivos.filter((a) => !G[GLOBAIS[a]]);
    const esperas = [];
    if (doc && falta().length) {
      const base = (doc.currentScript && doc.currentScript.src) || doc.baseURI;
      G.mesaJanelasApoio = G.mesaJanelasApoio || {};
      for (const a of falta()) {
        if (G.mesaJanelasApoio[a]) continue;
        const s = doc.createElement('script');
        s.src = new root.URL(a, base).href;
        s.async = false;
        G.mesaJanelasApoio[a] = s;
        doc.head.appendChild(s);
      }
      for (const a of falta()) {
        esperas.push(new Promise((ok) => {
          G.mesaJanelasApoio[a].addEventListener('load', ok, { once: true });
        }));
      }
    }
    const montar = api.mount;
    const pronto = esperas.length ? Promise.all(esperas) : null;
    api.mount = function (el, vistaApi) {
      if (!falta().length) return montar(el, vistaApi);
      let inst = null;
      let ultimo = null;
      let morto = false;
      pronto.then(() => {
        if (morto) return;
        inst = montar(el, vistaApi);
        if (ultimo) inst.update(ultimo[0], ultimo[1]);
      }, () => {});
      return {
        update(s, meta) { if (inst) inst.update(s, meta); else ultimo = [s, meta]; },
        destroy() { morto = true; if (inst) inst.destroy(); },
        focus() { if (inst && inst.focus) inst.focus(); },
      };
    };
    G.mesaJanelas[api.type] = api;
  }

  const api = { type: TYPE, mount, livresNaColuna, rotuloColuna, empate, LABELS };

  registrar(api, ['comum.js', 'tabuleiro.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
