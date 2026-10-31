'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarTour, CHAVE_TOUR, PASSOS } = require('./boas-vindas');

function armazenamento() {
  const dados = new Map();
  return { getItem: (k) => dados.get(k) ?? null, setItem: (k, v) => dados.set(k, v) };
}

test('primeira abertura oferece o tour; concluir nao oferece novamente no proximo boot', () => {
  const storage = armazenamento();
  const tour = criarTour(storage);
  assert.equal(tour.deveAbrir(), true);
  assert.equal(tour.indice(), 0);
  for (let i = 1; i < PASSOS.length; i++) {
    assert.equal(tour.avancar(), true);
    assert.equal(tour.indice(), i);
  }
  assert.equal(tour.avancar(), false);
  assert.equal(storage.getItem(CHAVE_TOUR), 'concluido');
  assert.equal(criarTour(storage).deveAbrir(), false);
});

test('pular e persistente, mas rever comeca no primeiro passo e permite voltar', () => {
  const storage = armazenamento();
  const tour = criarTour(storage);
  tour.avancar();
  tour.pular();
  assert.equal(storage.getItem(CHAVE_TOUR), 'pulado');
  assert.equal(criarTour(storage).deveAbrir(), false);
  tour.reiniciar();
  tour.voltar();
  assert.equal(tour.indice(), 0);
  tour.avancar();
  tour.voltar();
  assert.equal(tour.indice(), 0);
  assert.equal(tour.deveAbrir(), false);
});

test('fechar antes de terminar nao registra conclusao e armazenamento indisponivel nao impede o uso', () => {
  const storage = armazenamento();
  const tour = criarTour(storage);
  tour.avancar();
  assert.equal(criarTour(storage).deveAbrir(), true);
  const indisponivel = criarTour({
    getItem() { throw new Error('bloqueado'); },
    setItem() { throw new Error('bloqueado'); },
  });
  assert.equal(indisponivel.deveAbrir(), true);
  assert.doesNotThrow(() => indisponivel.pular());
  assert.equal(indisponivel.deveAbrir(), false);
});
