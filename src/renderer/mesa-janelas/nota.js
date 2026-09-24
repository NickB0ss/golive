'use strict';
/* global setTimeout, clearTimeout, module */

/*
 * Conteudo da janela "Nota" (contrato da Mesa, secao 6). O modulo puro e
 * `mesa-modules/nota.js`: `{ kind: 'set', text }`, o ultimo que salva vence,
 * 1 000 caracteres.
 *
 * O texto vai para a sala ao sair do campo ou depois de uma pausa na
 * digitacao -- nunca a cada tecla. Enquanto a pessoa esta no campo, versao
 * nova que chega de outra pessoa nao apaga o que ela digita: a janela so
 * avisa ("Bia salvou outra versão") e, se ela sair do campo sem ter mexido,
 * o campo mostra a versao da sala.
 */

(function (root) {
  const TYPE = 'nota';
  const PAUSA_MS = 900;

  // ---------- Puras ----------

  /** Caracteres de verdade (um emoji conta um), como o validate conta. */
  function contar(texto) {
    return Array.from(texto).length;
  }

  /** "12 / 1 000"; `passou` quando nao cabe mais. */
  function contador(texto, max, milhar) {
    const n = contar(texto);
    return { n, passou: n > max, texto: `${milhar(n)} / ${milhar(max)}` };
  }

  /** Vale mandar? So se mudou do que a sala ja tem. */
  function precisaSalvar(local, daSala) {
    return local !== daSala;
  }

  /** "Salvo por Bia" (rodape), ou '' se ninguem salvou ainda. */
  function textoAutor(state, nomeDe) {
    return state.by === null || state.by === undefined || state.rev === 0 ? '' : `Salvo por ${nomeDe(state.by)}`;
  }

  // ---------- DOM ----------

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const MAX = 1000;
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;
    let daSala = '';
    let pausa = null;
    let mexeu = false; // digitou desde a ultima vez que o campo bateu com a sala

    const area = el('textarea', {
      class: 'mj-nota-texto',
      attrs: { 'aria-label': 'Nota', placeholder: 'Escreva uma nota…', spellcheck: 'false' },
    });
    const conta = el('span', { class: 'mj-nota-conta', attrs: { 'aria-live': 'off' } });
    const autor = el('span', { class: 'mj-nota-autor' });
    const rodape = el('div', { class: 'mj-nota-rodape' }, autor, el('span', { class: 'mj-mola' }), conta);
    b.raiz.append(area, rodape);
    b.aviso.em(b.raiz);

    function atualizarConta() {
      const c = contador(area.value, MAX, C.milhar);
      conta.textContent = c.texto;
      conta.classList.toggle('is-passou', c.passou);
      conta.setAttribute('aria-label', `${c.n} de ${MAX} caracteres`);
    }

    function salvar() {
      if (pausa) clearTimeout(pausa);
      pausa = null;
      if (!mexeu || !precisaSalvar(area.value, daSala)) return;
      if (b.acao(b.raiz, { kind: 'set', text: area.value })) mexeu = false;
    }

    area.addEventListener('input', () => {
      mexeu = true;
      atualizarConta();
      if (pausa) clearTimeout(pausa);
      pausa = setTimeout(salvar, PAUSA_MS);
    });
    area.addEventListener('blur', () => {
      salvar();
      // Saiu sem nada a mandar: mostra a versao da sala.
      if (!mexeu && area.value !== daSala) {
        area.value = daSala;
        atualizarConta();
      }
      b.aviso.limpar();
    });
    area.addEventListener('keydown', (e) => {
      // Esc tira do campo (e salva); a Vista usa Esc para mais nada aqui.
      if (e.key === 'Escape') {
        e.stopPropagation();
        area.blur();
      }
    });
    b.faxina.push(() => { if (pausa) clearTimeout(pausa); });

    function update(novo, meta) {
      const antes = daSala;
      state = novo;
      daSala = typeof state.text === 'string' ? state.text : '';
      const emFoco = root.document && root.document.activeElement === area;
      if (!emFoco) {
        if (area.value !== daSala) area.value = daSala;
        mexeu = false;
      } else if (daSala !== antes && daSala !== area.value && meta && meta.by !== api.me()) {
        b.aviso.mostrar(`${C.nomeDe(api, meta.by)} salvou outra versão; a sua vale se você salvar`, b.raiz);
      } else if (daSala === area.value) {
        mexeu = false;
      }
      autor.textContent = textoAutor(state, (id) => C.nomeDe(api, id));
      atualizarConta();
    }

    return {
      update,
      destroy() {
        // Quem fecha a janela no meio da digitacao nao perde o texto.
        try { salvar(); } catch { /* a janela ja saiu */ }
        b.destruir();
      },
      focus() { area.focus(); },
    };
  }

  const api = { type: TYPE, mount, contar, contador, precisaSalvar, textoAutor, PAUSA_MS };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaJanelas = root.GoLive.mesaJanelas || {};
  root.GoLive.mesaJanelas[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
