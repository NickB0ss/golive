'use strict';
/* global setTimeout, clearTimeout, module */

/*
 * Conteudo da janela "Roleta" (contrato da Mesa, secao 6). Tudo que decide
 * onde a roleta para vem do servidor na acao `spin`; `spinAngle` do modulo
 * da o angulo final e aqui so se anima ate la, por `transform` (rotate) no
 * disco. O ponteiro fica no topo. Quando o disco para, o resultado entra no
 * `aria-live` e a fatia sorteada ganha o contorno.
 *
 * Quem chega depois do giro (ou prefere menos movimento) ve o disco ja
 * parado no lugar, sem a animacao.
 */

(function (root) {
  const TYPE = 'roleta';
  const GIRO_MS = 4200;
  const R = 96; // raio no viewBox -100..100
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function mod() {
    return root.GoLive.mesaModules[TYPE];
  }

  // ---------- Puras ----------

  /** Ponto no aro, `graus` no sentido horario a partir do topo. */
  function pontoEm(r, graus) {
    const rad = (graus * Math.PI) / 180;
    // `+ 0` tira o -0 (cos de 90 graus nao e zero exato).
    return [Math.round(r * Math.sin(rad) * 1000) / 1000 + 0, Math.round(-r * Math.cos(rad) * 1000) / 1000 + 0];
  }

  /** Geometria das fatias: a fatia 0 comeca no topo (o mesmo referencial
   * do `spinAngle`). `tom` alterna tres superficies sem repetir vizinhas. */
  function fatias(n) {
    if (n <= 0) return [];
    const s = 360 / n;
    return Array.from({ length: n }, (_, i) => {
      const a0 = i * s;
      const a1 = (i + 1) * s;
      const [x0, y0] = pontoEm(R, a0);
      const [x1, y1] = pontoEm(R, a1);
      const grande = s > 180 ? 1 : 0;
      const path = n === 1
        ? `M0,${-R} A${R},${R} 0 1 1 0,${R} A${R},${R} 0 1 1 0,${-R} Z`
        : `M0,0 L${x0},${y0} A${R},${R} 0 ${grande} 1 ${x1},${y1} Z`;
      let tom = i % 3;
      if (i === n - 1 && n > 1 && tom === 0) tom = 1; // a ultima encosta na primeira
      return { i, a0, a1, mid: a0 + s / 2, path, tom };
    });
  }

  /** Texto de fatia curto o bastante para caber no raio. */
  function rotuloFatia(texto, n) {
    const max = n <= 4 ? 14 : n <= 8 ? 11 : 8;
    return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
  }

  /** Transform do texto: ao longo do raio, sem ficar de cabeca para baixo. */
  function transformRotulo(mid) {
    const esquerda = mid > 180;
    return esquerda
      ? `rotate(${round(mid + 90)}) translate(${-R * 0.6} 0)`
      : `rotate(${round(mid - 90)}) translate(${R * 0.6} 0)`;
  }

  function round(v) {
    return Math.round(v * 1000) / 1000;
  }

  /** "Deu Pizza" -- o resultado do giro que esta no estado. */
  function resultado(state) {
    if (!state.spin) return state.last !== null ? `Da última vez: ${state.last}` : '';
    return `Deu ${state.options[state.spin.index]}`;
  }

  /** Anima este giro? So se e novo para mim e ainda esta dentro do tempo. */
  function precisaAnimar(spin, agora, dur) {
    if (!spin) return false;
    if (typeof spin.at !== 'number' || typeof agora !== 'number') return true;
    return agora - spin.at < dur;
  }

  // ---------- DOM ----------

  function svg(tag, attrs) {
    const n = root.document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    return n;
  }

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const m = mod();
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;
    let giroVisto = null; // spin.n ja mostrado
    let rodando = false;
    let timer = null;
    let chaveDisco = '';
    let abertoPorMim = null; // o painel de opcoes: null = automatico

    // Disco.
    const disco = el('div', { class: 'mj-rol-disco' });
    const desenho = svg('svg', { viewBox: '-100 -100 200 200', class: 'mj-rol-svg', 'aria-hidden': 'true' });
    disco.append(desenho);
    const ponteiro = el('div', { class: 'mj-rol-ponteiro', attrs: { 'aria-hidden': 'true' } });
    const roda = el('div', { class: 'mj-rol-roda' }, disco, ponteiro);
    const saida = el('p', { class: 'mj-rol-saida', attrs: { role: 'status', 'aria-live': 'polite' } });
    const quem = el('span', { class: 'mj-dados-quem mj-rol-quem' });
    const girar = C.botao({ icone: 'zerar', text: 'Girar', class: 'mj-pri' });
    const alternar = C.botao({ text: 'Opções', class: 'mj-fantasma mj-rol-alternar', attrs: { 'aria-expanded': 'false' } });
    const ctrl = el('div', { class: 'mj-barra mj-rol-ctrl' }, alternar, el('span', { class: 'mj-mola' }), girar);
    const lado = el('div', { class: 'mj-rol-lado' }, roda, el('div', { class: 'mj-rol-res' }, saida, quem), ctrl);

    // Opcoes.
    const painel = el('section', { class: 'mj-rol-painel', attrs: { 'aria-label': 'Opções da roleta' } });
    const listaOp = el('ol', { class: 'mj-rol-lista mj-rola' });
    const campoNova = el('input', {
      class: 'mj-campo',
      attrs: { type: 'text', maxlength: String(m.MAX_TEXT), placeholder: 'Nova opção', 'aria-label': 'Nova opção', spellcheck: 'false' },
    });
    const addBtn = C.botao({ icone: 'mais', class: 'mj-ic', label: 'Adicionar opção' });
    const form = el('form', { class: 'mj-form' }, campoNova, addBtn);
    const dicaPainel = el('p', { class: 'mj-dica' });
    painel.append(el('p', { class: 'mj-rotulo', text: 'Opções' }), form, listaOp, dicaPainel);

    b.raiz.append(lado, painel);

    b.clique(girar, ctrl, () => b.acao(ctrl, { kind: 'spin' }));
    alternar.addEventListener('click', () => {
      abertoPorMim = painel.hidden;
      pintarPainel();
      if (!painel.hidden) campoNova.focus();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!campoNova.value.trim()) return;
      if (b.acao(form, { kind: 'add', text: campoNova.value })) campoNova.value = '';
    });
    b.clique(addBtn, form, () => form.requestSubmit());
    b.faxina.push(() => { if (timer) clearTimeout(timer); });

    const linhas = []; // { li, input, campo, x }

    function criarLinha(i) {
      const input = el('input', { class: 'mj-campo', attrs: { type: 'text', maxlength: String(m.MAX_TEXT), spellcheck: 'false' } });
      const x = C.botao({ icone: 'x', class: 'mj-ic mj-fantasma' });
      const li = el('li', { class: 'mj-form' }, input, x);
      const linha = { li, input, x, i };
      linha.campo = C.campoLocal(input, { confirmar: (v) => b.acao(li, { kind: 'edit', index: linha.i, text: v }) });
      b.clique(x, li, () => b.acao(li, { kind: 'remove', index: linha.i }));
      return linha;
    }

    function desenharLista() {
      const ops = state.options;
      while (linhas.length < ops.length) {
        const l = criarLinha(linhas.length);
        linhas.push(l);
        listaOp.append(l.li);
      }
      while (linhas.length > ops.length) linhas.pop().li.remove();
      ops.forEach((o, i) => {
        const l = linhas[i];
        l.campo.sync(o);
        l.input.setAttribute('aria-label', `Opção ${i + 1}`);
        l.x.setAttribute('aria-label', `Tirar ${o}`);
        C.ligado(l.x, true, `Tirar ${o}`);
      });
      C.ligado(addBtn, C.podeFazer(api, { kind: 'add', text: 'x' }), 'Adicionar opção');
      alternar.replaceChildren(el('span', { text: `Opções (${ops.length})` }));
      const faltam = m.MIN_SPIN_OPTIONS - ops.length;
      dicaPainel.textContent = faltam > 0 ? `Ponha pelo menos ${m.MIN_SPIN_OPTIONS} opções para girar.` : '';
      dicaPainel.hidden = faltam <= 0;
    }

    function desenharDisco() {
      const chave = JSON.stringify(state.options);
      if (chave === chaveDisco) return;
      chaveDisco = chave;
      const n = state.options.length;
      desenho.replaceChildren();
      desenho.append(svg('circle', { r: String(R + 3), class: 'mj-rol-aro' }));
      for (const f of fatias(n)) {
        const g = svg('g', { class: `mj-rol-fatia t${f.tom}`, 'data-i': String(f.i) });
        g.append(svg('path', { d: f.path }));
        const t = svg('text', { transform: transformRotulo(f.mid), 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        t.textContent = rotuloFatia(state.options[f.i], n);
        g.append(t);
        desenho.append(g);
      }
      if (n === 0) {
        const t = svg('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'mj-rol-vazio' });
        t.textContent = 'Sem opções';
        desenho.append(t);
      }
      desenho.append(svg('circle', { r: '9', class: 'mj-rol-eixo' }));
    }

    function pintarQuem() {
      quem.replaceChildren();
      if (!state.spin || state.spin.by === null || rodando) return;
      quem.append(C.bolinha(C.corDe(api, state.spin.by)), el('span', { text: `${C.nomeDe(api, state.spin.by)} girou` }));
    }

    function marcarSorteada(i) {
      for (const g of desenho.querySelectorAll('.mj-rol-fatia')) g.classList.toggle('is-sorteada', Number(g.dataset.i) === i);
    }

    function pararEm(angulo) {
      disco.style.transition = 'none';
      disco.style.transform = `rotate(${angulo}deg)`;
    }

    function terminarGiro() {
      timer = null;
      rodando = false;
      b.raiz.classList.remove('is-girando');
      if (!state.spin) return;
      marcarSorteada(state.spin.index);
      saida.textContent = resultado(state);
      pintarQuem();
      pintarBotao();
    }

    function animarGiro() {
      const n = state.options.length;
      const alvo = m.spinAngle(state.spin, n);
      // Parte de onde o disco esta (so a fracao da volta), para girar
      // sempre para a frente: o alvo tem pelo menos 3 voltas.
      const atual = anguloAtual() % 360;
      pararEm(atual);
      void disco.offsetWidth; // o navegador precisa ver o ponto de partida
      disco.style.transition = `transform ${GIRO_MS}ms cubic-bezier(0.12, 0.8, 0.18, 1)`;
      disco.style.transform = `rotate(${alvo}deg)`;
      rodando = true;
      b.raiz.classList.add('is-girando');
      marcarSorteada(-1);
      saida.textContent = 'Girando…';
      if (timer) clearTimeout(timer);
      timer = setTimeout(terminarGiro, GIRO_MS + 60);
    }

    function anguloAtual() {
      const t = disco.style.transform.match(/rotate\((-?[\d.]+)deg\)/);
      return t ? Number(t[1]) : 0;
    }

    function pintarBotao() {
      C.ligado(girar, rodando ? 'A roleta está girando' : C.podeFazer(api, { kind: 'spin' }), 'Girar a roleta');
    }

    function pintarPainel() {
      const auto = state.options.length < m.MIN_SPIN_OPTIONS;
      const aberto = abertoPorMim === null ? auto : abertoPorMim;
      painel.hidden = !aberto;
      alternar.setAttribute('aria-expanded', String(aberto));
      b.raiz.classList.toggle('is-painel', aberto);
    }

    function update(novo, meta) {
      state = novo;
      desenharDisco();
      desenharLista();
      pintarPainel();
      const spin = state.spin;
      if (!spin) {
        if (timer) clearTimeout(timer);
        timer = null;
        rodando = false;
        b.raiz.classList.remove('is-girando');
        pararEm(0);
        marcarSorteada(-1);
        saida.textContent = resultado(state);
      } else if (spin.n !== giroVisto) {
        const anima = meta !== null && meta !== undefined && !C.reduzMovimento() && precisaAnimar(spin, api.serverNow(), GIRO_MS);
        if (anima) {
          animarGiro();
        } else {
          pararEm(m.spinAngle(spin, state.options.length) % 360);
          marcarSorteada(spin.index);
          saida.textContent = resultado(state);
        }
      }
      giroVisto = spin ? spin.n : null;
      pintarQuem();
      pintarBotao();
    }

    return { update, destroy: b.destruir, focus() { girar.focus(); } };
  }

  const api = { type: TYPE, mount, pontoEm, fatias, rotuloFatia, transformRotulo, resultado, precisaAnimar, GIRO_MS };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaJanelas = root.GoLive.mesaJanelas || {};
  root.GoLive.mesaJanelas[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
