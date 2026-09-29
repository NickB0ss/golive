'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const registro = require('../../src/renderer/mesa-modules');
const pagina = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function temScript(nome) {
  return pagina.includes(`src="../../src/renderer/${nome}"`);
}

test('bancada carrega modulo e conteudo de cada tipo registrado', () => {
  for (const tipo of registro.MODULE_NAMES) {
    assert.ok(temScript(`mesa-modules/${tipo}.js`), `módulo ausente: ${tipo}`);
    assert.ok(temScript(`mesa-janelas/${tipo}.js`), `conteúdo ausente: ${tipo}`);
  }
});

test('bancada carrega os apoios do registro antes dos módulos', () => {
  for (const apoio of registro.HELPER_NAMES) {
    assert.ok(temScript(`mesa-modules/${apoio}.js`), `apoio ausente: ${apoio}`);
  }
});
