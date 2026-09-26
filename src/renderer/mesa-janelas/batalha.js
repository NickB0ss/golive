'use strict';

/*
 * Conteudo da janela "Batalha naval" (contrato da Mesa, secoes 6, 7 e 8).
 * O modulo puro e `mesa-modules/batalha.js`, que e `secret`: este conteudo
 * so recebe a `view` do servidor -- os proprios navios, os tiros dos dois,
 * os navios afundados e, pronto, o que cada botao pode (`me.can`). Nunca o
 * estado inteiro, entao nada aqui roda o `validate` do modulo.
 *
 * Dois mares de 10x10: quem esta sentado ve "Seu mar" (os navios dele e os
 * tiros que levou) e o mar do adversario, onde clica para atirar (botoes de
 * verdade, setas andam pelas casas). Quem assiste ve os dois mares so com
 * tiros e afundados. A moldura das cadeiras vem de `tabuleiro.js`.
 *
 * Tempo esgotado: quando o relogio da sala (`api.serverNow()`) passa do
 * `deadline`, o adversario manda `{ kind: 'timeout' }` na hora e os outros
 * 3 s depois (se ninguem mandou); o servidor confere com a hora dele e
 * recusa com `early` o que chegar cedo -- recusa que nao vira aviso.
 */

(function (root) {
  const TYPE = 'batalha';
  const LABELS = ['Frota 1', 'Frota 2'];
  const N = 10;
  const COLUNAS = 'ABCDEFGHIJ';
  const NAVIOS = ['Porta-aviões', 'Encouraçado', 'Cruzador', 'Submarino', 'Destróier'];
  // Quem nao e o adversario da vez espera um pouco antes de mandar o
  // timeout: o adversario, que tem o maior interesse, manda primeiro.
  const FOLGA_OUTROS_MS = 3000;
  const REPETE_MS = 2000;

  // ---------- Puras ----------

  /** Casa -> "C7" (coluna A..J, linha 1..10). */
  function nomeCasa(cell) {
    return `${COLUNAS[cell % N]}${Math.floor(cell / N) + 1}`;
  }

  /** O que cada casa de um mar mostra: 'navio', 'afundado', 'acerto',
   * 'agua' ou '' (sem nada). Um mapa casa -> marca. */
  function marcas(board) {
    const out = new Map();
    if (!board) return out;
    for (const navio of board.ships || []) {
      for (const x of navio.cells || []) out.set(x, navio.sunk ? 'afundado' : 'navio');
    }
    for (const [x, hit] of board.shots || []) {
      const atual = out.get(x);
      if (atual === 'afundado') continue;
      out.set(x, hit ? 'acerto' : 'agua');
    }
    return out;
  }

  const ROTULO_MARCA = { navio: 'navio', afundado: 'navio afundado', acerto: 'acerto', agua: 'água' };

  function rotuloCasa(cell, marca) {
    return `${nomeCasa(cell)}: ${ROTULO_MARCA[marca] || 'sem tiro'}`;
  }

  /** "Bia acertou C7", "Água em C7", "Bia afundou o Cruzador". */
  function textoUltimo(last, nomeDe) {
    if (!last || !Number.isInteger(last.cell)) return '';
    const quem = nomeDe(last.seat);
    if (Number.isInteger(last.sunk)) return `${quem} afundou o ${NAVIOS[last.sunk] || 'navio'}`;
    return last.hit ? `${quem} acertou ${nomeCasa(last.cell)}` : `Água em ${nomeCasa(last.cell)}`;
  }

  /** A linha de situacao durante o posicionamento. */
  function textoPosicionando(state, nomeDe) {
    const eu = state.me ? state.me.seat : -1;
    const livres = state.seats.filter((s) => s === null).length;
    if (livres === 2) return 'Cadeiras livres: sente-se para jogar';
    if (eu < 0) return livres ? 'Uma cadeira livre: sente-se para jogar' : 'Posicionando as frotas';
    if (!state.ready[eu]) return 'Sorteie a frota até gostar e diga Pronto';
    if (state.seats[1 - eu] === null) return 'Pronto. Esperando alguém sentar na outra cadeira';
    return `Pronto. Esperando ${nomeDe(1 - eu)}`;
  }

  /** Motivo de um botao desligado, pelo `me.can` da view. */
  function podeDaView(state, action) {
    const can = (state && state.me && state.me.can) || {};
    switch (action.kind) {
      case 'sit': return Array.isArray(can.sit) && can.sit[action.seat] === true ? true : 'Cadeira ocupada';
      case 'reset': return can.reset === true ? true : 'Só quem está sentado ou o líder recomeça';
      case 'resign': return can.resign === true ? true : 'A partida não está correndo';
      case 'shuffle': return can.shuffle === true ? true : 'A frota já está posta';
      case 'ready': return can.ready === true ? true : 'Indisponível';
      case 'fire': return can.fire === true ? true : 'Não é a sua vez';
      case 'stand': return can.stand === true ? true : 'Você não está sentado';
      default: return 'Indisponível';
    }
  }

  // ---------- DOM ----------

  function mount(elRoot, apiVista) {
    const C = root.GoLive.mesaJanelasComum;
    const T = root.GoLive.mesaJanelasTabuleiro;
    const { el } = C;
    // O `early` do tempo esgotado e o "ninguem precisava mandar" nao sao
    // erro de ninguem: nao viram aviso na janela.
    const api = Object.assign({}, apiVista, {
      onDenied(fn) {
        return apiVista.onDenied((d) => {
          if (d && (d.reason === 'early' || (d.reason === 'invalid' && d.detail === 'Nada correndo'))) return;
          fn(d);
        });
      },
    });
    const b = C.base(elRoot, api, TYPE);
    let state = null;

    const mold = T.moldura(b, api, {
      labels: LABELS,
      desistir: true,
      pode: (action) => podeDaView(state, action),
      amostra(a, i) { a.textContent = String(i + 1); },
    });

    const mares = el('div', { class: 'mj-bn-mares' });
    mold.placa.append(mares);
    const lados = [0, 1].map(() => {
      const titulo = el('span', { class: 'mj-bn-titulo' });
      const conta = el('span', { class: 'mj-bn-conta' });
      const grade = el('div', { class: 'mj-bn-grade' });
      const casas = [];
      for (let x = 0; x < N * N; x++) {
        const bt = el('button', { class: 'mj-bn-casa', attrs: { type: 'button', 'data-casa': String(x), tabindex: '-1' } });
        grade.append(bt);
        casas.push(bt);
      }
      const caixa = el('section', { class: 'mj-bn-mar' }, el('header', { class: 'mj-bn-cab' }, titulo, conta), grade);
      mares.append(caixa);
      return { caixa, titulo, conta, grade, casas, tecl: T.gradeTeclado(grade, () => casas, N), alvo: false, seat: 0 };
    });
    lados.forEach((lado) => {
      lado.casas.forEach((bt, x) => {
        b.clique(bt, mold.zona, () => {
          if (!lado.alvo) return;
          b.acao(mold.zona, { kind: 'fire', cell: x });
        });
      });
    });
    // Nada que comeca nos mares sobe para a mesa.
    mold.placa.addEventListener('pointerdown', (e) => e.stopPropagation());

    const sortear = C.botao({ icone: 'embaralhar', text: 'Sortear de novo', class: 'mj-bn-sortear' });
    const pronto = C.botao({ icone: 'check', text: 'Pronto', class: 'mj-bn-pronto' });
    const acoes = el('div', { class: 'mj-bn-acoes' }, sortear, pronto);
    mold.placa.append(acoes);
    b.clique(sortear, mold.zona, () => b.acao(mold.zona, { kind: 'shuffle' }));
    b.clique(pronto, mold.zona, () => b.acao(mold.zona, { kind: 'ready' }));

    const relogio = el('span', { class: 'mj-bn-relogio', attrs: { 'aria-hidden': 'true' } });
    mold.topo.insertBefore(relogio, mold.topo.querySelector('.mj-mola'));

    const nomeDe = (seat) => {
      const me = api.me();
      if (state && state.seats[seat] === me) return 'Você';
      return state ? T.nomeCadeira(state, seat, LABELS, mold.nameOf) : LABELS[seat];
    };

    function desenharMar(lado, board, seat, alvo) {
      const eu = state.me ? state.me.seat : -1;
      lado.seat = seat;
      lado.alvo = alvo;
      const dono = seat === eu ? 'Seu mar' : `Mar de ${eu >= 0 ? nomeDe(seat) : T.nomeCadeira(state, seat, LABELS, mold.nameOf)}`;
      if (lado.titulo.textContent !== dono) lado.titulo.textContent = dono;
      const left = board && Number.isInteger(board.left) ? board.left : null;
      const conta = left === null ? '' : `${left} ${left === 1 ? 'navio' : 'navios'}`;
      if (lado.conta.textContent !== conta) lado.conta.textContent = conta;
      lado.caixa.classList.toggle('is-alvo', alvo);
      lado.grade.setAttribute('role', 'grid');
      lado.grade.setAttribute('aria-label', alvo ? `${dono}: escolha onde atirar` : dono);
      const m = marcas(board);
      const podeAtirar = alvo ? podeDaView(state, { kind: 'fire', cell: 0 }) : 'Aqui não se atira';
      const ultimo = state.last && state.last.seat === 1 - seat ? state.last.cell : -1;
      lado.casas.forEach((bt, x) => {
        const marca = m.get(x) || '';
        if (bt.dataset.m !== marca) bt.dataset.m = marca;
        bt.classList.toggle('is-ultimo', x === ultimo);
        bt.setAttribute('aria-label', rotuloCasa(x, marca));
        const livre = marca === '' || marca === 'navio';
        C.ligado(bt, alvo && livre ? podeAtirar : (alvo ? 'Você já atirou aí' : 'Aqui não se atira'), '');
      });
      lado.tecl.marcar();
    }

    function update(novo, meta) {
      if (!novo || !Array.isArray(novo.seats) || !Array.isArray(novo.boards)) return;
      state = novo;
      mold.update(state, meta);
      const eu = state.me ? state.me.seat : -1;
      const posicionando = state.phase === 'setup';
      // Quem esta sentado: o proprio mar a esquerda, o do adversario (alvo)
      // a direita. Quem assiste: frota 1 e frota 2.
      const ordem = eu >= 0 ? [eu, 1 - eu] : [0, 1];
      desenharMar(lados[0], state.boards[ordem[0]], ordem[0], false);
      desenharMar(lados[1], state.boards[ordem[1]], ordem[1], eu >= 0 && !posicionando && !state.result);

      acoes.hidden = !posicionando || eu < 0;
      C.ligado(sortear, podeDaView(state, { kind: 'shuffle' }));
      C.ligado(pronto, podeDaView(state, { kind: 'ready' }));
      pronto.classList.toggle('is-feito', eu >= 0 && state.ready[eu] === true);

      if (posicionando) {
        // A moldura destaca "a vez" pela cadeira; posicionando nao ha vez.
        for (const c of mold.topo.querySelectorAll('.mj-cadeira')) c.classList.remove('is-vez');
        b.raiz.classList.remove('is-minha-vez');
      }
      mold.topo.querySelectorAll('.mj-cadeira').forEach((c, i) => c.classList.toggle('is-pronta', posicionando && state.ready[i] === true));
      b.raiz.classList.toggle('is-posicionando', posicionando);

      let st;
      if (posicionando) st = textoPosicionando(state, nomeDe);
      else {
        const base = T.textoStatus(state, api.me(), LABELS, mold.nameOf);
        const ult = textoUltimo(state.last, nomeDe);
        st = ult && !state.result ? `${ult}. ${base}` : base;
      }
      if (mold.status.textContent !== st) mold.status.textContent = st;
      tique();
    }

    // Relogio da vez e o timeout.
    let pedidoPara = null;
    let pedidoEm = 0;
    function tique() {
      const s = state;
      const correndo = s && s.phase === 'play' && !s.result && Number.isFinite(s.deadline) && s.seats[0] !== null && s.seats[1] !== null;
      if (!correndo) {
        relogio.textContent = '';
        relogio.hidden = true;
        return;
      }
      const agora = api.serverNow();
      const falta = Math.max(0, Math.ceil((s.deadline - agora) / 1000));
      relogio.hidden = false;
      const txt = `${falta} s`;
      if (relogio.textContent !== txt) relogio.textContent = txt;
      relogio.classList.toggle('is-pouco', falta <= 10);
      const eu = s.me ? s.me.seat : -1;
      const folga = eu >= 0 && s.turn !== eu ? 0 : FOLGA_OUTROS_MS;
      if (agora >= s.deadline + folga && (pedidoPara !== s.deadline || Date.now() - pedidoEm > REPETE_MS)) {
        pedidoPara = s.deadline;
        pedidoEm = Date.now();
        api.act({ kind: 'timeout' });
      }
    }
    const timer = setInterval(tique, 500);
    b.faxina.push(() => clearInterval(timer));

    return {
      update,
      destroy: b.destruir,
      focus() {
        const alvo = lados[1].alvo ? lados[1] : null;
        if (alvo) alvo.casas[alvo.tecl.atual].focus();
        else mold.topo.querySelector('button:not([hidden])')?.focus();
      },
    };
  }

  // ---------- Registro ----------
  // Igual aos outros tabuleiros: a Vista carrega so `mesa-janelas/<tipo>.js`;
  // o apoio (comum.js, tabuleiro.js) vem daqui, uma vez, da mesma pasta.
  function registrar(api, arquivos) {
    const G = (root.GoLive = root.GoLive || {});
    G.mesaJanelas = G.mesaJanelas || {};
    const GLOBAIS = { 'comum.js': 'mesaJanelasComum', 'tabuleiro.js': 'mesaJanelasTabuleiro' };
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

  const api = { type: TYPE, mount, nomeCasa, marcas, rotuloCasa, textoUltimo, textoPosicionando, podeDaView, LABELS };

  registrar(api, ['comum.js', 'tabuleiro.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
