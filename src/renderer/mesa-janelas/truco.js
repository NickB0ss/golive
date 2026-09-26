'use strict';

/* Conteudo do Truco. A janela recebe apenas a view filtrada pelo servidor;
 * carta nula vira verso e, por isso, a mao de ferro nao vaza valores. */
(function (root) {
  const VALORES = [1, 3, 6, 9, 12];
  const NAIPES = { s: '♠', h: '♥', d: '♦', c: '♣' };

  function proximoValor(valor) {
    const posicao = VALORES.indexOf(valor);
    return posicao >= 0 && posicao < VALORES.length - 1
      ? VALORES[posicao + 1]
      : null;
  }

  function rotuloCanto(view) {
    const valor = proximoValor(view?.hand?.value);
    if (valor === 3) return 'Pedir truco';
    return valor ? `Pedir ${valor}` : 'Canto encerrado';
  }

  function face(carta) {
    if (typeof carta !== 'string' || carta.length !== 2) return '';
    const valor = carta[0] === 'T' ? '10' : carta[0];
    return `${valor}${NAIPES[carta[1]] || ''}`;
  }

  function segundos(deadline, agora) {
    if (!Number.isFinite(deadline) || !Number.isFinite(agora)) return null;
    return Math.max(0, Math.ceil((deadline - agora) / 1000));
  }

  function textoRodadas(rounds) {
    const lista = Array.isArray(rounds) ? rounds : [];
    const vencedora = (rodada) => rodada && typeof rodada === 'object' ? rodada.winner : rodada;
    const primeira = lista.filter((rodada) => vencedora(rodada) === 0).length;
    const segunda = lista.filter((rodada) => vencedora(rodada) === 1).length;
    const plural = (n) => `rodada${n === 1 ? '' : 's'}`;
    return `1ª dupla venceu ${primeira} ${plural(primeira)} · `
      + `2ª dupla venceu ${segunda} ${plural(segunda)}`;
  }

  function resumoMao(view, agora) {
    const mao = view?.hand;
    if (!mao) return '';
    const partes = [
      `Vira ${face(mao.vira)}`,
      `manilha ${mao.manilha || '?'}`,
      `vale ${mao.value || 1}`,
      textoRodadas(mao.rounds),
    ];
    const tempo = segundos(mao.deadline, agora);
    if (tempo !== null) partes.push(`${tempo} s`);
    return partes.join(' · ');
  }

  function textoStatus(view, nome) {
    if (!view) return '';
    if (view.phase === 'waiting' || view.phase === 'finished') {
      return view.me?.seat < 0
        ? 'Escolha um lugar para sentar'
        : 'Dê as cartas quando houver 2 ou 4 jogadores';
    }
    if (view.phase === 'eleven' && view.me?.team === view.hand?.eleven) {
      return 'Mão de onze: jogam por 3 ou correm';
    }
    const pendente = view.hand?.pending;
    if (pendente && view.me?.team === pendente.toTeam) {
      return `Responder ${pendente.amount}: aceitar, correr ou aumentar`;
    }
    if (pendente) return `Esperando a resposta ao ${pendente.amount}`;
    if (view.hand?.turn === view.me?.seat) return 'Sua vez';
    return `Vez de ${nome(view.hand?.turn)}`;
  }

  function acoesDaView(view, index) {
    if (!view?.me?.can?.play || !view.hand || !Number.isInteger(index)) {
      return [];
    }
    const acoes = [{ kind: 'play', index, covered: false }];
    if (view.hand.rounds.length > 0) {
      acoes.push({ kind: 'play', index, covered: true });
    }
    return acoes;
  }

  function acoesPrincipais(view) {
    const acoes = [];
    if (view?.me?.can?.stand) acoes.push({ kind: 'stand' });
    if (view?.me?.can?.deal) acoes.push({ kind: 'deal' });
    return acoes;
  }

  function criar(doc, tag, classe, texto) {
    const no = doc.createElement(tag);
    if (classe) no.className = classe;
    if (texto !== undefined) no.textContent = texto;
    return no;
  }

  function mount(el, api) {
    const comum = root.GoLive.mesaJanelasComum;
    const cartas = root.GoLive.mesaJanelasCartas;
    if (!comum || !cartas) return { update() {}, destroy() {} };

    const base = comum.base(el, api, 'truco');
    const doc = root.document;
    const titulo = criar(doc, 'h2', 'mj-tr-titulo', 'Truco');
    const placar = criar(doc, 'p', 'mj-tr-placar');
    const resumo = criar(doc, 'p', 'mj-tr-resumo');
    const status = criar(doc, 'p', 'mj-jogo-status');
    const vira = criar(doc, 'div', 'mj-tr-vira');
    const lugares = criar(doc, 'div', 'mj-tr-lugares');
    const mesa = criar(doc, 'div', 'mj-tr-mesa');
    const minhas = criar(doc, 'div', 'mj-tr-minhas');
    const acoes = criar(doc, 'div', 'mj-tr-acoes');
    const topo = criar(doc, 'div', 'mj-tr-topo');
    topo.append(titulo, placar, vira);
    base.raiz.append(topo, resumo, lugares, mesa, minhas, status, acoes);
    let view = null;

    function nome(seat) {
      const id = view?.seats?.[seat];
      return id ? comum.nomeDe(api, id) : 'Livre';
    }

    function botao(texto, action, zona = acoes) {
      const novo = comum.botao({ text: texto, class: 'mj-pri' });
      base.clique(novo, zona, () => base.acao(zona, action));
      return novo;
    }

    function desenharLugares() {
      lugares.replaceChildren();
      for (let seat = 0; seat < 4; seat += 1) {
        const lugar = criar(doc, 'div', 'mj-tr-lugar');
        if (view?.hand?.turn === seat) lugar.classList.add('is-vez');
        lugar.append(criar(doc, 'span', 'mj-tr-nome', nome(seat)));
        if (!view?.seats?.[seat] && view?.me?.can?.sit) {
          lugar.append(botao('Sentar', { kind: 'sit', seat }, lugar));
        }
        lugares.append(lugar);
      }
    }

    function desenharMesa() {
      mesa.replaceChildren();
      for (const jogada of view?.hand?.table || []) {
        const no = criar(doc, 'div', 'mj-tr-jogada');
        no.append(
          criar(doc, 'span', null, nome(jogada.seat)),
          cartas.carta(jogada.covered ? null : jogada.card, { tamanho: 'm' }),
        );
        mesa.append(no);
      }
    }

    function desenharCartas() {
      minhas.replaceChildren();
      const mao = view?.hand?.cards || [];
      if (Array.isArray(view?.hand?.partnerCards)) {
        minhas.append(criar(doc, 'p', 'mj-tr-parceiro', 'Cartas do parceiro'));
        for (const carta of view.hand.partnerCards) {
          minhas.append(cartas.carta(carta, { tamanho: 'p' }));
        }
      }
      mao.forEach((carta, index) => {
        const item = criar(doc, 'div', 'mj-tr-carta');
        item.append(cartas.carta(carta, { tamanho: 'g' }));
        for (const action of acoesDaView(view, index)) {
          item.append(botao(action.covered ? 'Encoberta' : 'Jogar', action));
        }
        minhas.append(item);
      });
    }

    function desenharAcoes() {
      acoes.replaceChildren();
      for (const action of acoesPrincipais(view)) {
        const texto = action.kind === 'stand' ? 'Levantar' : 'Dar as cartas';
        acoes.append(botao(texto, action));
      }
      if (view?.me?.can?.eleven) {
        acoes.append(botao('Jogar por 3', { kind: 'eleven', choice: 'play' }));
        acoes.append(botao('Correr', { kind: 'eleven', choice: 'run' }));
      }
      if (view?.me?.can?.call) {
        acoes.append(botao(rotuloCanto(view), { kind: 'call' }));
      }
      if (view?.me?.can?.answer) {
        acoes.append(botao('Aceitar', { kind: 'answer', answer: 'accept' }));
        acoes.append(botao('Correr', { kind: 'answer', answer: 'run' }));
        acoes.append(botao('Aumentar', { kind: 'answer', answer: 'raise' }));
      }
    }

    function desenhar(novaView) {
      view = novaView;
      placar.textContent = `${view.scores?.[0] || 0} × ${view.scores?.[1] || 0}`;
      vira.replaceChildren();
      if (view.hand?.vira) {
        vira.append('Vira ', cartas.carta(view.hand.vira, { tamanho: 'p' }));
      }
      resumo.textContent = resumoMao(view, api.serverNow());
      status.textContent = textoStatus(view, nome);
      desenharLugares();
      desenharMesa();
      desenharCartas();
      desenharAcoes();
    }

    let timeoutEnviado = null;
    const timer = setInterval(() => {
      const deadline = view?.hand?.deadline;
      if (!deadline || api.serverNow() < deadline || timeoutEnviado === deadline) return;
      timeoutEnviado = deadline;
      api.act({ kind: 'timeout' });
    }, 500);
    base.faxina.push(() => clearInterval(timer));

    return {
      update: desenhar,
      destroy: base.destruir,
      focus() {
        (acoes.querySelector('button') || status).focus();
      },
    };
  }

  function registrar(api, arquivos) {
    const global = root.GoLive = root.GoLive || {};
    global.mesaJanelas = global.mesaJanelas || {};
    const globais = { 'comum.js': 'mesaJanelasComum', 'cartas.js': 'mesaJanelasCartas' };
    const doc = root.document;
    const falta = () => arquivos.filter((arquivo) => !global[globais[arquivo]]);
    const esperas = [];
    if (doc && falta().length) {
      const base = (doc.currentScript && doc.currentScript.src) || doc.baseURI;
      global.mesaJanelasApoio = global.mesaJanelasApoio || {};
      for (const arquivo of falta()) {
        if (global.mesaJanelasApoio[arquivo]) continue;
        const script = doc.createElement('script');
        script.src = new root.URL(arquivo, base).href;
        script.async = false;
        global.mesaJanelasApoio[arquivo] = script;
        doc.head.appendChild(script);
      }
      for (const arquivo of falta()) {
        esperas.push(new Promise((ok) => {
          global.mesaJanelasApoio[arquivo].addEventListener('load', ok, { once: true });
        }));
      }
    }
    const montar = api.mount;
    const pronto = esperas.length ? Promise.all(esperas) : null;
    api.mount = function montarComApoio(el, vistaApi) {
      if (!falta().length) return montar(el, vistaApi);
      let instancia = null;
      let ultimo = null;
      let destruida = false;
      pronto.then(() => {
        if (destruida) return;
        instancia = montar(el, vistaApi);
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
    global.mesaJanelas[api.type] = api;
  }

  const api = {
    type: 'truco',
    mount,
    textoStatus,
    acoesDaView,
    acoesPrincipais,
    rotuloCanto,
    resumoMao,
  };
  registrar(api, ['comum.js', 'cartas.js']);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
