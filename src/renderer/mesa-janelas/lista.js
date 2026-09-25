'use strict';
/* global document, module */

/*
 * Conteudo da janela "Lista" (contrato da Mesa, secao 6). O modulo puro
 * (`mesa-modules/lista.js`) enderecao itens por `id`, entao cada linha aqui
 * e um no por id, reaproveitado entre `update`s: quem esta marcando ou
 * editando uma linha nao perde o foco quando outra pessoa mexe na lista.
 *
 * Marcar: a caixa (ou o texto). Editar: o lapis abre o campo; Enter ou
 * sair do campo confirma, Esc desiste. Reordenar: Alt+↑/Alt+↓ com o foco
 * em qualquer controle da linha, ou os botoes Subir/Descer.
 */

(function (root) {
  const TYPE = 'lista';

  function mod() {
    return root.GoLive.mesaModules[TYPE];
  }

  // ---------- Puras ----------

  function contagem(state) {
    const total = state.items.length;
    const feitos = state.items.filter((it) => it.done).length;
    const texto = total === 0 ? 'Lista vazia' : `${feitos} de ${total} ${total === 1 ? 'feito' : 'feitos'}`;
    return { feitos, total, texto };
  }

  /** Posicao nova de `id` andando `delta` (-1 sobe, +1 desce), ou null. */
  function destino(items, id, delta) {
    const i = items.findIndex((it) => it.id === id);
    if (i === -1) return null;
    const to = i + delta;
    return to < 0 || to >= items.length ? null : to;
  }

  /** Alt+↑ = -1, Alt+↓ = +1, o resto 0. */
  function teclaMove(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return 0;
    if (e.key === 'ArrowUp') return -1;
    if (e.key === 'ArrowDown') return 1;
    return 0;
  }

  // ---------- DOM ----------

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const m = mod();
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;

    const titulo = el('input', {
      class: 'mj-lista-titulo mj-sec',
      attrs: { type: 'text', maxlength: String(m.MAX_TITLE), placeholder: 'Título da lista', 'aria-label': 'Título da lista', spellcheck: 'false' },
    });
    const campoTitulo = C.campoLocal(titulo, { confirmar: (v) => b.acao(b.raiz, { kind: 'title', text: v }) });

    const ul = el('ul', { class: 'mj-lista-itens mj-rola', attrs: { 'aria-label': 'Itens' } });
    const vazio = el('p', { class: 'mj-dica mj-lista-vazio', text: 'Nada na lista ainda.' });

    const novo = el('input', {
      class: 'mj-campo',
      attrs: { type: 'text', maxlength: String(m.MAX_TEXT), placeholder: 'Novo item', 'aria-label': 'Novo item', spellcheck: 'false' },
    });
    const addBtn = C.botao({ icone: 'mais', class: 'mj-ic', label: 'Adicionar à lista' });
    const form = el('form', { class: 'mj-form' }, novo, addBtn);

    const conta = el('span', { class: 'mj-lista-conta' });
    const apagar = C.botao({ text: 'Apagar marcados', class: 'mj-fantasma' });
    const rodape = el('div', { class: 'mj-barra mj-lista-rodape' }, conta, el('span', { class: 'mj-mola' }), apagar);

    b.raiz.append(titulo, ul, vazio, form, rodape);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!novo.value.trim()) return;
      if (b.acao(form, { kind: 'add', text: novo.value })) novo.value = '';
    });
    b.clique(addBtn, form, () => form.requestSubmit());
    b.clique(apagar, rodape, () => b.acao(rodape, { kind: 'clearDone' }));

    const linhas = new Map(); // id -> linha

    function mover(linha, delta) {
      const to = destino(state.items, linha.id, delta);
      if (to === null) return;
      b.acao(linha.li, { kind: 'move', id: linha.id, to });
    }

    function criarLinha(id) {
      const caixa = el('input', { class: 'mj-caixa', attrs: { type: 'checkbox' } });
      const marca = C.icone('check');
      marca.classList.add('mj-caixa-marca');
      const texto = el('span', { class: 'mj-item-texto' });
      const rot = el('label', { class: 'mj-item-rot' }, el('span', { class: 'mj-caixa-wrap' }, caixa, marca), texto);
      const editar = C.botao({ icone: 'lapis', class: 'mj-mini mj-fantasma' });
      const subir = C.botao({ icone: 'sobe', class: 'mj-mini mj-fantasma' });
      const descer = C.botao({ icone: 'desce', class: 'mj-mini mj-fantasma' });
      const tirar = C.botao({ icone: 'x', class: 'mj-mini mj-fantasma' });
      const acoes = el('span', { class: 'mj-item-acoes' }, editar, subir, descer, tirar);
      const li = el('li', { class: 'mj-item' }, rot, acoes);
      const linha = { id, li, caixa, texto, rot, editar, subir, descer, tirar, campo: null, item: null };

      caixa.addEventListener('change', () => {
        const quer = caixa.checked;
        caixa.checked = linha.item.done; // quem manda e a sala; o eco marca
        b.acao(li, { kind: 'check', id, done: quer });
      });
      b.clique(editar, li, () => abrirEdicao(linha));
      b.clique(subir, li, () => mover(linha, -1));
      b.clique(descer, li, () => mover(linha, 1));
      b.clique(tirar, li, () => {
        const prox = li.nextElementSibling || li.previousElementSibling;
        if (b.acao(li, { kind: 'remove', id }) && prox) linha.focoDepois = prox;
      });
      li.addEventListener('keydown', (e) => {
        if (linha.campo) return; // editando: Alt+setas sao do campo
        const d = teclaMove(e);
        if (!d) return;
        e.preventDefault();
        mover(linha, d);
      });
      return linha;
    }

    function abrirEdicao(linha) {
      if (linha.campo) return;
      const input = el('input', {
        class: 'mj-campo mj-item-campo',
        attrs: { type: 'text', maxlength: String(m.MAX_TEXT), 'aria-label': `Editar ${linha.item.text}`, spellcheck: 'false' },
      });
      input.value = linha.item.text;
      linha.campo = input;
      linha.li.classList.add('is-editando');
      linha.rot.after(input);
      let fechado = false;
      const fechar = (confirmar) => {
        if (fechado) return;
        fechado = true;
        const v = input.value;
        linha.campo = null;
        linha.li.classList.remove('is-editando');
        const voltar = input === document.activeElement;
        input.remove();
        if (voltar) linha.editar.focus({ preventScroll: true });
        if (confirmar && v.trim() && v !== linha.item.text) b.acao(linha.li, { kind: 'edit', id: linha.id, text: v });
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); fechar(true); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(false); }
      });
      input.addEventListener('blur', () => { if (!C.estaMovendo()) fechar(true); });
      input.focus();
      input.select();
    }

    function pintarLinha(linha, it, i, n) {
      linha.item = it;
      if (linha.texto.textContent !== it.text) linha.texto.textContent = it.text;
      if (linha.caixa.checked !== it.done) linha.caixa.checked = it.done;
      linha.li.classList.toggle('is-feito', it.done);
      linha.caixa.setAttribute('aria-label', it.text);
      linha.editar.setAttribute('aria-label', `Editar ${it.text}`);
      linha.subir.setAttribute('aria-label', `Subir ${it.text}`);
      linha.descer.setAttribute('aria-label', `Descer ${it.text}`);
      linha.tirar.setAttribute('aria-label', `Apagar ${it.text}`);
      C.ligado(linha.editar, true, 'Editar');
      C.ligado(linha.subir, i > 0 ? true : 'Já é o primeiro', 'Subir (Alt+↑)');
      C.ligado(linha.descer, i < n - 1 ? true : 'Já é o último', 'Descer (Alt+↓)');
      C.ligado(linha.tirar, true, 'Apagar');
    }

    function update(novoEstado) {
      state = novoEstado;
      campoTitulo.sync(state.title || '');
      const vivos = new Set(state.items.map((it) => it.id));
      let focoPerdido = null;
      for (const [id, linha] of linhas) {
        if (vivos.has(id)) continue;
        if (linha.li.contains(document.activeElement) || linha.focoDepois) focoPerdido = linha.focoDepois || null;
        linha.li.remove();
        linhas.delete(id);
      }
      const n = state.items.length;
      state.items.forEach((it, i) => {
        let linha = linhas.get(it.id);
        if (!linha) {
          linha = criarLinha(it.id);
          linhas.set(it.id, linha);
        }
        pintarLinha(linha, it, i, n);
        C.porNaPosicao(ul, linha.li, i);
      });
      if (focoPerdido && focoPerdido.isConnected && (document.activeElement === document.body || !document.activeElement)) {
        const alvo = focoPerdido.querySelector('.mj-caixa');
        if (alvo) alvo.focus({ preventScroll: true });
      }
      vazio.hidden = n > 0;
      conta.textContent = contagem(state).texto;
      C.ligado(apagar, C.podeFazer(api, { kind: 'clearDone' }), 'Apagar os itens marcados');
      C.ligado(addBtn, C.podeFazer(api, { kind: 'add', text: 'x' }), 'Adicionar à lista');
    }

    return { update, destroy: b.destruir, focus() { novo.focus(); } };
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

  const api = { type: TYPE, mount, contagem, destino, teclaMove };

  registrar(api, ['comum.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
