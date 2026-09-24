'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpyState } = require('./espiar');

test('estado de espiar abre um tile e troca o conteudo sem criar outro estado', () => {
  const state = createSpyState();
  assert.deepEqual(state.open('peer-1'), { action: 'open', tileId: 'peer-1' });
  assert.deepEqual(state.open('peer-2'), { action: 'replace', tileId: 'peer-2' });
  assert.equal(state.tileId(), 'peer-2');
});

test('estado de espiar so fecha para o tile que esta aberto', () => {
  const state = createSpyState();
  state.open('peer-1');
  assert.equal(state.closeFor('peer-2'), false);
  assert.equal(state.tileId(), 'peer-1');
  assert.equal(state.closeFor('peer-1'), true);
  assert.equal(state.tileId(), null);
});

test('estado de espiar fecha quando a janela filha avisa que acabou', () => {
  const state = createSpyState();
  state.open('peer-1');
  assert.equal(state.closed('peer-2'), false);
  assert.equal(state.closed('peer-1'), true);
  assert.equal(state.tileId(), null);
});

const fs = require('node:fs');
const path = require('node:path');
const { SPY_THEME_VARS, spyThemeVars, sanitizeSpyTheme } = require('./espiar');
const { PRESETS, tokensFor } = require('./theme');

// Le os tokens como getComputedStyle leria na janela principal com o tema
// aplicado (o valor computado de uma variavel vem com espaco na frente).
function readerFor(tokens) {
  const vars = {
    '--bg': tokens.surfaces.bg, '--tx': tokens.surfaces.tx, '--tx2': tokens.surfaces.tx2,
    '--s2': tokens.surfaces.s2, '--s4': tokens.surfaces.s4, '--act': tokens.act,
  };
  return (name) => ` ${vars[name] ?? ''}`;
}

test('espiar segue cada predefinicao de tema, inclusive a clara (A15)', () => {
  for (const [id, preset] of Object.entries(PRESETS)) {
    const vars = spyThemeVars(readerFor(preset));
    assert.deepEqual(Object.keys(vars).sort(), Object.keys(SPY_THEME_VARS).sort(), `faltou variavel no tema ${id}`);
    assert.equal(vars['--spy-bg'], preset.surfaces.bg, `fundo do Espiar no tema ${id}`);
    assert.equal(vars['--spy-fg'], preset.surfaces.tx, `texto do Espiar no tema ${id}`);
    assert.equal(vars['--spy-act'], preset.act, `acento do Espiar no tema ${id}`);
  }
  assert.equal(spyThemeVars(readerFor(PRESETS.paper))['--spy-bg'], '#FCFAF7', 'Papel abre o Espiar claro');
});

test('espiar segue o acento trocado por cima da predefinicao', () => {
  const tokens = tokensFor({ preset: 'paper', act: '#0F766E' });
  const vars = spyThemeVars(readerFor(tokens));
  assert.equal(vars['--spy-act'], tokens.act);
  assert.equal(vars['--spy-bg'], PRESETS.paper.surfaces.bg);
});

test('espiar ignora token vazio e valor que nao e cor', () => {
  const vars = spyThemeVars((name) => ({ '--bg': '', '--tx': 'red; background: url(x)' })[name] ?? '#123456');
  assert.equal(vars['--spy-bg'], undefined);
  assert.equal(vars['--spy-fg'], undefined);
  assert.equal(vars['--spy-muted'], '#123456');

  assert.deepEqual(sanitizeSpyTheme({ '--spy-bg': 'rgb(1, 2, 3)', '--spy-fg': 'expression(x)', '--outra': '#fff' }), { '--spy-bg': 'rgb(1, 2, 3)' });
  assert.deepEqual(sanitizeSpyTheme(null), {});
  assert.deepEqual(sanitizeSpyTheme('#fff'), {});
});

test('espiar.html abre com o tema GoLive e usa cada cor do tema', () => {
  const html = fs.readFileSync(path.join(__dirname, 'espiar.html'), 'utf8');
  const defaults = spyThemeVars(readerFor(PRESETS.marca));
  for (const [name, value] of Object.entries(defaults)) {
    const declared = html.match(new RegExp(`${name}:\\s*(#[0-9a-f]+)`, 'i'));
    assert.ok(declared, `espiar.html precisa declarar ${name}`);
    assert.equal(declared[1].toUpperCase(), value.toUpperCase(), `${name} padrao difere do tema GoLive`);
    assert.match(html, new RegExp(`var\\(${name}\\)`), `${name} declarada e nunca usada`);
  }
  const lib = html.indexOf('src="espiar.js"');
  assert.ok(lib > -1 && lib < html.indexOf('src="espiar-page.js"'), 'espiar.js precisa carregar antes de espiar-page.js');
});
