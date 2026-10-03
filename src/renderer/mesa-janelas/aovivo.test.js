'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./comum');
const modulo = require('../mesa-modules/aovivo');
const { Elemento, texto, instalarDocumento, apiFalsa } = require('./dom-falso-midia');

// A dependencia de midia que o conteudo carrega sob demanda no app, aqui sem rede nem iframe.
const G = globalThis.GoLive;
G.mesaMidiaLinks = require('../mesa-modules/midialinks');
G.mesaMidia = { register: () => ({ active: () => true, take() {}, release() {} }) };
globalThis.location = { hostname: 'localhost' };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
instalarDocumento();
const janela = require('./aovivo');

const aguardar = () => new Promise((resolve) => setImmediate(resolve));
const rotuloDe = (botao) => botao.getAttribute('aria-label') || botao.textContent
  || botao.children.map((f) => f.textContent).join('');
const botaoDe = (no, rotulo) => no.querySelectorAll('button').find((b) => rotuloDe(b) === rotulo);

async function montar(estado) {
  const el = new Elemento('div');
  const tela = janela.mount(el, apiFalsa());
  await aguardar();
  tela.update(estado);
  return { el, tela };
}

test('registra o conteudo do ao vivo', () => {
  assert.equal(G.mesaJanelas.aovivo, janela);
});

test('sem canal: palco com o vazio e o formulario como acao, sem Cancelar e sem o iframe', async () => {
  const { el, tela } = await montar(modulo.init());
  try {
    const raiz = el.querySelector('.mjm-live');
    assert.equal(raiz.dataset.superficie, 'palco');
    const vazio = raiz.querySelector('.mj-vazio');
    assert.match(texto(vazio), /Uma live para todos/);
    assert.ok(vazio.querySelector('.mj-vazio-acao form'), 'o formulario do canal e a acao do vazio');
    assert.equal(botaoDe(vazio, 'Cancelar').hidden, true);
    assert.equal(raiz.querySelector('iframe'), null);
  } finally {
    tela.destroy();
  }
});

test('com canal: o iframe da Twitch aparece, o vazio some, e Trocar canal o traz de volta com Cancelar', async () => {
  const { el, tela } = await montar({ channel: 'gaules' });
  try {
    const raiz = el.querySelector('.mjm-live');
    assert.equal(raiz.querySelector('.mjm-empty').hidden, true);
    assert.equal(raiz.querySelector('iframe').getAttribute('title'), 'Twitch: gaules');
    botaoDe(raiz, 'Trocar canal').dispatch('click');
    assert.equal(raiz.querySelector('.mjm-empty').hidden, false);
    assert.equal(botaoDe(raiz.querySelector('.mj-vazio'), 'Cancelar').hidden, false);
  } finally {
    tela.destroy();
  }
});
