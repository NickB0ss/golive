'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const janela = require('./imagem');
const galeria = require('./galeria');

test('registra o conteudo da imagem e da galeria', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.imagem, janela);
  assert.equal(globalThis.GoLive.mesaJanelas.galeria, galeria);
});

test('imagem: o que dizer no lugar dela', () => {
  assert.match(janela.textoFalta({ msgId: null }, null), /Nenhuma imagem/);
  assert.match(janela.textoFalta({ msgId: '3' }, null), /saiu do histórico/);
  assert.equal(janela.textoFalta({ msgId: '3' }, { image: 'data:' }), null);
  assert.equal(janela.legenda({ name: 'Bia' }), 'Enviada por Bia');
  assert.equal(janela.legenda({ name: '' }), '');
  assert.equal(janela.legenda(null), '');
});

test('galeria: da mais nova para a mais antiga, so o que tem id e imagem', () => {
  const lista = [{ id: '1', image: 'a' }, { id: null, image: 'b' }, { id: '3', image: 'c' }];
  assert.deepEqual(galeria.itens(lista).map((i) => i.id), ['3', '1']);
  assert.deepEqual(lista.map((i) => i.id), ['1', null, '3'], 'nao muda a lista recebida');
  assert.deepEqual(galeria.itens(null), []);
  assert.equal(galeria.contagem(0), 'Nenhuma imagem');
  assert.equal(galeria.contagem(1), '1 imagem');
  assert.equal(galeria.contagem(8), '8 imagens');
});
