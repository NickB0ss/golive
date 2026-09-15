'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cssPath = path.join(__dirname, 'style.css');

function declarations(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  const stack = [];
  let segment = '';
  let line = 1;

  // A ultima declaracao de um bloco pode vir sem ';' (`.x { color: #fff }`):
  // fechar o bloco tambem conta como fim de declaracao, senao ela escapava.
  const flush = () => {
    const match = segment.match(/^\s*([\w-]+)\s*:\s*([^;{}]+)$/);
    if (match) found.push({ property: match[1], value: match[2].trim(), stack: [...stack], line });
    segment = '';
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\n') line += 1;
    if (char === '{') {
      stack.push(segment.trim());
      segment = '';
    } else if (char === '}') {
      flush();
      stack.pop();
    } else if (char === ';') {
      flush();
    } else {
      segment += char;
    }
  }
  return found;
}

function isRootBlock(stack) {
  return stack.some((entry) => /^:root(?:\[data-theme=(?:"[^"]+"|'[^']+'|[^\]]+)\])?$/.test(entry));
}

// Excecao legada documentada: o botao nativo de fechar ainda usa as cores
// do Windows, e esta frente nao reescreve sua aparencia.
const ALLOWED_LITERAL_SELECTORS = new Set([
  '.titlebar-btn-close:hover',
  '.titlebar-btn-close:active',
]);

test('style.css respeita piso de 11px e nao usa backdrop-filter', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  const rules = declarations(css);
  // `!important` nao muda o tamanho -- sem aceita-lo, `10px !important` passava.
  const small = rules.filter(({ property, value }) => property === 'font-size' && /^\d+(?:\.\d+)?px(?:\s*!important)?$/.test(value) && Number.parseFloat(value) < 11);
  assert.deepEqual(small, [], `font-size abaixo de 11px: ${small.map((rule) => `${rule.line}: ${rule.value}`).join(', ')}`);
  assert.deepEqual(rules.filter(({ property }) => property === 'backdrop-filter'), [], 'backdrop-filter e proibido');
});

test('cores literais ficam restritas aos tokens dos blocos de tema', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  const literal = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl)\(/i;
  const violations = declarations(css).filter(({ value, stack }) => (
    literal.test(value) && !isRootBlock(stack) && !ALLOWED_LITERAL_SELECTORS.has(stack.at(-1))
  ));
  assert.deepEqual(violations, [], `cor literal fora de bloco de tema: ${violations.map((rule) => `${rule.line}: ${rule.stack.at(-1)} -> ${rule.value}`).join('; ')}`);
});

test('estrutura moderna mantem dock no fluxo e camadas por tokens', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /--z-stage:\s*\d+;/, 'falta token da camada do palco');
  assert.match(css, /--z-popover:\s*\d+;/, 'falta token da camada de popovers');
  assert.match(css, /--z-modal:\s*\d+;/, 'falta token da camada de dialogos');
  assert.match(css, /--z-toast:\s*\d+;/, 'falta token da camada de toasts');
  assert.match(css, /--z-titlebar:\s*\d+;/, 'falta token da camada da faixa de titulo');
  assert.match(css, /\.control-bar\s*\{[^}]*position:\s*static;/s, 'o dock deve permanecer no fluxo');
  assert.match(css, /\.room-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill, minmax\(260px, 1fr\)\)/s, 'a lista de salas deve ser uma grade de cards');
});

test('estado vazio da grade nao vaza para outros elementos', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  const unscoped = declarations(css).filter(({ stack }) => /^\.empty(?:::?(?:before|after))?$/.test(stack.at(-1)));
  assert.deepEqual(unscoped, [], `seletor .empty sem escopo: ${unscoped.map((rule) => rule.line).join(', ')}`);
});
