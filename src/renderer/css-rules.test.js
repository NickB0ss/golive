'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'sinal');
// Toda folha do Sinal entra: um arquivo novo nao pode escapar das regras.
const FILES = fs.readdirSync(DIR).filter((file) => file.endsWith('.css')).sort();
const cssByFile = new Map(FILES.map((file) => [file, fs.readFileSync(path.join(DIR, file), 'utf8')]));

test('as fontes Sinal apontam para arquivos locais existentes', () => {
  const fonts = [...cssByFile.get('tokens.css').matchAll(/@font-face\s*\{([\s\S]*?)\}/g)];
  assert.ok(fonts.length > 0);
  for (const [, block] of fonts) {
    const url = /src:\s*url\('([^']+)'\)/.exec(block)?.[1];
    assert.ok(url, 'cada fonte precisa de URL local');
    assert.ok(fs.existsSync(path.join(DIR, url)), `fonte ausente: ${url}`);
  }
});

test('hidden vence os displays dos componentes', () => {
  assert.match(cssByFile.get('base.css'), /\[hidden\],\s*\.hidden\s*\{\s*display:\s*none\s*!important/);
});

test('folhas Sinal nao usam cores literais fora dos arquivos de tema', () => {
  for (const file of FILES.filter((f) => !['tokens.css', 'themes.css'].includes(f))) {
    const source = cssByFile.get(file).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|\brgba?\(/i, `${file} contem cor literal`);
  }
});

test('important fica restrito a hidden e movimento reduzido', () => {
  for (const [file, source] of cssByFile) {
    if (file === 'base.css') continue;
    assert.doesNotMatch(source, /!important/, `${file} nao pode usar !important`);
  }
  const base = cssByFile.get('base.css');
  const stripped = base
    .replace(/\[hidden\],\s*\.hidden\s*\{[^}]*!important[^}]*\}/g, '')
    .replace(/\.sr-only\s*\{[^}]*!important[^}]*\}/g, '')
    .replace(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\}/g, '');
  assert.doesNotMatch(stripped, /!important/);
});

test('live so marca estados ao vivo e a marca', () => {
  const allowed = /(?:\.node\[data-state=['"](?:live|paused)['"]\]|\.tag--live|\.me__live|\.src\[data-paused\]|\.btn--live|\.brand(?:__mark)?|\.app-brand)/;
  for (const source of cssByFile.values()) {
    for (const match of source.matchAll(/([^{}]+)\{[^{}]*var\(--live\)[^{}]*\}/g)) {
      assert.match(match[1], allowed, `uso indevido de --live em ${match[1].trim()}`);
    }
  }
});

test('z-index usa apenas a escala de tokens', () => {
  for (const [file, source] of cssByFile) {
    if (file === 'tokens.css') continue;
    for (const match of source.matchAll(/z-index\s*:\s*([^;}]*)/g)) {
      assert.match(match[1], /^(?:var\(--z-[\w-]+\)|calc\(var\(--z-[\w-]+\)[^)]+\))\s*$/,
        `${file}: z-index fora da escala: ${match[1]}`);
    }
  }
});

test('a página carrega a pilha Sinal e nao a folha removida', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const file of FILES) assert.match(html, new RegExp(`href="sinal/${file}"`));
  assert.match(html, /href="mesa-janelas\.css"/);
  assert.doesNotMatch(html, /href="style\.css"/);
});
