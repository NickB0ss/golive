'use strict';

/* Conteudo da janela Oito maluco. Recebe somente a `view` secreta: a mao
 * da propria pessoa, contagens dos demais e a carta de cima; maos alheias e
 * monte nao existem neste lado do renderer. */
(function (root) {
  const TYPE = 'oito';
  const NAIPES = [
    ['s', 'Espadas'],
    ['h', 'Copas'],
    ['d', 'Ouros'],
    ['c', 'Paus'],
  ];
  const nomeDoLugar = (state, seat) => state.names[seat] || `Lugar ${seat + 1}`;
  const textoDeStatus = (state) => {
    if (state.phase === 'finished') return `${nomeDoLugar(state, state.winner)} venceu`;
    if (state.phase !== 'play') return 'Sente-se e dê as cartas';
    const points = state.scores.filter((_, i) => state.seats[i] !== null).join(' × ');
    return `Vez de ${nomeDoLugar(state, state.turn)} — ${points} pontos`;
  };
  const podeJogar = (card, discard, suit) => Boolean(card && discard)
    && (card[0] === '8' || card[1] === suit || card[0] === discard[0]);
  const atualizarBarra = (api, texto, vez) => {
    api.setStatus?.(texto);
    api.setTurn?.(vez);
  };

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const K = root.GoLive.mesaJanelasCartas;
    const { el } = C;
    const b = C.base(elRoot, api, TYPE);
    let state = null;
    let chosen = 's';
    const titulo = el('strong', { class: 'mj-oito-titulo' }, 'Oito maluco');
    const status = el('span', { class: 'mj-oito-status', attrs: { tabindex: '-1' } });
    const relogio = el('span', { class: 'mj-oito-relogio' });
    const topo = el('header', { class: 'mj-oito-topo' }, titulo, relogio);
    const descarte = el('div', { class: 'mj-oito-descarte' });
    const naipe = el('div', { class: 'mj-oito-naipe' });
    const mesa = el('section', { class: 'mj-oito-mesa' }, descarte, naipe);
    const pessoas = el('div', { class: 'mj-oito-pessoas' });
    const minha = el('div', { class: 'mj-oito-minha' });
    const selecao = el('select', {
      class: 'mj-oito-selecao',
      attrs: { 'aria-label': 'Naipe escolhido pelo oito' },
    });
    for (const [v, n] of NAIPES) selecao.append(el('option', { attrs: { value: v } }, n));
    selecao.addEventListener('change', () => {
      chosen = selecao.value;
    });
    const comprar = C.botao({ icone: 'mais', text: 'Comprar', class: 'mj-oito-comprar' });
    const iniciar = C.botao({ icone: 'play', text: 'Dar cartas', class: 'mj-oito-iniciar' });
    const levantar = C.botao({ icone: 'sair', text: 'Levantar', class: 'mj-oito-levantar' });
    const resetar = C.botao({ icone: 'reiniciar', text: 'Recomeçar', class: 'mj-oito-resetar' });
    const acoes = el(
      'footer',
      { class: 'mj-oito-acoes' },
      selecao,
      comprar,
      iniciar,
      levantar,
      resetar,
    );
    b.raiz.append(topo, pessoas, mesa, minha, acoes);
    b.clique(comprar, b.raiz, () => b.acao(b.raiz, { kind: 'draw', suit: chosen }));
    b.clique(iniciar, b.raiz, () => b.acao(b.raiz, { kind: 'start' }));
    b.clique(levantar, b.raiz, () => b.acao(b.raiz, { kind: 'stand' }));
    b.clique(resetar, b.raiz, () => b.acao(b.raiz, { kind: 'reset' }));
    function nome(i) {
      return state.names[i] || `Lugar ${i + 1}`;
    }
    function renderPeople() {
      pessoas.replaceChildren();
      state.seats.forEach((id, i) => {
        if (!id) return;
        pessoas.append(el(
          'span',
          { class: `mj-oito-pessoa${state.turn === i ? ' is-vez' : ''}` },
          `${nome(i)} · ${state.counts[i]} cartas · ${state.scores[i]} pts`,
        ));
      });
      // Sem isto nao havia como sentar (a janela so tinha "Dar cartas"/
      // "Levantar"/"Recomeçar" -- nenhuma acao 'sit'). Um botao so (nao um
      // por lugar, ate 8): a pessoa nao escolhe QUAL lugar, so entra no
      // primeiro livre, como "Entrar na rodada" do Desenha.
      const livre = state.me?.can?.sit?.findIndex(Boolean) ?? -1;
      if (livre >= 0) {
        const sentar = C.botao({ text: 'Sentar', class: 'mj-fantasma mj-oito-sentar' });
        b.clique(sentar, b.raiz, () => b.acao(b.raiz, { kind: 'sit', seat: livre }));
        pessoas.append(sentar);
      }
    }
    function renderHand() {
      minha.replaceChildren();
      const myTurn = state.me && state.me.can.play;
      for (const card of state.hand || []) {
        const bt = el(
          'button',
          { class: 'mj-oito-carta', attrs: { type: 'button', 'aria-label': K.rotulo(card) } },
          K.carta(card, { tamanho: 'm' }),
        );
        const ok = myTurn
          && (card[0] === '8'
            || card[1] === state.suit
            || (state.discard && card[0] === state.discard[0]));
        C.ligado(bt, ok ? true : 'Não pode jogar esta carta agora');
        b.clique(bt, b.raiz, () => b.acao(b.raiz, {
          kind: 'play',
          card,
          suit: chosen,
        }));
        minha.append(bt);
      }
    }
    function update(s) {
      if (!s) return;
      state = s;
      status.textContent = s.phase === 'finished'
        ? `${nome(s.winner)} venceu`
        : (s.phase === 'play' ? `Vez de ${nome(s.turn)}` : 'Sente-se e dê as cartas');
      renderPeople();
      atualizarBarra(api, textoDeStatus(s), Boolean(s.phase === 'play' && s.me?.can?.play));
      descarte.replaceChildren(K.carta(s.discard, { tamanho: 'g' }));
      naipe.textContent = s.suit ? `Naipe: ${NAIPES.find((n) => n[0] === s.suit)?.[1] || ''}` : '';
      renderHand();
      C.ligado(comprar, s.me?.can.draw ? true : 'Comprar só quando não houver jogada');
      C.ligado(iniciar, s.me?.can.start ? true : 'Precisa de duas pessoas e rodada parada');
      C.ligado(levantar, s.me?.can.stand ? true : 'Você não está jogando');
      C.ligado(resetar, s.me?.can.reset ? true : 'Sente-se para recomeçar');
      selecao.disabled = !(s.me?.can.play || s.me?.can.draw);
      tick();
    }
    let timeout = null;
    const tick = () => {
      if (!state) return;
      if (Number.isFinite(state.deadline)) {
        const seconds = Math.max(0, Math.ceil((state.deadline - api.serverNow()) / 1000));
        relogio.textContent = `${seconds} s`;
      } else {
        relogio.textContent = '';
      }
      if (state.deadline && api.serverNow() >= state.deadline) api.act({ kind: 'timeout' });
    };
    timeout = setInterval(tick, 500);
    b.faxina.push(() => clearInterval(timeout));
    return {
      update,
      destroy() { atualizarBarra(api, '', false); b.destruir(); },
      focus() {
        minha.querySelector('button:not([disabled])')?.focus();
      },
    };
  }
  function registrar(api, arquivos) {
    const G = root.GoLive = root.GoLive || {};
    G.mesaJanelas = G.mesaJanelas || {};
    const map = {
      'comum.js': 'mesaJanelasComum',
      'cartas.js': 'mesaJanelasCartas',
    };
    const missing = () => arquivos.filter((a) => !G[map[a]]);
    const doc = root.document;
    const waits = [];
    if (doc && missing().length) {
      const base = (doc.currentScript && doc.currentScript.src) || doc.baseURI;
      G.mesaJanelasApoio = G.mesaJanelasApoio || {};
      for (const a of missing()) {
        if (!G.mesaJanelasApoio[a]) {
          const script = doc.createElement('script');
          script.src = new root.URL(a, base).href;
          script.async = false;
          G.mesaJanelasApoio[a] = script;
          doc.head.append(script);
        }
        waits.push(new Promise((ok) => {
          G.mesaJanelasApoio[a].addEventListener('load', ok, { once: true });
        }));
      }
    }
    const original = api.mount;
    const ready = waits.length ? Promise.all(waits) : null;
    api.mount = function (node, vista) {
      if (!missing().length) return original(node, vista);
      let inst;
      let last;
      let dead = false;
      void ready.then(() => {
        if (!dead) {
          inst = original(node, vista);
          if (last) inst.update(last);
        }
      }, () => {});
      return {
        update(s) {
          if (inst) inst.update(s);
          else last = s;
        },
        destroy() {
          dead = true;
          inst?.destroy();
        },
        focus() {
          inst?.focus();
        },
      };
    };
    G.mesaJanelas[api.type] = api;
  }
  const api = { type: TYPE, mount, textoDeStatus, atualizarBarra, podeJogar };
  registrar(api, ['comum.js', 'cartas.js']);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
