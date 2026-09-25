'use strict';
/* global module */

/*
 * Conteudo da janela "Cronometro" (contrato da Mesa, secao 6). O modulo
 * puro (`mesa-modules/cronometro.js`) guarda so `elapsed` e, correndo, a
 * hora do SERVIDOR em que voltou a correr; o numero na tela sai de
 * `displayMs(state, api.serverNow())`, entao todo mundo ve o mesmo sem
 * mensagem por segundo.
 *
 * O quadro (requestAnimationFrame) so roda enquanto o cronometro corre, a
 * janela aparece na tela e a aba esta visivel (comum.criarLaco); parado,
 * esgotado ou destruido, nao ha laco nenhum. O texto so e reescrito quando
 * o segundo muda.
 */

(function (root) {
  const TYPE = 'cronometro';
  const MIN = 60 * 1000;
  const PRESETS = Object.freeze([1, 5, 10, 15]); // minutos

  function mod() {
    return root.GoLive.mesaModules[TYPE];
  }

  // ---------- Puras ----------

  /** O que o mostrador diz em `agora` (hora do servidor). `frac` e quanto
   * ja correu do regressivo (0..1), para a barra; null no progressivo. */
  function mostrador(m, state, agora) {
    const down = state.mode === 'down';
    const ms = m.displayMs(state, agora);
    const fim = m.isFinished(state, agora);
    const frac = down && state.duration > 0 ? Math.min(1, m.elapsedAt(state, agora) / state.duration) : null;
    return { texto: m.formatMs(ms, down), fim, frac };
  }

  /** O botao principal: rotulo e a(s) acao(oes) que ele manda. */
  function principal(m, state, agora) {
    const fim = m.isFinished(state, agora);
    if (state.running && fim) return { rotulo: 'Recomeçar', icone: 'zerar', acoes: [{ kind: 'reset' }, { kind: 'start' }] };
    if (state.running) return { rotulo: 'Pausar', icone: 'pausa', acoes: [{ kind: 'pause' }] };
    if (fim) return { rotulo: 'Recomeçar', icone: 'play', acoes: [{ kind: 'start' }] };
    if (state.elapsed > 0) return { rotulo: 'Continuar', icone: 'play', acoes: [{ kind: 'start' }] };
    return { rotulo: 'Iniciar', icone: 'play', acoes: [{ kind: 'start' }] };
  }

  /** 300000 -> "5 min"; 5400000 -> "1 h 30 min"; 45000 -> "45 s". */
  function rotuloDuracao(ms) {
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600);
    const mi = Math.floor((s % 3600) / 60);
    const se = s % 60;
    const partes = [];
    if (h) partes.push(`${h} h`);
    if (mi) partes.push(`${mi} min`);
    if (se || !partes.length) partes.push(`${se} s`);
    return partes.join(' ');
  }

  /** Frase para o leitor de tela quando o estado muda (nao a cada segundo). */
  function anuncio(m, state, agora) {
    if (m.isFinished(state, agora)) return 'Tempo esgotado';
    const quanto = rotuloDuracao(m.displayMs(state, agora));
    if (state.running) return state.mode === 'down' ? `Correndo, faltam ${quanto}` : `Correndo, ${quanto}`;
    return state.elapsed > 0 ? `Pausado em ${quanto}` : `Parado em ${quanto}`;
  }

  // ---------- DOM ----------

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const m = mod();
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;
    let ultimoTexto = '';
    let ultimoFim = null;
    let esgotou = false; // o quadro que viu o fim desenha 00:00 e o laco para

    const agora = () => api.serverNow();

    // Topo: nome e modo.
    const topo = el('div', { class: 'mj-barra mj-sec' });
    const nome = el('input', {
      class: 'mj-campo mj-cron-nome',
      attrs: { type: 'text', maxlength: String(m.MAX_LABEL), placeholder: 'Nome (ex.: Pausa)', 'aria-label': 'Nome do cronômetro', spellcheck: 'false' },
    });
    const campoNome = C.campoLocal(nome, { confirmar: (v) => b.acao(topo, { kind: 'label', text: v }) });
    const modoDown = C.botao({ text: 'Regressivo', class: 'mj-seg', attrs: { 'aria-pressed': 'true' } });
    const modoUp = C.botao({ text: 'Progressivo', class: 'mj-seg', attrs: { 'aria-pressed': 'false' } });
    const modos = el('div', { class: 'mj-segs', attrs: { role: 'group', 'aria-label': 'Modo' } }, modoDown, modoUp);
    topo.append(nome, modos);

    // Mostrador.
    const tempo = el('output', { class: 'mj-cron-tempo', attrs: { 'aria-live': 'off' } });
    const barra = el('div', { class: 'mj-cron-barra', attrs: { 'aria-hidden': 'true' } }, el('i'));
    const relogio = el('div', { class: 'mj-cron-relogio' }, tempo, barra);

    // Duracoes prontas (regressivo parado).
    const pre = el('div', { class: 'mj-barra mj-cron-pre mj-sec', attrs: { role: 'group', 'aria-label': 'Duração' } });
    const botoesPre = PRESETS.map((min) => {
      const bt = C.botao({ text: `${min} min`, class: 'mj-seg', attrs: { 'aria-pressed': 'false' } });
      b.clique(bt, pre, () => b.acao(pre, { kind: 'set', mode: 'down', duration: min * MIN }));
      pre.append(bt);
      return { bt, ms: min * MIN };
    });

    // Controles.
    const ctrl = el('div', { class: 'mj-barra mj-cron-ctrl' });
    const menos1 = C.botao({ text: '−1 min', class: 'mj-fantasma mj-sec', label: 'Tirar 1 minuto' });
    const mais1 = C.botao({ text: '+1 min', class: 'mj-fantasma mj-sec', label: 'Somar 1 minuto' });
    const play = C.botao({ icone: 'play', text: 'Iniciar', class: 'mj-pri mj-cron-play' });
    const zerar = C.botao({ icone: 'zerar', text: 'Zerar', class: 'mj-cron-zerar', label: 'Zerar o cronômetro' });
    ctrl.append(menos1, play, zerar, mais1);

    const status = el('p', { class: 'mj-cron-status visually-hidden', attrs: { role: 'status', 'aria-live': 'polite' } });

    b.raiz.append(topo, relogio, pre, ctrl, status);

    b.clique(modoDown, topo, () => b.acao(topo, { kind: 'set', mode: 'down', duration: state.duration }));
    b.clique(modoUp, topo, () => b.acao(topo, { kind: 'set', mode: 'up' }));
    b.clique(menos1, ctrl, () => b.acao(ctrl, { kind: 'adjust', delta: -MIN }));
    b.clique(mais1, ctrl, () => b.acao(ctrl, { kind: 'adjust', delta: MIN }));
    b.clique(zerar, ctrl, () => b.acao(ctrl, { kind: 'reset' }));
    b.clique(play, ctrl, () => {
      const p = principal(m, state, agora());
      if (!b.acao(ctrl, p.acoes[0])) return;
      // "Recomecar" com o regressivo esgotado e correndo: zera e poe para
      // correr de novo. O segundo passo nao passa pelo validate local
      // porque o estado daqui ainda nao viu o `reset`.
      for (const a of p.acoes.slice(1)) api.act(a);
    });

    function desenharTempo() {
      const d = mostrador(m, state, agora());
      esgotou = d.fim;
      if (d.texto !== ultimoTexto) {
        tempo.textContent = d.texto;
        ultimoTexto = d.texto;
      }
      barra.firstChild.style.transform = `scaleX(${d.frac === null ? 0 : 1 - d.frac})`;
      if (d.fim !== ultimoFim) {
        ultimoFim = d.fim;
        b.raiz.classList.toggle('is-fim', d.fim);
        if (d.fim && state.running) {
          status.textContent = 'Tempo esgotado';
          // O botao principal vira "Recomecar" no fim, sem esperar acao.
          pintarPrincipal();
        }
      }
    }

    const laco = C.criarLaco(b.raiz, () => !!state && state.running && !esgotou, desenharTempo);
    b.faxina.push(() => laco.parar());

    function pintarPrincipal() {
      const p = principal(m, state, agora());
      play.replaceChildren(C.icone(p.icone), el('span', { text: p.rotulo }));
      play.setAttribute('aria-label', p.rotulo);
      C.ligado(play, C.podeFazer(api, p.acoes[0]), p.rotulo);
    }

    function update(novo) {
      state = novo;
      const down = state.mode === 'down';
      campoNome.sync(state.label || '');
      modoDown.setAttribute('aria-pressed', String(down));
      modoUp.setAttribute('aria-pressed', String(!down));
      C.ligado(modoDown, down ? true : C.podeFazer(api, { kind: 'set', mode: 'down', duration: state.duration }));
      C.ligado(modoUp, !down ? true : C.podeFazer(api, { kind: 'set', mode: 'up' }));
      b.raiz.classList.toggle('is-up', !down);
      b.raiz.classList.toggle('is-rodando', state.running);
      pre.hidden = !down || state.running;
      for (const p of botoesPre) {
        p.bt.setAttribute('aria-pressed', String(down && state.duration === p.ms));
        C.ligado(p.bt, C.podeFazer(api, { kind: 'set', mode: 'down', duration: p.ms }));
      }
      const zerado = state.elapsed === 0 && !state.running;
      C.ligado(zerar, zerado ? 'Já está zerado' : true, 'Zerar o cronômetro');
      C.ligado(menos1, C.podeFazer(api, { kind: 'adjust', delta: -MIN }), 'Tirar 1 minuto');
      C.ligado(mais1, C.podeFazer(api, { kind: 'adjust', delta: MIN }), 'Somar 1 minuto');
      pintarPrincipal();
      ultimoFim = null;
      desenharTempo();
      status.textContent = anuncio(m, state, agora());
      tempo.setAttribute('aria-label', state.label ? `${state.label}: ${ultimoTexto}` : ultimoTexto);
      laco.acordar();
    }

    return {
      update,
      destroy: b.destruir,
      focus() { play.focus(); },
      // Para a bancada conferir que o laco para.
      get _laco() { return laco; },
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

  const api = { type: TYPE, mount, mostrador, principal, rotuloDuracao, anuncio, PRESETS };

  registrar(api, ['comum.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
