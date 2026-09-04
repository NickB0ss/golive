'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PRESETS,
  contrast,
  hueOf,
  hueDistance,
  deriveSurfaces,
  deriveAction,
  validate,
  tokensFor,
  apply,
} = require('./theme');

function luminanceOf(hex) {
  // Aproximacao simples de "quao claro" pra comparar dois hex sem
  // reimportar a formula WCAG inteira aqui -- usa a mesma relacao de
  // ordem (mais luz = numero maior), o suficiente pra testar monotonia.
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test('contrast preto/branco da 21:1 (ou bem perto)', () => {
  const c = contrast('#000000', '#FFFFFF');
  assert.ok(Math.abs(c - 21) < 0.05, `esperava ~21, veio ${c}`);
});

test('contrast e simetrico na ordem dos argumentos', () => {
  const a = contrast('#4F46E5', '#0E0F13');
  const b = contrast('#0E0F13', '#4F46E5');
  assert.equal(a, b);
});

test('hueDistance e circular -- 350deg e 10deg estao a 20deg, nao a 340', () => {
  // vermelho puro (~0deg) contra magenta-avermelhado perto de 350deg
  const d = hueDistance('#ff0000', '#ff0044');
  assert.ok(d < 30, `esperava distancia pequena, veio ${d}`);
});

test('deriveSurfaces: bg fica estritamente mais claro conforme level sobe', () => {
  const niveis = [0, 0.25, 0.5, 0.75, 1];
  let anterior = -Infinity;
  for (const level of niveis) {
    const surf = deriveSurfaces({ temp: 0.5, level });
    const l = luminanceOf(surf.bg);
    assert.ok(l > anterior, `level=${level}: bg (lum ${l}) deveria ser mais claro que o anterior (${anterior})`);
    anterior = l;
  }
});

test('deriveSurfaces: nenhum token da rampa fica mais escuro que no level anterior, pra qualquer temp', () => {
  const niveis = [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1];
  for (const temp of [0, 0.3, 0.5, 0.7, 1]) {
    let anterior = null;
    for (const level of niveis) {
      const surf = deriveSurfaces({ temp, level });
      if (anterior) {
        for (const chave of ['bg', 's1', 's2', 's3', 's4']) {
          assert.ok(
            luminanceOf(surf[chave]) >= luminanceOf(anterior[chave]) - 0.001,
            `temp=${temp} level=${level}: ${chave} ficou mais escuro que no level anterior`,
          );
        }
      }
      anterior = surf;
    }
  }
});

test('deriveSurfaces: a rampa nunca tem dois niveis colados', () => {
  const MIN_GAP = 1.5; // diferenca minima de luminosidade (escala 0-255) entre niveis vizinhos
  for (const temp of [0, 0.5, 1]) {
    for (const level of [0, 0.25, 0.5, 0.75, 1]) {
      const surf = deriveSurfaces({ temp, level });
      const ordem = ['bg', 's1', 's2', 's3', 's4'];
      for (let i = 0; i < ordem.length - 1; i += 1) {
        const gap = Math.abs(luminanceOf(surf[ordem[i + 1]]) - luminanceOf(surf[ordem[i]]));
        assert.ok(gap >= MIN_GAP, `temp=${temp} level=${level}: ${ordem[i]}/${ordem[i + 1]} colados (gap ${gap})`);
      }
    }
  }
});

test('todo preset do catalogo passa em validate', () => {
  for (const nome of Object.keys(PRESETS)) {
    const result = validate(tokensFor({ preset: nome }));
    assert.ok(result.ok, `preset ${nome} falhou: ${result.failures.join('; ')}`);
  }
});

test('acento vermelho perto de --live e reprovado por distancia de matiz, e nearestAct passa', () => {
  const tokens = { ...tokensFor({ preset: 'signal' }), act: '#E63946' };
  const result = validate(tokens);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.includes('°')));
  assert.ok(result.nearestAct, 'deveria sugerir uma cor alternativa');
  assert.ok(hueDistance(result.nearestAct, '#FF4D4F') >= 40 - 0.01);
});

test('deriveAction com acento muito claro escolhe onAct escuro em vez de branco', () => {
  const claro = '#F5F0FF';
  assert.ok(contrast('#ffffff', claro) < 4.5, 'pre-condicao: branco nao deveria passar sobre essa cor');
  const derived = deriveAction(claro);
  assert.notEqual(derived.onAct.toLowerCase(), '#ffffff');
  assert.ok(contrast(derived.onAct, claro) >= 4.5, `onAct deveria passar 4.5:1, deu ${contrast(derived.onAct, claro)}`);
});

test('deriveAction com acento escuro comum aceita branco', () => {
  const derived = deriveAction('#4F46E5');
  assert.equal(derived.onAct.toLowerCase(), '#ffffff');
});

test('tokensFor com preset desconhecido cai no padrao (signal)', () => {
  const tokens = tokensFor({ preset: 'nao-existe' });
  assert.deepEqual(tokens, PRESETS.signal);
});

test('tokensFor com custom sem act valido cai no padrao', () => {
  const tokens = tokensFor({ preset: 'custom', base: { temp: 0.5, level: 0.5 }, act: 'nao-e-hex' });
  assert.deepEqual(tokens, PRESETS.signal);
});

test('tokensFor com custom sem base valida cai no padrao', () => {
  const tokens = tokensFor({ preset: 'custom', base: { temp: 2, level: 0.5 }, act: '#4F46E5' });
  assert.deepEqual(tokens, PRESETS.signal);
});

test('tokensFor com custom ausente/vazio cai no padrao', () => {
  assert.deepEqual(tokensFor(undefined), PRESETS.signal);
  assert.deepEqual(tokensFor({}), PRESETS.signal);
  assert.deepEqual(tokensFor({ preset: 'custom' }), PRESETS.signal);
});

test('tokensFor com custom valido deriva surfaces e action, nao devolve preset fixo', () => {
  const tokens = tokensFor({ preset: 'custom', base: { temp: 0.2, level: 0.1 }, act: '#4F8EF7' });
  assert.equal(tokens.act, '#4F8EF7');
  assert.ok(tokens.surfaces.bg);
  assert.ok(tokens.onAct);
});

test('hueOf de --live e estavel (regressao simples)', () => {
  const h = hueOf('#FF4D4F');
  assert.ok(h >= 355 || h <= 5, `esperava matiz perto de 0/360 (vermelho), veio ${h}`);
});

test('apply com preset "signal" remove data-theme; outro preset seta o atributo', () => {
  const doc = { documentElement: { attrs: {}, style: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } } };
  doc.documentElement.style.setProperty = function setProperty(k, v) { this[k] = v; };

  apply({ preset: 'midnight' }, doc);
  assert.equal(doc.documentElement.attrs['data-theme'], 'midnight');

  apply({ preset: 'signal' }, doc);
  assert.equal(doc.documentElement.attrs['data-theme'], undefined);
});

test('apply com custom valido seta data-theme="custom" e escreve variaveis, sem tocar em tokens semanticos', () => {
  const setProps = {};
  const doc = {
    documentElement: {
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      removeAttribute(k) { delete this.attrs[k]; },
      style: { setProperty(k, v) { setProps[k] = v; } },
    },
  };

  apply({ preset: 'custom', base: { temp: 0.3, level: 0.2 }, act: '#4F8EF7' }, doc);

  assert.equal(doc.documentElement.attrs['data-theme'], 'custom');
  assert.ok(setProps['--bg']);
  assert.ok(setProps['--act']);
  assert.equal(setProps['--live'], undefined);
  assert.equal(setProps['--warn'], undefined);
  assert.equal(setProps['--danger'], undefined);
});

test('apply sem document global e sem doc explicito nao lanca (no-op)', () => {
  assert.doesNotThrow(() => apply({ preset: 'signal' }));
});
