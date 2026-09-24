'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../mesa-modules/roleta');
require('./comum');
const janela = require('./roleta');

test('registra o conteudo da roleta', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.roleta, janela);
});

test('pontoEm: topo, direita, baixo (sentido horario a partir do topo)', () => {
  assert.deepEqual(janela.pontoEm(10, 0), [0, -10]);
  assert.deepEqual(janela.pontoEm(10, 90), [10, 0]);
  assert.deepEqual(janela.pontoEm(10, 180).map(Math.round), [0, 10]);
});

test('fatias: n fatias iguais comecando no topo, vizinhas com tons diferentes', () => {
  for (const n of [2, 3, 4, 5, 7, 16]) {
    const f = janela.fatias(n);
    assert.equal(f.length, n);
    assert.equal(f[0].a0, 0);
    assert.equal(f[n - 1].a1, 360);
    for (let i = 0; i < n; i++) {
      const prox = f[(i + 1) % n];
      if (n > 1) assert.notEqual(f[i].tom, prox.tom, `n=${n} fatia ${i}`);
    }
  }
  assert.deepEqual(janela.fatias(0), []);
});

test('o angulo do spinAngle poe o meio da fatia sorteada sob o ponteiro do desenho', () => {
  // O disco gira `ang` no sentido horario; um ponto a `phi` do topo vai
  // para phi + ang. O ponteiro esta no topo (0).
  const n = 5;
  const f = janela.fatias(n);
  for (let index = 0; index < n; index++) {
    const spin = { index, turns: 3, offset: 0.5 };
    const ang = m.spinAngle(spin, n);
    const sob = ((360 - (ang % 360)) + 360) % 360; // ponto do disco que fica no topo
    assert.ok(sob >= f[index].a0 && sob <= f[index].a1, `fatia ${index}: ${sob}`);
  }
});

test('rotuloFatia corta pelo numero de fatias', () => {
  assert.equal(janela.rotuloFatia('Hambúrguer', 4), 'Hambúrguer');
  assert.equal(janela.rotuloFatia('Japonês de novo', 5), 'Japonês de…');
  assert.equal(janela.rotuloFatia('Churrascaria', 12), 'Churras…');
});

test('resultado: o do giro, o ultimo depois de mexer nas opcoes, ou nada', () => {
  let s = m.reduce(m.init(), { kind: 'setOptions', options: ['Pizza', 'Sushi'] });
  assert.equal(janela.resultado(s), '');
  s = m.reduce(s, { kind: 'spin', index: 1, turns: 3, offset: 0.5, at: 10, by: '2' });
  assert.equal(janela.resultado(s), 'Deu Sushi');
  s = m.reduce(s, { kind: 'add', text: 'Tacos' });
  assert.equal(janela.resultado(s), 'Da última vez: Sushi');
});

test('precisaAnimar: giro novo anima; quem chega depois do fim ve parado', () => {
  const spin = { index: 0, turns: 3, offset: 0.5, at: 1000 };
  assert.equal(janela.precisaAnimar(spin, 1500, janela.GIRO_MS), true);
  assert.equal(janela.precisaAnimar(spin, 1000 + janela.GIRO_MS + 1, janela.GIRO_MS), false);
  assert.equal(janela.precisaAnimar({ ...spin, at: null }, 99999, janela.GIRO_MS), true);
  assert.equal(janela.precisaAnimar(null, 0, 1), false);
});
