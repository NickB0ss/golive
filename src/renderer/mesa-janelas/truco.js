'use strict';

/* Conteudo do Truco. A janela recebe apenas a view filtrada pelo servidor;
 * carta nula vira verso e, por isso, a mao de ferro nao vaza valores. */
(function (root) {
  const VALORES = [1, 3, 6, 9, 12];
  const TEXTO_VAZIO = 'Sente 2 ou 4 pessoas. As duplas ficam frente a frente.';
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

  function atualizarBarra(api, texto, vez) {
    api.setStatus?.(texto);
    api.setTurn?.(vez);
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
    const placar = criar(doc, 'p', 'mj-tr-placar');
    const resumo = criar(doc, 'p', 'mj-tr-resumo');
    const status = criar(doc, 'p', 'mj-jogo-status');
    const vira = criar(doc, 'div', 'mj-tr-vira');
    const lugares = criar(doc, 'div', 'mj-tr-lugares');
    const mesa = criar(doc, 'div', 'mj-tr-mesa');
    const minhas = criar(doc, 'div', 'mj-tr-minhas');
    const acoes = criar(doc, 'div', 'mj-tr-acoes');
    const topo = criar(doc, 'div', 'mj-tr-topo');
    topo.append(vira);

    // Sem mao: as 4 cadeiras em cruz (duplas frente a frente) dentro do vazio.
    // Cada cadeira e uma `C.cadeiras` de um lugar so, para a cruz poder usar a grade.
    const cruz = criar(doc, 'div', 'mj-tr-cruz');
    const cadeiras = [0, 1, 2, 3].map((seat) => {
      const grupo = comum.cadeiras({
        rotulo: `Lugar ${seat + 1}`,
        aoSentar() { base.acao(cruz, { kind: 'sit', seat }); },
        aoRecusar(motivo) { base.aviso.mostrar(motivo, cruz); },
      });
      grupo.node.classList.add(`mj-tr-pos-${seat}`);
      cruz.append(grupo.node);
      return grupo;
    });
    const vazio = comum.vazio({
      icone: 'pessoas',
      titulo: 'Quatro lugares, duas duplas',
      texto: TEXTO_VAZIO,
      acao: cruz,
    });
    base.raiz.append(vazio, topo, resumo, lugares, mesa, minhas, acoes);
    let view = null;
    let jogadasVistas = new Set();

    function nome(seat) {
      const id = view?.seats?.[seat];
      return id ? comum.nomeDe(api, id) : 'Livre';
    }

    function botao(texto, action, zona = acoes, classe = '') {
      const novo = comum.botao({ text: texto, class: classe });
      base.clique(novo, zona, () => base.acao(zona, action));
      return novo;
    }

    function desenharCruz() {
      const sentado = view?.me?.seat >= 0;
      cadeiras.forEach((grupo, seat) => {
        const id = view?.seats?.[seat] || null;
        grupo.sync([{
          peer: id,
          nome: id ? nome(seat) : '',
          cor: id ? comum.corDe(api, id) : null,
          peca: null,
          vez: false,
          eu: Boolean(id) && view?.me?.seat === seat,
          motivoSentar: view?.me?.can?.sit ? true : (sentado ? 'Você já está sentado' : 'Indisponível agora'),
          // Levantar mora so no botao "Levantar" de baixo: uma acao num lugar so.
          motivoLevantar: 'Use o botão Levantar',
        }]);
      });
      const sentados = (view?.seats || []).filter(Boolean).length;
      vazio.children[2].textContent = sentados ? textoStatus(view, nome) : TEXTO_VAZIO;
    }

    function desenharLugares() {
      lugares.replaceChildren();
      for (let seat = 0; seat < 4; seat += 1) {
        const lugar = criar(doc, 'div', 'mj-tr-lugar');
        if (view?.hand?.turn === seat) lugar.classList.add('is-vez');
        lugar.append(criar(doc, 'span', 'mj-tr-nome', nome(seat)));
        if (!view?.seats?.[seat] && view?.me?.can?.sit) {
          lugar.append(botao('Sentar', { kind: 'sit', seat }, lugar, 'mj-fantasma'));
        }
        lugares.append(lugar);
      }
    }

    function desenharMesa() {
      mesa.replaceChildren();
      const vistas = new Set();
      for (const jogada of view?.hand?.table || []) {
        const chave = `${jogada.seat}:${jogada.covered ? 'x' : jogada.card}`;
        vistas.add(chave);
        const no = criar(doc, 'div', 'mj-tr-jogada');
        no.append(
          criar(doc, 'span', null, nome(jogada.seat)),
          // So a carta que acabou de cair gira; as que ja estavam ficam paradas.
          cartas.carta(jogada.covered ? null : jogada.card, { tamanho: 'm', vira: !jogadasVistas.has(chave) }),
        );
        mesa.append(no);
      }
      jogadasVistas = vistas;
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
          item.append(botao(action.covered ? 'Encoberta' : 'Jogar', action, acoes, action.covered ? '' : 'mj-pri'));
        }
        minhas.append(item);
      });
    }

    function desenharAcoes() {
      // `principal: true` e a acao que o momento pede; o resto vai como secundaria.
      const itens = [];
      for (const action of acoesPrincipais(view)) {
        const levantar = action.kind === 'stand';
        itens.push({ texto: levantar ? 'Levantar' : 'Dar as cartas', action, principal: !levantar });
      }
      if (view?.me?.can?.eleven) {
        itens.push({ texto: 'Jogar por 3', action: { kind: 'eleven', choice: 'play' }, principal: true });
        itens.push({ texto: 'Correr', action: { kind: 'eleven', choice: 'run' } });
      }
      if (view?.me?.can?.call) itens.push({ texto: rotuloCanto(view), action: { kind: 'call' } });
      if (view?.me?.can?.answer) {
        itens.push({ texto: 'Aceitar', action: { kind: 'answer', answer: 'accept' }, principal: true });
        itens.push({ texto: 'Correr', action: { kind: 'answer', answer: 'run' } });
        itens.push({ texto: 'Aumentar', action: { kind: 'answer', answer: 'raise' } });
      }
      const botoes = itens.map((item) => ({ item, botao: botao(item.texto, item.action) }));
      const principal = botoes.find((x) => x.item.principal);
      acoes.replaceChildren();
      if (!botoes.length) return;
      acoes.append(comum.acoes({
        principal: principal ? principal.botao : null,
        secundarias: botoes.filter((x) => x !== principal).map((x) => x.botao),
      }));
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
      atualizarBarra(
        api,
        `${view.scores?.[0] || 0} × ${view.scores?.[1] || 0} · ${status.textContent}`,
        Boolean(view.hand && !view.hand.result && (view.me?.can?.play || view.me?.can?.answer)),
      );
      // Sem mao na mesa: so o vazio com as cadeiras em cruz (e as acoes de baixo).
      const semMao = !view.hand || view.phase === 'waiting';
      vazio.hidden = !semMao;
      for (const parte of [topo, resumo, lugares, mesa, minhas]) parte.hidden = semMao;
      desenharCruz();
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
      destroy() { atualizarBarra(api, '', false); base.destruir(); },
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
    atualizarBarra,
  };
  registrar(api, ['comum.js', 'cartas.js']);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
