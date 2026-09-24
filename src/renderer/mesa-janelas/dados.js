'use strict';
/* global setTimeout, clearTimeout, module */

/*
 * Conteudo da janela "Dados e moeda" (contrato da Mesa, secao 6). O
 * resultado nasce no servidor (`prepare` do modulo); aqui a jogada nova
 * so da uma sacudida curta (transform, ~0,45 s) e o `describe` do modulo
 * e anunciado quando ela para. Quem prefere menos movimento ve o numero
 * direto.
 */

(function (root) {
  const TYPE = 'dados';
  const ANIM_MS = 450;

  function mod() {
    return root.GoLive.mesaModules[TYPE];
  }

  // ---------- Puras ----------

  function ultima(state) {
    return state.history.length ? state.history[state.history.length - 1] : null;
  }

  /** Jogada nova desde o ultimo estado visto (o contador so sobe). */
  function novaJogada(antes, depois) {
    return !!antes && depois.rolls > antes.rolls && !!ultima(depois);
  }

  /** "Bia rolou 2d6: 3 + 5 = 8" / "Bia jogou a moeda: cara". */
  function anuncio(m, entry, nomeDe) {
    const quem = nomeDe(entry.by);
    if (entry.kind === 'coin') return `${quem} jogou a moeda: ${entry.value}`;
    return `${quem} rolou ${m.describe(entry)}`;
  }

  /** O que vai no meio da janela: as faces (ou a moeda) e o total. */
  function faces(m, entry) {
    if (!entry) return { tipo: 'nada', valores: [], total: null };
    if (entry.kind === 'coin') return { tipo: 'moeda', valores: [entry.value === 'cara' ? 'Cara' : 'Coroa'], total: null };
    return { tipo: 'dados', valores: entry.values.map(String), total: entry.values.length > 1 ? m.total(entry) : null, lados: entry.sides };
  }

  /** Historico do mais novo para o mais velho, sem a jogada do meio. */
  function historico(m, state) {
    return state.history.slice(0, -1).reverse().map((e) => ({ n: e.n, by: e.by, texto: m.describe(e) }));
  }

  /** O historico mudou (jogada nova ou limpo)? Por conteudo, nao por
   * referencia: o estado pode chegar sempre como objeto novo. */
  function mudouHistorico(a, b) {
    const ua = ultima(a);
    const ub = ultima(b);
    return a.history.length !== b.history.length || (ua && ua.n) !== (ub && ub.n);
  }

  // ---------- DOM ----------

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const m = mod();
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;
    let timer = null;

    const topo = el('div', { class: 'mj-barra mj-sec' });
    const selQtd = el('select', { class: 'mj-sel', attrs: { 'aria-label': 'Quantos dados' } });
    for (let n = m.MIN_DICE; n <= m.MAX_DICE; n++) selQtd.append(el('option', { text: `${n} ${n === 1 ? 'dado' : 'dados'}`, attrs: { value: String(n) } }));
    const selLados = el('select', { class: 'mj-sel', attrs: { 'aria-label': 'Lados do dado' } });
    for (const s of m.SIDES) selLados.append(el('option', { text: `d${s}`, attrs: { value: String(s) } }));
    topo.append(selQtd, selLados);

    const palco = el('div', { class: 'mj-dados-palco', attrs: { 'aria-hidden': 'true' } });
    const res = el('p', { class: 'mj-dados-res', attrs: { 'aria-live': 'polite' } });
    const quem = el('span', { class: 'mj-dados-quem' });
    const meio = el('div', { class: 'mj-dados-meio' }, palco, res, quem);

    const hist = el('ol', { class: 'mj-dados-hist mj-rola', attrs: { 'aria-label': 'Jogadas anteriores' } });
    const limpar = C.botao({ text: 'Limpar', class: 'mj-fantasma', label: 'Limpar o histórico' });
    const colHist = el('section', { class: 'mj-dados-col', attrs: { 'aria-label': 'Histórico' } },
      el('div', { class: 'mj-barra' }, el('p', { class: 'mj-rotulo', text: 'Antes' }), el('span', { class: 'mj-mola' }), limpar), hist);

    const corpo = el('div', { class: 'mj-dados-corpo' }, meio, colHist);

    const ctrl = el('div', { class: 'mj-barra mj-dados-ctrl' });
    const rolar = C.botao({ icone: 'dado', text: 'Rolar', class: 'mj-pri' });
    const moeda = C.botao({ icone: 'moeda', text: 'Moeda', label: 'Jogar a moeda' });
    ctrl.append(rolar, moeda);

    b.raiz.append(topo, corpo, ctrl);

    function config() {
      const a = { kind: 'config', count: Number(selQtd.value), sides: Number(selLados.value) };
      if (!b.acao(topo, a)) {
        selQtd.value = String(state.count);
        selLados.value = String(state.sides);
      }
    }
    selQtd.addEventListener('change', config);
    selLados.addEventListener('change', config);
    b.clique(rolar, ctrl, () => b.acao(ctrl, { kind: 'roll' }));
    b.clique(moeda, ctrl, () => b.acao(ctrl, { kind: 'coin' }));
    b.clique(limpar, colHist, () => b.acao(colHist, { kind: 'clear' }));
    b.faxina.push(() => { if (timer) clearTimeout(timer); });

    function desenharPalco(animar) {
      const e = ultima(state);
      const f = faces(m, e);
      palco.className = `mj-dados-palco is-${f.tipo}`;
      palco.style.setProperty('--mj-n', String(Math.max(1, f.valores.length)));
      palco.replaceChildren(...f.valores.map((v, i) => {
        const d = el('span', { class: f.tipo === 'moeda' ? 'mj-moeda' : 'mj-dado', text: v });
        if (animar) {
          d.classList.add('is-rola');
          d.style.setProperty('--mj-i', String(i));
        }
        return d;
      }));
      if (f.tipo === 'nada') {
        palco.append(el('span', { class: 'mj-dado is-vazio', text: '?' }));
      }
      if (timer) clearTimeout(timer);
      const texto = e ? m.describe(e) : 'Ninguém rolou ainda';
      const dono = e ? C.nomeDe(api, e.by) : '';
      const pintar = () => {
        timer = null;
        res.textContent = texto;
        res.setAttribute('aria-label', e ? anuncio(m, e, (id) => C.nomeDe(api, id)) : texto);
        quem.replaceChildren();
        if (e) quem.append(C.bolinha(C.corDe(api, e.by)), el('span', { text: dono }));
      };
      if (animar) {
        res.classList.add('is-espera');
        timer = setTimeout(() => {
          res.classList.remove('is-espera');
          pintar();
        }, ANIM_MS);
      } else {
        res.classList.remove('is-espera');
        pintar();
      }
    }

    function desenharHist() {
      const h = historico(m, state);
      hist.replaceChildren(...h.map((x) => el('li', null, C.bolinha(C.corDe(api, x.by), C.nomeDe(api, x.by)), el('span', { text: x.texto }))));
      if (!h.length) hist.append(el('li', { class: 'mj-dica', text: 'Nada ainda.' }));
    }

    function update(novo) {
      const antes = state;
      state = novo;
      if (root.document.activeElement !== selQtd) selQtd.value = String(state.count);
      if (root.document.activeElement !== selLados) selLados.value = String(state.sides);
      const nova = novaJogada(antes, state);
      if (!antes || nova || mudouHistorico(antes, state)) {
        desenharPalco(nova && !C.reduzMovimento());
        desenharHist();
      }
      C.ligado(limpar, state.history.length ? true : 'O histórico já está vazio', 'Limpar o histórico');
      const rot = `Rolar ${state.count}d${state.sides}`;
      rolar.setAttribute('aria-label', rot);
      C.ligado(rolar, C.podeFazer(api, { kind: 'roll' }), rot);
    }

    return { update, destroy: b.destruir, focus() { rolar.focus(); } };
  }

  const api = { type: TYPE, mount, ultima, novaJogada, mudouHistorico, anuncio, faces, historico, ANIM_MS };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaJanelas = root.GoLive.mesaJanelas || {};
  root.GoLive.mesaJanelas[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
