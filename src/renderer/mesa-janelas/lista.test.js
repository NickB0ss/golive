'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../mesa-modules/lista');
require('./comum');
const janela = require('./lista');

function tres() {
  let s = m.init();
  for (const t of ['Refri', 'Salgadinho', 'Controle']) s = m.reduce(s, { kind: 'add', text: t });
  return s;
}

test('registra o conteudo da lista', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.lista, janela);
});

test('contagem', () => {
  assert.equal(janela.contagem(m.init()).texto, 'Lista vazia');
  let s = tres();
  assert.equal(janela.contagem(s).texto, '0 de 3 feitos');
  s = m.reduce(s, { kind: 'check', id: 2, done: true });
  assert.deepEqual(janela.contagem(s), { feitos: 1, total: 3, texto: '1 de 3 feitos' });
  s = m.reduce(m.init(), { kind: 'add', text: 'Só um' });
  assert.equal(janela.contagem(s).texto, '0 de 1 feito');
});

test('destino: sobe, desce e para nas pontas; a acao passa no validate', () => {
  const s = tres();
  assert.equal(janela.destino(s.items, 2, -1), 0);
  assert.equal(janela.destino(s.items, 2, 1), 2);
  assert.equal(janela.destino(s.items, 1, -1), null);
  assert.equal(janela.destino(s.items, 3, 1), null);
  assert.equal(janela.destino(s.items, 99, 1), null);
  assert.equal(m.validate(s, { kind: 'move', id: 2, to: janela.destino(s.items, 2, 1) }), true);
});

test('teclaMove: so Alt+setas', () => {
  assert.equal(janela.teclaMove({ altKey: true, key: 'ArrowUp' }), -1);
  assert.equal(janela.teclaMove({ altKey: true, key: 'ArrowDown' }), 1);
  assert.equal(janela.teclaMove({ altKey: false, key: 'ArrowDown' }), 0);
  assert.equal(janela.teclaMove({ altKey: true, ctrlKey: true, key: 'ArrowDown' }), 0);
  assert.equal(janela.teclaMove({ altKey: true, key: 'Enter' }), 0);
});
