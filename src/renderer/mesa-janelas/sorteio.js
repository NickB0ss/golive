'use strict';
/* global document, module */

/*
 * Conteudo da janela "Sorteio de times" (contrato da Mesa, secao 6). O
 * modulo puro (`mesa-modules/sorteio.js`) embaralha no servidor; aqui so
 * se desenha a lista de nomes e os times que sairam.
 *
 * Quem entrou pela sala (`peerId`) aparece com a bolinha e o nome na cor da
 * pessoa (a mesma do rabisco). O nome e misturado ao --tx no CSS para
 * continuar legivel no tema claro.
 */

(function (root) {
  const TYPE = 'sorteio';

  function mod() {
    return root.GoLive.mesaModules[TYPE];
  }

  // ---------- Puras ----------

  /** Chave estavel de cada nome, para reaproveitar o no quando a lista
   * muda: a pessoa pelo id; nome digitado pelo texto e a ocorrencia. */
  function chaves(entries) {
    const vistos = new Map();
    return entries.map((e) => {
      const base = e.peerId !== null && e.peerId !== undefined ? `p:${e.peerId}` : `n:${e.name}`;
      const k = vistos.get(base) || 0;
      vistos.set(base, k + 1);
      return `${base}#${k}`;
    });
  }

  function rotuloSortear(state) {
    return state.teams ? 'Sortear de novo' : 'Sortear';
  }

  /** "Time 1: Ana e Bia. Time 2: Caio e Duda." -- o anuncio do sorteio. */
  function textoTimes(state) {
    if (!state.teams) return '';
    return state.teams
      .map((t, i) => {
        const nomes = t.map((e) => e.name);
        const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}` : nomes.join('');
        return `Time ${i + 1}: ${lista || 'ninguém'}.`;
      })
      .join(' ');
  }

  function opcoesTimes(m) {
    const out = [];
    for (let n = m.MIN_TEAMS; n <= m.MAX_TEAMS; n++) out.push({ valor: n, texto: `${n} times` });
    return out;
  }

  // ---------- DOM ----------

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const m = mod();
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;
    let montado = false;
    let rodadaVista = null;
    let focoDepois = null; // indice do nome tirado pelo teclado

    // Barra de cima: quantos times e o botao que sorteia.
    const topo = el('div', { class: 'mj-barra' });
    const selTimes = el('select', { class: 'mj-sel', attrs: { 'aria-label': 'Número de times' } });
    for (const o of opcoesTimes(m)) selTimes.append(el('option', { text: o.texto, attrs: { value: String(o.valor) } }));
    const sortear = C.botao({ icone: 'embaralhar', text: 'Sortear', class: 'mj-pri' });
    topo.append(selTimes, el('span', { class: 'mj-mola' }), sortear);

    // Times que sairam.
    const secTimes = el('section', { class: 'mj-sort-times', attrs: { 'aria-label': 'Times' } });
    const cabTimes = el('p', { class: 'mj-rotulo' });
    const gradeTimes = el('div', { class: 'mj-sort-grade' });
    const vazioTimes = el('p', { class: 'mj-dica', text: 'Ponha os nomes e sorteie.' });
    const anuncio = el('p', { class: 'visually-hidden', attrs: { role: 'status', 'aria-live': 'polite' } });
    secTimes.append(cabTimes, gradeTimes, vazioTimes, anuncio);

    // Nomes.
    const secNomes = el('section', { class: 'mj-sort-nomes', attrs: { 'aria-label': 'Nomes' } });
    const cabNomes = el('p', { class: 'mj-rotulo' });
    const campo = el('input', {
      class: 'mj-campo',
      attrs: { type: 'text', maxlength: String(m.MAX_NAME), placeholder: 'Adicionar nome', 'aria-label': 'Adicionar nome', spellcheck: 'false' },
    });
    const addBtn = C.botao({ icone: 'mais', class: 'mj-ic', label: 'Adicionar nome' });
    const form = el('form', { class: 'mj-form' }, campo, addBtn);
    const sala = C.botao({ icone: 'pessoas', text: 'Pôr a sala toda', class: 'mj-fantasma' });
    const limpar = C.botao({ icone: 'x', text: 'Limpar', class: 'mj-fantasma', label: 'Limpar os nomes' });
    const acoesNomes = el('div', { class: 'mj-barra mj-sort-acoes' }, sala, el('span', { class: 'mj-mola' }), limpar);
    const chips = el('ul', { class: 'mj-chips', attrs: { 'aria-label': 'Nomes no sorteio' } });
    secNomes.append(cabNomes, form, chips, acoesNomes);

    const corpo = el('div', { class: 'mj-sort-corpo mj-rola' }, secTimes, secNomes);
    b.raiz.append(topo, corpo);

    selTimes.addEventListener('change', () => {
      if (!b.acao(topo, { kind: 'teams', count: Number(selTimes.value) })) selTimes.value = String(state.teamCount);
    });
    b.clique(sortear, topo, () => b.acao(topo, { kind: 'draw' }));
    b.clique(sala, secNomes, () => b.acao(secNomes, { kind: 'addPeers' }));
    b.clique(limpar, secNomes, () => b.acao(secNomes, { kind: 'clear' }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const nome = campo.value;
      if (!nome.trim()) return;
      if (b.acao(form, { kind: 'add', name: nome })) campo.value = '';
    });
    b.clique(addBtn, form, () => form.requestSubmit());

    const nosChips = new Map(); // chave -> { li, nome, x, i }

    function criarChip(chave) {
      const dot = C.bolinha(null);
      const nome = el('span', { class: 'mj-chip-nome' });
      const x = C.botao({ icone: 'x', class: 'mj-mini mj-fantasma' });
      const li = el('li', { class: 'mj-chip' }, dot, nome, x);
      const no = { li, dot, nome, x, i: -1, chave };
      b.clique(x, secNomes, () => {
        if (b.acao(secNomes, { kind: 'remove', index: no.i })) focoDepois = no.i;
      });
      return no;
    }

    function pintarNome(no, e) {
      no.nome.textContent = e.name;
      const cor = e.peerId !== null && e.peerId !== undefined ? C.corDe(api, e.peerId) : null;
      no.dot.hidden = !cor;
      if (cor) {
        no.dot.style.setProperty('--mj-cor', cor);
        no.li.style.setProperty('--mj-cor', cor);
        no.li.classList.add('is-pessoa');
      } else {
        no.li.style.removeProperty('--mj-cor');
        no.li.classList.remove('is-pessoa');
      }
    }

    function desenharNomes() {
      const ks = chaves(state.entries);
      const vivos = new Set(ks);
      for (const [k, no] of nosChips) {
        if (!vivos.has(k)) {
          no.li.remove();
          nosChips.delete(k);
        }
      }
      ks.forEach((k, i) => {
        let no = nosChips.get(k);
        if (!no) {
          no = criarChip(k);
          nosChips.set(k, no);
        }
        no.i = i;
        const e = state.entries[i];
        pintarNome(no, e);
        no.x.setAttribute('aria-label', `Tirar ${e.name}`);
        no.x.title = `Tirar ${e.name}`;
        C.porNaPosicao(chips, no.li, i);
      });
      if (focoDepois !== null && (document.activeElement === document.body || !document.activeElement)) {
        const alvo = chips.children[Math.min(focoDepois, chips.children.length - 1)];
        (alvo ? alvo.querySelector('button') : campo).focus({ preventScroll: true });
      }
      focoDepois = null;
      const n = state.entries.length;
      cabNomes.textContent = `Nomes (${n})`;
    }

    function desenharTimes(animar) {
      gradeTimes.replaceChildren();
      const tem = !!state.teams;
      vazioTimes.hidden = tem;
      cabTimes.textContent = tem ? `Times · sorteio ${state.round}` : 'Times';
      if (!tem) return;
      state.teams.forEach((t, i) => {
        const lista = el('ul', { class: 'mj-sort-lista' });
        for (const e of t) {
          const cor = e.peerId !== null && e.peerId !== undefined ? C.corDe(api, e.peerId) : null;
          const li = el('li', { class: cor ? 'is-pessoa' : '' }, cor ? C.bolinha(cor) : el('span', { class: 'mj-dot is-vazio' }), el('span', { text: e.name }));
          if (cor) li.style.setProperty('--mj-cor', cor);
          lista.append(li);
        }
        const card = el('div', { class: `mj-sort-time${animar ? ' is-entra' : ''}` }, el('h4', { text: `Time ${i + 1}` }), lista);
        card.style.setProperty('--mj-i', String(i));
        gradeTimes.append(card);
      });
    }

    function update(novo) {
      const antes = state;
      state = novo;
      if (document.activeElement !== selTimes) selTimes.value = String(state.teamCount);

      if (!antes || JSON.stringify(antes.entries) !== JSON.stringify(state.entries)) desenharNomes();
      const novaRodada = rodadaVista !== state.round;
      if (!antes || novaRodada || JSON.stringify(antes.teams) !== JSON.stringify(state.teams)) {
        desenharTimes(montado && novaRodada && !!state.teams && !C.reduzMovimento());
        if (montado && novaRodada && state.teams) anuncio.textContent = textoTimes(state);
      }
      rodadaVista = state.round;
      montado = true;

      const rot = rotuloSortear(state);
      sortear.replaceChildren(C.icone('embaralhar'), el('span', { text: rot }));
      C.ligado(sortear, C.podeFazer(api, { kind: 'draw' }), rot);
      C.ligado(sala, C.podeFazer(api, { kind: 'addPeers' }), 'Pôr todas as pessoas da sala');
      C.ligado(limpar, state.entries.length ? true : 'A lista já está vazia', 'Limpar os nomes');
      C.ligado(addBtn, C.podeFazer(api, { kind: 'add', name: 'x' }), 'Adicionar nome');
      b.raiz.classList.toggle('tem-times', !!state.teams);
    }

    return { update, destroy: b.destruir, focus() { sortear.focus(); } };
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

  const api = { type: TYPE, mount, chaves, rotuloSortear, textoTimes, opcoesTimes };

  registrar(api, ['comum.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
