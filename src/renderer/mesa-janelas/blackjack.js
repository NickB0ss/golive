'use strict';

/*
 * Conteudo da janela "Blackjack" (contrato da Mesa, secoes 6, 8 e 9).
 *
 * O estado que chega aqui ja e a `view` do servidor para esta pessoa
 * (mesa-modules/blackjack.js): a carta fechada da banca vem `null` ate a vez
 * dela, o sapato so como contagem, e `me.actions` diz o que da para fazer
 * agora -- a interface so mostra os botoes que estao ali (o `validate` de
 * janela secreta no cliente sempre diz sim; quem decide e o servidor).
 *
 * Desenho: a banca em cima, os 5 lugares embaixo (fichas, aposta, maos --
 * varias quando divide -- e o total), e a barra da pessoa: fichas 10/25/100/
 * 500 e o campo na fase de apostas; Pedir, Parar, Dobrar, Dividir e Seguro
 * na vez dela. O prazo corre pelo relogio da sala (`api.serverNow()`); ao
 * estourar, a janela manda `{ kind: 'timeout' }` (quem esta na vez na hora,
 * os outros um pouco depois, para nao chover pedido repetido).
 */

(function (root) {
  const TYPE = 'blackjack';
  const LUGARES = 5;
  const FICHAS = [10, 25, 100, 500];
  const NOMES_ACAO = { hit: 'Pedir', stand: 'Parar', double: 'Dobrar', split: 'Dividir' };

  // ---------- Puras ----------

  function milhar(n) {
    return String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /** "17 macio", "Blackjack!", "Estourou", "21". */
  function textoTotal(h) {
    if (!h || !Array.isArray(h.cards) || !h.cards.length) return '';
    if (h.blackjack) return 'Blackjack!';
    if (h.bust) return 'Estourou';
    return h.soft ? `${h.total} macio` : String(h.total);
  }

  /** O total da banca: so a aberta enquanto a fechada nao vira. */
  function textoBanca(d) {
    if (!d || !Array.isArray(d.cards) || !d.cards.length) return '';
    if (!d.revealed) return typeof d.cards[0] === 'string' && d.cards[0][0] === 'A' ? 'Mostra ás' : `Mostra ${d.total}`;
    return textoTotal(d);
  }

  /** "Ganhou 30", "Empate", "Perdeu 10" (null antes do fim). */
  function textoResultado(h) {
    if (!h || !h.result) return null;
    if (h.result === 'push') return 'Empate';
    if (h.win > 0) return h.result === 'blackjack' ? `Blackjack! Ganhou ${milhar(h.win)}` : `Ganhou ${milhar(h.win)}`;
    return `Perdeu ${milhar(-h.win)}`;
  }

  /** Segundos inteiros que faltam (arredonda para cima; nunca negativo). */
  function segundos(deadline, agora) {
    if (typeof deadline !== 'number') return null;
    return Math.max(0, Math.ceil((deadline - agora) / 1000));
  }

  function nomeLugar(v, i, nameOf) {
    const id = v.seats && v.seats[i];
    const vivo = id && nameOf ? nameOf(id) : null;
    return vivo || (v.names && v.names[i]) || `Lugar ${i + 1}`;
  }

  /** A linha de situacao, para todos. */
  function textoStatus(v, nameOf) {
    if (!v || !Array.isArray(v.seats)) return '';
    const me = v.me || { seat: -1, actions: [] };
    const sentados = v.seats.filter((x) => x !== null).length;
    if (v.phase === 'bets') {
      if (!sentados) return 'Lugares livres: sente-se para jogar';
      if (me.seat >= 0 && (me.actions || []).includes('rebuy')) return 'Sem fichas: faça a recompra para apostar';
      if (me.seat >= 0 && me.bet > 0) return `Você apostou ${milhar(me.bet)}; esperando os outros`;
      return 'Façam as apostas';
    }
    if (v.phase === 'insurance') {
      return (me.actions || []).includes('insurance') ? 'A banca mostra ás: quer seguro?' : 'A banca mostra ás: seguro';
    }
    if (v.phase === 'play' && v.turn !== null && v.hands[v.turn]) {
      const h = v.hands[v.turn];
      if (h.seat === me.seat) {
        const minhas = v.hands.filter((x) => x.seat === me.seat);
        const k = minhas.indexOf(h);
        return minhas.length > 1 ? `Sua vez (mão ${k + 1} de ${minhas.length})` : 'Sua vez';
      }
      return `Vez de ${nomeLugar(v, h.seat, nameOf)}`;
    }
    return 'Vez da banca';
  }

  /** Anuncio curto para o leitor de tela quando algo importante muda
   * (null = nada a dizer). */
  function anuncio(antes, v, nameOf) {
    if (!v || !Array.isArray(v.hands)) return null;
    const me = v.me || { seat: -1 };
    const partes = [];
    const novaRodada = !antes || v.round !== antes.round;
    if (novaRodada && v.round > 0 && v.phase !== 'bets') {
      if (v.reshuffled) partes.push('Sapato novo embaralhado');
      partes.push(`Cartas na mesa. Banca mostra ${textoBanca(v.dealer).replace('Mostra ', '')}`);
      const minhas = v.hands.filter((h) => h.seat === me.seat);
      if (minhas.length) partes.push(`você tem ${textoTotal(minhas[0])}`);
    }
    const fimAgora = antes && antes.phase !== 'bets' && v.phase === 'bets' && v.round === antes.round;
    const fimDireto = novaRodada && v.phase === 'bets' && v.round > 0 && v.hands.length && v.hands.every((h) => h.result);
    if (fimAgora || fimDireto) {
      if (fimDireto && v.reshuffled) partes.push('Sapato novo embaralhado');
      partes.push(`Banca: ${textoBanca(v.dealer)}`);
      const minhas = v.hands.filter((h) => h.seat === me.seat).map(textoResultado).filter(Boolean);
      if (minhas.length) partes.push(`você: ${minhas.join(', ')}`);
    }
    if (v.phase === 'insurance' && (!antes || antes.phase !== 'insurance') && (me.actions || []).includes('insurance')) {
      partes.push('Seguro?');
    }
    const minhaVez = (x) => x && x.phase === 'play' && x.me && x.me.hand !== null && x.me.hand !== undefined;
    if (minhaVez(v) && (!minhaVez(antes) || antes.me.hand !== v.me.hand || novaRodada)) {
      partes.push(`Sua vez: ${textoTotal(v.hands[v.turn])}`);
    } else if (!novaRodada && antes && v.phase === 'play' && v.turn !== antes.turn && v.turn !== null && v.hands[v.turn] && v.hands[v.turn].seat !== me.seat) {
      partes.push(`Vez de ${nomeLugar(v, v.hands[v.turn].seat, nameOf)}`);
    }
    return partes.length ? partes.join('. ') : null;
  }

  /** Espera antes de mandar o `timeout`: quem esta na vez manda na hora, os
   * sentados 0,7 s depois, quem assiste 1,5 s depois. */
  function esperaTimeout(v) {
    const me = v && v.me;
    if (!me || me.seat < 0) return 1500;
    if (me.hand !== null && me.hand !== undefined) return 0;
    if ((me.actions || []).some((a) => a === 'insurance' || a === 'bet')) return 0;
    return 700;
  }

  // ---------- DOM ----------

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const K = root.GoLive.mesaJanelasCartas;
    const { el } = C;

    // As recusas do `timeout` repetido (outro chegou primeiro) nao sao da
    // pessoa: nao viram aviso.
    let ultimoKind = null;
    const apiF = Object.assign({}, api, {
      act(a) { ultimoKind = a && a.kind; api.act(a); },
      onDenied(fn) {
        return typeof api.onDenied === 'function'
          ? api.onDenied((d) => { if (ultimoKind !== 'timeout') fn(d); })
          : undefined;
      },
    });
    const b = C.base(elRoot, apiF, TYPE);
    b.raiz.classList.add('mj-bj');

    let v = null;
    let ultimoAnuncio = '';

    // Cabecalho: situacao, prazo e o sapato.
    // A situacao recebe o foco quando nao sobra controle nenhum (a vez
    // passou): quem esta no teclado nao cai no <body>.
    const status = el('p', { class: 'mj-bj-status', attrs: { tabindex: '-1' } });
    const prazo = el('span', { class: 'mj-bj-prazo', attrs: { 'aria-hidden': 'true' } });
    const sapato = el('span', { class: 'mj-bj-sapato' });
    const falado = el('p', { class: 'visually-hidden', attrs: { role: 'status', 'aria-live': 'polite' } });
    const topo = el('div', { class: 'mj-bj-topo' }, status, el('span', { class: 'mj-mola' }), prazo, sapato);

    // Banca.
    const bancaMao = el('div', { class: 'mj-bj-banca-mao' });
    const bancaTotal = el('span', { class: 'mj-bj-total' });
    const banca = el('section', { class: 'mj-bj-banca', attrs: { 'aria-label': 'Banca' } },
      el('span', { class: 'mj-rotulo', text: 'Banca' }), bancaMao, bancaTotal);

    // Lugares.
    const lugaresEl = el('div', { class: 'mj-bj-lugares' });
    const lugares = [];
    for (let i = 0; i < LUGARES; i += 1) {
      const node = el('section', { class: 'mj-bj-lugar', attrs: { 'aria-label': `Lugar ${i + 1}` } });
      lugaresEl.append(node);
      lugares.push({ node, chave: null });
    }

    // Barra da pessoa.
    const zona = el('div', { class: 'mj-bj-barra' });
    const apostaCampo = el('input', {
      class: 'mj-campo mj-bj-campo',
      attrs: { type: 'number', inputmode: 'numeric', min: '10', max: '500', step: '1', 'aria-label': 'Valor da aposta', id: `mj-bj-aposta-${Math.random().toString(36).slice(2, 8)}` },
    });
    const apostaRot = el('label', { class: 'mj-bj-rot', text: 'Aposta', attrs: { for: apostaCampo.id } });
    const fichas = FICHAS.map((n) => {
      const bt = C.botao({ text: `+${n}`, class: 'mj-bj-ficha', label: `Somar ${n} à aposta` });
      bt.dataset.ficha = String(n);
      b.clique(bt, zona, () => somar(n));
      return bt;
    });
    const btApostar = C.botao({ text: 'Apostar', class: 'mj-pri' });
    const btTirar = C.botao({ text: 'Tirar aposta', class: 'mj-fantasma' });
    const grupoAposta = el('div', { class: 'mj-bj-grupo', attrs: { role: 'group', 'aria-label': 'Aposta' } },
      apostaRot, apostaCampo, ...fichas, btApostar, btTirar);

    const btSeguro = C.botao({ text: 'Seguro', class: 'mj-pri' });
    const btSemSeguro = C.botao({ text: 'Sem seguro' });
    const grupoSeguro = el('div', { class: 'mj-bj-grupo', attrs: { role: 'group', 'aria-label': 'Seguro' } }, btSeguro, btSemSeguro);

    const jogadas = {};
    const grupoJogo = el('div', { class: 'mj-bj-grupo', attrs: { role: 'group', 'aria-label': 'Sua jogada' } });
    for (const k of ['hit', 'stand', 'double', 'split']) {
      const bt = C.botao({ text: NOMES_ACAO[k], class: k === 'hit' || k === 'stand' ? 'mj-pri' : '' });
      bt.dataset.acao = k;
      b.clique(bt, zona, () => b.acao(zona, { kind: k }));
      jogadas[k] = bt;
      grupoJogo.append(bt);
    }

    const dica = el('p', { class: 'mj-dica mj-bj-dica' });
    const btRecompra = C.botao({ text: 'Recompra', class: 'mj-pri' });
    const btLevantar = C.botao({ text: 'Levantar', class: 'mj-fantasma' });
    zona.append(grupoAposta, grupoSeguro, grupoJogo, dica, el('span', { class: 'mj-mola' }), btRecompra, btLevantar);

    b.raiz.append(topo, falado, banca, lugaresEl, zona);

    b.clique(btApostar, zona, apostar);
    b.clique(btTirar, zona, () => b.acao(zona, { kind: 'bet', amount: 0 }));
    b.clique(btSeguro, zona, () => b.acao(zona, { kind: 'insurance', amount: (v && v.me && v.me.insuranceMax) || 0 }));
    b.clique(btSemSeguro, zona, () => b.acao(zona, { kind: 'insurance', amount: 0 }));
    b.clique(btRecompra, zona, () => b.acao(zona, { kind: 'rebuy' }));
    b.clique(btLevantar, zona, () => b.acao(zona, { kind: 'leave' }));
    b.ouvir(apostaCampo, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        apostar();
      }
    });

    let ultimaAposta = 10;
    function valorCampo() {
      const n = Math.floor(Number(apostaCampo.value));
      return Number.isFinite(n) ? n : 0;
    }
    function somar(n) {
      const me = v && v.me;
      const teto = me ? me.maxBet : 500;
      const base = apostaCampo.dataset.tocado === '1' ? valorCampo() : 0;
      apostaCampo.value = String(Math.min(teto, Math.max(0, base) + n));
      apostaCampo.dataset.tocado = '1';
    }
    function apostar() {
      const n = valorCampo();
      const me = (v && v.me) || { minBet: 10, maxBet: 500 };
      if (n < me.minBet || n > me.maxBet) {
        b.aviso.mostrar(me.maxBet < me.minBet ? 'Fichas insuficientes' : `Aposta de ${me.minBet} a ${milhar(me.maxBet)}`, zona);
        return;
      }
      ultimaAposta = n;
      apostaCampo.dataset.tocado = '';
      b.acao(zona, { kind: 'bet', amount: n });
    }
    b.ouvir(apostaCampo, 'input', () => { apostaCampo.dataset.tocado = '1'; });

    // Lugar: refeito so quando o que ele mostra mudou.
    function desenharLugar(i) {
      const L = lugares[i];
      const id = v.seats[i];
      const me = v.me || { seat: -1, actions: [] };
      const maos = v.hands.map((h, k) => ({ h, k })).filter((x) => x.h.seat === i);
      const vez = v.phase === 'play' && v.turn !== null && v.hands[v.turn] && v.hands[v.turn].seat === i;
      const podeSentar = id === null && (me.actions || []).includes('sit');
      const nome = id !== null ? nomeLugar(v, i, (x) => C.nomeDe(api, x)) : null;
      const chave = JSON.stringify([id, nome, v.chips[i], v.bets[i], v.insurance[i], v.insuranceNet[i], maos, vez, v.turn, podeSentar, me.seat === i, v.phase]);
      if (chave === L.chave) return;
      L.chave = chave;
      const tinhaFoco = L.node.contains(root.document.activeElement);
      L.node.replaceChildren();
      L.node.classList.toggle('is-vazio', id === null);
      L.node.classList.toggle('is-vez', !!vez);
      L.node.classList.toggle('is-meu', me.seat === i);
      L.node.classList.toggle('is-anterior', v.phase === 'bets');
      if (id === null) {
        L.node.setAttribute('aria-label', `Lugar ${i + 1}, livre`);
        if (podeSentar) {
          const bt = C.botao({ text: 'Sentar', label: `Sentar no lugar ${i + 1}` });
          b.clique(bt, zona, () => b.acao(zona, { kind: 'sit', seat: i }));
          L.node.append(bt);
          if (tinhaFoco) bt.focus();
        } else {
          L.node.append(el('span', { class: 'mj-bj-livre', text: 'Livre' }));
        }
        return;
      }
      L.node.setAttribute('aria-label', `Lugar ${i + 1}: ${nome}${me.seat === i ? ' (você)' : ''}`);
      const cab = el('div', { class: 'mj-bj-quem' },
        C.bolinha(C.corDe(api, id), nome),
        el('span', { class: 'mj-bj-nome', text: me.seat === i ? `${nome} (você)` : nome }));
      const saldo = el('div', { class: 'mj-bj-saldo' },
        el('span', { class: 'mj-bj-fichas', text: `${milhar(v.chips[i])} fichas` }));
      if (v.bets[i] > 0) saldo.append(el('span', { class: 'mj-bj-aposta', text: `Aposta ${milhar(v.bets[i])}` }));
      if (v.insurance[i] > 0) {
        const net = v.insuranceNet[i];
        const t = net === null ? `Seguro ${milhar(v.insurance[i])}` : net > 0 ? `Seguro: ganhou ${milhar(net)}` : `Seguro: perdeu ${milhar(-net)}`;
        saldo.append(el('span', { class: 'mj-bj-seguro', text: t }));
      }
      L.node.append(cab, saldo);
      const lista = el('div', { class: 'mj-bj-maos' });
      for (const { h, k } of maos) {
        const res = textoResultado(h);
        const mao = el('div', { class: `mj-bj-mao${k === v.turn && vez ? ' is-vez' : ''}${h.result ? ` is-${h.result === 'push' ? 'empate' : h.win > 0 ? 'ganhou' : 'perdeu'}` : ''}` },
          K.mao(h.cards, { tamanho: 'p' }),
          el('span', { class: 'mj-bj-total', text: textoTotal(h) }),
          el('span', { class: 'mj-bj-mao-aposta', text: milhar(h.bet), attrs: { title: h.doubled ? 'Aposta dobrada' : 'Aposta' } }));
        if (res) mao.append(el('span', { class: 'mj-bj-res', text: res }));
        mao.setAttribute('aria-label', `${maos.length > 1 ? `Mão ${maos.findIndex((x) => x.k === k) + 1}: ` : ''}${K.rotuloMao(h.cards)}; ${textoTotal(h)}; aposta ${h.bet}${h.doubled ? ', dobrada' : ''}${res ? `; ${res}` : ''}`);
        mao.setAttribute('role', 'group');
        lista.append(mao);
      }
      L.node.append(lista);
    }

    let bancaChave = null;
    function desenharBanca() {
      const d = v.dealer || { cards: [] };
      const chave = JSON.stringify(d);
      if (chave === bancaChave) return;
      bancaChave = chave;
      bancaMao.replaceChildren(K.mao(d.cards, { tamanho: 'm' }));
      bancaTotal.textContent = textoBanca(d);
      banca.classList.toggle('is-estourou', !!d.bust);
    }

    function desenharBarra() {
      const me = v.me || { seat: -1, actions: [] };
      const a = new Set(me.actions || []);
      grupoAposta.hidden = !a.has('bet');
      if (a.has('bet')) {
        apostaCampo.max = String(me.maxBet);
        apostaCampo.min = String(me.minBet);
        if (apostaCampo.dataset.tocado !== '1' && root.document.activeElement !== apostaCampo) {
          apostaCampo.value = String(Math.min(me.maxBet, me.bet > 0 ? me.bet : ultimaAposta));
        }
        btApostar.querySelector('span').textContent = me.bet > 0 ? 'Trocar aposta' : 'Apostar';
        btTirar.hidden = !(me.bet > 0);
        for (const f of fichas) C.ligado(f, Number(f.dataset.ficha) <= me.maxBet ? true : 'Fichas insuficientes');
      }
      grupoSeguro.hidden = !a.has('insurance');
      if (a.has('insurance')) {
        btSeguro.querySelector('span').textContent = `Seguro de ${milhar(me.insuranceMax)}`;
        btSeguro.hidden = !(me.insuranceMax > 0);
      }
      const joga = ['hit', 'stand', 'double', 'split'].some((k) => a.has(k));
      grupoJogo.hidden = !joga;
      for (const k of Object.keys(jogadas)) jogadas[k].hidden = !a.has(k);
      btRecompra.hidden = !a.has('rebuy');
      btLevantar.hidden = !a.has('leave');
      let texto = '';
      if (me.seat < 0) texto = a.has('sit') ? 'Escolha um lugar livre para jogar' : 'Mesa cheia: assistindo';
      else if (!a.size || (a.size === 1 && a.has('leave'))) texto = v.phase === 'bets' ? '' : 'Esperando a sua vez';
      dica.textContent = texto;
      dica.hidden = !texto;
    }

    /** Foco que estava num botao que sumiu (lugar refeito, jogada que nao
     * vale mais) vai para o primeiro controle que ficou. */
    function resgatarFoco(estavaDentro) {
      if (!estavaDentro) return;
      const ativo = root.document.activeElement;
      if (ativo && b.raiz.contains(ativo) && ativo.offsetParent !== null) return;
      focus();
    }

    // Relogio: um tique a cada 250 ms so enquanto ha prazo.
    let timer = null;
    let enviado = null; // { deadline, em }
    function tique() {
      if (!v) return;
      const agora = api.serverNow();
      const s = segundos(v.deadline, agora);
      if (s === null) {
        prazo.textContent = '';
        prazo.hidden = true;
        return;
      }
      prazo.hidden = false;
      prazo.textContent = `${s} s`;
      prazo.classList.toggle('is-fim', s <= 5);
      prazo.title = v.phase === 'bets' ? 'Tempo para apostar' : 'Tempo para decidir';
      if (agora >= v.deadline + esperaTimeout(v)) {
        if (enviado && enviado.deadline === v.deadline && agora - enviado.em < 2000) return;
        enviado = { deadline: v.deadline, em: agora };
        apiF.act({ kind: 'timeout' });
      }
    }
    function relogio() {
      const precisa = v && typeof v.deadline === 'number';
      if (precisa && !timer) timer = setInterval(tique, 250);
      if (!precisa && timer) {
        clearInterval(timer);
        timer = null;
      }
      tique();
    }
    b.faxina.push(() => { if (timer) clearInterval(timer); timer = null; });

    function update(novo) {
      if (!novo || !Array.isArray(novo.seats)) return;
      const estavaDentro = b.raiz.contains(root.document.activeElement);
      const antes = v;
      v = novo;
      if (antes && antes.round !== v.round) {
        apostaCampo.dataset.tocado = '';
      }
      status.textContent = textoStatus(v, (x) => C.nomeDe(api, x));
      sapato.textContent = `Sapato: ${v.shoeLeft}`;
      sapato.title = `${v.shoeLeft} de ${v.shoeTotal} cartas no sapato`;
      sapato.setAttribute('aria-label', `${v.shoeLeft} cartas no sapato`);
      desenharBanca();
      for (let i = 0; i < LUGARES; i += 1) desenharLugar(i);
      desenharBarra();
      const fala = anuncio(antes, v, (x) => C.nomeDe(api, x));
      if (fala && fala !== ultimoAnuncio) falado.textContent = fala;
      if (fala) ultimoAnuncio = fala;
      b.raiz.classList.toggle('is-minha-vez', !!(v.me && v.me.hand !== null && v.me.hand !== undefined));
      relogio();
      resgatarFoco(estavaDentro);
    }

    function focus() {
      const alvo = [...zona.querySelectorAll('button, input')].find((x) => x.offsetParent !== null)
        || [...lugaresEl.querySelectorAll('button')].find((x) => x.offsetParent !== null)
        || status;
      alvo.focus();
    }

    return { update, destroy: b.destruir, focus };
  }

  // ---------- Registro ----------
  // Como os outros conteudos: o apoio (comum.js, cartas.js) vem da mesma
  // pasta, uma vez; se ainda nao chegou, a janela monta vazia, guarda o
  // ultimo `update` e so desenha quando ele chegar.
  function registrar(api, arquivos) {
    const G = (root.GoLive = root.GoLive || {});
    G.mesaJanelas = G.mesaJanelas || {};
    const GLOBAIS = { 'comum.js': 'mesaJanelasComum', 'cartas.js': 'mesaJanelasCartas' };
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

  const api = { type: TYPE, mount, textoTotal, textoBanca, textoResultado, textoStatus, anuncio, segundos, esperaTimeout, milhar };

  registrar(api, ['comum.js', 'cartas.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
