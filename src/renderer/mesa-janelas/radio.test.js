'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./comum');
const modulo = require('../mesa-modules/radio');
const { Elemento, texto, instalarDocumento, apiFalsa } = require('./dom-falso-midia');

// As dependencias de midia que o conteudo carrega sob demanda no app, aqui sem rede nem iframe.
const G = globalThis.GoLive;
G.mesaMidiaLinks = require('../mesa-modules/midialinks');
G.mesaMidia = { register: () => ({ active: () => true, take() {}, release() {} }) };
G.mesaSyncMedia = { createSync: () => ({ tick() {}, reset() {} }) };
G.ytplayer = {
  isVideoError: () => false,
  create: () => ({
    ready: false, videoId: null, destroy() {}, load() {}, duration: () => 0, currentTime: () => null,
    info: () => ({}), setVolume() {},
  }),
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
instalarDocumento();
const janela = require('./radio');

test('registra o conteudo do radio', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.radio, janela);
});

test('a fila e uma lista numerada: a posicao comeca em 1 e segue a ordem da fila', () => {
  const fila = [
    { id: 'r2', videoId: 'aaa', title: 'Primeira', by: '1', name: 'Ana' },
    { id: 'r3', videoId: 'bbb', title: '', by: '2', name: '' },
    { id: 'r4', videoId: 'ccc', title: 'Terceira', by: '3', name: 'Caio' },
  ];
  const linhas = janela.linhasDaFila(fila, (id) => ({ 2: 'Bia' })[id]);
  assert.deepEqual(linhas.map((l) => l.pos), [1, 2, 3]);
  assert.deepEqual(linhas.map((l) => l.id), ['r2', 'r3', 'r4']);
  assert.deepEqual(linhas.map((l) => l.titulo), ['Primeira', 'bbb', 'Terceira'], 'sem titulo vale o id do video');
  assert.deepEqual(linhas.map((l) => l.quem), ['Ana', 'Bia', 'Caio'], 'sem nome guardado vale o nome da sala');
});

test('fila vazia ou torta nao gera linhas nem quebra', () => {
  assert.deepEqual(janela.linhasDaFila([]), []);
  assert.deepEqual(janela.linhasDaFila(undefined), []);
  assert.equal(janela.linhasDaFila([{ id: 'r1', videoId: 'x', by: '1' }])[0].quem, '');
});

test('o rotulo da faixa em destaque diz se toca ou esta pausada', () => {
  assert.equal(janela.rotuloDaFaixa(true), 'Tocando agora');
  assert.equal(janela.rotuloDaFaixa(false), 'Pausado');
});

const aguardar = () => new Promise((resolve) => setImmediate(resolve));
const rotuloDe = (botao) => botao.getAttribute('aria-label') || botao.textContent
  || botao.children.map((f) => f.textContent).join('');
const botaoDe = (no, rotulo) => no.querySelectorAll('button').find((b) => rotuloDe(b) === rotulo);
const item = (id, videoId, title, by, name) => ({ id, videoId, title, by, name });
const tocando = () => ({
  ...modulo.init(),
  current: item('r1', 'dQw4w9WgXcQ', 'Musica de agora', '1', 'Ana'),
  playing: true,
  at: 1000,
  queue: [item('r2', 'aaaaaaaaaaa', 'Segunda', '2', 'Bia'), item('r3', 'bbbbbbbbbbb', '', '1', '')],
});

async function montar(estado) {
  const el = new Elemento('div');
  const tela = janela.mount(el, apiFalsa({ serverNow: () => 2000 }));
  await aguardar();
  tela.update(estado);
  return { el, tela };
}

test('sem musica: palco com o vazio e o formulario de link como acao, sem fila nem cabecalho', async () => {
  const { el, tela } = await montar(modulo.init());
  try {
    const raiz = el.querySelector('.mjm-radio');
    assert.equal(raiz.dataset.superficie, 'palco');
    const vazio = raiz.querySelector('.mj-vazio');
    assert.equal(vazio.hidden, false);
    assert.match(texto(vazio), /Nada tocando/);
    assert.ok(vazio.querySelector('.mj-vazio-acao form'));
    assert.equal(raiz.querySelector('.mjm-radio-now').hidden, true);
    assert.equal(raiz.querySelector('.mjm-radio-queue').hidden, true);
    assert.equal(raiz.querySelector('.mjm-radio-head').hidden, true);
  } finally {
    tela.destroy();
  }
});

test('com musica: a faixa em destaque, a fila numerada e o formulario desce para o pe da janela', async () => {
  const { el, tela } = await montar(tocando());
  try {
    const raiz = el.querySelector('.mjm-radio');
    assert.equal(raiz.querySelector('.mj-vazio').hidden, true);
    assert.equal(raiz.querySelector('.mjm-radio-estado').textContent, 'Tocando agora');
    assert.equal(raiz.querySelector('.mjm-radio-title').textContent, 'Musica de agora');
    assert.equal(raiz.querySelector('.mjm-radio-head').textContent, 'Próximas (2/50)');
    const linhas = raiz.querySelectorAll('.mjm-radio-item');
    assert.deepEqual(linhas.map((li) => li.querySelector('.mjm-radio-num').textContent), ['1', '2']);
    const titulos = linhas.map((li) => li.querySelector('.mjm-radio-item-title').textContent);
    assert.deepEqual(titulos, ['Segunda', 'bbbbbbbbbbb']);
    const form = raiz.querySelector('form');
    assert.equal(form.parentNode, raiz.querySelector('.mjm-radio-pe'));
    assert.deepEqual(['Subir na fila', 'Descer na fila', 'Tirar da fila'].map((r) => Boolean(botaoDe(linhas[0], r))),
      [true, true, true], 'os rotulos dos botoes da fila continuam');
  } finally {
    tela.destroy();
  }
});

test('controles indisponiveis da fila e do voto mantem foco e explicam o motivo', async () => {
  const estado = { ...tocando(), votes: ['1'] };
  const { el, tela } = await montar(estado);
  try {
    const raiz = el.querySelector('.mjm-radio');
    const [primeira, ultima] = raiz.querySelectorAll('.mjm-radio-item');
    const subir = botaoDe(primeira, 'Subir na fila');
    const descer = botaoDe(ultima, 'Descer na fila');
    const voto = botaoDe(raiz, 'Você votou (1/1)');
    assert.equal(subir.getAttribute('aria-disabled'), 'true');
    assert.equal(subir.title, 'Esta música já é a primeira da fila');
    assert.equal(descer.getAttribute('aria-disabled'), 'true');
    assert.equal(descer.title, 'Esta música já é a última da fila');
    assert.equal(voto.getAttribute('aria-disabled'), 'true');
    assert.equal(voto.title, 'Você já votou');
    subir.dispatch('click');
    assert.equal(el.querySelector('.mj-aviso').textContent, 'Esta música já é a primeira da fila');
  } finally {
    tela.destroy();
  }
});

test('o formulario volta para o vazio quando a fila acaba, com o foco junto se estava nele', async () => {
  const { el, tela } = await montar(tocando());
  try {
    const raiz = el.querySelector('.mjm-radio');
    const campo = raiz.querySelector('.mjm-input');
    campo.focus();
    tela.update(modulo.init());
    assert.equal(raiz.querySelector('form').parentNode, raiz.querySelector('.mj-vazio-acao'));
    assert.equal(globalThis.document.activeElement, campo, 'o foco acompanha o formulario');
    assert.equal(raiz.querySelector('.mj-vazio').hidden, false);
  } finally {
    tela.destroy();
  }
});
