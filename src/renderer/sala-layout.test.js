'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ordenarPresencas, recolhimentoAutomatico } = require('./sala-layout');

test('ordena ao vivo primeiro e deixa voce por ultimo na sala', () => {
  const secoes = ordenarPresencas([
    { id: 'b', name: 'Bia', live: false },
    { id: 'a', name: 'Ana', live: true },
    { id: 'c', name: 'Caio', live: false },
    { id: 'me', name: 'Você', live: false, isSelf: true },
  ]);

  assert.deepEqual(secoes.aoVivo.map((pessoa) => pessoa.id), ['a']);
  assert.deepEqual(secoes.naSala.map((pessoa) => pessoa.id), ['b', 'c', 'me']);
});

test('recolhe pelas larguras sem substituir escolha manual', () => {
  assert.deepEqual(recolhimentoAutomatico(1279, {}), {
    pessoas: 'recolhido',
    chat: 'aberto',
  });
  assert.deepEqual(recolhimentoAutomatico(1099, {}), {
    pessoas: 'recolhido',
    chat: 'recolhido',
  });
  assert.deepEqual(recolhimentoAutomatico(1000, { pessoas: 'aberto', chat: 'aberto' }), {
    pessoas: 'aberto',
    chat: 'aberto',
  });
});

test('quem esta no ar (camera ou tela pausada) vai para ao vivo pelo estado do no', () => {
  const { aoVivo, naSala } = ordenarPresencas([
    { id: 'c', name: 'Caio', live: false, noAr: true },
    { id: 'l', name: 'Leo', live: true, noAr: true },
    { id: 'n', name: 'Nick', live: false, noAr: false, isSelf: true },
  ]);
  assert.deepEqual(aoVivo.map((p) => p.id), ['c', 'l']);
  assert.deepEqual(naSala.map((p) => p.id), ['n']);
});
