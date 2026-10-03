'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../mesa-modules/jam');
require('./comum');
const janela = require('./jam');
const { Elemento, texto, comDocumento, apiFalsa } = require('./dom-falso-midia');

const nomeDe = (id) => ({ 1: 'Ana', 2: 'Bia' })[id] || 'Alguém';
const CURTO = 'https://spotify.link/AbCdEf12345';

test('registra o conteudo do Jam', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.jam, janela);
});

test('host, lista e contagem', () => {
  let s = m.reduce(m.init({}), { kind: 'set', url: CURTO }, { from: '1' });
  s = m.reduce(s, { kind: 'join' }, { from: '2' });
  assert.equal(janela.hostDoLink(s.link), 'spotify.link');
  assert.equal(janela.hostDoLink(null), '');
  assert.equal(janela.hostDoLink('lixo'), '');
  assert.deepEqual(janela.pessoas(s, nomeDe), [{ id: '1', nome: 'Ana' }, { id: '2', nome: 'Bia' }]);
  assert.equal(janela.estouNoJam(s, '2'), true);
  assert.equal(janela.estouNoJam(s, 2), true);
  assert.equal(janela.estouNoJam(s, '3'), false);
  assert.equal(janela.estouNoJam(m.init({}), '1'), false);
  assert.equal(janela.contagem(0), 'Ninguém marcou ainda');
  assert.equal(janela.contagem(1), '1 pessoa no Jam');
  assert.equal(janela.contagem(4), '4 pessoas no Jam');
});

test('abrirNoNavegador: usa a ponte do app e traduz a recusa', async () => {
  const pedidos = [];
  const ponte = { abrirLinkDaMesa: async (tipo, url) => { pedidos.push([tipo, url]); return { ok: true }; } };
  assert.equal(await janela.abrirNoNavegador(ponte, 'jam', CURTO), true);
  assert.deepEqual(pedidos, [['jam', CURTO]]);
  assert.equal(await janela.abrirNoNavegador({ abrirLinkDaMesa: async () => ({ ok: false, reason: 'rapido' }) }, 'jam', CURTO),
    'Espere um instante e clique de novo');
  assert.equal(await janela.abrirNoNavegador({ abrirLinkDaMesa: async () => { throw new Error('x'); } }, 'jam', CURTO),
    janela.motivoAbrir('falhou'));
  assert.equal(await janela.abrirNoNavegador({ abrirLinkDaMesa: async () => null }, 'jam', CURTO), janela.motivoAbrir('?'));
  assert.equal(await janela.abrirNoNavegador(undefined, 'jam', CURTO), 'Abrir no navegador só funciona no app');
});

const rotuloDe = (botao) => botao.getAttribute('aria-label') || botao.children.map((f) => f.textContent).join('');
const botaoDe = (no, rotulo) => no.querySelectorAll('button').find((b) => rotuloDe(b) === rotulo);

test('sem Jam o vazio traz o formulario como acao: sem Cancelar e sem a tela do Jam', () => comDocumento(() => {
  const el = new Elemento('div');
  janela.mount(el, apiFalsa()).update(m.init({}));
  const vazio = el.querySelector('.mj-vazio');
  assert.equal(vazio.hidden, false);
  assert.equal(texto(vazio).includes('Ouvir junto'), true);
  assert.ok(vazio.querySelector('.mj-vazio-acao form'), 'o formulario e a acao do vazio');
  assert.equal(botaoDe(vazio, 'Cancelar').hidden, true, 'nao ha o que cancelar sem Jam');
  assert.equal(el.querySelector('.mj-jam-cheio').hidden, true);
}));

test('com Jam: Entrar e a principal, Trocar e Tirar ficam no pe e o Entrei mora junto da lista', () => comDocumento(() => {
  const el = new Elemento('div');
  const tela = janela.mount(el, apiFalsa({ me: () => '2' }));
  tela.update(m.reduce(m.init({}), { kind: 'set', url: CURTO }, { from: '1' }));
  assert.equal(el.querySelector('.mj-vazio').hidden, true);
  const cheio = el.querySelector('.mj-jam-cheio');
  assert.equal(cheio.hidden, false);
  const pe = cheio.querySelector('.mj-acoes');
  const principal = pe.querySelectorAll('.mj-pri');
  assert.deepEqual(principal.map(rotuloDe), ['Entrar no Jam']);
  assert.deepEqual(pe.querySelectorAll('.mj-fantasma').map(rotuloDe), ['Trocar o link do Jam', 'Tirar o Jam da janela']);
  assert.equal(pe.querySelectorAll('button').length, 3, 'o pe nao repete o Entrei');
  assert.ok(botaoDe(cheio.querySelector('.mj-jam-pessoas'), 'Entrei'), 'Entrei junto da lista de quem entrou');
}));

test('Trocar abre o formulario no vazio, agora com Cancelar', () => comDocumento(() => {
  const el = new Elemento('div');
  const tela = janela.mount(el, apiFalsa());
  tela.update(m.reduce(m.init({}), { kind: 'set', url: CURTO }, { from: '1' }));
  botaoDe(el.querySelector('.mj-acoes'), 'Trocar o link do Jam').dispatch('click');
  const vazio = el.querySelector('.mj-vazio');
  assert.equal(vazio.hidden, false);
  assert.equal(botaoDe(vazio, 'Cancelar').hidden, false);
  assert.equal(el.querySelector('.mj-jam-cheio').hidden, true);
}));
