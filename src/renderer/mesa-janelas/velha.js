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

  const api = { type: TYPE, mount, rotuloCasa, empate, LABELS };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaJanelas = root.GoLive.mesaJanelas || {};
  root.GoLive.mesaJanelas[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
