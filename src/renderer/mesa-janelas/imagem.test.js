'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./comum');
const janela = require('./imagem');
const galeria = require('./galeria');
const { Elemento, texto, comDocumento } = require('./dom-falso-midia');

test('registra o conteudo da imagem e da galeria', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.imagem, janela);
  assert.equal(globalThis.GoLive.mesaJanelas.galeria, galeria);
});

test('imagem: o que dizer no lugar dela (titulo curto e uma frase, sem repetir o da barra)', () => {
  const nenhuma = janela.faltaDaImagem({ msgId: null }, null);
  assert.equal(nenhuma.titulo, 'Nenhuma imagem');
  assert.match(nenhuma.texto, /Pôr na Mesa/);
  const saiu = janela.faltaDaImagem({ msgId: '3' }, null);
  assert.match(saiu.texto, /saiu do histórico/);
  assert.notEqual(saiu.titulo, nenhuma.titulo);
  assert.equal(janela.faltaDaImagem({ msgId: '3' }, { image: 'data:' }), null);
  for (const falta of [nenhuma, saiu]) assert.notEqual(falta.titulo, 'Imagem');
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

/** Historico do chat falso: o que o app.js alimenta em `GoLive.chatImagens`. */
function historico(imagens) {
  globalThis.GoLive.chatImagens = {
    list: () => imagens.slice(),
    get: (id) => imagens.find((i) => i.id === id) || null,
    onChange: () => () => {},
  };
}

test('imagem sem imagem mostra o vazio com a dica do Pôr na Mesa; com imagem ele some', () => comDocumento(() => {
  historico([{ id: '7', image: 'data:image/png;base64,AA', name: 'Bia' }]);
  const el = new Elemento('div');
  const tela = janela.mount(el);
  tela.update({ msgId: null });
  const falta = el.querySelector('.mj-vazio');
  assert.equal(falta.hidden, false);
  assert.match(texto(falta), /Nenhuma imagem/);
  assert.match(texto(falta), /Pôr na Mesa/);
  assert.equal(el.querySelector('.mj-img-foto').hidden, true);
  tela.update({ msgId: '7' });
  assert.equal(falta.hidden, true);
  assert.equal(el.querySelector('.mj-img-foto').hidden, false);
  assert.equal(el.querySelector('.mj-img-legenda').textContent, 'Enviada por Bia');
  tela.update({ msgId: '9' });
  assert.equal(falta.hidden, false);
  assert.match(texto(falta), /saiu do histórico/);
}));

test('galeria vazia diz uma frase so: o vazio aparece e o cabecalho com a contagem sai', () => comDocumento(() => {
  historico([]);
  const el = new Elemento('div');
  const tela = galeria.mount(el);
  tela.update();
  const raiz = el.querySelector('.mj-galeria');
  assert.equal(raiz.querySelector('.mj-vazio').hidden, false);
  assert.equal(raiz.querySelector('.mj-barra').hidden, true);
  assert.equal(raiz.querySelector('.mj-gal-grade').hidden, true);
  assert.equal(texto(raiz).split('Nenhuma imagem').length - 1, 1, 'a frase nao se repete');
}));

test('galeria com imagens: grade, contagem e um Pôr na Mesa por foto; sem o vazio', () => comDocumento(() => {
  historico([{ id: '1', image: 'a', name: 'Ana' }, { id: '2', image: 'b', name: 'Bia' }]);
  const el = new Elemento('div');
  const tela = galeria.mount(el);
  tela.update();
  const raiz = el.querySelector('.mj-galeria');
  assert.equal(raiz.querySelector('.mj-vazio').hidden, true);
  assert.equal(raiz.querySelector('.mj-barra').hidden, false);
  assert.equal(raiz.querySelector('.mj-gal-conta').textContent, '2 imagens');
  assert.equal(raiz.querySelectorAll('.mj-gal-item').length, 2);
  assert.deepEqual(raiz.querySelectorAll('.mj-gal-por').map((b) => b.textContent), ['Pôr na Mesa', 'Pôr na Mesa']);
}));
