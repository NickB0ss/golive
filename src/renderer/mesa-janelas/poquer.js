'use strict';

/*
 * Conteudo da janela "Pôquer" (contrato da Mesa, secoes 6, 8 e 9). O modulo
 * e `secret`: o `update` recebe a `view` da pessoa (as proprias cartas, as
 * publicas, e `me` com o que ela pode fazer ja calculado), nunca o estado
 * inteiro. Por isso nada aqui chama o `validate` do modulo: os botoes saem
 * de `me.actions`, e quem decide e o servidor.
 *
 * Mesa oval com 8 lugares; quem esta sentado se ve embaixo, no meio (a mesa
 * gira para cada um). Na sua vez aparece a barra de acoes: Desistir,
 * Passar/Pagar, e Apostar/Aumentar com a barra deslizante, o campo e os
 * atalhos (½ pote, Pote, All-in). O relogio de 30 s segue `api.serverNow()`;
 * estourou, a janela manda `{ kind: 'timeout' }` (a da pessoa da vez na
 * hora; as outras, com folga, caso ela tenha sumido) e o servidor aceita so
 * o primeiro. Anuncio curto em `aria-live` a cada acontecimento
 * ("Bia aumentou para 80").
 */

(function (root) {
  const { t } = root.GoLive.i18n;
  const TYPE = 'poquer';
  const N = 8;
  // Folga das janelas de quem NAO esta na vez antes de mandar o `timeout`
  // (a da pessoa da vez manda na hora): evita a enxurrada de recusas.
  const FOLGA_OUTROS_MS = 2500;
  const RUAS = {
    preflop: 'mesa.poquer.rua.preflop',
    flop: 'mesa.poquer.rua.flop',
    turn: 'mesa.poquer.rua.turn',
    river: 'mesa.poquer.rua.river',
    fim: 'mesa.poquer.rua.fim',
  };

  // ---------- Puras ----------

  /** 1000 -> "1 000" (espaco fino inseparavel, como o resto da interface). */
  function fichas(n) {
    return String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /** Posicao na tela (0 = embaixo, no meio; sentido horario visto de cima:
   * embaixo, esquerda, em cima, direita) da cadeira `seat`, com `base` (a
   * cadeira de quem ve) embaixo. */
  function posicao(seat, base) {
    return (((seat - (base >= 0 ? base : 0)) % N) + N) % N;
  }

  /** Centro do lugar na posicao `p`, em % da mesa: { x, y }. `r` = fracao do
   * raio (1 = a borda, onde fica o lugar; menos = a aposta, mais perto do meio). */
  function coordenada(p, r) {
    const ang = Math.PI / 2 + (p * 2 * Math.PI) / N;
    const k = r === undefined ? 1 : r;
    return { x: 50 + 41 * k * Math.cos(ang), y: 50 + 39 * k * Math.sin(ang) };
  }

  /** Texto curto do acontecimento para o anuncio e a linha de estado. */
  function textoEvento(ev, nome, blinds) {
    if (!ev) return '';
    const n = nome || t('mesa.poquer.alguem');
    switch (ev.kind) {
      case 'sit': return t('mesa.poquer.evento.sentou', { nome: n });
      case 'stand': return t('mesa.poquer.evento.levantou', { nome: n });
      case 'deal': return t('mesa.poquer.evento.cartasDadas', { mao: ev.hand });
      case 'fold': return t(ev.timeout ? 'mesa.poquer.evento.tempoDesistiu' : 'mesa.poquer.evento.desistiu', { nome: n });
      case 'check': return t(ev.timeout ? 'mesa.poquer.evento.tempoPassou' : 'mesa.poquer.evento.passou', { nome: n });
      case 'call': return t('mesa.poquer.evento.pagou', { nome: n, valor: fichas(ev.amount) });
      case 'bet': return t('mesa.poquer.evento.apostou', { nome: n, valor: fichas(ev.to) });
      case 'raise': return t('mesa.poquer.evento.aumentou', { nome: n, valor: fichas(ev.to) });
      case 'allin': return t('mesa.poquer.evento.allIn', { nome: n, valor: fichas(ev.to) });
      case 'rebuy': return t('mesa.poquer.evento.recompra', { nome: n });
      case 'blinds': return blinds
        ? t('mesa.poquer.evento.blindsAgora', { sb: fichas(blinds.sb), bb: fichas(blinds.bb) })
        : t('mesa.poquer.evento.blindsTrocados');
      default: return '';
    }
  }

  /** Frases do fim da mao, uma por pote: "Bia ganhou 400 com Trinca de ases",
   * "Leo e Ana dividiram 30 com Flush", "Caio levou 30" (todos desistiram),
   * "Voltaram 200 para Bia" (aposta que ninguem pagou). */
  function textoResultado(result, nomeDe) {
    if (!result || !Array.isArray(result.pots)) return [];
    return result.pots.map((p, i) => {
      const nomes = p.winners.map(nomeDe);
      const quem = new Intl.ListFormat(root.GoLive.i18n.idiomaAtivo(), { type: 'conjunction' }).format(nomes);
      const maos = root.GoLive.mesaPoquerMaos;
      const jogo = p.jogo && maos ? maos.nomeDoJogo(p.jogo.cat, p.jogo.score, t) : null;
      const qual = result.pots.length > 1 && jogo
        ? t(i === 0 ? 'mesa.poquer.potePrincipal' : 'mesa.poquer.poteParalelo', { n: i })
        : '';
      if (result.byFold) return t('mesa.poquer.resultado.levou', { nome: quem, valor: fichas(p.amount) });
      if (!jogo) return t('mesa.poquer.resultado.voltaram', { nome: quem, valor: fichas(p.amount) });
      const chave = nomes.length > 1 ? 'mesa.poquer.resultado.dividiram' : 'mesa.poquer.resultado.ganhou';
      return t(chave, { nome: quem, valor: fichas(p.amount), jogo, qual });
    });
  }

  /** Valores dos atalhos de aposta ("aumentar para"), ja dentro de
   * [minRaise, maxRaise]: { meio, pote, tudo }. Pote = o que esta na mesa
   * mais o que a pessoa paga (o aumento do tamanho do pote). */
  function atalhos(view) {
    const me = view && view.me;
    const h = view && view.hand;
    if (!me || !h || !me.maxRaise) return null;
    const minha = me.seat >= 0 ? h.bets[me.seat] : 0;
    const toCall = h.currentBet - minha;
    const base = h.pot + toCall;
    const clamp = (v) => Math.max(me.minRaise, Math.min(me.maxRaise, Math.round(v)));
    return {
      meio: clamp(h.currentBet + base / 2),
      pote: clamp(h.currentBet + base),
      tudo: me.maxRaise,
    };
  }

  /** A linha de estado do alto ("Blinds 10/20 · mão 3 · Flop"): o nome do jogo ja esta
   * na barra da janela, entao nao se repete aqui. */
  function linhaDeEstado(v) {
    const h = v.hand;
    const emMao = h && !h.result;
    return t('mesa.poquer.linhaEstado', {
      sb: fichas(v.blinds.sb),
      bb: fichas(v.blinds.bb),
      mao: v.handNo ? t('mesa.poquer.linhaMao', { n: v.handNo }) : '',
      rua: emMao ? t('mesa.poquer.linhaRua', { rua: t(RUAS[h.street]) }) : '',
    });
  }

  /** Segundos que faltam (arredondados para cima, nunca negativo). */
  function segundos(deadline, agora) {
    return Math.max(0, Math.ceil((deadline - agora) / 1000));
  }

  /** O rotulo do botao de pagar/passar. */
  function rotuloPagar(me) {
    if (!me || me.canCheck) return t('mesa.poquer.passar');
    return t('mesa.poquer.pagar', { valor: fichas(me.toCall) });
  }

  /** O rotulo do botao de apostar/aumentar para `to`. */
  function rotuloAumentar(me, to) {
    if (!me) return t('mesa.poquer.apostar');
    const tudo = to >= me.maxRaise;
    if (tudo) return t('mesa.poquer.allIn', { valor: fichas(to) });
    if (me.actions.includes('bet')) return t('mesa.poquer.apostar', { valor: fichas(to) });
    return t('mesa.poquer.aumentarPara', { valor: fichas(to) });
  }

  // ---------- DOM ----------

  function atualizarBarra(api, texto, vez) {
    api.setStatus?.(texto);
    api.setTurn?.(vez);
  }

  function mount(elRoot, vistaApi) {
    const C = root.GoLive.mesaJanelasComum;
    const K = root.GoLive.mesaJanelasCartas;
    const Maos = root.GoLive.mesaPoquerMaos || null;
    const { el } = C;

    // Recusa de `timeout` que outro ja mandou nao interessa a ninguem.
    let ultimoTimeout = 0;
    const api = Object.assign({}, vistaApi, {
      onDenied(fn) {
        return vistaApi.onDenied((d) => {
          if (Date.now() - ultimoTimeout < 4000 && d && d.reason === 'invalid') return;
          fn(d);
        });
      },
      // Modulo secreto: quem decide e o servidor; a interface le `me`.
      validate() { return true; },
    });
    const b = C.base(elRoot, api, TYPE);
    b.raiz.classList.add('mj-jogo');

    let view = null;
    let evVisto = null;
    let maoVista = null;
    let ruaVista = null;
    let vezVista = null;
    let resultadoVisto = null;
    let timeoutMandado = null;
    let confirmaLevantar = 0;

    // --- Topo ---
    const titulo = el('p', { class: 'mj-pq-titulo' });
    const selBlinds = el('select', { class: 'mj-sel mj-pq-blinds', attrs: { 'aria-label': t('mesa.poquer.blindsProxima') } });
    const btDar = C.botao({ text: t('mesa.poquer.darAsCartas'), class: 'mj-pri' });
    const btRecompra = C.botao({ text: t('mesa.jogo.recompra') });
    const btLevantar = C.botao({ text: t('mesa.jogo.levantar'), class: 'mj-fantasma' });
    const topo = el('div', { class: 'mj-barra mj-pq-topo' }, titulo, el('span', { class: 'mj-mola' }), selBlinds, btRecompra, btDar, btLevantar);

    // --- Mesa ---
    const feltro = el('div', { class: 'mj-pq-feltro', attrs: { 'aria-hidden': 'true' } });
    const potes = el('p', { class: 'mj-pq-pote' });
    const board = el('div', { class: 'mj-pq-board', attrs: { role: 'group', 'aria-label': t('mesa.poquer.cartasDaMesa') } });
    const slots = [];
    for (let i = 0; i < 5; i += 1) {
      const s = el('span', { class: 'mj-pq-slot' });
      slots.push(s);
      board.append(s);
    }
    const resultado = el('div', { class: 'mj-pq-resultado' });
    const centro = el('div', { class: 'mj-pq-centro' }, potes, board, resultado);
    const lugares = [];
    const apostas = [];
    const mesa = el('div', { class: 'mj-pq-mesa', attrs: { role: 'group', 'aria-label': t('mesa.poquer.mesaDePoquer') } }, feltro, centro);
    for (let seat = 0; seat < N; seat += 1) {
      const nome = el('span', { class: 'mj-pq-nome' });
      const botaoD = el('span', { class: 'mj-pq-d', text: 'D', attrs: { title: t('mesa.poquer.botaoDealer'), 'aria-hidden': 'true' } });
      const tag = el('span', { class: 'mj-pq-tag' });
      const pilha = el('span', { class: 'mj-pq-pilha' });
      const estado = el('span', { class: 'mj-pq-estado' });
      const cartas = el('span', { class: 'mj-pq-cartas' });
      const relogio = el('span', { class: 'mj-pq-relogio', attrs: { 'aria-hidden': 'true' } }, el('span'));
      // O lugar e a cadeira comum (avatar na cor da pessoa, "Sentar" no livre).
      // Levantar fica so no botao do alto: uma acao num lugar so.
      const cad = C.cadeiras({
        rotulo: t('mesa.cartas.lugar', { n: seat + 1 }),
        aoSentar() { b.acao(caixa, { kind: 'sit', seat }); },
        aoRecusar(motivo) { if (caixa.classList.contains('is-livre')) b.aviso.mostrar(motivo, caixa); },
      });
      const caixa = el('div', { class: 'mj-pq-lugar' },
        el('div', { class: 'mj-pq-linha' }, cad.node, nome, botaoD, tag),
        el('div', { class: 'mj-pq-linha' }, pilha, cartas),
        estado,
        relogio);
      const aposta = el('span', { class: 'mj-pq-aposta' });
      mesa.append(aposta, caixa);
      lugares.push({ caixa, nome, botaoD, tag, pilha, estado, cartas, cad, relogio, chave: '' });
      apostas.push(aposta);
    }

    // --- Baixo: minhas cartas, estado e acoes ---
    const minhas = el('div', { class: 'mj-pq-minhas' });
    const meuJogo = el('p', { class: 'mj-pq-jogo' });
    const eu = el('div', { class: 'mj-pq-eu' }, minhas, meuJogo);
    const status = el('p', { class: 'mj-jogo-status mj-pq-status', attrs: { tabindex: '-1' } });
    const anuncio = el('p', { class: 'mj-pq-anuncio', attrs: { role: 'status', 'aria-live': 'polite' } });

    const btDesistir = C.botao({ text: t('mesa.poquer.desistir') });
    const btPagar = C.botao({ text: t('mesa.poquer.passar') });
    const btAumentar = C.botao({ text: t('mesa.poquer.aumentar'), class: 'mj-pri' });
    const slider = el('input', { class: 'mj-pq-slider', attrs: { type: 'range', 'aria-label': t('mesa.cartas.valorAposta'), step: '1' } });
    const campo = el('input', { class: 'mj-campo mj-pq-valor', attrs: { type: 'number', inputmode: 'numeric', 'aria-label': t('mesa.poquer.aumentarParaSemValor'), step: '1' } });
    const btMeio = C.botao({ text: t('mesa.poquer.meioPoteCurto'), class: 'mj-pq-atalho', label: t('mesa.poquer.meioPote') });
    const btPote = C.botao({ text: t('mesa.poquer.pote'), class: 'mj-pq-atalho', label: t('mesa.poquer.apostaTamanhoPote') });
    const btTudo = C.botao({ text: t('mesa.poquer.allInCurto'), class: 'mj-pq-atalho' });
    const linhaValor = el('div', { class: 'mj-pq-valores' }, slider, campo, btMeio, btPote, btTudo);
    const linhaBotoes = el('div', { class: 'mj-pq-botoes' }, btDesistir, btPagar, btAumentar);
    const acoes = el('div', { class: 'mj-pq-acoes', attrs: { role: 'group', 'aria-label': t('mesa.jogo.suaVez') } }, linhaValor, linhaBotoes);
    const baixo = el('div', { class: 'mj-pq-baixo' }, eu, el('div', { class: 'mj-pq-direita' }, status, acoes));

    b.raiz.append(topo, mesa, baixo, anuncio);
    b.raiz.classList.add('mj-poquer');

    // --- Acoes ---
    let valor = 0; // o "aumentar para" escolhido

    function me() {
      return (view && view.me) || { seat: -1, actions: [] };
    }
    function pode(kind) {
      return me().actions.includes(kind);
    }
    function porValor(v) {
      const m = me();
      if (!m.maxRaise) return;
      const n = Math.max(m.minRaise, Math.min(m.maxRaise, Math.round(Number(v) || 0)));
      valor = n;
      slider.value = String(n);
      if (root.document.activeElement !== campo) campo.value = String(n);
      btAumentar.querySelector('span').textContent = rotuloAumentar(m, n);
    }

    b.clique(btDesistir, acoes, () => b.acao(acoes, { kind: 'fold' }));
    b.clique(btPagar, acoes, () => b.acao(acoes, { kind: me().canCheck ? 'check' : 'call' }));
    b.clique(btAumentar, acoes, () => {
      const m = me();
      if (valor >= m.maxRaise) b.acao(acoes, { kind: 'allin' });
      else b.acao(acoes, { kind: pode('bet') ? 'bet' : 'raise', to: valor });
    });
    b.ouvir(slider, 'input', () => porValor(slider.value));
    b.ouvir(campo, 'input', () => porValor(campo.value));
    b.ouvir(campo, 'change', () => porValor(campo.value));
    b.ouvir(campo, 'blur', () => { campo.value = String(valor); });
    b.ouvir(campo, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        porValor(campo.value);
        btAumentar.click();
      }
    });
    b.clique(btMeio, acoes, () => { const a = atalhos(view); if (a) porValor(a.meio); });
    b.clique(btPote, acoes, () => { const a = atalhos(view); if (a) porValor(a.pote); });
    b.clique(btTudo, acoes, () => porValor(me().maxRaise));

    b.clique(btDar, topo, () => b.acao(topo, { kind: 'deal' }));
    b.clique(btRecompra, topo, () => b.acao(topo, { kind: 'rebuy' }));
    b.clique(btLevantar, topo, () => {
      if (me().inHand && Date.now() - confirmaLevantar > 3000) {
        confirmaLevantar = Date.now();
        btLevantar.classList.add('is-confirmando');
        btLevantar.querySelector('span').textContent = t('mesa.poquer.sairDaMaoPergunta');
        return;
      }
      confirmaLevantar = 0;
      b.acao(topo, { kind: 'stand' });
    });
    b.ouvir(selBlinds, 'change', () => {
      b.acao(topo, { kind: 'blinds', level: Number(selBlinds.value) });
    });

    // --- Nomes ---
    function nomeDaCadeira(seat) {
      if (!view) return t('mesa.poquer.alguem');
      const id = view.seats[seat];
      if (id) {
        const n = C.nomeDe(api, id);
        if (n !== C.nomeDe(api, null)) return n;
      }
      return view.names[seat] || (id ? t('mesa.poquer.alguem') : t('mesa.cartas.lugar', { n: seat + 1 }));
    }

    function anunciar(texto) {
      if (!texto) return;
      // Troca o texto (mesmo repetido) para o leitor de tela falar de novo.
      anuncio.textContent = '';
      anuncio.textContent = texto;
    }

    // --- Desenho ---
    function cartasEm(alvo, lista, opts) {
      const chave = JSON.stringify([lista, opts]);
      if (alvo.dataset.chave === chave) return;
      alvo.dataset.chave = chave;
      alvo.replaceChildren(...lista.map((c) => K.carta(c, opts)));
    }

    function pintarTopo(v) {
      const h = v.hand;
      const emMao = h && !h.result;
      titulo.textContent = linhaDeEstado(v);
      const lider = safeBool(() => api.isLeader());
      selBlinds.hidden = !lider || !!emMao;
      if (!selBlinds.hidden && selBlinds.options.length !== v.levels.length) {
        selBlinds.replaceChildren(...v.levels.map(([sb, bb], i) => el('option', { text: t('mesa.poquer.blindsNivel', { sb: fichas(sb), bb: fichas(bb) }), attrs: { value: String(i) } })));
      }
      if (!selBlinds.hidden && root.document.activeElement !== selBlinds) selBlinds.value = String(v.level);
      btDar.hidden = !pode('deal');
      btRecompra.hidden = !pode('rebuy');
      btLevantar.hidden = !pode('stand');
      if (Date.now() - confirmaLevantar > 3000) {
        btLevantar.classList.remove('is-confirmando');
        btLevantar.querySelector('span').textContent = t('mesa.jogo.levantar');
      }
    }

    function pintarLugares(v) {
      const h = v.hand;
      const m = me();
      const base = m.seat;
      const vencedores = new Set();
      const destaque = new Set();
      if (h && h.result) {
        for (const p of h.result.pots) for (const w of p.winners) vencedores.add(w);
        for (const w of vencedores) {
          const mao = h.result.hands && h.result.hands[w];
          if (mao) for (const c of mao.cards) destaque.add(c);
        }
      }
      for (let seat = 0; seat < N; seat += 1) {
        const L = lugares[seat];
        const p = posicao(seat, base);
        const xy = coordenada(p);
        L.caixa.style.left = `${xy.x}%`;
        L.caixa.style.top = `${xy.y}%`;
        L.caixa.dataset.pos = String(p);
        const id = v.seats[seat];
        const livre = !id;
        L.caixa.classList.toggle('is-livre', livre);
        L.caixa.classList.toggle('is-eu', seat === base && !livre);
        const st = h ? h.status[seat] : null;
        L.caixa.classList.toggle('is-fora', !livre && !!h && !h.result && st !== 'in' && st !== 'allin');
        L.caixa.classList.toggle('is-vez', !!h && !h.result && h.toAct === seat);
        L.caixa.classList.toggle('is-vencedor', vencedores.has(seat));
        const podeSentar = livre && pode('sit');
        L.cad.sync([{
          peer: livre ? null : id,
          nome: livre ? '' : nomeDaCadeira(seat),
          cor: livre ? null : C.corDe(api, id),
          peca: null,
          vez: !!h && !h.result && h.toAct === seat,
          eu: !livre && seat === base,
          motivoSentar: podeSentar ? true : t('mesa.cartas.indisponivelAgora'),
          motivoLevantar: t('mesa.cartas.useBotaoLevantar'),
        }]);
        // Lugar livre que ninguem pode ocupar so mostra "Livre"; senao a cadeira diz tudo.
        L.cad.node.hidden = livre && !podeSentar;
        L.nome.hidden = !(livre && !podeSentar);
        L.nome.textContent = L.nome.hidden ? '' : t('mesa.poquer.livre');
        L.botaoD.hidden = livre || v.button !== seat;
        const tag = h && !h.result ? (h.sbSeat === seat ? 'SB' : h.bbSeat === seat ? 'BB' : '') : '';
        L.tag.textContent = tag;
        L.tag.hidden = !tag;
        L.pilha.textContent = livre ? '' : fichas(v.stacks[seat]);
        L.pilha.hidden = livre;
        let est = '';
        if (!livre && h && !h.result && h.ids[seat] === id) {
          if (st === 'folded') est = t('mesa.poquer.desistiu');
          else if (st === 'allin') est = t('mesa.poquer.allInCurto');
        } else if (!livre && h && !h.result && h.ids[seat] !== id) est = t('mesa.poquer.proxima');
        if (!livre && v.stacks[seat] === 0 && !(h && !h.result && (st === 'allin'))) est = t('mesa.poquer.estadoSemFichas');
        if (h && h.result && h.result.hands && h.result.hands[seat]) est = h.result.hands[seat].category;
        L.estado.textContent = est;
        L.estado.hidden = !est;
        // Cartas: as viradas dos outros; as reveladas no showdown; as minhas
        // ficam grandes embaixo (aqui, pequenas so para quem nao sou eu).
        const minhas = seat === base;
        let lista = [];
        if (h && h.holes[seat]) lista = minhas && !h.result ? [] : h.holes[seat];
        else if (h && h.cards[seat] && !minhas) lista = [null, null];
        cartasEm(L.cartas, lista, { tamanho: 'p', vira: !!(h && h.result) });
        L.cartas.querySelectorAll('.mj-carta').forEach((node, i) => {
          node.classList.toggle('is-destaque', !!(lista[i] && destaque.has(lista[i])));
        });
        // Rotulo do lugar para o leitor de tela.
        const partes = livre ? [t('mesa.poquer.lugarLivre', { n: seat + 1 })]
          : [nomeDaCadeira(seat), t('mesa.cartas.fichas', { valor: fichas(v.stacks[seat]) })];
        if (!livre && v.button === seat) partes.push(t('mesa.poquer.botao'));
        if (tag) partes.push(tag === 'SB' ? t('mesa.poquer.smallBlind') : t('mesa.poquer.bigBlind'));
        if (est) partes.push(est.toLowerCase());
        if (h && h.bets[seat]) partes.push(t('mesa.poquer.apostouValor', { valor: fichas(h.bets[seat]) }));
        if (lista.length && lista[0]) partes.push(K.rotuloMao(lista));
        L.caixa.setAttribute('aria-label', partes.join(', '));
        L.caixa.setAttribute('role', 'group');
        // Aposta desta rodada, entre o lugar e o meio.
        const ap = apostas[seat];
        const bet = h && !h.result ? h.bets[seat] : 0;
        const xyA = coordenada(p, 0.6);
        ap.style.left = `${xyA.x}%`;
        ap.style.top = `${xyA.y}%`;
        ap.textContent = bet ? fichas(bet) : '';
        ap.hidden = !bet;
      }
    }

    function pintarCentro(v) {
      const h = v.hand;
      const lista = h ? h.board : [];
      const destaque = new Set();
      if (h && h.result && h.result.hands) {
        for (const p of h.result.pots) for (const w of p.winners) {
          const mao = h.result.hands[w];
          if (mao) for (const c of mao.cards) destaque.add(c);
        }
      }
      slots.forEach((s, i) => {
        const c = lista[i];
        const chave = `${c || ''}|${c && destaque.has(c) ? 1 : 0}`;
        if (s.dataset.chave === chave) return;
        s.dataset.chave = chave;
        s.replaceChildren(...(c ? [K.carta(c, { destaque: destaque.has(c), vira: true })] : []));
        s.classList.toggle('is-vazio', !c);
      });
      board.setAttribute('aria-label', lista.length
        ? t('mesa.poquer.cartasDaMesaComLista', { cartas: K.rotuloMao(lista) })
        : t('mesa.poquer.mesaSemCartas'));
      if (!h) {
        potes.textContent = v.seats.filter(Boolean).length >= 2
          ? t('mesa.poquer.prontoDarCartas') : t('mesa.poquer.sentarVagas');
        resultado.replaceChildren();
        return;
      }
      if (h.result) {
        potes.textContent = t('mesa.poquer.poteValor', { valor: fichas(h.pot) });
        resultado.replaceChildren(...textoResultado(h.result, nomeDaCadeira).map((t) => el('p', { text: t })));
        return;
      }
      resultado.replaceChildren();
      const ps = h.pots.filter((p) => p.amount > 0);
      if (ps.length > 1) {
        potes.textContent = ps.map((p, i) => t(i === 0 ? 'mesa.poquer.poteValor' : 'mesa.poquer.poteParaleloValor', {
          n: i, valor: fichas(p.amount),
        })).join(' · ');
      } else {
        potes.textContent = t('mesa.poquer.poteValor', { valor: fichas(h.pot) });
      }
    }

    function pintarBaixo(v) {
      const h = v.hand;
      const m = me();
      const minhasCartas = h && m.seat >= 0 && h.holes[m.seat] ? h.holes[m.seat] : [];
      cartasEm(minhas, minhasCartas.length ? minhasCartas : [], { tamanho: 'g', vira: true });
      eu.hidden = !minhasCartas.length;
      let jogo = '';
      if (h && h.result && h.result.hands && h.result.hands[m.seat]) jogo = h.result.hands[m.seat].name;
      else if (Maos && minhasCartas.length === 2 && h.board.length >= 3) {
        const r = Maos.best(minhasCartas.concat(h.board));
        if (r) jogo = r.name;
      }
      if (h && !h.result && m.seat >= 0 && h.status[m.seat] === 'folded') jogo = t('mesa.poquer.voceDesistiu');
      meuJogo.textContent = jogo;

      const minhaVez = !!m.myTurn;
      b.raiz.classList.toggle('is-minha-vez', minhaVez);
      b.raiz.classList.toggle('is-fim', !!(h && h.result));
      b.raiz.classList.toggle('is-showdown', !!(h && h.result && !h.result.byFold));
      const focoNasAcoes = acoes.contains(root.document.activeElement);
      acoes.hidden = !minhaVez;
      if (focoNasAcoes && !minhaVez) status.focus({ preventScroll: true });
      if (minhaVez) {
        btPagar.querySelector('span').textContent = rotuloPagar(m);
        btPagar.hidden = !(pode('check') || pode('call'));
        const podeAumentar = pode('bet') || pode('raise');
        linhaValor.hidden = !podeAumentar;
        if (podeAumentar) {
          slider.min = String(m.minRaise);
          slider.max = String(m.maxRaise);
          campo.min = String(m.minRaise);
          campo.max = String(m.maxRaise);
          if (vezVista !== vezChave(v)) valor = m.minRaise;
          porValor(valor || m.minRaise);
        }
        // Sem poder aumentar, sobra pagar (o `call` curto ja e all-in) ou desistir.
        btAumentar.hidden = !podeAumentar;
      }
    }

    function vezChave(v) {
      const h = v.hand;
      return h && !h.result ? `${h.no}:${h.street}:${h.toAct}:${h.currentBet}` : null;
    }

    function pintarStatus() {
      if (!view) return;
      const v = view;
      const h = v.hand;
      const m = me();
      let texto = '';
      const agora = safeNum(() => api.serverNow(), Date.now());
      if (h && !h.result && h.toAct >= 0) {
        const seg = h.deadline ? segundos(h.deadline, agora) : null;
        texto = m.myTurn
          ? (seg === null ? t('mesa.jogo.suaVez') : t('mesa.poquer.suaVezSegundos', { n: seg }))
          : (seg === null ? t('mesa.jogo.vezDe', { nome: nomeDaCadeira(h.toAct) })
            : t('mesa.poquer.vezDeSegundos', { nome: nomeDaCadeira(h.toAct), n: seg }));
        const L = lugares[h.toAct];
        const frac = h.deadline ? Math.max(0, Math.min(1, (h.deadline - agora) / 30000)) : 0;
        L.relogio.firstChild.style.transform = `scaleX(${frac})`;
        L.relogio.classList.toggle('is-pouco', frac < 0.34);
        b.raiz.classList.toggle('is-pouco', m.myTurn && frac < 0.34);
        verTimeout(h, agora, m);
      } else if (h && h.result) {
        texto = pode('deal') ? t('mesa.poquer.maoEncerradaDar') : t('mesa.poquer.maoEncerrada');
      } else if (m.seat < 0) {
        texto = pode('sit') ? t('mesa.poquer.escolhaLugar') : t('mesa.poquer.mesaCheiaAssiste');
      } else if (pode('deal')) {
        texto = t('mesa.poquer.darQuandoProntos');
      } else if (pode('rebuy')) {
        texto = t('mesa.poquer.semFichasRecompra');
      } else {
        texto = t('mesa.poquer.esperandoAlguem');
      }
      if (status.textContent !== texto) status.textContent = texto;
    }

    function verTimeout(h, agora, m) {
      if (!h.deadline) return;
      const chave = `${h.no}:${h.deadline}:${h.toAct}`;
      if (timeoutMandado === chave) return;
      const folga = m.myTurn ? 0 : FOLGA_OUTROS_MS;
      if (agora < h.deadline + folga) return;
      timeoutMandado = chave;
      ultimoTimeout = Date.now();
      api.act({ kind: 'timeout' });
    }

    function anunciarNovidades(v) {
      const h = v.hand;
      const partes = [];
      const ev = v.ev;
      if (ev && evVisto !== null && ev.n !== evVisto) {
        const nome = ev.seat >= 0 ? (v.seats[ev.seat] ? nomeDaCadeira(ev.seat) : ev.name) : null;
        partes.push(textoEvento(ev, nome || ev.name, v.blinds));
      }
      if (h && maoVista === h.no && ruaVista !== null && h.street !== ruaVista && ['flop', 'turn', 'river'].includes(h.street)) {
        partes.push(`${RUAS[h.street]}: ${K.rotuloMao(h.street === 'flop' ? h.board.slice(0, 3) : h.board.slice(-1))}`);
      }
      const resKey = h && h.result ? h.no : null;
      if (resKey !== null && resultadoVisto !== null && resKey !== resultadoVisto) partes.push(...textoResultado(h.result, nomeDaCadeira));
      const vk = vezChave(v);
      if (me().myTurn && vk !== vezVista && evVisto !== null) partes.push(t('mesa.jogo.suaVez'));
      if (evVisto !== null || resultadoVisto !== null) anunciar(partes.filter(Boolean).join('. '));
      evVisto = ev ? ev.n : 0;
      maoVista = h ? h.no : null;
      ruaVista = h ? h.street : null;
      resultadoVisto = resKey === null ? (resultadoVisto === null ? 0 : resultadoVisto) : resKey;
    }

    function update(novo) {
      if (!novo || !Array.isArray(novo.seats)) return;
      view = novo;
      pintarTopo(view);
      pintarLugares(view);
      pintarCentro(view);
      anunciarNovidades(view);
      pintarBaixo(view);
      vezVista = vezChave(view);
      pintarStatus();
      atualizarBarra(api, status.textContent, Boolean(me().myTurn && view.hand && !view.hand.result));
    }

    const timer = setInterval(pintarStatus, 250);
    b.faxina.push(() => clearInterval(timer));

    return {
      update,
      destroy() { atualizarBarra(api, '', false); b.destruir(); },
      focus() {
        const livre = lugares.find((L) => !L.cad.node.hidden && L.cad.node.querySelector('.mj-cadeira-livre'));
        const alvo = !acoes.hidden ? btPagar : [btDar, btRecompra].find((x) => !x.hidden)
          || livre?.cad.node.querySelector('.mj-cadeira-livre') || status;
        alvo.focus();
      },
    };
  }

  function safeBool(fn) {
    try {
      return fn() === true;
    } catch {
      return false;
    }
  }

  function safeNum(fn, fallback) {
    try {
      const v = Number(fn());
      return Number.isFinite(v) ? v : fallback;
    } catch {
      return fallback;
    }
  }

  // ---------- Registro ----------
  // A Vista carrega so `mesa-janelas/<tipo>.js` (contrato, secao 6); o
  // apoio (comum.js, cartas.js) vem daqui, uma vez, da mesma pasta. O
  // registro e imediato: se o apoio ainda nao chegou, a janela monta vazia,
  // guarda o ultimo `update` e so desenha quando ele chegar.
  function registrar(api, arquivos) {
    const G = (root.GoLive = root.GoLive || {});
    G.mesaJanelas = G.mesaJanelas || {};
    const GLOBAIS = { 'comum.js': 'mesaJanelasComum', 'tabuleiro.js': 'mesaJanelasTabuleiro', 'cartas.js': 'mesaJanelasCartas' };
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

  const api = {
    type: TYPE, mount, fichas, posicao, coordenada, linhaDeEstado, textoEvento, textoResultado, atalhos, segundos,
    rotuloPagar, rotuloAumentar, atualizarBarra,
  };

  registrar(api, ['comum.js', 'cartas.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
