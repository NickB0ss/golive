'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStallWatch } = require('./stallwatch');

const OPTS = { stallMs: 6000, cooldownMs: 20000, maxAttempts: 3 };

test('tela recem-assistida sem nenhum quadro pede cura so depois do limite', () => {
  const w = createStallWatch(OPTS);
  assert.equal(w.observe('7|screen', { watched: true, frames: 105, now: 0 }), null);
  assert.equal(w.observe('7|screen', { watched: true, frames: 105, now: 5000 }), null);
  assert.deepEqual(w.observe('7|screen', { watched: true, frames: 105, now: 6000 }), { action: 'heal', stalledFor: 6000, attempts: 1 });
});

test('respeita o intervalo entre tentativas e desiste uma vez so', () => {
  const w = createStallWatch(OPTS);
  w.observe('k', { watched: true, frames: 0, now: 0 });
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 6000 }).action, 'heal');
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 20000 }), null, 'dentro do intervalo');
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 26000 }).attempts, 2);
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 46000 }).attempts, 3);
  assert.deepEqual(w.observe('k', { watched: true, frames: 0, now: 66000 }), { action: 'give-up', stalledFor: 66000, attempts: 3 });
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 90000 }), null, 'nao repete o aviso');
});

test('tela que ja mostrou quadro e parou (conteudo parado) nao dispara', () => {
  const w = createStallWatch(OPTS);
  w.observe('k', { watched: true, frames: 10, now: 0 });
  w.observe('k', { watched: true, frames: 40, now: 1000 });
  assert.equal(w.observe('k', { watched: true, frames: 40, now: 60000 }), null);
});

test('avisa quando volta a mostrar quadro depois de uma cura', () => {
  const w = createStallWatch(OPTS);
  w.observe('k', { watched: true, frames: 0, now: 0 });
  w.observe('k', { watched: true, frames: 0, now: 6000 });
  assert.deepEqual(w.observe('k', { watched: true, frames: 3, now: 9000 }), { action: 'recovered', attempts: 1 });
});

test('tile recriado (contador reiniciou) nao zera as tentativas', () => {
  const w = createStallWatch(OPTS);
  w.observe('k', { watched: true, frames: 105, now: 0 });
  assert.equal(w.observe('k', { watched: true, frames: 105, now: 6000 }).attempts, 1);
  // A cura refez a conexao: o <video> novo comeca do zero e segue sem imagem.
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 7000 }), null);
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 13000 }), null, 'ainda no intervalo da tentativa 1');
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 27000 }).attempts, 2);
});

test('parar de assistir (ou medida indisponivel) esquece o estado', () => {
  const w = createStallWatch(OPTS);
  w.observe('k', { watched: true, frames: 0, now: 0 });
  assert.equal(w.observe('k', { watched: false, frames: 0, now: 3000 }), null);
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 4000 }), null, 'recomeca a contar');
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 9000 }), null);
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 10000 }).action, 'heal');
  assert.equal(w.observe('k', { watched: true, frames: null, now: 11000 }), null);
});

test('reset esquece tentativas e intervalo da sessao anterior', () => {
  const w = createStallWatch(OPTS);
  w.observe('7|screen', { watched: true, frames: 0, now: 0 });
  assert.equal(w.observe('7|screen', { watched: true, frames: 0, now: 6000 }).attempts, 1);

  w.reset();
  w.observe('7|screen', { watched: true, frames: 0, now: 7000 });
  assert.equal(w.observe('7|screen', { watched: true, frames: 0, now: 13000 }).attempts, 1);
});
