'use strict';

/*
 * Conteudo da janela "Placar" (contrato da Mesa, secao 6). O modulo puro
 * e `mesa-modules/placar.js`; aqui so o desenho.
 *
 * De 2 a 4 times lado a lado: nome editavel (vai para a sala ao sair do
 * campo ou no Enter), o numero grande e -1/+1. Em cima, o numero de times,
 * o "melhor de N" e Zerar -- secundarios, somem quando a janela e baixa.
 */

(function (root) {
  const { t, traduzirCodigo } = root.GoLive.i18n;
  const TYPE = 'placar';

  function mod() {
    return root.GoLive.mesaModules[TYPE];
  }

  // ---------- Puras (testadas sem DOM) ----------

  /** Opcoes do seletor "melhor de": null (sem serie) e os impares validos. */
  function opcoesSerie(m) {
    const out = [{ valor: null, texto: t('mesa.placar.semSerie') }];
    for (let n = m.MIN_BEST_OF; n <= m.MAX_BEST_OF; n += 2) out.push({ valor: n, texto: t('mesa.placar.melhorDe', { n }) });
    return out;
  }

  /** "Azul venceu a série" ou '' enquanto ninguem fechou. */
  function textoVencedor(m, state) {
    const w = m.winner(state);
    return w === -1 ? '' : t('mesa.placar.venceuSerie', { nome: traduzirCodigo(state.teams[w].name) });
  }

  /** Dica abaixo dos times: quantas vitorias fecham a serie. */
  function textoSerie(state) {
    if (state.bestOf === null) return '';
    const alvo = Math.floor(state.bestOf / 2) + 1;
    return t('mesa.placar.melhorDeFecha', { n: state.bestOf, alvo });
  }

  /** Motivo (ou true) de cada botao de um time, pelo validate do modulo. */
  function botoesDoTime(validar, i) {
    return {
      mais: validar({ kind: 'score', team: i, delta: 1 }),
      menos: validar({ kind: 'score', team: i, delta: -1 }),
    };
  }

  // ---------- DOM ----------

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const m = mod();
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;

    // Topo: times, serie, zerar.
    const topo = el('div', { class: 'mj-barra mj-sec' });
    const selTimes = el('select', { class: 'mj-sel', attrs: { 'aria-label': t('mesa.placar.numeroDeTimes') } });
    for (let n = m.MIN_TEAMS; n <= m.MAX_TEAMS; n++) {
      selTimes.append(el('option', { text: t('mesa.placar.nTimes', { n }), attrs: { value: String(n) } }));
    }
    const selSerie = el('select', { class: 'mj-sel', attrs: { 'aria-label': t('mesa.placar.serie') } });
    for (const o of opcoesSerie(m)) {
      selSerie.append(el('option', { text: o.texto, attrs: { value: o.valor === null ? '' : String(o.valor) } }));
    }
    const zerar = C.botao({ icone: 'zerar', text: t('mesa.placar.zerar'), label: t('mesa.placar.zerarPlacar'), class: 'mj-fantasma' });
    topo.append(selTimes, selSerie, el('span', { class: 'mj-mola' }), zerar);

    const times = el('div', { class: 'mj-times' });
    const rodape = el('p', { class: 'mj-placar-rodape', attrs: { 'aria-live': 'polite' } });
    b.raiz.append(topo, times, rodape);

    selTimes.addEventListener('change', () => {
      if (!b.acao(topo, { kind: 'teams', count: Number(selTimes.value) })) selTimes.value = String(state.teams.length);
    });
    selSerie.addEventListener('change', () => {
      const n = selSerie.value === '' ? null : Number(selSerie.value);
      if (!b.acao(topo, { kind: 'bestOf', n })) selSerie.value = state.bestOf === null ? '' : String(state.bestOf);
    });
    b.clique(zerar, topo, () => b.acao(topo, { kind: 'reset' }));

    const nos = []; // um por time: { caixa, nome, campo, pontos, mais, menos }

    function criarTime(i) {
      const caixa = el('div', { class: 'mj-time' });
      const nome = el('input', {
        class: 'mj-nome',
        attrs: {
          type: 'text',
          maxlength: String(m.MAX_NAME),
          'aria-label': t('mesa.placar.nomeDoTime', { n: i + 1 }),
          spellcheck: 'false',
        },
      });
      const pontos = el('output', { class: 'mj-pontos', attrs: { 'aria-live': 'off' } });
      const menos = C.botao({ icone: 'menos', class: 'mj-ic' });
      const mais = C.botao({ icone: 'mais', class: 'mj-ic' });
      const pm = el('div', { class: 'mj-pm' }, menos, mais);
      caixa.append(nome, pontos, pm);
      const campo = C.campoLocal(nome, {
        confirmar(v) {
          return b.acao(caixa, { kind: 'rename', team: i, name: v });
        },
      });
      b.clique(mais, caixa, () => b.acao(caixa, { kind: 'score', team: i, delta: 1 }));
      b.clique(menos, caixa, () => b.acao(caixa, { kind: 'score', team: i, delta: -1 }));
      return { caixa, nome, campo, pontos, mais, menos, valor: null };
    }

    function update(novo) {
      state = novo;
      const n = state.teams.length;
      while (nos.length < n) {
        const novoTime = criarTime(nos.length);
        nos.push(novoTime);
        times.append(novoTime.caixa);
      }
      while (nos.length > n) nos.pop().caixa.remove();
      times.style.setProperty('--mj-n', String(n));

      const w = m.winner(state);
      const validar = (a) => C.podeFazer(api, a);
      state.teams.forEach((time, i) => {
        const no = nos[i];
        const nomeDoTime = traduzirCodigo(time.name);
        no.campo.sync(nomeDoTime);
        if (no.valor !== time.score) {
          no.pontos.textContent = String(time.score);
          if (no.valor !== null && !C.reduzMovimento()) {
            no.pontos.classList.remove('is-mudou');
            void no.pontos.offsetWidth;
            no.pontos.classList.add('is-mudou');
          }
          no.valor = time.score;
        }
        no.pontos.setAttribute('aria-label', t('mesa.placar.pontosDe', { nome: nomeDoTime, n: time.score }));
        no.mais.setAttribute('aria-label', t('mesa.placar.somarPara', { nome: nomeDoTime }));
        no.menos.setAttribute('aria-label', t('mesa.placar.tirarDe', { nome: nomeDoTime }));
        const mot = botoesDoTime(validar, i);
        C.ligado(no.mais, mot.mais, t('mesa.placar.somarPara', { nome: nomeDoTime }));
        C.ligado(no.menos, mot.menos, t('mesa.placar.tirarDe', { nome: nomeDoTime }));
        no.caixa.classList.toggle('is-vence', i === w);
      });

      if (document.activeElement !== selTimes) selTimes.value = String(n);
      if (document.activeElement !== selSerie) selSerie.value = state.bestOf === null ? '' : String(state.bestOf);
      C.ligado(zerar, state.teams.some((time) => time.score > 0) ? true : t('mesa.placar.jaZerado'));

      const venc = textoVencedor(m, state);
      rodape.textContent = venc || textoSerie(state);
      rodape.classList.toggle('is-vence', !!venc);
    }

    return {
      update,
      destroy: b.destruir,
      focus() {
        if (nos[0]) nos[0].mais.focus();
      },
    };
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

  const api = { type: TYPE, mount, opcoesSerie, textoVencedor, textoSerie, botoesDoTime };

  registrar(api, ['comum.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
