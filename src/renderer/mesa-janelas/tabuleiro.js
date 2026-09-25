'use strict';
/* global document, setTimeout, clearTimeout, module */

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
      if (r.winner === null || r.winner === undefined) return empate ? empate(r) : 'Empate';
      const perdedor = 1 - r.winner;
      if (r.reason === 'abandono') {
        return perdedor === eu ? 'Você desistiu' : `${nomeCadeira(state, perdedor, labels, nameOf)} desistiu; ${r.winner === eu ? 'você venceu' : `${nomeCadeira(state, r.winner, labels, nameOf)} venceu`}`;
      }
      return r.winner === eu ? 'Você venceu' : `${nomeCadeira(state, r.winner, labels, nameOf)} venceu`;
    }
    const livres = state.seats.filter((s) => s === null).length;
    if (livres === 2) return 'Cadeiras livres: sente-se para jogar';
    if (livres === 1) return eu >= 0 ? 'Esperando alguém sentar na outra cadeira' : 'Uma cadeira livre: sente-se para jogar';
    if (state.turn === eu) return state.check ? 'Sua vez (xeque)' : 'Sua vez';
    return `Vez de ${nomeCadeira(state, state.turn, labels, nameOf)}${state.check ? ' (xeque)' : ''}`;
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
      try { placa.setPointerCapture(e.pointerId); } catch { /* sem captura, segue */ }
    });
    placa.addEventListener('pointermove', (e) => {
      if (!ativo || e.pointerId !== ativo.id) return;
      const dx = e.clientX - ativo.x;
      const dy = e.clientY - ativo.y;
      if (!ativo.movendo && Math.hypot(dx, dy) < 5) return;
      if (!ativo.movendo) {
        ativo.movendo = true;
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

  /** Moldura comum: cadeiras, Nova partida, Desistir e a situacao. */
  function moldura(b, api, opts) {
    const C = root.GoLive.mesaJanelasComum;
    const { el } = C;
    let state = null;
    let confirmando = null;

    const topo = el('div', { class: 'mj-jogo-topo' });
    const placa = el('div', { class: 'mj-jogo-placa' });
    const status = el('p', { class: 'mj-jogo-status', attrs: { role: 'status', 'aria-live': 'polite' } });
    // Onde as recusas aparecem: logo abaixo da situacao, perto do tabuleiro.
    const zona = el('div', { class: 'mj-jogo-rodape' }, status);
    const cadeiras = [0, 1].map((i) => {
      const amostra = el('span', { class: `mj-amostra s${i}`, attrs: { 'aria-hidden': 'true' } });
      if (opts.amostra) opts.amostra(amostra, i);
      const nome = el('span', { class: 'mj-cadeira-nome' });
      const sentar = C.botao({ text: 'Sentar', class: 'mj-cadeira-sentar' });
      const levantar = C.botao({ icone: 'x', class: 'mj-mini mj-fantasma', label: 'Levantar da cadeira' });
      const caixa = el('div', { class: 'mj-cadeira' }, amostra, nome, sentar, levantar);
      b.clique(sentar, zona, () => b.acao(zona, { kind: 'sit', seat: i }));
      b.clique(levantar, zona, () => b.acao(zona, { kind: 'stand' }));
      return { caixa, nome, sentar, levantar };
    });
    const nova = C.botao({ icone: 'zerar', class: 'mj-mini mj-fantasma', label: 'Nova partida' });
    const desistir = opts.desistir ? C.botao({ icone: 'bandeira', class: 'mj-mini mj-fantasma', label: 'Desistir' }) : null;
    topo.append(cadeiras[0].caixa, el('span', { class: 'mj-jogo-x', text: '×', attrs: { 'aria-hidden': 'true' } }), cadeiras[1].caixa, el('span', { class: 'mj-mola' }), nova);
    if (desistir) topo.append(desistir);

    b.raiz.classList.add('mj-jogo');
    b.raiz.append(topo, placa, zona);

    b.clique(nova, zona, () => b.acao(zona, { kind: 'reset' }));
    if (desistir) {
      // Dois toques: o primeiro so pergunta, e desarma sozinho.
      b.clique(desistir, zona, () => {
        if (!confirmando) {
          b.aviso.mostrar('Toque de novo para desistir', zona);
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
      return n === 'Alguém' ? null : n;
    };

    function update(novo) {
      state = novo;
      const me = api.me();
      const eu = minhaCadeira(state, me);
      cadeiras.forEach((cd, i) => {
        const id = state.seats[i];
        const ocupada = id !== null && id !== undefined;
        const txt = ocupada ? (id === me ? 'Você' : nomeCadeira(state, i, opts.labels, nameOf)) : opts.labels[i];
        cd.nome.textContent = txt;
        cd.nome.hidden = !ocupada;
        cd.sentar.hidden = ocupada || eu >= 0;
        cd.sentar.setAttribute('aria-label', `Sentar: ${opts.labels[i]}`);
        cd.levantar.hidden = id !== me || !ocupada;
        cd.caixa.classList.toggle('is-livre', !ocupada);
        cd.caixa.classList.toggle('is-vez', !state.result && ocupada && state.seats[1 - i] !== null && state.turn === i);
        cd.caixa.classList.toggle('is-eu', ocupada && id === me);
        cd.caixa.title = ocupada ? `${opts.labels[i]}: ${txt}` : `${opts.labels[i]}: cadeira livre`;
        const cor = ocupada ? C.corDe(api, id) : null;
        if (cor) cd.caixa.style.setProperty('--mj-cor', cor);
        else cd.caixa.style.removeProperty('--mj-cor');
        if (!ocupada && eu < 0) C.ligado(cd.sentar, C.podeFazer(api, { kind: 'sit', seat: i }), `Sentar: ${opts.labels[i]}`);
      });
      C.ligado(nova, C.podeFazer(api, { kind: 'reset' }), 'Nova partida');
      nova.hidden = C.podeFazer(api, { kind: 'reset' }) !== true;
      if (desistir) {
        desistir.hidden = eu < 0 || !!state.result;
        C.ligado(desistir, C.podeFazer(api, { kind: 'resign' }), 'Desistir');
      }
      const st = textoStatus(state, me, opts.labels, nameOf, opts.empate);
      if (status.textContent !== st) status.textContent = st;
      b.raiz.classList.toggle('is-minha-vez', !state.result && eu >= 0 && state.turn === eu && state.seats[1 - eu] !== null);
      b.raiz.classList.toggle('is-fim', !!state.result);
    }

    return { topo, placa, zona, status, update, nameOf };
  }

  const api = {
    minhaCadeira,
    nomeCadeira,
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
