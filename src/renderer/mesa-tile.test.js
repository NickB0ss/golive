'use strict';
/*
 * Controles do tile (volume, rabisco, reacoes) dentro da janela da Mesa.
 * O comportamento com DOM de verdade e conferido no banco de prova
 * (tools/mesa-prints/harness.js, `tileNaMesa`); aqui fica o que da para
 * travar sem navegador: o CSS nao esconde as barras, o arrastar da janela
 * pula os controles do tile, e o rabisco nao depende da escala da mesa.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const annotate = require('./annotate');

const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
const vista = fs.readFileSync(path.join(__dirname, 'mesa-view.js'), 'utf8');

/** Blocos `seletores { corpo }` de primeiro nivel: o que esta dentro de
 * @container/@media (a janela estreita) fica de fora. */
function blocos(texto) {
  const t = texto.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < t.length) {
    const abre = t.indexOf('{', i);
    if (abre < 0) break;
    const sel = t.slice(i, abre).trim();
    let prof = 1;
    let j = abre + 1;
    while (j < t.length && prof > 0) {
      if (t[j] === '{') prof += 1;
      else if (t[j] === '}') prof -= 1;
      j += 1;
    }
    if (!sel.startsWith('@')) out.push({ sel, corpo: t.slice(abre + 1, j - 1) });
    i = j;
  }
  return out;
}

test('a janela da Mesa nao esconde a barra de rabisco nem a de reacoes', () => {
  const escondem = blocos(css).filter((b) => /display:\s*none/.test(b.corpo));
  for (const b of escondem) {
    for (const s of b.sel.split(',').map((x) => x.trim())) {
      assert.ok(!/^\.mesa-win \.tile-(annot|react)-bar$/.test(s), `"${s}" some com as barras do tile na Mesa`);
    }
  }
  assert.match(css, /\.mesa-win:hover \.tile-annot-bar/, 'a barra de rabisco aparece com o mouse em cima');
  assert.match(css, /\.mesa-win \.tile\.annot-on \.tile-annot-bar/, 'com o rabisco ligado a barra fica');
  assert.match(css, /\.mesa-win \.tile-react-bar \{[^}]*scale\(var\(--mesa-inv/, 'a barra de reacoes fica do mesmo tamanho com zoom');
});

test('arrastar a janela de video pula os controles do tile', () => {
  const linha = vista.split('\n').find((l) => l.includes('media && e.target.closest('));
  assert.ok(linha, 'a guarda do arrastar existe');
  for (const s of ['button', 'input', '.tile-annot-bar', '.tile-react-bar']) assert.ok(linha.includes(s), `falta ${s}`);
});

test('o menu da janela de video oferece o volume do tile', () => {
  assert.match(vista, /Volume e silenciar/);
  assert.match(vista, /deps\.openTileMenu\(/);
});

test('o ponto do rabisco e o mesmo com qualquer zoom da mesa (transform no conteiner)', () => {
  // Na Mesa, getBoundingClientRect do tile e o retangulo de layout vezes a
  // escala; o clique tambem vem em px da tela. A normalizacao pela caixa do
  // video tem de dar o mesmo ponto em qualquer escala, com e sem letterbox.
  for (const [vw, vh] of [[1280, 720], [1080, 1920], [0, 0]]) {
    const w = 640;
    const h = 360;
    const base = annotate.toNorm(200, 120, annotate.contentRect(vw, vh, w, h));
    for (const z of [0.25, 0.5, 1, 1.2, 2.5]) {
      const r = annotate.contentRect(vw, vh, w * z, h * z);
      const p = annotate.toNorm(200 * z, 120 * z, r);
      assert.ok(Math.abs(p.x - base.x) <= 0.001 && Math.abs(p.y - base.y) <= 0.001, `video ${vw}x${vh}, zoom ${z}: ${JSON.stringify(p)} != ${JSON.stringify(base)}`);
    }
  }
});
