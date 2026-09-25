'use strict';
/* global document, window, requestAnimationFrame, cancelAnimationFrame, setTimeout, clearTimeout, module */

/*
 * Apoio do conteudo das janelas da Mesa (contrato:
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secao 6).
 *
 * Cada tipo mora em `mesa-janelas/<tipo>.js` e se registra em
 * `GoLive.mesaJanelas[<tipo>]` com `mount(el, api)`. O que todos repetem --
 * montar elemento, desligar botao pelo `validate` do modulo, mostrar a
 * recusa perto de onde se clicou, campo que nao perde o que a pessoa esta
 * digitando quando chega versao nova -- fica aqui, em
 * `GoLive.mesaJanelasComum`.
 *
 * As funcoes puras (textos, motivos, milhar) nao tocam no DOM e sao
 * testadas pelo `node --test`; as de DOM so rodam dentro do `mount`, entao
 * carregar este arquivo no Node nao precisa de `document`.
 *
 * "Desligar" um botao aqui e `aria-disabled`, nao `disabled`: um botao
 * `disabled` perde o foco na hora em que desliga (ex.: o "-" do placar
 * quando o placar chega a zero), e quem estava no teclado cai no <body>.
 * Com `aria-disabled` o foco fica, o leitor de tela diz "indisponivel" e o
 * clique mostra o motivo em vez de nao fazer nada.
 */

(function (root) {
  // ---------- Puras ----------

  /** Recusa do servidor (`mesa-denied.reason`) -> frase curta em PT. O
   * `invalid` traz o motivo do `validate` do modulo em `detail`, que ja e
   * texto para a pessoa. */
  const RECUSAS = {
    rate: 'Muitas ações seguidas; espere um instante',
    locked: 'Só o líder da sala mexe na mesa agora',
    'leader-only': 'Só o líder da sala pode',
    'not-found': 'Esta janela saiu da mesa',
    'not-viewing': 'Abra a Mesa para mexer aqui',
    'state-too-big': 'Passou do tamanho que a janela guarda',
    'too-big': 'Grande demais para mandar',
    'no-act': 'Esta janela não aceita ações',
    'bad-request': 'Pedido inválido',
    error: 'Não deu certo; tente de novo',
  };

  function motivoRecusa(reason, detail) {
    if (reason === 'invalid' && typeof detail === 'string' && detail.trim()) return primeiraMaiuscula(detail.trim());
    return RECUSAS[reason] || 'Não deu certo; tente de novo';
  }

  function primeiraMaiuscula(s) {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
  }

  /** 1000 -> "1 000" (espaco fino inseparavel, como o resto da interface). */
  function milhar(n) {
    return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /** "1 voto", "3 votos". */
  function plural(n, um, varios) {
    return `${n} ${n === 1 ? um : varios}`;
  }

  /** O `validate` da api sem deixar um modulo que lanca derrubar a janela. */
  function podeFazer(api, action) {
    try {
      const r = api.validate(action);
      if (r === true) return true;
      return typeof r === 'string' && r ? primeiraMaiuscula(r) : 'Indisponível';
    } catch {
      return 'Indisponível';
    }
  }

  function nomeDe(api, peerId) {
    if (peerId === null || peerId === undefined) return 'Alguém';
    try {
      const n = api.nameOf(peerId);
      return typeof n === 'string' && n.trim() ? n : 'Alguém';
    } catch {
      return 'Alguém';
    }
  }

  function corDe(api, peerId) {
    try {
      const c = api.colorFor(peerId);
      return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null;
    } catch {
      return null;
    }
  }

  // ---------- DOM ----------

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Icones de traco, os mesmos do prototipo aprovado. */
  const ICONES = {
    mais: '<path d="M12 5v14M5 12h14"/>',
    menos: '<path d="M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    lapis: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    sobe: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    desce: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    pausa: '<path d="M9 5v14M15 5v14"/>',
    zerar: '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4"/>',
    dado: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h.01M15 15h.01M15 9h.01M9 15h.01"/>',
    moeda: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8"/>',
    embaralhar: '<path d="M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3M18 4l3 3-3 3M18 14l3 3-3 3"/>',
    pessoas: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M21 20a6 6 0 0 0-4-5.6"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    bandeira: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  };

  function icone(nome) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'mj-i');
    svg.innerHTML = ICONES[nome] || '';
    return svg;
  }

  /** el('button', { class, text, attrs: {}, on: {} }, ...filhos). */
  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    const p = props || {};
    if (p.class) node.className = p.class;
    if (p.text !== undefined) node.textContent = p.text;
    if (p.attrs) for (const [k, v] of Object.entries(p.attrs)) if (v !== null && v !== undefined) node.setAttribute(k, v);
    if (p.on) for (const [k, fn] of Object.entries(p.on)) node.addEventListener(k, fn);
    for (const k of kids) if (k) node.append(k);
    return node;
  }

  /** Botao de verdade: `type=button`, rotulo em PT (texto ou aria-label). */
  function botao(props) {
    const p = props || {};
    const b = el('button', {
      class: `mj-btn${p.class ? ` ${p.class}` : ''}`,
      attrs: { type: 'button', 'aria-label': p.label || null, title: p.title || p.label || null, ...(p.attrs || {}) },
    });
    if (p.icone) b.append(icone(p.icone));
    if (p.text) b.append(el('span', { text: p.text }));
    return b;
  }

  /** `true` liga; um motivo desliga (aria-disabled, e o motivo no title).
   * `titulo` e o title de quando esta ligado (se mudou, ex.: o nome do time). */
  function ligado(btn, motivo, titulo) {
    if (titulo !== undefined) btn.dataset.titulo = titulo;
    else if (btn.dataset.titulo === undefined) btn.dataset.titulo = btn.getAttribute('title') || '';
    if (motivo === true) {
      btn.removeAttribute('aria-disabled');
      if (btn.dataset.titulo) btn.title = btn.dataset.titulo;
      else btn.removeAttribute('title');
      return true;
    }
    btn.setAttribute('aria-disabled', 'true');
    btn.title = motivo;
    return false;
  }

  function estaDesligado(btn) {
    return btn.getAttribute('aria-disabled') === 'true';
  }

  /** Bolinha na cor da pessoa (detalhe, nunca fundo de texto). */
  function bolinha(cor, titulo) {
    const b = el('span', { class: 'mj-dot', attrs: { title: titulo || null } });
    if (cor) b.style.setProperty('--mj-cor', cor);
    return b;
  }

  /** A linha de recusa. Uma por janela: ela vai morar perto do controle da
   * ultima acao (`em(zona)` a move para dentro da zona) e some sozinha. */
  function criarAviso() {
    const node = el('p', { class: 'mj-aviso', attrs: { role: 'status', 'aria-live': 'polite' } });
    let timer = null;
    function limpar() {
      if (timer) clearTimeout(timer);
      timer = null;
      node.textContent = '';
      node.classList.remove('is-on');
    }
    return {
      node,
      em(zona) {
        if (zona && node.parentNode !== zona) zona.append(node);
      },
      mostrar(texto, zona) {
        this.em(zona);
        node.textContent = texto;
        node.classList.add('is-on');
        if (timer) clearTimeout(timer);
        timer = setTimeout(limpar, 4000);
      },
      limpar,
      destruir: limpar,
    };
  }

  /** Base de todo conteudo: raiz, aviso, recusas do servidor e a faxina.
   * `acao(zona, action)` confere no `validate`, mostra o motivo se nao
   * pode, manda se pode. */
  function base(elRoot, api, tipo) {
    const raiz = el('div', { class: `mj mj-${tipo}` });
    elRoot.append(raiz);
    const aviso = criarAviso();
    const faxina = [];
    let zonaUltima = null;

    function acao(zona, action) {
      const ok = podeFazer(api, action);
      if (ok !== true) {
        aviso.mostrar(ok, zona);
        return false;
      }
      zonaUltima = zona;
      aviso.limpar();
      aviso.em(zona);
      api.act(action);
      return true;
    }

    if (typeof api.onDenied === 'function') {
      const off = api.onDenied((d) => {
        aviso.mostrar(motivoRecusa(d && d.reason, d && d.detail), zonaUltima);
      });
      if (typeof off === 'function') faxina.push(off);
    }

    /** Ouvinte que sai no destroy. */
    function ouvir(alvo, ev, fn, opts) {
      alvo.addEventListener(ev, fn, opts);
      faxina.push(() => alvo.removeEventListener(ev, fn, opts));
    }

    /** Clique em botao que pode estar desligado: desligado mostra o motivo. */
    function clique(btn, zona, fazer) {
      btn.addEventListener('click', (e) => {
        if (estaDesligado(btn)) {
          e.preventDefault();
          aviso.mostrar(btn.title || 'Indisponível', zona);
          return;
        }
        fazer(e);
      });
    }

    function destruir() {
      aviso.destruir();
      for (const f of faxina.splice(0)) {
        try { f(); } catch { /* faxina nao derruba a outra */ }
      }
      raiz.remove();
    }

    return { raiz, aviso, acao, ouvir, clique, faxina, destruir };
  }

  /** Campo com edicao local: o texto so vai para a sala ao confirmar
   * (Enter ou sair do campo) e, enquanto a pessoa esta nele, versao nova
   * que chega NAO sobrescreve o que ela digitou. Esc volta ao da sala.
   *
   * `confirmar(texto)` devolve false se nao mandou (motivo ja mostrado);
   * ai o campo volta ao valor da sala. */
  function campoLocal(input, opts) {
    let daSala = input.value;
    let aoEntrar = input.value;
    const multilinha = input.tagName === 'TEXTAREA';

    function emFoco() {
      return document.activeElement === input;
    }

    function confirmar() {
      const v = input.value;
      if (v === aoEntrar || v === daSala) {
        if (!emFoco()) input.value = daSala;
        return;
      }
      aoEntrar = v;
      const foi = opts.confirmar(v);
      if (foi === false && !emFoco()) input.value = daSala;
    }

    input.addEventListener('focus', () => { aoEntrar = input.value; });
    input.addEventListener('blur', () => { if (!movendo) confirmar(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !multilinha) {
        e.preventDefault();
        confirmar();
        aoEntrar = input.value;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        input.value = daSala;
        aoEntrar = daSala;
        input.blur();
      }
    });

    return {
      /** Valor novo da sala. Em foco, fica guardado para o Esc/saida. */
      sync(v) {
        daSala = v;
        if (!emFoco()) {
          if (input.value !== v) input.value = v;
          aoEntrar = v;
        }
      },
      get daSala() { return daSala; },
      emFoco,
    };
  }

  /** Move `filho` para a posicao `i` de `pai` sem perder o foco de quem
   * esta dentro (mover um no no DOM tira o foco do que esta nele). */
  let movendo = false; // um porNaPosicao em curso: o blur que ele causa nao vale

  function estaMovendo() {
    return movendo;
  }

  function porNaPosicao(pai, filho, i) {
    const atual = pai.children[i];
    if (atual === filho) return;
    const ativo = document.activeElement;
    const dentro = ativo && filho.contains(ativo) ? ativo : null;
    let sel = null;
    if (dentro && typeof dentro.selectionStart === 'number') {
      try { sel = [dentro.selectionStart, dentro.selectionEnd]; } catch { sel = null; }
    }
    movendo = true;
    try {
      pai.insertBefore(filho, atual || null);
      if (dentro && document.activeElement !== dentro) {
        dentro.focus({ preventScroll: true });
        if (sel) try { dentro.setSelectionRange(sel[0], sel[1]); } catch { /* campo sem selecao */ }
      }
    } finally {
      movendo = false;
    }
  }

  function reduzMovimento() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  /** Laco de quadro que so roda enquanto `precisa()` diz que sim, o
   * elemento esta na pagina, a aba esta visivel e a janela aparece na
   * tela (IntersectionObserver). `quadro()` desenha. */
  function criarLaco(elemento, precisa, quadro) {
    let id = 0;
    let visivelNaTela = true;
    let morto = false;
    let io = null;

    function podeRodar() {
      return !morto && elemento.isConnected && !document.hidden && visivelNaTela && precisa();
    }
    function passo() {
      id = 0;
      if (!podeRodar()) return;
      quadro();
      id = requestAnimationFrame(passo);
    }
    function acordar() {
      if (id || !podeRodar()) return;
      id = requestAnimationFrame(passo);
    }
    function aoMudarVisibilidade() {
      if (document.hidden && id) { cancelAnimationFrame(id); id = 0; }
      acordar();
    }
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    if (typeof root.IntersectionObserver === 'function') {
      io = new root.IntersectionObserver((entradas) => {
        const e = entradas[entradas.length - 1];
        visivelNaTela = !!(e && e.isIntersecting);
        if (!visivelNaTela && id) { cancelAnimationFrame(id); id = 0; }
        acordar();
      });
      io.observe(elemento);
    }
    return {
      acordar,
      get rodando() { return id !== 0; },
      parar() {
        morto = true;
        if (id) cancelAnimationFrame(id);
        id = 0;
        document.removeEventListener('visibilitychange', aoMudarVisibilidade);
        if (io) io.disconnect();
      },
    };
  }

  const api = {
    RECUSAS,
    motivoRecusa,
    milhar,
    plural,
    primeiraMaiuscula,
    podeFazer,
    nomeDe,
    corDe,
    icone,
    el,
    botao,
    ligado,
    estaDesligado,
    bolinha,
    criarAviso,
    base,
    campoLocal,
    porNaPosicao,
    estaMovendo,
    reduzMovimento,
    criarLaco,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaJanelas = root.GoLive.mesaJanelas || {};
  root.GoLive.mesaJanelasComum = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
