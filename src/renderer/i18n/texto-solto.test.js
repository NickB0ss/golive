'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { textosSoltos, ARQUIVOS_VARRIDOS } = require('../../../tools/i18n/literais');

const RAIZ = path.join(__dirname, '..', '..', '..');
const ARQ_PENDENTES = path.join(RAIZ, 'tools', 'i18n', 'pendentes.json');
const pendentes = fs.existsSync(ARQ_PENDENTES) ? JSON.parse(fs.readFileSync(ARQ_PENDENTES, 'utf8')) : {};

test('nenhum arquivo ganhou texto visivel fora dos dicionarios', () => {
  const problemas = [];
  for (const relativo of ARQUIVOS_VARRIDOS(RAIZ)) {
    const arquivo = path.join(RAIZ, relativo);
    const soltos = textosSoltos(relativo, fs.readFileSync(arquivo, 'utf8'));
    const sobra = new Map();
    for (const texto of pendentes[relativo] || []) sobra.set(texto, (sobra.get(texto) || 0) + 1);
    const novos = [];
    for (const solto of soltos) {
      const quantidade = sobra.get(solto.texto) || 0;
      if (quantidade > 0) sobra.set(solto.texto, quantidade - 1);
      else novos.push(solto);
    }
    if (novos.length) {
      const exemplos = novos
        .slice(0, 5)
        .map((solto) => `  ${solto.linha}: ${solto.texto.slice(0, 70)}`)
        .join('\n');
      problemas.push(`${relativo}: ${novos.length} texto(s) solto(s) novo(s). Use t(). Ex.:\n${exemplos}`);
    } else if ([...sobra.values()].some((quantidade) => quantidade > 0)) {
      problemas.push(`${relativo}: perdeu textos soltos; rode node tools/i18n/contar.js --gravar`);
    }
  }
  assert.deepEqual(problemas, []);
});
