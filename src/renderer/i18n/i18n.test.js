'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('./index');
const pt = require('./pt-BR');
const en = require('./en');

beforeEach(() => i18n.definirIdioma('pt-BR'));

test('idioma desconhecido cai no pt-BR', () => {
  assert.equal(i18n.definirIdioma('fr'), 'pt-BR');
  assert.equal(i18n.definirIdioma('en'), 'en');
  assert.equal(i18n.idiomaAtivo(), 'en');
});

test('t troca marcadores e mantem os que nao vieram', () => {
  pt['teste.ola'] = 'Ola, {nome}! {resto}';
  try {
    assert.equal(i18n.t('teste.ola', { nome: 'Ana' }), 'Ola, Ana! {resto}');
  } finally {
    delete pt['teste.ola'];
  }
});

test('t usa o pt-BR quando falta a chave no idioma ativo', () => {
  pt['teste.so.pt'] = 'so em portugues';
  try {
    i18n.definirIdioma('en');
    assert.equal(i18n.t('teste.so.pt'), 'so em portugues');
  } finally {
    delete pt['teste.so.pt'];
  }
});

test('t devolve a propria chave quando ela nao existe em lugar nenhum', () => {
  assert.equal(i18n.t('nao.existe.mesmo'), 'nao.existe.mesmo');
});

test('plural escolhe a forma pelo n', () => {
  pt['teste.votos'] = { one: '{n} voto', other: '{n} votos' };
  en['teste.votos'] = { one: '{n} vote', other: '{n} votes' };
  try {
    assert.equal(i18n.t('teste.votos', { n: 1 }), '1 voto');
    assert.equal(i18n.t('teste.votos', { n: 3 }), '3 votos');
    i18n.definirIdioma('en');
    assert.equal(i18n.t('teste.votos', { n: 0 }), '0 votes');
  } finally {
    delete pt['teste.votos'];
    delete en['teste.votos'];
  }
});

test('codigo e traduzirCodigo fazem ida e volta, inclusive com valores', () => {
  pt['teste.aposta'] = 'Aposta de {min} a {max}';
  try {
    const codigo = i18n.codigo('teste.aposta', { min: 10, max: 500 });
    assert.equal(codigo, 'teste.aposta?min=10&max=500');
    assert.equal(i18n.traduzirCodigo(codigo), 'Aposta de 10 a 500');
    assert.equal(i18n.codigo('teste.aposta'), 'teste.aposta');
  } finally {
    delete pt['teste.aposta'];
  }
});

test('traduzirCodigo deixa texto livre passar intacto', () => {
  assert.equal(i18n.traduzirCodigo('Nome de pessoa'), 'Nome de pessoa');
  assert.equal(i18n.traduzirCodigo('mesa.nao.existe'), 'mesa.nao.existe');
  assert.equal(i18n.traduzirCodigo(null), '');
});

test('formatacao segue o idioma ativo', () => {
  const ts = Date.UTC(2026, 9, 3, 15, 4);
  i18n.definirIdioma('pt-BR');
  assert.match(i18n.formatarData(ts), /outubro/);
  i18n.definirIdioma('es');
  assert.match(i18n.formatarData(ts), /octubre/);
  i18n.definirIdioma('en');
  assert.match(i18n.formatarData(ts), /October/);
  assert.equal(i18n.maiuscula('agua'), 'Agua');
});
