'use strict';

/* Conteudo da janela Quiz. A resposta escolhida fica desabilitada no retrato
 * local ate a revelacao; o servidor e a unica fonte de verdade do placar. */

(function (root) {
  function textoBarra(s) {
    const { t } = root.GoLive.i18n;
    if (s.setup) return t('quiz.temasTitulo');
    if (s.finished) return t('quiz.barraEncerrada');
    if (s.me?.answered) return t('quiz.barraRegistrada');
    return t('quiz.rodada', { n: s.round + 1, total: s.total });
  }

  function atualizarBarra(api, texto, vez) {
    api.setStatus?.(texto);
    api.setTurn?.(vez);
  }

  function montar(elRoot, api) {
    // Lido dentro do mount (nao no topo do arquivo): a Vista carrega
    // `<tipo>.js` por MODULE_NAMES sem tag no index.html (contrato, secao
    // 6) e a ordem entre eles e `comum.js` nao e garantida -- `registrar`,
    // mais abaixo, so chama isto depois que `comum.js` (que nao tem tag
    // propria) certamente carregou.
    const C = root.GoLive.mesaJanelasComum;
    const { t, idiomaAtivo } = root.GoLive.i18n;
    const banco = root.GoLive.mesaQuizPerguntas;
    const b = C.base(elRoot, api, 'quiz');
    const T = C.el;
    const topo = T('div', { class: 'mj-quiz-topo' });
    // O nome do jogo ja esta na barra da janela: o alto e so a linha de estado.
    const prazo = T('span', { class: 'mj-quiz-prazo', attrs: { 'aria-live': 'polite' } });
    const rodada = T('span', { class: 'mj-quiz-rodada' });
    topo.append(rodada, T('span', { class: 'mj-mola' }), prazo);
    const temaDaPergunta = T('span', { class: 'mj-quiz-tema-pergunta' });
    const pergunta = T('p', { class: 'mj-quiz-pergunta' });
    const alternativas = T('div', { class: 'mj-quiz-alternativas', attrs: { role: 'group' } });
    const placar = T('div', { class: 'mj-quiz-placar', attrs: { 'aria-label': t('quiz.placar') } });
    const status = T('p', { class: 'mj-quiz-status', attrs: { role: 'status', 'aria-live': 'polite' } });
    const reiniciar = C.botao({ text: t('quiz.reiniciar'), class: 'mj-pri' });
    // Preparo: uma caixa de marcar por tema e o botao de comecar. Os rotulos vem
    // do dicionario (quiz.tema.<id>); o estado so guarda ids de tema.
    const preparo = T('div', { class: 'mj-quiz-preparo' });
    const dica = T('p', { class: 'mj-dica', text: t('quiz.temasTitulo') });
    const listaTemas = T('div', {
      class: 'mj-quiz-temas', attrs: { role: 'group', 'aria-label': t('quiz.temasGrupo') },
    });
    const caixas = new Map();
    for (const id of banco.TEMAS) {
      const caixa = T('input', { attrs: { type: 'checkbox', value: id } });
      const rotulo = T('label', { class: 'mj-quiz-tema' });
      rotulo.append(caixa, T('span', { text: t(`quiz.tema.${id}`) }));
      caixas.set(id, caixa);
      listaTemas.append(rotulo);
    }
    const comecar = C.botao({ text: t('quiz.comecar'), class: 'mj-pri' });
    preparo.append(dica, listaTemas, comecar);
    b.raiz.append(topo, preparo, temaDaPergunta, pergunta, alternativas, placar, status, reiniciar);
    b.clique(reiniciar, b.raiz, () => b.acao(b.raiz, { kind: 'reset' }));
    b.clique(comecar, preparo, () => b.acao(preparo, { kind: 'start' }));
    listaTemas.addEventListener('change', () => {
      const marcados = banco.TEMAS.filter((id) => caixas.get(id).checked);
      if (!marcados.length) {
        // Nao da para comecar sem tema: desfaz a ultima desmarcacao e diz o motivo.
        for (const id of state?.temas || []) caixas.get(id).checked = true;
        status.textContent = t('quiz.precisaDeTema');
        return;
      }
      b.acao(preparo, { kind: 'temas', temas: marcados });
    });

    let state = null;
    let enviado = false;
    let ultimoPrazo = null;
    let pedido = false;
    const botoes = [];
    for (let i = 0; i < 4; i++) {
      const botao = C.botao({ class: 'mj-quiz-opcao' });
      // Cartao A-D: a letra e o selo; o texto da alternativa ocupa o resto.
      const texto = T('span', { class: 'mj-quiz-opcao-texto' });
      botao.append(T('span', { class: 'mj-quiz-letra', text: `${String.fromCharCode(65 + i)}.` }), texto);
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
      try { return api.nameOf(id); } catch { return id || '?'; }
    }
    function desenharPlacar(s) {
      placar.replaceChildren();
      for (const jogador of s.players || []) {
        const linha = T('div', { class: `mj-quiz-jogador${jogador.by === api.me() ? ' is-eu' : ''}` });
        const resposta = jogador.answered ? t('quiz.respondeu') : t('quiz.pensando');
        const inicial = String(nome(jogador.by) || '').trim().charAt(0).toUpperCase() || '?';
        const avatar = T('span', { class: 'mj-cadeira-avatar', text: inicial });
        const cor = C.corDe(api, jogador.by);
        if (cor) avatar.style.setProperty('--mj-cor', cor);
        linha.append(avatar, T('span', { class: 'mj-quiz-nome', text: nome(jogador.by) }),
          T('span', { class: 'mj-quiz-respondeu', text: resposta }),
          T('strong', { class: 'mj-quiz-pontos', text: t('quiz.pontos', { n: jogador.score }) }));
        placar.append(linha);
      }
    }
    function atualizarPrazo() {
      if (!state || !Number.isFinite(state.deadline) || state.finished) {
        prazo.textContent = '';
        return;
      }
      const falta = Math.max(0, Math.ceil((state.deadline - api.serverNow()) / 1000));
      prazo.textContent = t('quiz.segundos', { n: falta });
      prazo.classList.toggle('is-fim', falta <= 5);
      if (falta === 0 && !pedido && !state.me?.answered) {
        pedido = true;
        api.act({ kind: 'timeout' });
      }
    }
    function mostrarPreparo(s) {
      for (const [id, caixa] of caixas) caixa.checked = s.temas.includes(id);
      topo.hidden = true;
      preparo.hidden = false;
      temaDaPergunta.hidden = true;
      pergunta.hidden = true;
      alternativas.hidden = true;
      placar.hidden = true;
      reiniciar.hidden = true;
      status.textContent = '';
      C.ligado(comecar, s.temas.length ? true : t('quiz.precisaDeTema'));
    }
    function atualizar(s) {
      if (!s) return;
      state = s;
      atualizarBarra(api, textoBarra(s), Boolean(!s.setup && !s.finished && s.me?.canAnswer));
      if (s.setup) { mostrarPreparo(s); return; }
      if (!s.question) return;
      topo.hidden = false;
      preparo.hidden = true;
      temaDaPergunta.hidden = false;
      pergunta.hidden = false;
      alternativas.hidden = false;
      placar.hidden = false;
      enviado = s.me?.answered === true;
      pedido = ultimoPrazo === s.deadline ? pedido : false;
      ultimoPrazo = s.deadline;
      rodada.textContent = s.finished ? t('quiz.fim') : t('quiz.rodada', { n: s.round + 1, total: s.total });
      // O estado so tem ids: o texto sai do banco, na lingua de quem esta lendo.
      const q = banco.porId(s.question.id);
      if (!q) return;
      const { pergunta: enunciado, alternativas: alts } = banco.texto(q, idiomaAtivo());
      const visiveis = s.question.ordem.map((indice) => alts[indice]);
      temaDaPergunta.textContent = t(`quiz.tema.${s.question.tema}`);
      pergunta.textContent = enunciado;
      for (let i = 0; i < botoes.length; i++) {
        const alt = visiveis[i];
        botoes[i].texto.textContent = alt;
        botoes[i].botao.hidden = !alt;
        botoes[i].botao.classList.toggle('is-escolhida', s.me.answer === i);
        const motivo = enviado ? t('quiz.respostaEnviada') : t('mesa.tabuleiro.indisponivel');
        C.ligado(botoes[i].botao, s.me.canAnswer ? true : motivo);
      }
      reiniciar.hidden = !s.can?.reset;
      desenharPlacar(s);
      const ultimaRodada = s.history?.[s.history.length - 1];
      const letraCerta = Number.isInteger(ultimaRodada?.certa)
        ? String.fromCharCode(65 + ultimaRodada.certa) : null;
      if (s.finished) {
        status.textContent = letraCerta ? t('quiz.status.encerradaCerta', { letra: letraCerta })
          : t('quiz.status.encerrada');
      } else if (enviado) status.textContent = t('quiz.status.aguarde');
      else {
        status.textContent = letraCerta ? t('quiz.status.escolhaCerta', { letra: letraCerta })
          : t('quiz.status.escolha');
      }
      atualizarPrazo();
    }
    const timer = setInterval(atualizarPrazo, 500);
    b.faxina.push(() => clearInterval(timer));
    return {
      update: atualizar,
      destroy() { atualizarBarra(api, '', false); b.destruir(); },
      focus() { botoes.find((x) => !x.botao.hidden)?.botao.focus(); },
    };
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

  const api = { type: 'quiz', mount: montar, textoBarra, atualizarBarra };
  registrar(api, ['comum.js']);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
