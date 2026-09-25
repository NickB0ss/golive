'use strict';
/* global module */

/*
 * Conteudo da janela "Jogo da velha" (contrato da Mesa, secoes 6 e 7). O
 * modulo puro e `mesa-modules/velha.js`; a moldura das cadeiras vem de
 * `tabuleiro.js`. Nove botoes de verdade: clique ou setas + Enter.
 */

(function (root) {
  const TYPE = 'velha';
  const LABELS = ['X', 'O'];

  // ---------- Puras ----------

  /** Rotulo de cada casa para o leitor de tela: "Linha 1, coluna 2: X". */
  function rotuloCasa(board, i) {
    const v = board[i];
    const onde = `Linha ${Math.floor(i / 3) + 1}, coluna ${(i % 3) + 1}`;
    return v === '.' ? `${onde}: vazia` : `${onde}: ${v}`;
  }

  function empate() {
    return 'Deu velha';
  }

  // ---------- DOM ----------

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const T = root.GoLive.mesaJanelasTabuleiro;
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;

    const mold = T.moldura(b, api, {
      labels: LABELS,
      empate,
      amostra(a, i) { a.textContent = LABELS[i]; },
    });
    const grade = el('div', { class: 'mj-velha-grade', attrs: { role: 'grid', 'aria-label': 'Jogo da velha' } });
    mold.placa.append(grade);
    const casas = Array.from({ length: 9 }, (_, i) => {
      const bt = el('button', { class: 'mj-velha-casa', attrs: { type: 'button', 'data-casa': String(i) } });
      b.clique(bt, mold.zona, () => b.acao(mold.zona, { kind: 'move', cell: i }));
      grade.append(bt);
      return bt;
    });
    const tecl = T.gradeTeclado(grade, () => casas, 3);
    // Nada que comeca na placa sobe para a mesa.
    mold.placa.addEventListener('pointerdown', (e) => e.stopPropagation());

    function update(novo, meta) {
      state = novo;
      mold.update(state, meta);
      const linha = new Set(state.line || []);
      casas.forEach((bt, i) => {
        const v = state.board[i];
        const txt = v === '.' ? '' : v;
        if (bt.textContent !== txt) bt.textContent = txt;
        bt.classList.toggle('is-o', v === 'O');
        bt.classList.toggle('is-linha', linha.has(i));
        bt.setAttribute('aria-label', rotuloCasa(state.board, i));
        C.ligado(bt, v === '.' ? C.podeFazer(api, { kind: 'move', cell: i }) : 'Casa ocupada', '');
      });
      tecl.marcar();
    }

    return { update, destroy: b.destruir, focus() { casas[tecl.atual].focus(); } };
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

  const api = { type: TYPE, mount, rotuloCasa, empate, LABELS };

  registrar(api, ['comum.js', 'tabuleiro.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
