'use strict';

// Grade da Mesa (spec 2026-09-24, secao 6): --grid e --grid2 em cada tema,
// medidos contra --bg pela trava de contraste. Aparecem (>= 1,1:1) sem
// competir com as janelas (<= 1,4:1); a forte e mais forte que a fina.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const theme = require('./theme');

test('grade da Mesa: --grid e --grid2 dos sete temas ficam entre 1,1:1 e 1,4:1 contra --bg', () => {
  const { min, max } = theme.GRID_CONTRAST;
  assert.equal(Object.keys(theme.PRESETS).length, 7);
  for (const [nome, preset] of Object.entries(theme.PRESETS)) {
    const s = preset.surfaces;
    const fina = theme.contrast(theme.blendOver(s.grid, s.bg), s.bg);
    const forte = theme.contrast(theme.blendOver(s.grid2, s.bg), s.bg);
    assert.ok(fina >= min && fina <= max, `${nome}: --grid ${fina.toFixed(3)}:1`);
    assert.ok(forte >= min && forte <= max, `${nome}: --grid2 ${forte.toFixed(3)}:1`);
    assert.ok(forte > fina, `${nome}: a linha forte tem de ser mais forte que a fina`);
  }
});

test('grade da Mesa: o tema personalizado deriva a grade dentro da faixa em qualquer fundo', () => {
  const { min, max } = theme.GRID_CONTRAST;
  for (const temp of [0, 0.5, 1]) {
    for (const level of [0, 0.25, 0.5, 0.75, 1]) {
      const s = theme.deriveSurfaces({ temp, level });
      for (const nome of ['grid', 'grid2']) {
        const c = theme.contrast(theme.blendOver(s[nome], s.bg), s.bg);
        assert.ok(c >= min && c <= max, `temp ${temp} level ${level}: --${nome} ${c.toFixed(3)}:1`);
      }
    }
  }
});

test('grade da Mesa: validate reprova grade que some ou que grita', () => {
  const base = theme.PRESETS.marca;
  const some = { ...base, surfaces: { ...base.surfaces, grid: 'rgba(237,237,242,.01)' } };
  const grita = { ...base, surfaces: { ...base.surfaces, grid2: 'rgba(237,237,242,.5)' } };
  assert.equal(theme.validate(base).ok, true);
  assert.ok(theme.validate(some).failures.some((f) => f.includes('--grid ')));
  assert.ok(theme.validate(grita).failures.some((f) => f.includes('--grid2')));
});

test('grade da Mesa: blendOver pinta rgba sobre o fundo e recusa o que nao e rgba', () => {
  assert.equal(theme.blendOver('rgba(255,255,255,1)', '#000000'), '#ffffff');
  assert.equal(theme.blendOver('rgba(255, 255, 255, 0)', '#102030'), '#102030');
  assert.equal(theme.blendOver('#ffffff', '#000000'), null);
  assert.equal(theme.blendOver(undefined, '#000000'), null);
});

test('grade da Mesa: o CSS de cada tema traz os mesmos --grid/--grid2 do theme.js', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  const norm = (v) => v.replace(/\s+/g, '').replace(/,0\./g, ',.');
  const bloco = (nome) => {
    const i = nome === 'marca' ? css.indexOf(':root {') : css.indexOf(`:root[data-theme="${nome}"]`);
    assert.ok(i >= 0, `${nome}: bloco CSS`);
    return css.slice(i, css.indexOf('}', i));
  };
  for (const [nome, preset] of Object.entries(theme.PRESETS)) {
    const b = bloco(nome);
    const g1 = b.match(/--grid:\s*(rgba\([^)]*\))/);
    const g2 = b.match(/--grid2:\s*(rgba\([^)]*\))/);
    assert.ok(g1 && g2, `${nome}: bloco CSS sem --grid/--grid2`);
    assert.equal(norm(g1[1]), norm(preset.surfaces.grid), `${nome}: --grid`);
    assert.equal(norm(g2[1]), norm(preset.surfaces.grid2), `${nome}: --grid2`);
  }
});
