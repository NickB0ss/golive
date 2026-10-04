'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../mesa-modules/link');
require('./comum');
const janela = require('./link');
const jamJanela = require('./jam');
const { Elemento, texto, comDocumento, apiFalsa } = require('./dom-falso-midia');

test('registra o conteudo do Link', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.link, janela);
});

test('apresentar: titulo (ou dominio), dominio e o resto do endereco', () => {
  assert.equal(janela.apresentar(m.init({})), null);
  const s1 = m.reduce(m.init({}), { kind: 'set', url: 'https://example.com/regras?v=2#fim', title: 'Regras' }, { from: '1' });
  assert.deepEqual(janela.apresentar(s1), { titulo: 'Regras', dominio: 'example.com', resto: '/regras?v=2#fim', temTitulo: true });
  const s2 = m.reduce(s1, { kind: 'set', url: 'https://example.com' }, { from: '1' });
  assert.deepEqual(janela.apresentar(s2), { titulo: 'example.com', dominio: 'example.com', resto: '', temTitulo: false });
});

test('a pergunta mostra o dominio', () => {
  assert.equal(janela.pergunta('xn--po-sia.com.br'), 'Abrir xn--po-sia.com.br no seu navegador?');
});

test('abrirNoNavegador pede o tipo link e usa os mesmos motivos do Jam', async () => {
  const pedidos = [];
  const ponte = { abrirLinkDaMesa: async (tipo, url) => { pedidos.push([tipo, url]); return { ok: true }; } };
  assert.equal(await janela.abrirNoNavegador(ponte, 'link', 'https://example.com/'), true);
  assert.deepEqual(pedidos, [['link', 'https://example.com/']]);
  assert.equal(await janela.abrirNoNavegador({ abrirLinkDaMesa: async () => ({ ok: false, reason: 'recusado' }) }, 'link', 'x'),
    'O app não abre este link');
  assert.equal(await janela.abrirNoNavegador(null, 'link', 'x'), 'Abrir no navegador só funciona no app');
  assert.deepEqual(janela.MOTIVOS_ABRIR, jamJanela.MOTIVOS_ABRIR);
});

const rotuloDe = (botao) => botao.getAttribute('aria-label') || botao.children.map((f) => f.textContent).join('');
const botaoDe = (no, rotulo) => no.querySelectorAll('button').find((b) => rotuloDe(b) === rotulo);
const COM_LINK = () => m.reduce(m.init({}), { kind: 'set', url: 'https://example.com/regras', title: 'Regras' }, { from: '1' });

test('sem link o vazio traz o formulario (endereco e titulo) como acao e nao ha Cancelar', () => comDocumento(() => {
  const el = new Elemento('div');
  janela.mount(el, apiFalsa()).update(m.init({}));
  const vazio = el.querySelector('.mj-vazio');
  assert.equal(vazio.hidden, false);
  assert.equal(texto(vazio).includes('Um link para a sala'), true);
  assert.equal(vazio.querySelectorAll('.mj-vazio-acao form input').length, 2);
  assert.equal(botaoDe(vazio, 'Cancelar').hidden, true);
  assert.equal(el.querySelector('.mj-link-cheio').hidden, true);
}));

test('com link: Abrir e a principal, Trocar e Tirar secundarias, e o Abrir pergunta o dominio', () => comDocumento(() => {
  const el = new Elemento('div');
  janela.mount(el, apiFalsa()).update(COM_LINK());
  assert.equal(el.querySelector('.mj-vazio').hidden, true);
  const cheio = el.querySelector('.mj-link-cheio');
  const pe = cheio.querySelector('.mj-acoes');
  assert.deepEqual(pe.querySelectorAll('.mj-pri').map(rotuloDe), ['Abrir no navegador']);
  assert.deepEqual(pe.querySelectorAll('.mj-fantasma').map(rotuloDe), ['Trocar o link', 'Tirar o link da janela']);
  botaoDe(pe, 'Abrir no navegador').dispatch('click');
  assert.equal(pe.hidden, true, 'a pergunta troca o pe');
  const confirma = cheio.querySelector('.mj-link-confirma');
  assert.equal(confirma.hidden, false);
  assert.equal(cheio.querySelector('.mj-link-pergunta').getAttribute('aria-label'), 'Abrir example.com no seu navegador?');
}));
