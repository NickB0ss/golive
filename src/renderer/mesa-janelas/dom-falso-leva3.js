'use strict';

/*
 * DOM falso so para os testes de montagem das janelas de cartas e festa
 * (truco, domino, oito, quiz, stop, desenha, blackjack, poquer). Nao e codigo
 * do app: `node --test` nao carrega renderer, entao o `mount` roda aqui contra
 * um Elemento minimo com o que `comum.js` e os conteudos usam.
 */

class Elemento {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attrs = new Map();
    this.className = '';
    this.listeners = new Map();
    this.style = { setProperty() {}, removeProperty() {} };
    this.textContent = '';
    this.hidden = false;
    this.value = '';
    this.classList = {
      add: (...nomes) => this.trocarClasses((atuais) => new Set([...atuais, ...nomes])),
      remove: (...nomes) => this.trocarClasses((atuais) => new Set([...atuais].filter((c) => !nomes.includes(c)))),
      contains: (nome) => this.classes().includes(nome),
      toggle: (nome, ligado) => {
        const liga = ligado === undefined ? !this.classes().includes(nome) : Boolean(ligado);
        if (liga) this.classList.add(nome);
        else this.classList.remove(nome);
        return liga;
      },
    };
  }

  classes() { return this.className.split(' ').filter(Boolean); }

  trocarClasses(fazer) { this.className = [...fazer(this.classes())].join(' '); }

  append(...nos) {
    for (const no of nos) {
      const filho = typeof no === 'string' ? Object.assign(new Elemento('#texto'), { textContent: no }) : no;
      filho.remove();
      filho.parentNode = this;
      this.children.push(filho);
    }
  }

  replaceChildren(...nos) {
    for (const filho of this.children) filho.parentNode = null;
    this.children = [];
    this.append(...nos);
  }

  insertBefore(no, antes) {
    no.remove();
    no.parentNode = this;
    const i = antes ? this.children.indexOf(antes) : -1;
    if (i < 0) this.children.push(no);
    else this.children.splice(i, 0, no);
  }

  remove() {
    const i = this.parentNode ? this.parentNode.children.indexOf(this) : -1;
    if (i >= 0) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }

  setAttribute(nome, valor) { this.attrs.set(nome, String(valor)); }
  getAttribute(nome) { return this.attrs.has(nome) ? this.attrs.get(nome) : null; }
  removeAttribute(nome) { this.attrs.delete(nome); }

  addEventListener(tipo, fn) {
    this.listeners.set(tipo, [...(this.listeners.get(tipo) || []), fn]);
  }

  removeEventListener(tipo, fn) {
    this.listeners.set(tipo, (this.listeners.get(tipo) || []).filter((f) => f !== fn));
  }

  dispatch(tipo, extra = {}) {
    for (const fn of this.listeners.get(tipo) || []) fn({ preventDefault() {}, stopPropagation() {}, ...extra });
  }

  click() { this.dispatch('click'); }
  focus() { this.focado = true; }
  getContext() { return null; }
  get options() { return this.children; }
  blur() {}
  contains(no) { return no === this || this.children.some((filho) => filho.contains(no)); }

  combina(seletor) {
    return seletor.split(',').some((parte) => {
      const s = parte.trim();
      if (s.startsWith('.')) return this.classes().includes(s.slice(1));
      return this.tagName === s.toUpperCase();
    });
  }

  querySelectorAll(seletor) {
    const achados = [];
    for (const filho of this.children) {
      if (filho.combina(seletor)) achados.push(filho);
      achados.push(...filho.querySelectorAll(seletor));
    }
    return achados;
  }

  querySelector(seletor) { return this.querySelectorAll(seletor)[0] || null; }

  /** Todo texto do no e dos descendentes, na ordem. */
  texto() { return this.textContent + this.children.map((filho) => filho.texto()).join(''); }
}

/** Monta `janela` num elemento falso e devolve o que o teste precisa. `extra`
 * sobrescreve partes da api (act, me, nameOf...). */
function montar(janela, estado, extra = {}) {
  const anterior = {
    document: globalThis.document,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    ResizeObserver: globalThis.ResizeObserver,
  };
  globalThis.document = {
    createElement: (tag) => new Elemento(tag),
    createElementNS: (_ns, tag) => new Elemento(tag),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const acoes = [];
  const api = {
    act: (acao) => { acoes.push(acao); return true; },
    validate: () => true,
    me: () => '1',
    isLeader: () => true,
    nameOf: (id) => ({ 1: 'Ana', 2: 'Bia', 3: 'Caio', 4: 'Duda' })[id] || null,
    colorFor: () => '#4ade80',
    serverNow: () => 0,
    onDenied: () => () => {},
    sendAnnotate: () => true,
    setStatus() {},
    setTurn() {},
    ...extra,
  };
  const raiz = new Elemento('div');
  const instancia = janela.mount(raiz, api);
  instancia.update(estado, null);
  return {
    raiz,
    acoes,
    api,
    atualizar: (novo) => instancia.update(novo, null),
    achar: (seletor) => raiz.querySelector(seletor),
    todos: (seletor) => raiz.querySelectorAll(seletor),
    botao: (rotulo) => raiz.querySelectorAll('button').find((b) => b.texto() === rotulo
      || b.getAttribute('aria-label') === rotulo),
    texto: () => raiz.texto(),
    destruir() {
      instancia.destroy();
      Object.assign(globalThis, anterior);
    },
  };
}

module.exports = { Elemento, montar };
