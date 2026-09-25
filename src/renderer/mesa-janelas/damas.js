'use strict';

/*
 * Conteudo da janela "Damas" (contrato da Mesa, secoes 6 e 7), regra
 * brasileira do modulo `mesa-modules/damas.js`. `legalMoves(state)` diz o
 * que pode agora: as pecas que mexem ganham um anel, e a peca escolhida
 * mostra os destinos (e as pecas que cairiam, se for captura).
 *
 * Jogar: clicar na peca e no destino, arrastar a peca (o arraste fica
 * dentro do tabuleiro, nunca move a janela), ou pelo teclado: setas andam,
 * Enter escolhe e joga, Esc desiste da escolha. Quem senta nas escuras ve
 * o tabuleiro virado, com as proprias pecas embaixo.
 */

(function (root) {
  const TYPE = 'damas';
  const LABELS = ['Claras', 'Escuras'];
  const N = 8;

  function mod() {
    return root.GoLive.mesaModules[TYPE];
  }

  const chave = (l, c) => `${l},${c}`;

  // ---------- Puras ----------

  /** Casas de onde sai algum lance (as pecas que podem mexer). */
  function pecasQueMexem(lances) {
    return new Set(lances.map((mv) => chave(mv.path[0][0], mv.path[0][1])));
  }

  /** Destinos da peca em (l, c): chave da casa final -> lance. Dois lances
   * que terminam na mesma casa (caminhos diferentes) ficam com o que
   * captura mais; empate, o primeiro. */
  function destinos(lances, l, c) {
    const out = new Map();
    for (const mv of lances) {
      if (mv.path[0][0] !== l || mv.path[0][1] !== c) continue;
      const fim = mv.path[mv.path.length - 1];
      const k = chave(fim[0], fim[1]);
      const ja = out.get(k);
      if (!ja || mv.captures.length > ja.captures.length) out.set(k, mv);
    }
    return out;
  }

  function nomePeca(ch) {
    switch (ch) {
      case 'c': return 'pedra clara';
      case 'C': return 'dama clara';
      case 'e': return 'pedra escura';
      case 'E': return 'dama escura';
      default: return 'vazia';
    }
  }

  function empate(r) {
    return r && r.reason === 'damas' ? 'Empate: 20 lances só de damas' : 'Empate';
  }

  // ---------- DOM ----------

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const T = root.GoLive.mesaJanelasTabuleiro;
    const m = mod();
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;
    let lances = [];
    let posso = false;
    let sel = null; // [l, c] da peca escolhida

    const mold = T.moldura(b, api, { labels: LABELS, empate, desistir: true });
    const g = T.grade8(mold.placa, {
      rotulo: 'Tabuleiro de damas',
      clique(l, c) { tocar(l, c); },
    });
    const pecas = g.casas.map((bt) => {
      const p = el('span', { class: 'mj-peca', attrs: { 'aria-hidden': 'true' } });
      bt.append(p);
      return p;
    });

    function jogar(mv) {
      sel = null;
      b.acao(mold.zona, { kind: 'move', path: mv.path });
      pintar();
    }

    function tocar(l, c) {
      if (!state) return;
      if (sel) {
        const mv = destinos(lances, sel[0], sel[1]).get(chave(l, c));
        if (mv) return jogar(mv);
      }
      if (posso && pecasQueMexem(lances).has(chave(l, c))) {
        sel = sel && sel[0] === l && sel[1] === c ? null : [l, c];
      } else if (sel) {
        sel = null;
      } else {
        // Clique que nao faz nada: diz por que (vez, cadeira, captura).
        const ch = state.board[l][c];
        const eu = T.minhaCadeira(state, api.me());
        const minha = eu === 0 ? /[cC]/ : eu === 1 ? /[eE]/ : null;
        const motivo = C.podeFazer(api, { kind: 'move', path: [[l, c], [l, c]] });
        const minhaPeca = !!minha && minha.test(ch);
        if (motivo === 'Lance inválido') {
          if (minhaPeca) b.aviso.mostrar('Essa peça não tem lance', mold.zona);
        } else if (/^Captura/.test(motivo)) {
          if (minhaPeca) b.aviso.mostrar(motivo, mold.zona);
        } else if (motivo !== true) {
          b.aviso.mostrar(motivo, mold.zona);
        }
      }
      pintar();
    }

    T.arrastar(mold.placa, {
      podePegar(casa) {
        return posso && pecasQueMexem(lances).has(chave(Number(casa.dataset.l), Number(casa.dataset.c)));
      },
      aoPegar(casa) {
        sel = [Number(casa.dataset.l), Number(casa.dataset.c)];
        pintar();
      },
      soltar(origem, destino) {
        const mv = destinos(lances, Number(origem.dataset.l), Number(origem.dataset.c)).get(chave(Number(destino.dataset.l), Number(destino.dataset.c)));
        if (mv) jogar(mv);
      },
    });
    mold.placa.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sel) {
        e.stopPropagation();
        sel = null;
        pintar();
      }
    });

    function pintar() {
      const mexem = posso ? pecasQueMexem(lances) : new Set();
      const dest = sel ? destinos(lances, sel[0], sel[1]) : new Map();
      const caem = new Set();
      for (const mv of dest.values()) for (const [l, c] of mv.captures) caem.add(chave(l, c));
      const ultimo = new Set(state.last ? state.last.path.map(([l, c]) => chave(l, c)) : []);
      g.casas.forEach((bt, i) => {
        const l = Number(bt.dataset.l);
        const c = Number(bt.dataset.c);
        const ch = state.board[l][c];
        const k = chave(l, c);
        const p = pecas[i];
        p.className = `mj-peca${ch === '.' ? '' : ` is-${ch === 'c' || ch === 'C' ? 'clara' : 'escura'}`}${ch === 'C' || ch === 'E' ? ' is-dama' : ''}`;
        bt.classList.toggle('is-mexe', mexem.has(k) && !sel);
        bt.classList.toggle('is-sel', !!sel && sel[0] === l && sel[1] === c);
        bt.classList.toggle('is-destino', dest.has(k));
        bt.classList.toggle('is-tem-peca', ch !== '.');
        bt.classList.toggle('is-cai', caem.has(k));
        bt.classList.toggle('is-ultimo', ultimo.has(k));
        let rot = `${T.nomeCasa(l, c, N)}: ${nomePeca(ch)}`;
        if (dest.has(k)) rot += dest.get(k).captures.length ? ', destino com captura' : ', destino';
        else if (mexem.has(k)) rot += ', pode mexer';
        bt.setAttribute('aria-label', rot);
        bt.setAttribute('aria-selected', String(!!sel && sel[0] === l && sel[1] === c));
      });
      g.tecl.marcar();
    }

    function update(novo, meta) {
      state = novo;
      mold.update(state, meta);
      g.virar(T.virado(state, api.me()));
      lances = m.legalMoves(state);
      const eu = T.minhaCadeira(state, api.me());
      posso = eu >= 0 && lances.length > 0 && C.podeFazer(api, { kind: 'move', path: lances[0].path }) === true;
      // A escolha so vale enquanto ainda tem lance dali.
      if (sel && (!posso || !pecasQueMexem(lances).has(chave(sel[0], sel[1])))) sel = null;
      b.raiz.classList.toggle('is-posso', posso);
      pintar();
    }

    return { update, destroy: b.destruir, focus() { g.casas[g.tecl.atual].focus(); } };
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

  const api = { type: TYPE, mount, pecasQueMexem, destinos, nomePeca, empate, LABELS };

  registrar(api, ['comum.js', 'tabuleiro.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
