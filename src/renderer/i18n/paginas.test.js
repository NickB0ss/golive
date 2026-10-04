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

test('catraca: frase com palavra de uma letra no meio conta; bloco de dados marcado nao conta', () => {
  const { textosSoltos } = require('../../../tools/i18n/literais');
  const js = [
    "const a = 'Escolha a palavra';",
    '// i18n: dados',
    "const B = ['jacaré', 'guitarra acústica'];",
    '// i18n: fim dos dados',
    "const c = 'Abra o menu';",
  ].join('\n');
  assert.deepEqual(textosSoltos('x.js', js).map((s) => s.texto), ['Escolha a palavra', 'Abra o menu']);
});

test('catraca: analisa trecho estatico depois de interpolacao, inclusive template aninhado', () => {
  const js = 'const frase = `Antes $' + '{`Parar de assistir $' + '{x} agora`} Agora vai`;';
  assert.deepEqual(textosSoltos('x.js', js).map((s) => s.texto), ['Parar de assistir', 'Agora vai']);
});

test('catraca: template so com classes CSS nao e texto de tela', () => {
  const js = 'const classes = `btn-$' + '{estado} primary-action`;';
  assert.deepEqual(textosSoltos('x.js', js), []);
});
