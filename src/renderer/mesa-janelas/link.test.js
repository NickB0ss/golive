'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../mesa-modules/link');
require('./comum');
const janela = require('./link');
const jamJanela = require('./jam');

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
