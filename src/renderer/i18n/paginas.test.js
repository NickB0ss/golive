'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { textosSoltos } = require('../../../tools/i18n/literais');

const RAIZ = path.join(__dirname, '..', '..', '..');
const PAGINAS = [
  'src/renderer/index.html',
  'src/renderer/espiar.html',
  'src/renderer/overlay.html',
  'src/renderer/vazia.html',
];

test('as paginas estaticas nao deixam texto visivel fora dos dicionarios', () => {
  const problemas = PAGINAS.flatMap((pagina) => {
    const conteudo = fs.readFileSync(path.join(RAIZ, pagina), 'utf8');
    return textosSoltos(pagina, conteudo).map((texto) => `${pagina}:${texto.linha}: ${texto.texto}`);
  });

  assert.deepEqual(problemas, []);
});
