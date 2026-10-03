'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./comum');
const modulo = require('../mesa-modules/youtube');
const { Elemento, texto, instalarDocumento, apiFalsa } = require('./dom-falso-midia');

// As dependencias de midia que o conteudo carrega sob demanda no app, aqui sem rede nem iframe.
const G = globalThis.GoLive;
G.mesaMidiaLinks = require('../mesa-modules/midialinks');
G.mesaMidia = { register: () => ({ active: () => true, take() {}, release() {} }) };
G.mesaSyncMedia = { createSync: () => ({ tick() {}, reset() {} }) };
G.ytplayer = {
  create: () => ({
    ready: false, videoId: null, destroy() {}, load() {}, duration: () => 0, currentTime: () => null,
    info: () => ({}), setVolume() {}, mute() {}, unMute() {},
  }),
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
instalarDocumento();
const janela = require('./youtube');

const aguardar = () => new Promise((resolve) => setImmediate(resolve));
const rotuloDe = (botao) => botao.getAttribute('aria-label') || botao.textContent
  || botao.children.map((f) => f.textContent).join('');
const botaoDe = (no, rotulo) => no.querySelectorAll('button').find((b) => rotuloDe(b) === rotulo);
const comVideo = () => modulo.reduce(modulo.init(), { kind: 'load', url: 'https://youtu.be/dQw4w9WgXcQ', at: 1000 });

async function montar(estado) {
  const el = new Elemento('div');
  const tela = janela.mount(el, apiFalsa({ serverNow: () => 2000 }));
  await aguardar();
  tela.update(estado);
  return { el, tela };
}

test('registra o conteudo do youtube', () => {
  assert.equal(G.mesaJanelas.youtube, janela);
});

test('sem video: palco com o vazio e o formulario como acao, sem Cancelar e sem o player', async () => {
  const { el, tela } = await montar(modulo.init());
  try {
    const raiz = el.querySelector('.mjm-yt');
    assert.equal(raiz.dataset.superficie, 'palco');
    assert.ok(raiz.classes().includes('mj'), 'a raiz herda a ilha escura do palco');
    const vazio = raiz.querySelector('.mj-vazio');
    assert.match(texto(vazio), /Um vídeo para todos/);
    assert.ok(vazio.querySelector('.mj-vazio-acao form'), 'o formulario de link e a acao do vazio');
    assert.equal(botaoDe(vazio, 'Cancelar').hidden, true);
    assert.equal(raiz.querySelector('.mjm-stage').hidden, true);
  } finally {
    tela.destroy();
  }
});

test('com video: o player aparece, o vazio some, e Trocar o traz de volta com Cancelar', async () => {
  const { el, tela } = await montar(comVideo());
  try {
    const raiz = el.querySelector('.mjm-yt');
    assert.equal(raiz.querySelector('.mjm-stage').hidden, false);
    assert.equal(raiz.querySelector('.mjm-empty').hidden, true);
    botaoDe(raiz, 'Trocar').dispatch('click');
    assert.equal(raiz.querySelector('.mjm-empty').hidden, false);
    assert.equal(botaoDe(raiz.querySelector('.mj-vazio'), 'Cancelar').hidden, false);
  } finally {
    tela.destroy();
  }
});

test('os controles do video sao tracos, nao emoji, e mantem os rotulos', async () => {
  const { el, tela } = await montar(comVideo());
  try {
    const barra = el.querySelector('.mjm-bar');
    const tocar = barra.querySelector('.mjm-icon');
    assert.equal(tocar.getAttribute('aria-label'), 'Pausar para todos');
    assert.equal(tocar.textContent, '');
    assert.equal(tocar.children[0].className, 'mj-i');
    const mudo = barra.querySelectorAll('.mjm-icon')[1];
    assert.equal(mudo.getAttribute('aria-label'), 'Tirar o som (só seu)');
    assert.equal(mudo.textContent, '');
  } finally {
    tela.destroy();
  }
});
