'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolverIdioma, lerPreferencia, gravarPreferencia } = require('./idioma');

function fsFalso(inicial) {
  const arquivos = { ...inicial };
  return {
    arquivos,
    readFileSync: (arquivo, encoding) => {
      assert.equal(encoding, 'utf8');
      if (!(arquivo in arquivos)) throw new Error('ENOENT');
      return arquivos[arquivo];
    },
    writeFileSync: (arquivo, conteudo, encoding) => {
      assert.equal(encoding, 'utf8');
      arquivos[arquivo] = conteudo;
    },
  };
}

test('preferencia explicita vence o sistema', () => {
  assert.equal(resolverIdioma('es', ['pt-BR']), 'es');
  assert.equal(resolverIdioma('pt-BR', ['en-US']), 'pt-BR');
});

test('auto usa o primeiro idioma do sistema que o app tem', () => {
  assert.equal(resolverIdioma('auto', ['pt-PT']), 'pt-BR');
  assert.equal(resolverIdioma('auto', ['en-GB', 'pt-BR']), 'en');
  assert.equal(resolverIdioma('auto', ['es-MX']), 'es');
  assert.equal(resolverIdioma('auto', ['fr-FR', 'es-ES']), 'es');
  assert.equal(resolverIdioma('auto', ['PT_br']), 'pt-BR');
});

test('sem idioma conhecido no sistema, ingles', () => {
  assert.equal(resolverIdioma('auto', ['fr-FR', 'de-DE']), 'en');
  assert.equal(resolverIdioma('auto', []), 'en');
  assert.equal(resolverIdioma('auto', undefined), 'en');
});

test('preferencia invalida conta como auto', () => {
  assert.equal(resolverIdioma('klingon', ['es-AR']), 'es');
  assert.equal(resolverIdioma(null, ['pt-BR']), 'pt-BR');
});

test('ler: arquivo ausente, quebrado ou com valor estranho da auto', () => {
  assert.equal(lerPreferencia('/x', fsFalso({})), 'auto');
  assert.equal(lerPreferencia('/x', fsFalso({ '/x': '{quebrado' })), 'auto');
  assert.equal(lerPreferencia('/x', fsFalso({ '/x': '{"preferencia":"fr"}' })), 'auto');
  assert.equal(lerPreferencia('/x', fsFalso({ '/x': '{"preferencia":"es"}' })), 'es');
});

test('gravar normaliza, usa UTF-8 e e lido de volta', () => {
  const fsMod = fsFalso({});

  assert.equal(gravarPreferencia('/x', 'en', fsMod), 'en');
  assert.equal(fsMod.arquivos['/x'], '{"preferencia":"en"}');
  assert.equal(lerPreferencia('/x', fsMod), 'en');
  assert.equal(gravarPreferencia('/x', 'xx', fsMod), 'auto');
  assert.equal(lerPreferencia('/x', fsMod), 'auto');
});
