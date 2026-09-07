'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { init } = require('./titlebar');

function fakeEl() {
  const listeners = {};
  return {
    hidden: true,
    _attrs: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, on) { on ? this._set.add(c) : this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    setAttribute(k, v) { this._attrs[k] = v; },
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
    _fire(ev) { (listeners[ev] || []).forEach((fn) => fn()); },
  };
}

function fakeDoc() {
  const els = {
    titlebar: fakeEl(),
    'tb-min': fakeEl(),
    'tb-max': fakeEl(),
    'tb-close': fakeEl(),
  };
  return {
    els,
    body: fakeEl(),
    getElementById(id) { return els[id]; },
  };
}

function fakeWin(platform) {
  let maxCb = null;
  return {
    platform,
    calls: { minimize: 0, toggleMaximize: 0, close: 0 },
    minimize() { this.calls.minimize++; },
    toggleMaximize() { this.calls.toggleMaximize++; },
    close() { this.calls.close++; },
    onMaximizeChange(cb) { maxCb = cb; },
    _emitMax(v) { maxCb(v); },
  };
}

test('nao-win32: faixa continua escondida e sem listeners', () => {
  const doc = fakeDoc();
  const win = fakeWin('darwin');
  init(win, doc);
  assert.equal(doc.els.titlebar.hidden, true);
  assert.equal(doc.body.classList.contains('has-titlebar'), false);
  doc.els['tb-min']._fire('click');
  assert.equal(win.calls.minimize, 0);
});

test('win32: mostra a faixa e marca o body', () => {
  const doc = fakeDoc();
  init(fakeWin('win32'), doc);
  assert.equal(doc.els.titlebar.hidden, false);
  assert.equal(doc.body.classList.contains('has-titlebar'), true);
});

test('win32: cada botao chama o metodo certo', () => {
  const doc = fakeDoc();
  const win = fakeWin('win32');
  init(win, doc);
  doc.els['tb-min']._fire('click');
  doc.els['tb-max']._fire('click');
  doc.els['tb-close']._fire('click');
  assert.deepEqual(win.calls, { minimize: 1, toggleMaximize: 1, close: 1 });
});

test('win32: onMaximizeChange alterna classe e aria-label', () => {
  const doc = fakeDoc();
  const win = fakeWin('win32');
  init(win, doc);
  win._emitMax(true);
  assert.equal(doc.els['tb-max'].classList.contains('is-maximized'), true);
  assert.equal(doc.els['tb-max']._attrs['aria-label'], 'Restaurar');
  win._emitMax(false);
  assert.equal(doc.els['tb-max'].classList.contains('is-maximized'), false);
  assert.equal(doc.els['tb-max']._attrs['aria-label'], 'Maximizar');
});
