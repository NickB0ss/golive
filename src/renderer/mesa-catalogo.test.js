'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./i18n');
const catalogo = require('./mesa-catalogo');

test('busca por tecla deixa Espaco e Enter no cartao focado', () => {
  assert.equal(catalogo.deveRedirecionarParaBusca('a', true), true);
  assert.equal(catalogo.deveRedirecionarParaBusca(' ', true), false);
  assert.equal(catalogo.deveRedirecionarParaBusca('Enter', true), false);
  assert.equal(catalogo.deveRedirecionarParaBusca('a', false), false);
});
const registro = require('./mesa-modules');
const { t, existe } = require('./i18n');

test('todo tipo adicionavel tem metadados no catalogo', () => {
  for (const mod of registro.addable()) {
    assert.ok(catalogo.itens[mod.type], `faltam metadados para ${mod.type}`);
  }
});

test('filtrar ignora caixa e acento em titulo, grupo e chaves', () => {
  const mods = [
    { type: 'musica', title: 'Música', group: 'assistir' },
    { type: 'truco', title: 'Truco', group: 'jogos' },
  ];
  assert.deepEqual(catalogo.filtrar(mods, 'MUSICA', 'tudo').map((mod) => mod.type), ['musica']);
  assert.deepEqual(catalogo.filtrar(mods, 'assistir e ouvir', 'tudo').map((mod) => mod.type), ['musica']);
  assert.deepEqual(catalogo.filtrar(mods, 'baralho', 'jogos').map((mod) => mod.type), ['truco']);
});

test('lembrarRecente sobe o novo tipo, remove repeticao e guarda quatro', () => {
  assert.deepEqual(
    catalogo.lembrarRecente(['nota', 'truco', 'dados', 'quiz'], 'truco'),
    ['truco', 'nota', 'dados', 'quiz'],
  );
  assert.deepEqual(
    catalogo.lembrarRecente(['nota', 'truco', 'dados', 'quiz'], 'roleta'),
    ['roleta', 'nota', 'truco', 'dados'],
  );
});

test('descricao curta, com texto proprio e sem repetir o titulo', () => {
  for (const mod of registro.addable()) {
    const { descricao } = catalogo.itens[mod.type];
    assert.ok(existe(descricao), `${mod.type}: falta ${descricao}`);
    const desc = t(descricao);
    const titulo = t(mod.title);
    assert.ok(desc.length > 0 && desc.length <= 48, `${mod.type}: descricao com ${desc.length} caracteres`);
    assert.ok(!desc.toLowerCase().startsWith(titulo.toLowerCase()), `${mod.type}: descricao repete o titulo`);
  }
});

test('grupos do catalogo sao chaves que existem', () => {
  for (const chave of Object.values(catalogo.GRUPOS)) assert.ok(existe(chave), chave);
  assert.equal(t(catalogo.GRUPOS.assistir), 'Assistir e ouvir');
});
