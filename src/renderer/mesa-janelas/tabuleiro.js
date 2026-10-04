'use strict';

/*
 * Apoio dos tabuleiros da Mesa (velha, lig4, damas, xadrez), em
 * `GoLive.mesaJanelasTabuleiro`. Os quatro tem cadeiras (contrato, secoes 1
 * e 7): a moldura daqui desenha as duas cadeiras com "Sentar", destaca a de
 * quem e a vez, e poe "Nova partida", "Desistir" (quem tiver) e a linha de
 * situacao em `aria-live`.
 *
 * Tambem mora aqui o teclado da grade (setas andam pelas casas, uma casa so
 * no Tab -- "roving tabindex") e o arrastar de peca: o `pointerdown` na
 * placa nao sobe (stopPropagation) e a peca anda por transform, entao
 * arrastar dentro do tabuleiro nunca move a janela nem a mesa.
 */

(function (root) {
  const { t } = root.GoLive.i18n;

  // ---------- Puras ----------

  /** Cadeira da pessoa (0 ou 1), ou -1 se esta assistindo. */
  function minhaCadeira(state, me) {
    if (!state || !Array.isArray(state.seats) || me === null || me === undefined) return -1;
    return state.seats.indexOf(me);
  }

  /** Nome de quem esta na cadeira: o da sala, o guardado ao sentar ou o
   * rotulo da cor. */
  function nomeCadeira(state, i, labels, nameOf) {
    const id = state.seats[i];
    const vivo = id !== null && id !== undefined && nameOf ? nameOf(id) : null;
    return vivo || (state.names && state.names[i]) || labels[i];
  }

  /** A linha de situacao: fim, vez, ou o que falta para comecar.
   * `empate(result)` da o texto do empate de cada jogo. */
  function textoStatus(state, me, labels, nameOf, empate) {
    const eu = minhaCadeira(state, me);
    const r = state.result;
    if (r) {
      if (r.winner === null || r.winner === undefined) return empate ? empate(r) : t('mesa.tabuleiro.empate');
      const perdedor = 1 - r.winner;
      if (r.reason === 'abandono') {
        if (perdedor === eu) return t('mesa.tabuleiro.voceDesistiu');
        const nome = nomeCadeira(state, perdedor, labels, nameOf);
        if (r.winner === eu) return t('mesa.tabuleiro.desistiuVoceVenceu', { nome });
        return t('mesa.tabuleiro.desistiuVenceu', {
          perdedor: nome,
          vencedor: nomeCadeira(state, r.winner, labels, nameOf),
        });
      }
      if (r.winner === eu) return t('mesa.tabuleiro.voceVenceu');
      return t('mesa.tabuleiro.venceu', { nome: nomeCadeira(state, r.winner, labels, nameOf) });
    }
    const livres = state.seats.filter((s) => s === null).length;
    if (livres === 2) return '';
    if (livres === 1) return t(eu >= 0 ? 'mesa.tabuleiro.esperandoOutra' : 'mesa.tabuleiro.cadeiraLivre');
    if (state.turn === eu) return t(state.check ? 'mesa.tabuleiro.suaVezXeque' : 'mesa.jogo.suaVez');
    const nome = nomeCadeira(state, state.turn, labels, nameOf);
    return t(state.check ? 'mesa.tabuleiro.vezDeXeque' : 'mesa.jogo.vezDe', { nome });
  }

  /** O que `api.validate` devolveu, sem traduzir: `true` ou o codigo da recusa. Serve
   * para a janela decidir o que fazer pelo motivo, nao pelo texto. */
  function motivoBruto(api, action) {
    try {
      return api.validate(action);
    } catch {
      return null;
    }
  }

  /** Vista de cima para baixo virada para quem senta na cadeira 1. */
  function virado(state, me) {
    return minhaCadeira(state, me) === 1;
  }

  /** Casa visual (linha, coluna na tela) -> casa do estado. */
  function casaDoEstado(vl, vc, n, virar) {
    return virar ? [n - 1 - vl, n - 1 - vc] : [vl, vc];
  }

  /** Nome de casa como no xadrez: coluna a..h, linha 8..1 de cima para baixo. */
  function nomeCasa(l, c, n) {
    return `${'abcdefgh'[c]}${n - l}`;
  }

  /** Proxima posicao do foco na grade para uma tecla, ou null. */
  function passoGrade(i, tecla, cols, total) {
    const lin = Math.floor(i / cols);
    const col = i % cols;
    const linhas = Math.ceil(total / cols);
    let l = lin;
    let c = col;
    if (tecla === 'ArrowLeft') c--;
    else if (tecla === 'ArrowRight') c++;
    else if (tecla === 'ArrowUp') l--;
    else if (tecla === 'ArrowDown') l++;
    else if (tecla === 'Home') c = 0;
    else if (tecla === 'End') c = cols - 1;
    else return null;
    if (l < 0 || l >= linhas || c < 0 || c >= cols) return i;
    const j = l * cols + c;
    return j < total ? j : i;
  }

  // ---------- DOM ----------

  /** Grade de botoes com um so no Tab e setas para andar. `botoes()` da a
   * lista na ordem da tela. */
  function gradeTeclado(container, botoes, cols) {
    let atual = 0;
    function marcar() {
      const bs = botoes();
      if (atual >= bs.length) atual = 0;
      bs.forEach((b, i) => { b.tabIndex = i === atual ? 0 : -1; });
    }
    container.addEventListener('keydown', (e) => {
      const bs = botoes();
      const i = bs.indexOf(document.activeElement);
      if (i === -1) return;
      const j = passoGrade(i, e.key, cols, bs.length);
      if (j === null) return;
      e.preventDefault();
      atual = j;
      marcar();
      bs[j].focus();
    });
    container.addEventListener('focusin', (e) => {
      const i = botoes().indexOf(e.target);
      if (i !== -1 && i !== atual) {
        atual = i;
        marcar();
      }
    });
    return { marcar, get atual() { return atual; }, set atual(v) { atual = v; marcar(); } };
  }

  /** Arrastar peca dentro da placa. `pegar(casa)` diz se pode (e seleciona),
   * `soltar(origem, destino)` joga. Um arraste de verdade engole o clique
   * que viria depois; um toque sem mexer vira clique normal. */
  function arrastar(placa, opts) {
    let ativo = null; // { casa, peca, x, y, id, movendo }
    let engolirClique = false;

    placa.addEventListener('pointerdown', (e) => {
      // Nada que comeca no tabuleiro sobe para a mesa (nem arrasta janela).
      e.stopPropagation();
      if (e.button !== 0) return;
      const casa = e.target.closest('[data-casa]');
      if (!casa || !placa.contains(casa)) return;
      const peca = casa.querySelector('.mj-peca');
      if (!peca || !opts.podePegar(casa)) return;
      ativo = { casa, peca, x: e.clientX, y: e.clientY, id: e.pointerId, movendo: false };
    });
    placa.addEventListener('pointermove', (e) => {
      if (!ativo || e.pointerId !== ativo.id) return;
      const dx = e.clientX - ativo.x;
      const dy = e.clientY - ativo.y;
      if (!ativo.movendo && Math.hypot(dx, dy) < 5) return;
      if (!ativo.movendo) {
        ativo.movendo = true;
        // A captura so quando o arraste comeca: com ela desde o toque, o
        // clique simples iria para a placa e nao para a casa.
        try { placa.setPointerCapture(e.pointerId); } catch { /* sem captura, segue */ }
        ativo.peca.classList.add('is-arrastando');
        opts.aoPegar(ativo.casa);
      }
      ativo.peca.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    function fim(e, cancelou) {
      if (!ativo || e.pointerId !== ativo.id) return;
      const a = ativo;
      ativo = null;
      a.peca.classList.remove('is-arrastando');
      a.peca.style.transform = '';
      if (!a.movendo) return;
      engolirClique = true;
      setTimeout(() => { engolirClique = false; }, 0);
      if (cancelou) return;
      const alvo = document.elementFromPoint(e.clientX, e.clientY);
      const destino = alvo && alvo.closest('[data-casa]');
      if (destino && placa.contains(destino) && destino !== a.casa) opts.soltar(a.casa, destino);
    }
    placa.addEventListener('pointerup', (e) => fim(e, false));
    placa.addEventListener('pointercancel', (e) => fim(e, true));
    placa.addEventListener('click', (e) => {
      if (engolirClique) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
    // Arrastar nativo de imagem/texto nunca comeca aqui.
    placa.addEventListener('dragstart', (e) => e.preventDefault());
  }

  /** Tabuleiro 8x8 de botoes (damas e xadrez). As casas ficam na ordem da
   * TELA; `dataset.l`/`dataset.c` dizem a casa do estado (muda ao virar).
   * `clique(l, c, botao)` recebe a casa do estado. */
  function grade8(placa, opts) {
    const C = root.GoLive.mesaJanelasComum;
    const { el } = C;
    const N = 8;
    const grade = el('div', { class: 'mj-grade8', attrs: { role: 'grid', 'aria-label': opts.rotulo } });
    placa.append(grade);
    let virar = false;
    const casas = [];
    for (let vl = 0; vl < N; vl++) {
      for (let vc = 0; vc < N; vc++) {
        const bt = el('button', { class: `mj-casa ${(vl + vc) % 2 ? 'is-b' : 'is-a'}`, attrs: { type: 'button', 'data-casa': '' } });
        bt.addEventListener('click', () => opts.clique(Number(bt.dataset.l), Number(bt.dataset.c), bt));
        grade.append(bt);
        casas.push(bt);
      }
    }
    function posicionar() {
      casas.forEach((bt, i) => {
        const [l, c] = casaDoEstado(Math.floor(i / N), i % N, N, virar);
        bt.dataset.l = String(l);
        bt.dataset.c = String(c);
      });
    }
    posicionar();
    const tecl = gradeTeclado(grade, () => casas, N);
    return {
      grade,
      casas,
      tecl,
      virar(v) {
        if (v === virar) return;
        virar = v;
        grade.classList.toggle('is-virado', v);
        posicionar();
      },
      /** Botao da casa do estado (l, c). */
      em(l, c) {
        const [vl, vc] = casaDoEstado(l, c, N, virar); // a mesma troca desfaz
        return casas[vl * N + vc];
      },
    };
  }

  /** Moldura comum: cadeiras, Nova partida, Desistir e a situacao.
   * `opts.pode(action)` (opcional) troca o `validate` da api na hora de
   * ligar os botoes -- o jogo secret usa o `me` da view. */
  function moldura(b, api, opts) {
    const C = root.GoLive.mesaJanelasComum;
    const { el } = C;
    let state = null;
    let confirmando = null;
    // Jogo secret (contrato, secao 8): o `validate` da api diz sempre sim, e
    // quem liga e desliga os botoes e o `me` que veio na view do servidor.
    const pode = typeof opts.pode === 'function' ? opts.pode : (action) => C.podeFazer(api, action);
    // Os rotulos das cores podem vir de uma funcao: o idioma pode mudar com a janela aberta.
    const rotulosDe = () => (typeof opts.labels === 'function' ? opts.labels() : opts.labels);

    const topo = el('div', { class: 'mj-jogo-topo' });
    const placa = el('div', { class: 'mj-jogo-placa' });
    const status = el('p', { class: 'mj-jogo-status', attrs: { role: 'status', 'aria-live': 'polite' } });
    // Onde as recusas aparecem: logo abaixo da situacao, perto do tabuleiro.
    const zona = el('div', { class: 'mj-jogo-rodape' }, status);
    const cadeiras = C.cadeiras({
      rotulo: t('mesa.tabuleiro.cadeiras'),
      aoSentar(i) { b.acao(zona, { kind: 'sit', seat: i }); },
      aoLevantar() { b.acao(zona, { kind: 'stand' }); },
      aoRecusar(motivo) { b.aviso.mostrar(motivo, zona); },
    });
    const nova = C.botao({ icone: 'zerar', class: 'mj-mini mj-fantasma', label: t('mesa.tabuleiro.novaPartida') });
    const desistir = opts.desistir ? C.botao({ icone: 'bandeira', class: 'mj-mini mj-fantasma', label: t('mesa.tabuleiro.desistir') }) : null;
    topo.append(cadeiras.node, nova);
    if (desistir) topo.append(desistir);

    b.raiz.classList.add('mj-jogo');
    b.raiz.append(topo, placa, zona);

    b.clique(nova, zona, () => b.acao(zona, { kind: 'reset' }));
    if (desistir) {
      // Dois toques: o primeiro so pergunta, e desarma sozinho.
      b.clique(desistir, zona, () => {
        if (!confirmando) {
          b.aviso.mostrar(t('mesa.tabuleiro.toqueDeNovo'), zona);
          desistir.classList.add('is-confirmando');
          confirmando = setTimeout(() => {
            confirmando = null;
            desistir.classList.remove('is-confirmando');
          }, 3000);
          return;
        }
        clearTimeout(confirmando);
        confirmando = null;
        desistir.classList.remove('is-confirmando');
        b.acao(zona, { kind: 'resign' });
      });
      b.faxina.push(() => { if (confirmando) clearTimeout(confirmando); });
    }

    const nameOf = (id) => {
      const n = C.nomeDe(api, id);
      // `nomeDe` devolve o mesmo marcador para quem nao tem nome (id nulo).
      return n === C.nomeDe(api, null) ? null : n;
    };

    function update(novo) {
      state = novo;
      const me = api.me();
      const eu = minhaCadeira(state, me);
      const labels = rotulosDe();
      const lugares = [0, 1].map((i) => {
        const id = state.seats[i];
        const ocupada = id !== null && id !== undefined;
        const txt = ocupada ? (id === me ? t('mesa.tabuleiro.voce') : nomeCadeira(state, i, labels, nameOf)) : labels[i];
        return {
          peer: ocupada ? id : null,
          nome: txt,
          cor: ocupada ? C.corDe(api, id) : null,
          peca: opts.peca ? opts.peca(i) : null,
          vez: !state.result && ocupada && state.seats[1 - i] !== null && state.turn === i,
          eu: ocupada && id === me,
          motivoSentar: eu < 0 ? pode({ kind: 'sit', seat: i }) : t('mesa.jogo.jaEstaSentado'),
          motivoLevantar: id === me ? pode({ kind: 'stand' }) : t('mesa.tabuleiro.cadeiraDeOutra'),
        };
      });
      cadeiras.sync(lugares);
      cadeiras.node.querySelectorAll('.mj-cadeira-botao').forEach((botaoLugar, i) => {
        const ocupada = lugares[i].peer !== null;
        let rotulo = t('mesa.tabuleiro.sentarCor', { cor: labels[i] });
        if (ocupada) {
          rotulo = lugares[i].eu
            ? t('mesa.tabuleiro.levantarDaCadeira')
            : t('mesa.tabuleiro.cadeiraDe', { cor: labels[i], nome: lugares[i].nome });
        }
        botaoLugar.setAttribute('aria-label', rotulo);
      });
      C.ligado(nova, pode({ kind: 'reset' }), t('mesa.tabuleiro.novaPartida'));
      nova.hidden = pode({ kind: 'reset' }) !== true;
      if (desistir) {
        desistir.hidden = eu < 0 || !!state.result;
        C.ligado(desistir, pode({ kind: 'resign' }), t('mesa.tabuleiro.desistir'));
      }
      const st = textoStatus(state, me, labels, nameOf, opts.empate);
      if (status.textContent !== st) status.textContent = st;
      b.raiz.classList.toggle('is-minha-vez', !state.result && eu >= 0 && state.turn === eu && state.seats[1 - eu] !== null);
      b.raiz.classList.toggle('is-fim', !!state.result);
    }

    return { topo, placa, zona, status, cadeiras, update, nameOf };
  }

  const api = {
    minhaCadeira,
    nomeCadeira,
    motivoBruto,
    textoStatus,
    virado,
    casaDoEstado,
    nomeCasa,
    passoGrade,
    gradeTeclado,
    arrastar,
    grade8,
    moldura,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaJanelasTabuleiro = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
