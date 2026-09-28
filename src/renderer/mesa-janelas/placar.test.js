'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../mesa-modules/placar');
require('./comum');
const janela = require('./placar');

test('registra o conteudo do placar', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.placar, janela);
  assert.equal(janela.type, 'placar');
  assert.equal(typeof janela.mount, 'function');
});

test('opcoesSerie: sem serie e os impares de 3 a 21', () => {
  const o = janela.opcoesSerie(m);
  assert.deepEqual(o[0], { valor: null, texto: 'Sem série' });
  assert.deepEqual(o.slice(1).map((x) => x.valor), [3, 5, 7, 9, 11, 13, 15, 17, 19, 21]);
  assert.equal(o[1].texto, 'Melhor de 3');
  // Todas as opcoes passam no validate do modulo.
  for (const x of o) assert.equal(m.validate(m.init(), { kind: 'bestOf', n: x.valor }), true);
});

test('textoVencedor e textoSerie', () => {
  let s = m.reduce(m.init(), { kind: 'bestOf', n: 3 });
  assert.equal(janela.textoVencedor(m, s), '');
  assert.equal(janela.textoSerie(s), 'Melhor de 3: fecha com 2');
  s = m.reduce(s, { kind: 'score', team: 1, delta: 1 });
  s = m.reduce(s, { kind: 'score', team: 1, delta: 1 });
  assert.equal(janela.textoVencedor(m, s), 'Vermelho venceu a série');
  assert.equal(janela.textoSerie(m.init()), '');
});

test('botoesDoTime: -1 desliga no zero, +1 desliga quando a serie fecha', () => {
  let s = m.init();
  const validar = (a) => m.validate(s, a);
  assert.equal(janela.botoesDoTime(validar, 0).mais, true);
  assert.equal(janela.botoesDoTime(validar, 0).menos, 'O placar não fica negativo');
  s = m.reduce(s, { kind: 'bestOf', n: 3 });
  s = m.reduce(s, { kind: 'score', team: 0, delta: 1 });
  s = m.reduce(s, { kind: 'score', team: 0, delta: 1 });
  assert.equal(typeof janela.botoesDoTime(validar, 1).mais, 'string');
  assert.equal(janela.botoesDoTime(validar, 0).menos, true);
});
