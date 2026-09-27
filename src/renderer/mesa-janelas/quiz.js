'use strict';

/* Conteudo da janela Quiz. A resposta escolhida fica desabilitada no retrato
 * local ate a revelacao; o servidor e a unica fonte de verdade do placar. */

(function (root) {
  function montar(elRoot, api) {
    // Lido dentro do mount (nao no topo do arquivo): a Vista carrega
    // `<tipo>.js` por MODULE_NAMES sem tag no index.html (contrato, secao
    // 6) e a ordem entre eles e `comum.js` nao e garantida -- `registrar`,
    // mais abaixo, so chama isto depois que `comum.js` (que nao tem tag
    // propria) certamente carregou.
    const C = root.GoLive.mesaJanelasComum;
    const b = C.base(elRoot, api, 'quiz');
    const T = C.el;
    const topo = T('div', { class: 'mj-quiz-topo' });
    const titulo = T('strong', { class: 'mj-quiz-titulo', text: 'Quiz' });
    const prazo = T('span', { class: 'mj-quiz-prazo', attrs: { 'aria-live': 'polite' } });
    const rodada = T('span', { class: 'mj-quiz-rodada' });
    topo.append(titulo, rodada, T('span', { class: 'mj-mola' }), prazo);
    const pergunta = T('p', { class: 'mj-quiz-pergunta' });
    const alternativas = T('div', { class: 'mj-quiz-alternativas', attrs: { role: 'group' } });
    const placar = T('div', { class: 'mj-quiz-placar', attrs: { 'aria-label': 'Placar' } });
    const status = T('p', { class: 'mj-quiz-status', attrs: { role: 'status', 'aria-live': 'polite' } });
    const reiniciar = C.botao({ text: 'Reiniciar', class: 'mj-pri' });
    b.raiz.append(topo, pergunta, alternativas, placar, status, reiniciar);
    b.clique(reiniciar, b.raiz, () => b.acao(b.raiz, { kind: 'reset' }));

    let state = null;
    let enviado = false;
    let ultimoPrazo = null;
    let pedido = false;
    const botoes = [];
    for (let i = 0; i < 4; i++) {
      const botao = C.botao({ text: `${String.fromCharCode(65 + i)}.`, class: 'mj-quiz-opcao' });
      const texto = T('span', { class: 'mj-quiz-opcao-texto' });
      botao.append(texto);
      const indice = i;
      b.clique(botao, alternativas, () => {
        if (state?.me?.canAnswer) {
          b.acao(alternativas, { kind: 'answer', option: indice });
          enviado = true;
        }
      });
      botoes.push({ botao, texto });
      alternativas.append(botao);
    }

    function nome(id) {
      try { return api.nameOf(id); } catch { return id || 'Alguem'; }
    }
    function desenharPlacar(s) {
      placar.replaceChildren();
      for (const jogador of s.players || []) {
        const linha = T('div', { class: `mj-quiz-jogador${jogador.by === api.me() ? ' is-eu' : ''}` });
        const resposta = jogador.answered ? 'respondeu' : 'pensando';
        linha.append(T('span', { class: 'mj-quiz-nome', text: nome(jogador.by) }),
          T('span', { class: 'mj-quiz-respondeu', text: resposta }),
          T('strong', { class: 'mj-quiz-pontos', text: `${jogador.score} pts` }));
        placar.append(linha);
      }
    }
    function atualizarPrazo() {
      if (!state || !Number.isFinite(state.deadline) || state.finished) {
        prazo.textContent = '';
        return;
      }
      const falta = Math.max(0, Math.ceil((state.deadline - api.serverNow()) / 1000));
      prazo.textContent = `${falta} s`;
      prazo.classList.toggle('is-fim', falta <= 5);
      if (falta === 0 && !pedido && !state.me?.answered) {
        pedido = true;
        api.act({ kind: 'timeout' });
      }
    }
    function atualizar(s) {
      if (!s || !s.question) return;
      state = s;
      enviado = s.me?.answered === true;
      pedido = ultimoPrazo === s.deadline ? pedido : false;
      ultimoPrazo = s.deadline;
      rodada.textContent = s.finished ? 'Fim da partida' : `Pergunta ${s.round + 1} de ${s.total}`;
      pergunta.textContent = s.question.pergunta;
      for (let i = 0; i < botoes.length; i++) {
        const alt = s.question.alternativas[i];
        botoes[i].texto.textContent = alt;
        botoes[i].botao.hidden = !alt;
        botoes[i].botao.classList.toggle('is-escolhida', s.me.answer === i);
        C.ligado(botoes[i].botao, s.me.canAnswer ? true : (enviado ? 'Resposta enviada' : 'Indisponivel'));
      }
      reiniciar.hidden = !s.can?.reset;
      desenharPlacar(s);
      const ultimaRodada = s.history?.[s.history.length - 1];
      const letraCerta = Number.isInteger(ultimaRodada?.certa)
        ? String.fromCharCode(65 + ultimaRodada.certa) : null;
      const respostaCerta = letraCerta ? ` A resposta certa da pergunta anterior foi ${letraCerta}.` : '';
      if (s.finished) status.textContent = letraCerta
        ? `Partida encerrada. A resposta certa da ultima pergunta foi ${letraCerta}.` : 'Partida encerrada.';
      else if (enviado) status.textContent = 'Resposta registrada. Aguarde a revelacao.';
      else status.textContent = `Escolha uma alternativa.${respostaCerta}`;
      atualizarPrazo();
    }
    const timer = setInterval(atualizarPrazo, 500);
    b.faxina.push(() => clearInterval(timer));
    return { update: atualizar, destroy: b.destruir, focus() { botoes.find((x) => !x.botao.hidden)?.botao.focus(); } };
  }

  // Mesmo molde de truco.js/oito.js: garante que `comum.js` (sem tag
  // propria no index.html) esteja carregado antes do primeiro `mount` --
  // sem isto, o Quiz sendo o PRIMEIRO tipo de conteudo aberto numa mesa
  // (nenhum outro modulo pediu `comum.js` ainda) quebrava com
  // "Cannot read properties of undefined (reading 'base')".
  function registrar(api, arquivos) {
    const G = root.GoLive = root.GoLive || {};
    G.mesaJanelas = G.mesaJanelas || {};
    const GLOBAIS = { 'comum.js': 'mesaJanelasComum' };
    const doc = root.document;
    const falta = () => arquivos.filter((a) => !G[GLOBAIS[a]]);
    const esperas = [];
    if (doc && falta().length) {
      const base = (doc.currentScript && doc.currentScript.src) || doc.baseURI;
      G.mesaJanelasApoio = G.mesaJanelasApoio || {};
      for (const a of falta()) {
        if (G.mesaJanelasApoio[a]) continue;
        const script = doc.createElement('script');
        script.src = new root.URL(a, base).href;
        script.async = false;
        G.mesaJanelasApoio[a] = script;
        doc.head.appendChild(script);
      }
      for (const a of falta()) {
        esperas.push(new Promise((ok) => {
          G.mesaJanelasApoio[a].addEventListener('load', ok, { once: true });
        }));
      }
    }
    const montarOriginal = api.mount;
    const pronto = esperas.length ? Promise.all(esperas) : null;
    api.mount = function montarComApoio(el, vistaApi) {
      if (!falta().length) return montarOriginal(el, vistaApi);
      let instancia = null;
      let ultimo = null;
      let destruida = false;
      pronto.then(() => {
        if (destruida) return;
        instancia = montarOriginal(el, vistaApi);
        if (ultimo) instancia.update(ultimo[0], ultimo[1]);
      }, () => {});
      return {
        update(estado, meta) {
          if (instancia) instancia.update(estado, meta);
          else ultimo = [estado, meta];
        },
        destroy() {
          destruida = true;
          if (instancia) instancia.destroy();
        },
        focus() {
          if (instancia && instancia.focus) instancia.focus();
        },
      };
    };
    G.mesaJanelas[api.type] = api;
  }

  const api = { type: 'quiz', mount: montar };
  registrar(api, ['comum.js']);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
