'use strict';
/*
 * Controles do tile (volume, rabisco, reacoes) dentro da janela da Mesa.
 * O comportamento com DOM de verdade e conferido no banco de prova
 * (tools/mesa-prints/harness.js, `tileNaMesa`); aqui fica o que da para
 * travar sem navegador: o CSS nao esconde as barras, o arrastar fica so na
 * barra da janela, e o rabisco nao depende da escala da mesa.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const annotate = require('./annotate');

const vista = fs.readFileSync(path.join(__dirname, 'mesa-view.js'), 'utf8');

test('arrastar a janela de video so comeca na barra', () => {
  assert.match(vista, /e\.target\.closest\('\.mesa-bar'\)/, 'a barra inicia o arraste');
  assert.match(vista, /e\.target\.closest\('\.mesa-bar-btn, \.mesa-resize'\)/, 'os botoes ficam livres');
});

test('a moldura da janela usa os componentes Sinal para vez e identidade', () => {
  assert.match(vista, /class="mesa-bar-turn tag tag--wire"/);
  assert.match(vista, /class="mesa-avatar node"/);
  assert.match(vista, /data-size="16"/);
});

test('o menu da janela de video oferece o volume do tile', () => {
  assert.match(vista, /Volume e silenciar/);
  assert.match(vista, /deps\.openTileMenu\(/);
});

test('janela de tela ou camera nao fecha: sem botao, sem menu e sem Delete', () => {
  assert.match(vista, /function canRemove\(win\) \{[^}]*return !isMedia\(win\);/, 'ninguem remove midia');
  assert.match(vista, /if \(isMedia\(win\)\) return;\s*if \(!canRemove\(win\)\)/, 'Delete e menu nao pedem');
  assert.match(vista, /isMedia\(win\) \? '' : row\('Tirar da Mesa'/, 'o menu nao oferece Tirar da Mesa');
  assert.match(vista, /if \(reason === 'media'\) return;/, 'recusa media fica sem aviso');
  assert.ok(!/not-yours/.test(vista), 'o motivo antigo saiu');
});

test('a Mesa vazia nao tem texto nem atalhos no meio', () => {
  assert.ok(!/mesa-empty|emptyShortcuts|emptyEl|renderEmptyShortcuts|data-mesa-quick/.test(vista));
  assert.ok(!/A Mesa está vazia/.test(vista));
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
