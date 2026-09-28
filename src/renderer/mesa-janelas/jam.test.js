'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../mesa-modules/jam');
require('./comum');
const janela = require('./jam');

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
