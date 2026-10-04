'use strict';

/* Janela do Dominó: pedras em SVG inline, sem imagens externas. */

(function (root) {
  const { t } = root.GoLive.i18n;
  const TYPE = 'domino';
  const POSICOES = [[50, 50], [25, 25], [75, 75], [25, 25], [75, 75], [25, 75], [75, 25]];

  function pontos(numero, deslocamento) {
    return POSICOES.slice(0, numero).map(([x, y]) => {
      return `<circle cx="${deslocamento + x / 2}" cy="${y / 2}" r="5"/>`;
    }).join('');
  }

  function pedraSvg(pedra) {
    return `<svg viewBox="0 0 100 50" aria-hidden="true">`
      + '<rect x="1" y="1" width="98" height="48" rx="7"/>'
      + '<path d="M50 2v46"/>'
      + pontos(pedra[0], 0)
      + pontos(pedra[1], 100)
      + '</svg>';
  }

  function podeJogar(state, pedra) {
    if (!state || state.me?.seat !== state.turn) return false;
    if (state.phase === 'opening') return true;
    if (state.phase !== 'play' || !state.ends) return false;
    return pedra.includes(state.ends[0]) || pedra.includes(state.ends[1]);
  }

  function segundos(deadline, now) {
    if (!Number.isFinite(deadline)) return null;
    return Math.max(0, Math.ceil((deadline - now) / 1000));
  }

  function atualizarBarra(api, texto, vez) {
    api.setStatus?.(texto);
    api.setTurn?.(vez);
  }

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const b = C.base(elRoot, api, TYPE);
    const { el, botao } = C;
    let state = null;
    let timer = null;

    const topo = el('div', { class: 'mj-do-topo' });
    const status = el('p', { class: 'mj-do-status', attrs: { tabindex: '-1' } });
    const prazo = el('span', { class: 'mj-do-prazo' });
    const nova = botao({ text: t('mesa.domino.novaMao'), label: t('mesa.domino.darPedras') });
    const reiniciar = botao({
      text: t('mesa.domino.recomecar'), label: t('mesa.domino.zerarPlacar'), class: 'mj-fantasma',
    });
    topo.append(status, prazo, nova, reiniciar);

    const mesa = el('div', { class: 'mj-do-mesa', attrs: { 'aria-label': t('mesa.domino.mesaDe') } });
    const linha = el('div', { class: 'mj-do-linha' });
    mesa.append(linha);
    // Sem ninguem sentado a mesa vazia vira o convite (e a frase de situacao some, para nao repetir).
    const vazio = C.vazio({
      icone: 'pessoas',
      titulo: t('mesa.domino.vazioTitulo'),
      texto: t('mesa.domino.vazioTexto'),
    });

    const lugares = el('div', { class: 'mj-do-lugares' });
    const mao = el('div', { class: 'mj-do-mao', attrs: { 'aria-label': t('mesa.domino.suasPedras') } });
    const comprar = botao({ text: t('mesa.domino.comprar'), label: t('mesa.domino.comprarMonte') });
    const passar = botao({ text: t('mesa.domino.passar'), label: t('mesa.domino.passarVez') });
    const levantar = botao({ text: t('mesa.jogo.levantar'), label: t('mesa.tabuleiro.levantarDaCadeira') });
    const acoes = C.acoes({ principal: comprar, secundarias: [passar, levantar] });
    acoes.classList.add('mj-do-acoes');
    b.raiz.append(topo, mesa, vazio, lugares, mao, acoes);

    b.clique(nova, topo, () => b.acao(topo, { kind: 'start' }));
    b.clique(reiniciar, topo, () => b.acao(topo, { kind: 'reset' }));
    b.clique(comprar, acoes, () => b.acao(acoes, { kind: 'draw' }));
    b.clique(passar, acoes, () => b.acao(acoes, { kind: 'pass' }));
    b.clique(levantar, acoes, () => b.acao(acoes, { kind: 'stand' }));

    // Um lugar = a cadeira comum (de um lugar so) e a linha de pedras e pontos embaixo.
    // Os 4 cartoes sao montados uma vez: o foco do "Sentar" nao cai quando chega estado novo.
    const cartoes = [0, 1, 2, 3].map((lugar) => {
      const cartao = el('div', { class: 'mj-do-lugar' });
      const cad = C.cadeiras({
        rotulo: t('mesa.cartas.lugar', { n: lugar + 1 }),
        aoSentar() { b.acao(cartao, { kind: 'sit', seat: lugar }); },
        aoRecusar(motivo) { b.aviso.mostrar(motivo, cartao); },
      });
      const placar = el('span', { class: 'mj-do-placar' });
      cartao.append(cad.node, placar);
      lugares.append(cartao);
      return { cartao, cad, placar };
    });

    function desenharLugar(lugar) {
      const { cartao, cad, placar } = cartoes[lugar];
      const id = state.seats?.[lugar] || null;
      const ocupado = Boolean(id);
      const meu = state.me?.seat === lugar;
      const vez = state.turn === lugar && state.phase === 'play';
      const nome = state.names?.[lugar] || t('ui.pessoa.alguem');
      const pedras = state.counts?.[lugar] || 0;
      cartao.classList.toggle('is-eu', meu);
      cartao.classList.toggle('is-vez', vez);
      cad.sync([{
        peer: id,
        nome: ocupado ? nome : '',
        cor: ocupado ? C.corDe(api, id) : null,
        peca: null,
        vez,
        eu: meu,
        motivoSentar: state.me?.can?.sit?.[lugar] ? true : t('mesa.domino.lugarIndisponivel'),
        // Levantar mora so no botao "Levantar" de baixo: uma acao num lugar so.
        motivoLevantar: t('mesa.cartas.useBotaoLevantar'),
      }]);
      const botaoLugar = cad.node.children[0].children[0];
      botaoLugar.setAttribute('aria-label', ocupado
        ? t('mesa.domino.lugarPedras', { nome, n: pedras })
        : t('mesa.cartas.sentarLugar', { n: lugar + 1 }));
      placar.textContent = ocupado
        ? t('mesa.domino.placarLugar', { n: pedras, pontos: state.scores?.[lugar] || 0 })
        : '';
    }

    function desenharMesa() {
      const pedras = state.table || [];
      linha.replaceChildren(...pedras.map((item) => {
        const pedra = el('span', {
          class: 'mj-do-pedra mj-do-mesa-pedra',
          attrs: { 'aria-label': t('mesa.domino.pedraMesa', { a: item.stone[0], b: item.stone[1] }) },
        });
        pedra.innerHTML = pedraSvg(item.stone);
        return pedra;
      }));
    }

    function desenharMao() {
      mao.replaceChildren(...(state.hand || []).map((pedra, indice) => {
        const esquerda = state.ends?.[0] !== undefined && pedra.includes(state.ends[0]);
        const direita = state.ends?.[1] !== undefined && pedra.includes(state.ends[1]);
        const botaoPedra = el('button', {
          class: 'mj-do-pedra',
          attrs: { type: 'button', 'aria-label': t('mesa.domino.pedraMao', { a: pedra[0], b: pedra[1] }) },
        });
        botaoPedra.innerHTML = pedraSvg(pedra);
        C.ligado(botaoPedra, podeJogar(state, pedra) ? true : t('mesa.domino.naoEncaixaOuVez'));
        b.clique(botaoPedra, mao, () => {
          if (state.phase === 'opening') b.acao(mao, { kind: 'open', stone: indice });
          else {
            const ponta = esquerda ? 'left' : direita ? 'right' : null;
            if (ponta) b.acao(mao, { kind: 'play', stone: indice, end: ponta });
          }
        });
        return botaoPedra;
      }));
    }

    function textoStatus() {
      if (state.result?.winner === null) return t('mesa.domino.maoTrancada');
      if (state.result) {
        return t('mesa.tabuleiro.venceu', { nome: state.names?.[state.result.winner] || t('ui.pessoa.alguem') });
      }
      const jogador = state.names?.[state.turn] || t('mesa.domino.jogador');
      if (state.phase === 'opening') return t('mesa.domino.vezAbrir', { nome: jogador });
      if (state.phase !== 'play') return t('mesa.domino.vazioTexto');
      return t('mesa.domino.vezMonte', { nome: jogador, n: state.stock });
    }

    function atualizarPrazo() {
      const agora = typeof api.serverNow === 'function' ? api.serverNow() : Date.now();
      const restante = segundos(state?.deadline, agora);
      prazo.textContent = restante === null ? '' : `${restante}s`;
      prazo.hidden = restante === null;
    }

    function update(novo) {
      state = novo || {};
      status.textContent = textoStatus();
      atualizarBarra(api, status.textContent, Boolean(state.phase === 'play' && state.me?.seat === state.turn));
      C.ligado(nova, state.me?.can?.start ? true : t('mesa.domino.novaMaoIndisponivel'));
      C.ligado(reiniciar, state.me?.can?.reset ? true : t('mesa.cadeiras.soSentadoOuLiderRecomeca'));
      C.ligado(comprar, state.me?.can?.draw ? true : t('mesa.domino.semCompra'));
      C.ligado(passar, state.me?.can?.pass ? true : t('mesa.domino.semPasse'));
      C.ligado(levantar, state.me?.can?.stand ? true : t('mesa.cadeiras.naoEstaSentado'));
      for (let lugar = 0; lugar < 4; lugar += 1) desenharLugar(lugar);
      const semGente = !(state.seats || []).some(Boolean);
      vazio.hidden = !semGente;
      mesa.hidden = semGente;
      status.hidden = semGente;
      mao.hidden = semGente;
      acoes.hidden = semGente;
      desenharMesa();
      desenharMao();
      atualizarPrazo();
    }

    timer = root.setInterval(atualizarPrazo, 250);
    return {
      update,
      destroy() {
        root.clearInterval(timer);
        atualizarBarra(api, '', false);
        b.destruir();
      },
      focus() { status.focus(); },
    };
  }

  function registrar(api) {
    const G = root.GoLive = root.GoLive || {};
    G.mesaJanelas = G.mesaJanelas || {};
    G.mesaJanelas[TYPE] = api;
  }

  const api = { type: TYPE, mount, pedraSvg, podeJogar, segundos, atualizarBarra };
  registrar(api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
