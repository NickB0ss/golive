'use strict';

/* Janela do Dominó: pedras em SVG inline, sem imagens externas. */

(function (root) {
  const TYPE = 'domino';
  const TEXTO_VAZIO = 'Sente 2 a 4 pessoas e dê as pedras';
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
    const nova = botao({ text: 'Nova mão', label: 'Dar as pedras' });
    const reiniciar = botao({ text: 'Recomeçar', label: 'Zerar o placar', class: 'mj-fantasma' });
    topo.append(status, prazo, nova, reiniciar);

    const mesa = el('div', { class: 'mj-do-mesa', attrs: { 'aria-label': 'Mesa de dominó' } });
    const linha = el('div', { class: 'mj-do-linha' });
    mesa.append(linha);
    // Sem ninguem sentado a mesa vazia vira o convite (e a frase de situacao some, para nao repetir).
    const vazio = C.vazio({
      icone: 'pessoas',
      titulo: 'Quatro lugares livres',
      texto: TEXTO_VAZIO,
    });

    const lugares = el('div', { class: 'mj-do-lugares' });
    const mao = el('div', { class: 'mj-do-mao', attrs: { 'aria-label': 'Suas pedras' } });
    const comprar = botao({ text: 'Comprar', label: 'Comprar do monte' });
    const passar = botao({ text: 'Passar', label: 'Passar a vez' });
    const levantar = botao({ text: 'Levantar', label: 'Levantar da cadeira' });
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
        rotulo: `Lugar ${lugar + 1}`,
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
      const nome = state.names?.[lugar] || 'Alguém';
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
        motivoSentar: state.me?.can?.sit?.[lugar] ? true : 'Lugar indisponível',
        // Levantar mora so no botao "Levantar" de baixo: uma acao num lugar so.
        motivoLevantar: 'Use o botão Levantar',
      }]);
      const botaoLugar = cad.node.children[0].children[0];
      botaoLugar.setAttribute('aria-label', ocupado ? `${nome}: ${pedras} pedras` : `Sentar no lugar ${lugar + 1}`);
      placar.textContent = ocupado ? `${pedras} pedras · ${state.scores?.[lugar] || 0} pontos` : '';
    }

    function desenharMesa() {
      const pedras = state.table || [];
      linha.replaceChildren(...pedras.map((item) => {
        const pedra = el('span', {
          class: 'mj-do-pedra mj-do-mesa-pedra',
          attrs: { 'aria-label': `${item.stone[0]} e ${item.stone[1]}` },
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
          attrs: { type: 'button', 'aria-label': `Pedra ${pedra[0]} e ${pedra[1]}` },
        });
        botaoPedra.innerHTML = pedraSvg(pedra);
        C.ligado(botaoPedra, podeJogar(state, pedra) ? true : 'Não encaixa ou não é sua vez');
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
      if (state.result?.winner === null) return 'Mão trancada';
      if (state.result) return `${state.names?.[state.result.winner] || 'Alguém'} venceu`;
      if (state.phase === 'opening') return `Vez de ${state.names?.[state.turn] || 'jogador'} abrir com a pedra que escolher`;
      if (state.phase !== 'play') return 'Sente 2 a 4 pessoas e dê as pedras';
      return `Vez de ${state.names?.[state.turn] || 'jogador'} · monte: ${state.stock}`;
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
      C.ligado(nova, state.me?.can?.start ? true : 'Nova mão indisponível');
      C.ligado(reiniciar, state.me?.can?.reset ? true : 'Só quem está sentado ou o líder da sala recomeça');
      C.ligado(comprar, state.me?.can?.draw ? true : 'Sem compra agora');
      C.ligado(passar, state.me?.can?.pass ? true : 'Sem passe agora');
      C.ligado(levantar, state.me?.can?.stand ? true : 'Você não está sentado');
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
