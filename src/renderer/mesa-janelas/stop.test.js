'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const janela = require('./stop');

class Elemento {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.attrs = new Map();
    this.dataset = {};
    this.classList = { add() {}, remove() {} };
    this.value = '';
    this.textContent = '';
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type, extra = {}) {
    this.listeners.get(type)?.({ preventDefault() {}, ...extra });
  }

  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) || null; }
  removeAttribute(name) { this.attrs.delete(name); }

  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (child.tagName === selector) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }

  focus() { this.focado = true; }
}

function montar(state = estado()) {
  const anteriores = {
    document: globalThis.document,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const timers = [];
  const intervalos = [];
  const recusas = new Set();
  let agora = 0;
  globalThis.document = { createElement: (tag) => new Elemento(tag) };
  globalThis.setTimeout = (fn) => { timers.push(fn); return fn; };
  globalThis.clearTimeout = (fn) => { const i = timers.indexOf(fn); if (i >= 0) timers.splice(i, 1); };
  globalThis.setInterval = (fn) => { intervalos.push(fn); return fn; };
  globalThis.clearInterval = (fn) => { const i = intervalos.indexOf(fn); if (i >= 0) intervalos.splice(i, 1); };
  const acoes = [];
  const api = {
    act: (acao) => { acoes.push(acao); return true; },
    isLeader: () => false,
    serverNow: () => agora,
    setStatus() {},
    setTurn() {},
    validate: () => true,
    onDenied(fn) {
      recusas.add(fn);
      return () => recusas.delete(fn);
    },
  };
  const C = {
    el(tag, props = {}, ...kids) {
      const node = new Elemento(tag);
      node.className = props.class || '';
      node.textContent = props.text || '';
      for (const [name, value] of Object.entries(props.attrs || {})) node.setAttribute(name, value);
      node.append(...kids);
      return node;
    },
    botao: ({ text, class: cls }) => {
      const node = new Elemento('button');
      node.textContent = text || '';
      node.className = cls || '';
      return node;
    },
    base(root) {
      const raiz = new Elemento('div');
      root.append(raiz);
      return { raiz, acao: (_where, acao) => api.act(acao), faxina: [], destruir() {} };
    },
    ligado(btn, ligado) {
      if (ligado === true) btn.removeAttribute('aria-disabled');
      else btn.setAttribute('aria-disabled', 'true');
    },
  };
  globalThis.GoLive.mesaJanelasComum = C;
  const root = new Elemento('div');
  const inst = janela.mount(root, api);
  inst.update(state);
  return {
    acoes,
    inputs: () => root.querySelectorAll('input'),
    botao: (texto) => root.querySelectorAll('button').find((node) => node.textContent === texto),
    rodarTimers: () => timers.splice(0).forEach((fn) => fn()),
    rodarIntervalos: () => intervalos.slice().forEach((fn) => fn()),
    recusar: (reason) => recusas.forEach((fn) => fn({ reason })),
    agora: (valor) => { agora = valor; },
    atualizar: (next) => inst.update(next),
    destruir: () => {
      inst.destroy();
      Object.assign(globalThis, anteriores);
    },
  };
}

function estado(extra = {}) {
  return {
    phase: 'writing',
    letter: 'A',
    deadline: 10000,
    categories: ['Animal', 'Cidade'],
    players: ['ana', 'bia'],
    answered: { ana: false, bia: false },
    myAnswers: ['', ''],
    me: { canStop: true },
    ...extra,
  };
}

test('Stop envia estado proprio e alheio para a barra', () => {
  const chamadas = [];
  const api = { setStatus: (v) => chamadas.push(['status', v]), setTurn: (v) => chamadas.push(['turn', v]) };
  janela.atualizarBarra(api, 'Letra A · escrevendo', true);
  janela.atualizarBarra(api, 'Corrigindo respostas', false);
  assert.deepEqual(chamadas, [
    ['status', 'Letra A · escrevendo'], ['turn', true], ['status', 'Corrigindo respostas'], ['turn', false],
  ]);
});

test('registra a janela Stop e calcula o relogio da rodada', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.stop, janela);
  assert.equal(janela.type, 'stop');
  assert.equal(janela.tempo(181000, 1000), '3:00');
  assert.equal(janela.tempo(1000, 1000), '0:00');
});

test('monta linhas de correcao com placar de anulacao', () => {
  const rows = janela.linhas({
    categories: ['Animal'],
    players: ['ana'],
    names: { ana: 'Ana' },
    answers: { ana: ['Anta'] },
    votes: [{ player: 'ana', category: 0, yes: 1, no: 2, mine: true, annulled: false }],
    points: [{ player: 'ana', category: 0, points: 10 }],
  });
  assert.deepEqual(rows, [{ player: 'ana', name: 'Ana', category: 0, answer: 'Anta', yes: 1, no: 2, points: 10 }]);
});

test('update da mesma rodada preserva os inputs e o rascunho local', () => {
  const view = montar();
  const [animal] = view.inputs();
  animal.value = 'Anta';
  animal.dispatch('input');
  view.atualizar(estado({ answered: { ana: false, bia: true } }));
  assert.equal(view.inputs()[0], animal);
  assert.equal(view.inputs()[0].value, 'Anta');
  view.destruir();
});

test('digitar salva apos debounce e nao reenvia resposta igual', () => {
  const view = montar();
  view.inputs()[0].value = 'Anta';
  view.inputs()[0].dispatch('input');
  view.rodarTimers();
  view.inputs()[0].dispatch('input');
  view.rodarTimers();
  assert.deepEqual(view.acoes, [{ kind: 'answer', answers: ['Anta', ''] }]);
  view.destruir();
});

test('blur e Enter salvam na hora e Enter avanca o foco', () => {
  const view = montar();
  const [animal, cidade] = view.inputs();
  animal.value = 'Anta';
  animal.dispatch('blur');
  animal.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(view.acoes, [
    { kind: 'answer', answers: ['Anta', ''] },
  ]);
  assert.equal(cidade.focado, true);
  view.destruir();
});

test('STOP manda as respostas locais antes da acao de parar', () => {
  const view = montar();
  view.inputs()[0].value = 'Anta';
  view.inputs()[1].value = 'Aracaju';
  view.botao('STOP').dispatch('click');
  assert.deepEqual(view.acoes, [
    { kind: 'answer', answers: ['Anta', 'Aracaju'] },
    { kind: 'stop' },
  ]);
  view.destruir();
});

test('STOP preserva o mesmo botao quando o blur salva a resposta', () => {
  const view = montar();
  const [animal, cidade] = view.inputs();
  const stop = view.botao('STOP');
  animal.value = 'Anta';
  cidade.value = 'Aracaju';
  animal.dispatch('blur');
  assert.equal(view.botao('STOP'), stop);
  stop.dispatch('click');
  assert.deepEqual(view.acoes, [
    { kind: 'answer', answers: ['Anta', 'Aracaju'] },
    { kind: 'stop' },
  ]);
  view.destruir();
});

test('recusa por rate reenvia a mesma resposta depois do debounce', () => {
  const view = montar();
  view.inputs()[0].value = 'Anta';
  view.inputs()[0].dispatch('input');
  view.rodarTimers();
  view.recusar('rate');
  view.rodarTimers();
  assert.deepEqual(view.acoes, [
    { kind: 'answer', answers: ['Anta', ''] },
    { kind: 'answer', answers: ['Anta', ''] },
  ]);
  view.destruir();
});

test('recusa que nao e rate nao reenvia a resposta', () => {
  const view = montar();
  view.inputs()[0].value = 'Anta';
  view.inputs()[0].dispatch('input');
  view.rodarTimers();
  view.recusar('not-viewing');
  view.rodarTimers();
  assert.deepEqual(view.acoes, [{ kind: 'answer', answers: ['Anta', ''] }]);
  view.destruir();
});

test('STOP habilita quando todos os campos locais estao preenchidos', () => {
  const view = montar();
  const [animal, cidade] = view.inputs();
  animal.value = 'Anta';
  animal.dispatch('input');
  cidade.value = 'Aracaju';
  cidade.dispatch('input');
  assert.equal(view.botao('STOP').getAttribute('aria-disabled'), null);
  view.destruir();
});

test('timeout descarrega as respostas antes de avisar o tempo esgotado', () => {
  const view = montar(estado({ deadline: -1 }));
  view.inputs()[0].value = 'Anta';
  view.rodarIntervalos();
  assert.deepEqual(view.acoes, [
    { kind: 'answer', answers: ['Anta', ''] },
    { kind: 'timeout' },
  ]);
  view.destruir();
});

test('timeout e reenviado a cada segundo depois do prazo', () => {
  const view = montar(estado({ deadline: 10 }));
  view.agora(10);
  view.rodarIntervalos();
  view.agora(500);
  view.rodarIntervalos();
  view.agora(1010);
  view.rodarIntervalos();
  assert.deepEqual(view.acoes, [
    { kind: 'answer', answers: ['', ''] },
    { kind: 'timeout' },
    { kind: 'timeout' },
  ]);
  view.destruir();
});

test('mudanca de rodada remonta os campos', () => {
  const view = montar();
  const [animal] = view.inputs();
  view.atualizar(estado({ letter: 'B', deadline: 20000 }));
  assert.notEqual(view.inputs()[0], animal);
  view.destruir();
});

test('sair da escrita cancela o envio pendente', () => {
  const view = montar();
  view.inputs()[0].value = 'Anta';
  view.inputs()[0].dispatch('input');
  view.atualizar(estado({ phase: 'review' }));
  view.rodarTimers();
  assert.deepEqual(view.acoes, []);
  view.destruir();
});

test('destroy salva o rascunho que ainda estava no debounce', () => {
  const view = montar();
  view.inputs()[0].value = 'Anta';
  view.inputs()[0].dispatch('input');
  view.destruir();
  assert.deepEqual(view.acoes, [{ kind: 'answer', answers: ['Anta', ''] }]);
});

test('nao mostra mais o botao Guardar respostas', () => {
  const view = montar();
  assert.equal(view.botao('Guardar respostas'), undefined);
  view.destruir();
});

test('mostra Salvo quando o servidor confirma a resposta ja limpa', () => {
  const view = montar();
  view.inputs()[0].value = 'Anta ';
  view.inputs()[1].value = 'Aracaju';
  view.inputs()[0].dispatch('blur');
  view.atualizar(estado({ myAnswers: ['Anta', 'Aracaju'] }));
  const dicas = [];
  const juntar = (node) => { dicas.push(node.textContent); node.children.forEach(juntar); };
  juntar(view.inputs()[0].parentNode.parentNode.parentNode);
  assert.ok(dicas.includes('Salvo'));
  assert.ok(!dicas.includes('Salvando…'));
  view.destruir();
});
