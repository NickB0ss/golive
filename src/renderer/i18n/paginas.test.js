'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { literaisDoHtml, textosSoltos } = require('../../../tools/i18n/literais');

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

test('o detector de paginas encontra texto e atributo de uma palavra sem ler comentarios', () => {
  const literais = literaisDoHtml(`
    <!-- Comentario longo que nao e texto para a pessoa ler -->
    <span>GoLive</span>
    <button>Entrar</button>
    <button aria-label="Fechar"></button>
  `);

  assert.deepEqual(literais.map((literal) => literal.texto), ['Entrar', 'Fechar']);
});
