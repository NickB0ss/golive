'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const tetoRecebido = require('./tetorecebido');

test('OPCOES oferece os quatro tetos da qualidade recebida', () => {
  assert.deepEqual(tetoRecebido.OPCOES, [
    { id: 'auto', largura: null },
    { id: '1080p', largura: 1920 },
    { id: '720p', largura: 1280 },
    { id: '480p', largura: 854 },
  ]);
});

test('combinar conserva ausencia de tetos', () => {
  assert.equal(tetoRecebido.combinar(null, null), null);
});

test('combinar conserva o teto escolhido sem Mesa', () => {
  assert.equal(tetoRecebido.combinar(1280, null), 1280);
});

test('combinar usa o menor teto', () => {
  assert.equal(tetoRecebido.combinar(1920, 900), 900);
});

test('combinar deixa a Mesa limitar escolha auto', () => {
  assert.equal(tetoRecebido.combinar(null, 900), 900);
});

test('escolha sem escolha volta para auto', () => {
  assert.equal(tetoRecebido.escolha('bia:screen'), 'auto');
});

test('escolher guarda o teto para a tela indicada', () => {
  tetoRecebido.escolher('ana:screen', '1080p');
  assert.equal(tetoRecebido.escolha('ana:screen'), '1080p');
});

test('escolher rejeita qualidade desconhecida', () => {
  assert.throws(() => tetoRecebido.escolher('bia:screen', '360p'), /qualidade desconhecida/i);
});

test('limpar devolve a escolha para auto', () => {
  tetoRecebido.escolher('caio:screen', '720p');
  tetoRecebido.limpar('caio:screen');
  assert.equal(tetoRecebido.escolha('caio:screen'), 'auto');
});

test('bloqueado sem funcao injetada devolve false', () => {
  assert.equal(tetoRecebido.bloqueado('duda:screen'), false);
});

test('bloqueado usa a funcao injetada', () => {
  tetoRecebido.definirBloqueio((tileId) => tileId === 'elisa:screen');
  assert.equal(tetoRecebido.bloqueado('elisa:screen'), true);
  assert.equal(tetoRecebido.bloqueado('fabio:screen'), false);
});

test('definirBloqueio rejeita valor que nao e funcao', () => {
  assert.throws(() => tetoRecebido.definirBloqueio('bloquear'), /função/i);
});

test('escolher avisa a mudanca pela funcao injetada', () => {
  const avisos = [];
  tetoRecebido.definirAoMudar((tileId, id) => avisos.push([tileId, id]));
  tetoRecebido.escolher('fabio:screen', '480p');
  assert.deepEqual(avisos, [['fabio:screen', '480p']]);
});

test('definirAoMudar rejeita valor que nao e funcao', () => {
  assert.throws(() => tetoRecebido.definirAoMudar(42), /função/i);
});

test('larguraEscolhida traduz a escolha em px', () => {
  tetoRecebido.escolher('gabi:screen', '720p');
  assert.equal(tetoRecebido.larguraEscolhida('gabi:screen'), 1280);
});

test('larguraEscolhida sem escolha e null', () => {
  assert.equal(tetoRecebido.larguraEscolhida('hugo:screen'), null);
});
