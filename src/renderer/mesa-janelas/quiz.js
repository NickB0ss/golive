'use strict';

/* Conteudo da janela Quiz. A resposta escolhida fica desabilitada no retrato
 * local ate a revelacao; o servidor e a unica fonte de verdade do placar. */

(function (root) {
  const C = root.GoLive.mesaJanelasComum;

  function montar(elRoot, api) {
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

  const api = { type: 'quiz', mount: montar };
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaJanelas = root.GoLive.mesaJanelas || {};
  root.GoLive.mesaJanelas.quiz = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
