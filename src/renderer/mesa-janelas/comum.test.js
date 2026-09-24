'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('./comum');

test('carregar no Node nao precisa de DOM e registra o apoio', () => {
  assert.equal(globalThis.GoLive.mesaJanelasComum, C);
  assert.equal(typeof globalThis.GoLive.mesaJanelas, 'object');
});

test('motivoRecusa: invalid mostra o motivo do modulo; o resto vira frase em PT', () => {
  assert.equal(C.motivoRecusa('invalid', 'o placar não fica negativo'), 'O placar não fica negativo');
  assert.equal(C.motivoRecusa('locked'), 'Só o líder da sala mexe na mesa agora');
  assert.equal(C.motivoRecusa('rate'), 'Muitas ações seguidas; espere um instante');
  assert.equal(C.motivoRecusa('coisa-nova'), 'Não deu certo; tente de novo');
  assert.equal(C.motivoRecusa('invalid', ''), 'Não deu certo; tente de novo');
});

test('milhar e plural', () => {
  assert.equal(C.milhar(1000), '1 000');
  assert.equal(C.milhar(999), '999');
  assert.equal(C.milhar(1234567), '1 234 567');
  assert.equal(C.plural(1, 'voto', 'votos'), '1 voto');
  assert.equal(C.plural(0, 'voto', 'votos'), '0 votos');
});

test('podeFazer: true passa; motivo vem com maiuscula; validate que lanca desliga', () => {
  assert.equal(C.podeFazer({ validate: () => true }, {}), true);
  assert.equal(C.podeFazer({ validate: () => 'ação desconhecida' }, {}), 'Ação desconhecida');
  assert.equal(C.podeFazer({ validate: () => { throw new Error('x'); } }, {}), 'Indisponível');
  assert.equal(C.podeFazer({ validate: () => false }, {}), 'Indisponível');
});

test('nomeDe e corDe aguentam pessoa que saiu e api que lanca', () => {
  const api = { nameOf: (id) => (id === '1' ? 'Ana' : null), colorFor: (id) => (id === '1' ? '#4ade80' : 'vermelho') };
  assert.equal(C.nomeDe(api, '1'), 'Ana');
  assert.equal(C.nomeDe(api, '9'), 'Alguém');
  assert.equal(C.nomeDe(api, null), 'Alguém');
  assert.equal(C.corDe(api, '1'), '#4ade80');
  assert.equal(C.corDe(api, '2'), null);
  assert.equal(C.corDe({ colorFor() { throw new Error('x'); } }, '1'), null);
});
