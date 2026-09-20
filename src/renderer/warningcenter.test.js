'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('./warningcenter');

function fakeClassList() {
  const set = new Set();
  return {
    add(...names) { names.forEach((name) => set.add(name)); },
    remove(...names) { names.forEach((name) => set.delete(name)); },
    toggle(name, on) { if (on === undefined ? !set.has(name) : on) set.add(name); else set.delete(name); },
    contains(name) { return set.has(name); },
  };
}

function fakeEl() {
  const listeners = {};
  return {
    _attrs: {}, children: [], classList: fakeClassList(), hidden: false,
    append(...nodes) { this.children.push(...nodes); nodes.forEach((node) => { node.parentNode = this; }); },
    appendChild(node) { this.append(node); return node; },
    removeChild(node) { this.children = this.children.filter((child) => child !== node); },
    setAttribute(name, value) { this._attrs[name] = String(value); },
    removeAttribute(name) { delete this._attrs[name]; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    contains(node) { return node === this || this.children.some((child) => child.contains?.(node)); },
    focus() { this.focused = true; },
    _fire(type, event = {}) { (listeners[type] || []).forEach((fn) => fn({ currentTarget: this, target: this, ...event })); },
    set textContent(value) { this._text = value; this.children = []; },
    get textContent() { return this._text || ''; },
  };
}

function fakeDoc() {
  const els = Object.fromEntries(['warn-center', 'warn-center-icon', 'warn-center-panel', 'warn-center-count', 'warn-center-label', 'warn-center-live', 'warn-center-wrap'].map((id) => [id, fakeEl()]));
  const listeners = {};
  return {
    els,
    activeElement: null,
    getElementById(id) { return els[id]; },
    createElement() { return fakeEl(); },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    _fire(type, event = {}) { (listeners[type] || []).forEach((fn) => fn(event)); },
  };
}

test('mostra a contagem, abre no foco e Esc devolve o foco ao botao', () => {
  const doc = fakeDoc();
  const center = create(doc);
  center.render([
    { id: 'captura', severidade: 'grave', titulo: 'Falha na captura', detalhe: 'Tela preta.', rotuloCurto: 'Sem imagem', dispensavel: false },
    { id: 'som', severidade: 'atencao', titulo: 'Silencio', detalhe: 'Nao sai audio.', dispensavel: true },
  ], { total: 2, pior: 'grave', rotuloCurto: 'Sem imagem' });

  assert.equal(doc.els['warn-center'].hidden, false);
  assert.equal(doc.els['warn-center']._attrs['aria-label'], '2 avisos');
  assert.equal(doc.els['warn-center-count'].textContent, '2');
  assert.equal(doc.els['warn-center-label'].textContent, 'Sem imagem');
  doc.els['warn-center']._fire('focus');
  assert.equal(doc.els['warn-center-panel'].hidden, false);
  doc._fire('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(doc.els['warn-center-panel'].hidden, true);
  assert.equal(doc.els['warn-center'].focused, true);
});

test('o X do item dispensavel informa qual aviso deve sair', () => {
  const doc = fakeDoc();
  const center = create(doc);
  let dismissed = null;
  center.onDismiss((id) => { dismissed = id; });
  center.render([
    { id: 'endereco', severidade: 'atencao', titulo: 'Endereco local', detalhe: 'Mesma rede.', dispensavel: true },
  ], { total: 1, pior: 'atencao', rotuloCurto: null });

  const item = doc.els['warn-center-panel'].children[0];
  const dismiss = item.children.at(-1);
  dismiss._fire('click', { stopPropagation() {} });

  assert.equal(dismissed, 'endereco');
});
