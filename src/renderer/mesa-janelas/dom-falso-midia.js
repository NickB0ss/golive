'use strict';

/*
 * DOM falso so para os testes de montagem das janelas de midia (jam, link,
 * imagem, galeria). Nao e codigo do app: `node --test` nao carrega o
 * renderer, entao o `mount` roda aqui contra um Elemento minimo, com o que o
 * `comum.js` e estes conteudos usam (inclusive `querySelector` simples).
 */

class Elemento {
  constructor(tag) {
    this.tagName = String(tag).toLowerCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attrs = new Map();
    this.className = '';
    this.listeners = new Map();
    this.style = { setProperty() {}, removeProperty() {} };
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.value = '';
    this.title = '';
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

  get firstChild() { return this.children[0] || null; }

  append(...nos) {
    for (const no of nos) {
      const filho = typeof no === 'string' ? Object.assign(new Elemento('#texto'), { textContent: no }) : no;
      filho.remove();
      filho.parentNode = this;
      this.children.push(filho);
    }
  }

  appendChild(no) { this.append(no); return no; }

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

  setAttribute(nome, valor) {
    if (nome === 'class') this.className = String(valor);
    this.attrs.set(nome, String(valor));
  }
  getAttribute(nome) { return this.attrs.has(nome) ? this.attrs.get(nome) : null; }
  removeAttribute(nome) { this.attrs.delete(nome); }

  addEventListener(tipo, fn) {
    this.listeners.set(tipo, [...(this.listeners.get(tipo) || []), fn]);
  }

  removeEventListener(tipo, fn) {
    this.listeners.set(tipo, (this.listeners.get(tipo) || []).filter((f) => f !== fn));
  }

  /** Dispara os ouvintes; `ev` ganha `preventDefault` e `stopPropagation` vazios. */
  dispatch(tipo, ev) {
    const evento = { preventDefault() {}, stopPropagation() {}, ...ev };
    for (const fn of this.listeners.get(tipo) || []) fn(evento);
  }

  contains(no) {
    return no === this || this.children.some((filho) => filho.contains(no));
  }

  focus() { Elemento.ativo = this; }
  blur() { if (Elemento.ativo === this) Elemento.ativo = null; }
  select() {}

  /** Cada parte e `tag`, `.classe` ou os dois juntos; espaco e descendente. */
  casa(parte) {
    const [, tag, classes] = /^([a-z0-9]*)((?:\.[\w-]+)*)$/i.exec(parte) || [];
    if (tag && tag.toLowerCase() !== this.tagName) return false;
    return classes.split('.').filter(Boolean).every((c) => this.classes().includes(c));
  }

  todos(partes, achados) {
    const [primeira, ...resto] = partes;
    for (const filho of this.children) {
      if (filho.casa(primeira)) {
        if (resto.length) filho.todos(resto, achados);
        else achados.push(filho);
      }
      filho.todos(partes, achados);
    }
    return achados;
  }

  querySelectorAll(seletor) {
    return [...new Set(this.todos(seletor.trim().split(/\s+/), []))];
  }

  querySelector(seletor) { return this.querySelectorAll(seletor)[0] || null; }
}

/** Texto visivel: o do no mais o dos filhos que nao estao escondidos. */
function texto(no) {
  if (no.hidden) return '';
  return no.textContent + no.children.map(texto).join('');
}

function documentoFalso() {
  return {
    createElement: (tag) => new Elemento(tag),
    createElementNS: (_ns, tag) => new Elemento(tag),
    createTextNode: (texto) => Object.assign(new Elemento('#texto'), { textContent: String(texto) }),
    get activeElement() { return Elemento.ativo || null; },
  };
}

/** Instala `document` falso durante `fazer()`; devolve o que ela devolver. */
function comDocumento(fazer) {
  const anterior = globalThis.document;
  globalThis.document = documentoFalso();
  Elemento.ativo = null;
  try {
    return fazer();
  } finally {
    globalThis.document = anterior;
  }
}

/** Para o conteudo que monta depois de uma promessa: o `document` fica ate o fim do arquivo de teste. */
function instalarDocumento() {
  globalThis.document = documentoFalso();
  Elemento.ativo = null;
}

/** `api` da Vista, mínima: tudo valido, nada enviado, ninguem com nome. */
function apiFalsa(extra) {
  return {
    act() {},
    validate: () => true,
    me: () => '1',
    nameOf: (id) => ({ 1: 'Ana', 2: 'Bia' })[id] || null,
    colorFor: () => '#4ade80',
    ...extra,
  };
}

module.exports = { Elemento, texto, comDocumento, instalarDocumento, apiFalsa };
