'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('./index');

const IDIOMAS = i18n.IDIOMAS;
const dicionarios = Object.fromEntries(IDIOMAS.map((idioma) => [idioma, require(`./${idioma}`)]));
const RAIZ = path.join(__dirname, '..', '..', '..');
const PREFIXOS_DINAMICOS = {};

function marcadores(valor) {
  const textos = typeof valor === 'string' ? [valor] : Object.values(valor || {});
  return [...new Set(textos.flatMap((texto) => {
    return [...String(texto).matchAll(/\{(\w+)\}/g)].map((resultado) => resultado[1]);
  }))].sort();
}

test('as tres linguas tem exatamente as mesmas chaves', () => {
  const base = Object.keys(dicionarios['pt-BR']).sort();
  for (const idioma of IDIOMAS) {
    assert.deepEqual(Object.keys(dicionarios[idioma]).sort(), base, `chaves diferentes em ${idioma}`);
  }
});

function problemasDeConteudo(dicionariosTeste, idiomas) {
  const problemas = [];
  const cheio = (texto) => typeof texto === 'string' && texto.trim() !== '';
  for (const [chave, valor] of Object.entries(dicionariosTeste['pt-BR'])) {
    for (const idioma of idiomas) {
      const atual = dicionariosTeste[idioma][chave];
      if (typeof atual !== typeof valor) {
        problemas.push(`${idioma} ${chave}: forma diferente do pt-BR`);
      }
      if (typeof atual === 'object' && atual !== null) {
        if (!cheio(atual.one) || !cheio(atual.other)) {
          problemas.push(`${idioma} ${chave}: plural sem one/other`);
        }
      } else if (!cheio(atual)) {
        problemas.push(`${idioma} ${chave}: vazio`);
      }
      if (JSON.stringify(marcadores(atual)) !== JSON.stringify(marcadores(valor))) {
        problemas.push(`${idioma} ${chave}: marcadores`);
      }
    }
  }
  return problemas;
}

test('mesmos marcadores, nenhum texto vazio e plural com one other', () => {
  const problemas = problemasDeConteudo(dicionarios, IDIOMAS);
  assert.deepEqual(problemas, []);
});

test('a guarda acusa forma, plural vazio e marcadores diferentes', () => {
  const exemplo = {
    'pt-BR': {
      'teste.frase': 'Ola, {nome}',
      'teste.plural': { one: '{n} item', other: '{n} itens' },
    },
    en: {
      'teste.frase': { one: 'Hello', other: 'Hello' },
      'teste.plural': { one: '{n} item', other: '' },
    },
    es: {
      'teste.frase': 'Hola, {persona}',
      'teste.plural': { one: '{n} elemento', other: '{n} elementos' },
    },
  };
  const problemas = problemasDeConteudo(exemplo, ['pt-BR', 'en', 'es']);
  assert.ok(problemas.includes('en teste.frase: forma diferente do pt-BR'));
  assert.ok(problemas.includes('en teste.plural: plural sem one/other'));
  assert.ok(problemas.includes('es teste.frase: marcadores'));
});

function arquivosFonte(diretorio, encontrados = []) {
  for (const nome of fs.readdirSync(diretorio)) {
    const arquivo = path.join(diretorio, nome);
    if (fs.statSync(arquivo).isDirectory()) {
      if (!/vendor|i18n/.test(nome)) arquivosFonte(arquivo, encontrados);
    } else if (/\.(js|html)$/.test(nome) && !/\.test\.js$|dom-falso/.test(nome)) {
      encontrados.push(arquivo);
    }
  }
  return encontrados;
}

test('toda chave citada no codigo existe no pt-BR', () => {
  const faltando = [];
  const dinamicas = [];
  for (const arquivo of arquivosFonte(path.join(RAIZ, 'src'))) {
    const fonte = fs.readFileSync(arquivo, 'utf8');
    const relativo = path.relative(RAIZ, arquivo);
    const citadas = [
      ...[...fonte.matchAll(/\b(?:t|codigo)\(\s*(['"`])([^'"`$\n]+)\1/g)].map((resultado) => resultado[2]),
      ...[...fonte.matchAll(/\bdata-i18n="([^"]+)"/g)].map((resultado) => resultado[1]),
      ...[...fonte.matchAll(/\bdata-i18n-attr="([^"]+)"/g)].flatMap((resultado) => {
        return resultado[1].split(';').map((par) => par.split(':')[1].trim());
      }),
    ];
    for (const chave of citadas) {
      if (!i18n.existe(chave)) faltando.push(`${relativo}: ${chave}`);
    }
    for (const resultado of fonte.matchAll(/\b(?:t|codigo)\(\s*`([^`$]*)\$\{/g)) {
      if (!(resultado[1] in PREFIXOS_DINAMICOS)) {
        dinamicas.push(`${relativo}: prefixo dinamico nao declarado: ${resultado[1]}`);
      }
    }
  }
  for (const [prefixo, sufixos] of Object.entries(PREFIXOS_DINAMICOS)) {
    for (const sufixo of sufixos()) {
      if (!i18n.existe(prefixo + sufixo)) faltando.push(`dinamica sem chave: ${prefixo}${sufixo}`);
    }
  }
  assert.deepEqual([...faltando, ...dinamicas], []);
});
