'use strict';

/*
 * Conteudo da janela "Xadrez" (contrato da Mesa, secoes 6 e 7). A regra e
 * a do chess.js (GoLive.chessjs, via o modulo `mesa-modules/xadrez.js`); a
 * interface le a posicao do `fen` e pergunta ao chess.js para onde a peca
 * escolhida pode ir, para marcar as casas.
 *
 * Jogar: clicar na peca e no destino, arrastar (dentro do tabuleiro), ou
 * teclado: setas, Enter escolhe e joga, Esc desiste. Peao na ultima
 * fileira abre a escolha da promocao (Dama, Torre, Bispo, Cavalo). Quem
 * joga de pretas ve o tabuleiro virado.
 */

(function (root) {
  const { t } = root.GoLive.i18n;
  const TYPE = 'xadrez';
  const rotulos = () => [t('mesa.xadrez.brancas'), t('mesa.xadrez.pretas')];
  const N = 8;
  const GLIFOS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  // Chave do nome de cada peca e o genero, que decide a cor ("rei branco", "dama branca").
  const NOMES = {
    k: ['mesa.xadrez.peca.rei', 'm'],
    q: ['mesa.xadrez.peca.dama', 'f'],
    r: ['mesa.xadrez.peca.torre', 'f'],
    b: ['mesa.xadrez.peca.bispo', 'm'],
    n: ['mesa.xadrez.peca.cavalo', 'm'],
    p: ['mesa.xadrez.peca.peao', 'm'],
  };
  const PECA_COR = {
    wm: 'mesa.xadrez.pecaBrancaM', wf: 'mesa.xadrez.pecaBrancaF',
    bm: 'mesa.xadrez.pecaPretaM', bf: 'mesa.xadrez.pecaPretaF',
  };
  const PROMOCOES = [
    ['q', 'mesa.xadrez.promocao.dama'], ['r', 'mesa.xadrez.promocao.torre'],
    ['b', 'mesa.xadrez.promocao.bispo'], ['n', 'mesa.xadrez.promocao.cavalo'],
  ];

  function chessjs() {
    return root.GoLive.chessjs;
  }

  // ---------- Puras ----------

  /** "peão branco", "dama preta". */
  function nomePeca(p) {
    if (!p) return t('mesa.tabuleiro.casaVazia');
    const [chave, genero] = NOMES[p.type];
    return t(PECA_COR[p.color + genero], { peca: t(chave) });
  }

  /** O glifo cheio com o seletor de texto (nao vira emoji colorido). */
  function glifo(p) {
    return p ? `${GLIFOS[p.type]}︎` : '';
  }

  /** Para onde a peca em `casa` pode ir: casa -> { promocao } */
  function alvos(fen, casa) {
    const Chess = chessjs().Chess;
    const out = new Map();
    for (const mv of new Chess(fen).moves({ square: casa, verbose: true })) {
      const ja = out.get(mv.to);
      out.set(mv.to, { promocao: !!(mv.promotion || (ja && ja.promocao)), captura: !!mv.captured });
    }
    return out;
  }

  /** Cor de quem esta na cadeira. */
  function corDaCadeira(seat) {
    return seat === 0 ? 'w' : seat === 1 ? 'b' : null;
  }

  function empate(r) {
    const chaves = {
      afogamento: 'mesa.xadrez.empateAfogamento',
      material: 'mesa.xadrez.empateMaterial',
      repeticao: 'mesa.xadrez.empateRepeticao',
      cinquenta: 'mesa.xadrez.empateCinquenta',
    };
    return t((r && chaves[r.reason]) || 'mesa.tabuleiro.empate');
  }

  function atualizarBarra(api, texto, vez) {
    api.setStatus?.(texto);
    api.setTurn?.(vez);
  }

  // ---------- DOM ----------

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const T = root.GoLive.mesaJanelasTabuleiro;
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;
    let tab = null; // chess.board(): [linha 0 = fileira 8][coluna a..h]
    let minhaCor = null;
    let posso = false;
    let sel = null; // 'e2'
    let alvosSel = new Map();
    let promo = null; // { from, to } esperando a escolha

    const mold = T.moldura(b, api, {
      labels: rotulos,
      empate,
      desistir: true,
      peca() { return { texto: '♚' }; },
      amostra(a, i) { a.textContent = `${GLIFOS.k}︎`; a.classList.add(i === 0 ? 'is-branca' : 'is-preta'); },
    });
    const g = T.grade8(mold.placa, { rotulo: t('mesa.xadrez.tabuleiro'), clique(l, c) { tocar(T.nomeCasa(l, c, N)); } });
    const pecas = g.casas.map((bt) => {
      const p = el('span', { class: 'mj-peca', attrs: { 'aria-hidden': 'true' } });
      bt.append(p);
      return p;
    });

    // Escolha da promocao: quatro botoes por cima do tabuleiro.
    const promoCaixa = el('div', { class: 'mj-xadrez-promo', attrs: { role: 'group', 'aria-label': t('mesa.xadrez.promoverA') } });
    const promoBotoes = PROMOCOES.map(([tipo, chave]) => {
      const bt = C.botao({ text: t(chave), class: 'mj-seg' });
      bt.prepend(el('span', { class: 'mj-xadrez-promo-g', text: `${GLIFOS[tipo]}︎`, attrs: { 'aria-hidden': 'true' } }));
      bt.addEventListener('click', () => {
        const p = promo;
        fecharPromo();
        if (p) jogar(p.from, p.to, tipo);
      });
      promoCaixa.append(bt);
      return bt;
    });
    const promoCancelar = C.botao({ icone: 'x', class: 'mj-ic mj-fantasma', label: t('mesa.xadrez.cancelarPromocao') });
    promoCancelar.addEventListener('click', () => { fecharPromo(); pintar(); });
    promoCaixa.append(promoCancelar);
    promoCaixa.hidden = true;
    mold.placa.append(promoCaixa);
    promoCaixa.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); fecharPromo(); pintar(); }
    });

    function abrirPromo(from, to) {
      promo = { from, to };
      promoCaixa.hidden = false;
      promoCaixa.classList.toggle('is-preta', minhaCor === 'b');
      promoBotoes[0].focus();
    }
    function fecharPromo() {
      const voltar = promo && promoCaixa.contains(root.document.activeElement) ? promo.to : null;
      promo = null;
      promoCaixa.hidden = true;
      if (voltar) casaBotao(voltar).focus();
    }

    function casaBotao(nome) {
      const c = 'abcdefgh'.indexOf(nome[0]);
      const l = N - Number(nome[1]);
      return g.em(l, c);
    }
    function pecaEm(nome) {
      const c = 'abcdefgh'.indexOf(nome[0]);
      const l = N - Number(nome[1]);
      return tab[l][c];
    }

    function jogar(from, to, promotion) {
      sel = null;
      alvosSel = new Map();
      const a = { kind: 'move', from, to };
      if (promotion) a.promotion = promotion;
      b.acao(mold.zona, a);
      pintar();
    }

    function podeMexer(nome) {
      const p = pecaEm(nome);
      return posso && !!p && p.color === minhaCor;
    }

    function escolher(nome) {
      sel = nome;
      alvosSel = alvos(state.fen, nome);
    }

    function tocar(nome) {
      if (!state || promo) return;
      if (sel && alvosSel.has(nome)) {
        if (alvosSel.get(nome).promocao) return abrirPromo(sel, nome);
        return jogar(sel, nome);
      }
      if (podeMexer(nome)) {
        if (sel === nome) {
          sel = null;
          alvosSel = new Map();
        } else {
          escolher(nome);
          if (!alvosSel.size) b.aviso.mostrar(t('mesa.tabuleiro.pecaSemLance'), mold.zona);
        }
      } else if (sel) {
        sel = null;
        alvosSel = new Map();
      } else {
        const tentativa = { kind: 'move', from: nome, to: nome };
        const motivo = C.podeFazer(api, tentativa);
        const bruto = T.motivoBruto(api, tentativa);
        const invalido = typeof bruto === 'string' && /Inv[aá]lid[ao]$/.test(bruto);
        if (motivo !== true && !invalido) b.aviso.mostrar(motivo, mold.zona);
      }
      pintar();
    }

    T.arrastar(mold.placa, {
      podePegar(casa) { return !promo && podeMexer(T.nomeCasa(Number(casa.dataset.l), Number(casa.dataset.c), N)); },
      aoPegar(casa) {
        escolher(T.nomeCasa(Number(casa.dataset.l), Number(casa.dataset.c), N));
        pintar();
      },
      soltar(origem, destino) {
        const from = T.nomeCasa(Number(origem.dataset.l), Number(origem.dataset.c), N);
        const to = T.nomeCasa(Number(destino.dataset.l), Number(destino.dataset.c), N);
        const alvo = alvos(state.fen, from).get(to);
        if (!alvo) return;
        if (alvo.promocao) abrirPromo(from, to);
        else jogar(from, to);
      },
    });
    mold.placa.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sel && !promo) {
        e.stopPropagation();
        sel = null;
        alvosSel = new Map();
        pintar();
      }
    });

    function pintar() {
      const ultimo = state.last ? new Set([state.last.from, state.last.to]) : new Set();
      const vez = state.turn === 0 ? 'w' : 'b';
      g.casas.forEach((bt, i) => {
        const l = Number(bt.dataset.l);
        const c = Number(bt.dataset.c);
        const nome = T.nomeCasa(l, c, N);
        const p = tab[l][c];
        const el2 = pecas[i];
        const g2 = glifo(p);
        if (el2.textContent !== g2) el2.textContent = g2;
        el2.className = `mj-peca${p ? (p.color === 'w' ? ' is-branca' : ' is-preta') : ''}`;
        const alvo = alvosSel.get(nome);
        bt.classList.toggle('is-sel', sel === nome);
        bt.classList.toggle('is-destino', !!alvo);
        bt.classList.toggle('is-tem-peca', !!p);
        bt.classList.toggle('is-ultimo', ultimo.has(nome));
        bt.classList.toggle('is-xeque', !!state.check && !!p && p.type === 'k' && p.color === vez);
        bt.classList.toggle('is-mexe', podeMexer(nome));
        const casa = { casa: nome, peca: nomePeca(p) };
        let rot = t('mesa.tabuleiro.casaPeca', casa);
        if (alvo) rot = t(alvo.captura ? 'mesa.tabuleiro.casaDestinoCaptura' : 'mesa.tabuleiro.casaDestino', casa);
        bt.setAttribute('aria-label', rot);
        bt.setAttribute('aria-selected', String(sel === nome));
      });
      g.tecl.marcar();
    }

    function update(novo, meta) {
      state = novo;
      mold.update(state, meta);
      atualizarBarra(api, mold.status.textContent, state.turn === api.me() && !state.result);
      const eu = T.minhaCadeira(state, api.me());
      g.virar(eu === 1);
      minhaCor = corDaCadeira(eu);
      tab = new (chessjs().Chess)(state.fen).board();
      const regra = root.GoLive.mesaModules && root.GoLive.mesaModules.xadrez;
      posso = eu >= 0 && !!regra && regra.canPlay(state, api.me()) === true;
      if (sel && !podeMexer(sel)) {
        sel = null;
        alvosSel = new Map();
      } else if (sel) {
        alvosSel = alvos(state.fen, sel);
      }
      if (promo && !posso) fecharPromo();
      b.raiz.classList.toggle('is-posso', posso);
      pintar();
    }

    return {
      update,
      destroy() { atualizarBarra(api, '', false); b.destruir(); },
      focus() { g.casas[g.tecl.atual].focus(); },
    };
  }

  // ---------- Registro ----------
  // A Vista carrega so `mesa-janelas/<tipo>.js` (contrato, secao 6); o
  // apoio (comum.js, tabuleiro.js) vem daqui, uma vez, da mesma pasta. O
  // registro e imediato: se o apoio ainda nao chegou, a janela monta vazia,
  // guarda o ultimo `update` e so desenha quando ele chegar.
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

  const api = { type: TYPE, mount, nomePeca, glifo, alvos, corDaCadeira, empate, atualizarBarra, rotulos };

  registrar(api, ['comum.js', 'tabuleiro.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
