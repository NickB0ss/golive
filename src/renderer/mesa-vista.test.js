'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const v = require('./mesa-vista');

const VW = 1200;
const VH = 800;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('mundo <-> tela vao e voltam', () => {
  const view = { x: 1000, y: 500, z: 0.5 };
  const p = v.toScreen(view, 1400, 900);
  assert.deepEqual(p, { x: 200, y: 200 });
  assert.deepEqual(v.toWorld(view, p.x, p.y), { x: 1400, y: 900 });
  assert.deepEqual(v.screenRect(view, { x: 1000, y: 500, w: 640, h: 360 }), { x: 0, y: 0, w: 320, h: 180 });
  assert.deepEqual(v.visibleRect(view, VW, VH), { x: 1000, y: 500, w: 2400, h: 1600 });
});

test('zoom fica entre 20 % e 200 %', () => {
  assert.equal(v.clampZoom(0.01), 0.2);
  assert.equal(v.clampZoom(9), 2);
  assert.equal(v.clampZoom(NaN), 1);
  assert.equal(v.clampZoom(0.7), 0.7);
});

test('zoom no ponto do cursor: o ponto do mundo sob o cursor nao sai do lugar', () => {
  const view = { x: 1500, y: 1000, z: 1 };
  const antes = v.toWorld(view, 300, 200);
  const depois = v.zoomAt(view, 300, 200, 1.6, VW, VH);
  const p = v.toWorld(depois, 300, 200);
  assert.ok(near(p.x, antes.x) && near(p.y, antes.y));
  assert.equal(depois.z, 1.6);
  // Passar do teto prende em 200 %, mantendo o ponto.
  const teto = v.zoomAt(view, 300, 200, 50, VW, VH);
  assert.equal(teto.z, 2);
  const q = v.toWorld(teto, 300, 200);
  assert.ok(near(q.x, antes.x) && near(q.y, antes.y));
});

test('+/- dao um degrau de 1,25 no meio da area; a roda aproxima com delta negativo', () => {
  const view = { x: 1500, y: 1000, z: 1 };
  assert.ok(near(v.zoomStep(view, 1, VW, VH).z, 1.25));
  assert.ok(near(v.zoomStep(view, -1, VW, VH).z, 0.8));
  assert.ok(v.wheelZoom(view, 0, 0, -100, false, VW, VH).z > 1);
  assert.ok(v.wheelZoom(view, 0, 0, 100, false, VW, VH).z < 1);
  // Pinca (ctrl) anda mais por evento que a roda.
  assert.ok(v.wheelZoom(view, 0, 0, -10, true, VW, VH).z > v.wheelZoom(view, 0, 0, -10, false, VW, VH).z);
});

test('a vista para na sobra de 600 alem da borda', () => {
  const longe = v.clampView({ x: -5000, y: 99999, z: 1 }, VW, VH);
  assert.equal(longe.x, -600);
  assert.equal(longe.y, 3000 + 600 - VH);
  // Arrastar o fundo para a direita anda a vista para a esquerda.
  const p = v.pan({ x: 1000, y: 1000, z: 0.5 }, 100, -50, VW, VH);
  assert.deepEqual(p, { x: 800, y: 1100, z: 0.5 });
});

test('com zoom baixo numa tela grande a mesa fica centrada', () => {
  const view = v.clampView({ x: 0, y: 0, z: 0.2 }, 2560, 1440);
  // 2560 / 0.2 = 12800 unidades de largura: maior que 4800 + 1200.
  assert.equal(view.x, (4800 - 12800) / 2);
  assert.equal(view.y, (3000 - 7200) / 2);
});

test('Ver tudo cobre todas as janelas; mesa vazia volta ao meio a 100 %', () => {
  const wins = [{ x: 100, y: 100, w: 640, h: 360 }, { x: 2000, y: 1500, w: 320, h: 240 }];
  const view = v.fitAll(wins, VW, VH);
  const b = v.boundsOf(wins);
  const s = v.screenRect(view, b);
  assert.ok(s.x >= 63 && s.y >= 63, 'folga de 64 px');
  assert.ok(s.x + s.w <= VW - 63 && s.y + s.h <= VH - 63);
  const vazia = v.fitAll([], VW, VH);
  assert.equal(vazia.z, 1);
  assert.deepEqual(v.viewCenter(vazia, VW, VH), { x: 2400, y: 1500 });
  // Uma janela pequena nao vira tela cheia: teto de 120 %.
  assert.equal(v.fitAll([{ x: 0, y: 0, w: 100, h: 100 }], VW, VH).z, 1.2);
  assert.equal(v.boundsOf([]), null);
});

test('voo: comeca na origem, termina no destino, desacelera e anda o zoom em escala log', () => {
  const from = { x: 0, y: 0, z: 0.5 };
  const to = v.centerOn(3000, 2000, 2, VW, VH);
  assert.deepEqual(v.flyStep(from, to, 0, VW, VH), { ...from, x: 0, y: 0 });
  assert.deepEqual(v.flyStep(from, to, 1, VW, VH), to);
  assert.ok(v.easeOut(0.5) > 0.5, 'desacelera: na metade do tempo passou da metade do caminho');
  const meio = v.flyStep(from, to, 0.5, VW, VH);
  const e = v.easeOut(0.5);
  assert.ok(near(Math.log(meio.z), Math.log(0.5) + (Math.log(2) - Math.log(0.5)) * e));
  assert.equal(v.FLY_MS, 420);
});

test('uma transformacao so para a mesa inteira', () => {
  assert.equal(v.transformFor({ x: 100, y: 50, z: 0.5 }), 'translate3d(-50px, -25px, 0) scale(0.5)');
});

test('grade: forte a cada 200 e fina a cada 40; a fina some com zoom baixo', () => {
  const perto = v.gridStyle({ x: 0, y: 0, z: 1 });
  assert.equal(perto.showMinor, true);
  assert.equal(perto.backgroundSize, '200px 200px, 200px 200px, 40px 40px, 40px 40px');
  assert.match(perto.backgroundImage, /var\(--grid2\).*var\(--grid\)/);
  const longe = v.gridStyle({ x: 0, y: 0, z: 0.3 });
  assert.equal(longe.showMinor, false, '40 x 0,3 = 12 px: chuvisco');
  assert.equal(longe.backgroundSize, '60px 60px, 60px 60px');
  // Alinhada ao mundo: a posicao acompanha a vista.
  assert.equal(v.gridStyle({ x: 10, y: 20, z: 2 }).backgroundPosition.split(', ')[0], '-20px -40px');
});

test('mapa: escala do mundo e clique levado de volta ao mundo', () => {
  const s = v.minimapScale(192, 120);
  assert.equal(s, 0.04);
  assert.deepEqual(v.fromMinimap(96, 60, 192, 120), { x: 2400, y: 1500 });
  assert.deepEqual(v.fromMinimap(-10, 999, 192, 120), { x: 0, y: 3000 });
});

test('assentar: solta em lugar livre fica; em cima de outra vai ao lugar livre mais perto', () => {
  const wins = [{ id: 'a', x: 1000, y: 1000, w: 400, h: 300 }];
  assert.deepEqual(v.landing(wins, { x: 100.4, y: 100.6, w: 200, h: 200 }, 'b'), { x: 100, y: 101, w: 200, h: 200 });
  const r = v.landing(wins, { x: 1100, y: 1050, w: 200, h: 200 }, 'b');
  assert.ok(v.fits(wins, r, { ignoreId: 'b', gap: 16 }));
  // A propria janela nao atrapalha.
  assert.deepEqual(v.landing(wins, { x: 1010, y: 1000, w: 400, h: 300 }, 'a'), { x: 1010, y: 1000, w: 400, h: 300 });
});

test('redimensionar: proporcao mantida, minimo respeitado, borda esquerda segura a direita', () => {
  const orig = { x: 100, y: 100, w: 640, h: 360 };
  const aspect = 16 / 9;
  assert.deepEqual(v.resizeRect(orig, 'r', 160, 0, { aspect }), { x: 100, y: 100, w: 800, h: 450 });
  assert.deepEqual(v.resizeRect(orig, 'b', 0, 90, { aspect }), { x: 100, y: 100, w: 800, h: 450 });
  const l = v.resizeRect(orig, 'l', 160, 0, { aspect });
  assert.deepEqual(l, { x: 260, y: 100, w: 480, h: 270 });
  assert.equal(l.x + l.w, orig.x + orig.w);
  const min = v.resizeRect(orig, 'br', -9999, -9999, { aspect, minW: 160, minH: 90 });
  assert.deepEqual(min, { x: 100, y: 100, w: 160, h: 90 });
  // Livre (nota): cada eixo por si.
  assert.deepEqual(v.resizeRect({ x: 0, y: 0, w: 320, h: 240 }, 'br', 30, -500, { minW: 160, minH: 120 }), { x: 0, y: 0, w: 350, h: 120 });
});

test('redimensionar para ao encostar numa vizinha', () => {
  const wins = [{ id: 'a', x: 0, y: 0, w: 300, h: 200 }, { id: 'b', x: 500, y: 0, w: 300, h: 200 }];
  const got = v.resizeStop(wins, 'a', wins[0], { x: 0, y: 0, w: 900, h: 200 });
  assert.ok(got.w >= 495 && got.w <= 500, `parou em ${got.w}`);
  assert.ok(v.fits(wins, got, { ignoreId: 'a' }));
  assert.deepEqual(v.resizeStop(wins, 'a', wins[0], { x: 0, y: 0, w: 350, h: 200 }), { x: 0, y: 0, w: 350, h: 200 });
});

test('teclado na janela: setas movem 10, Shift 100, Alt redimensiona', () => {
  const r = { x: 100, y: 100, w: 320, h: 240 };
  assert.deepEqual(v.keyRect(r, 'ArrowRight', {}), { x: 110, y: 100, w: 320, h: 240 });
  assert.deepEqual(v.keyRect(r, 'ArrowUp', { shift: true }), { x: 100, y: 0, w: 320, h: 240 });
  assert.deepEqual(v.keyRect(r, 'ArrowDown', { alt: true }), { x: 100, y: 100, w: 320, h: 250 });
  assert.deepEqual(v.keyRect({ x: 0, y: 0, w: 640, h: 360 }, 'ArrowRight', { alt: true, aspect: 16 / 9 }), { x: 0, y: 0, w: 650, h: 366 });
  assert.equal(v.keyRect(r, 'Enter', {}), null);
  assert.deepEqual(v.keyPan({ x: 1000, y: 1000, z: 1 }, 'ArrowRight', VW, VH), { x: 1080, y: 1000, z: 1 });
});

test('janela fora da vista ou menor que 120 px nao vale o video', () => {
  const view = { x: 0, y: 0, z: 1 };
  assert.deepEqual(v.watchable(view, VW, VH, { x: 100, y: 100, w: 640, h: 360 }), { onScreen: true, widthPx: 640, ok: true });
  assert.equal(v.watchable(view, VW, VH, { x: 2000, y: 100, w: 640, h: 360 }).ok, false);
  const pequena = v.watchable({ x: 0, y: 0, z: 0.2 }, VW, VH, { x: 100, y: 100, w: 500, h: 280 });
  assert.equal(pequena.widthPx, 100);
  assert.equal(pequena.ok, false);
});

test('carencia de 2 s: sair da vista so solta depois de 2 s seguidos; voltar pede na hora', () => {
  const t = v.createWatchTracker();
  assert.equal(t.see('w', true, 0), true);
  assert.equal(t.wanted('w'), true);
  assert.equal(t.see('w', false, 100), false);
  assert.equal(t.nextDeadline(100), 2000);
  assert.equal(t.see('w', false, 1500), false);
  assert.equal(t.wanted('w'), true);
  // Voltou antes dos 2 s: a contagem zera.
  assert.equal(t.see('w', true, 1600), false);
  assert.equal(t.see('w', false, 1700), false);
  assert.equal(t.see('w', false, 3600), false);
  assert.equal(t.see('w', false, 3700), true);
  assert.equal(t.wanted('w'), false);
  assert.equal(t.nextDeadline(3700), null);
  assert.equal(t.see('w', true, 3800), true);
  assert.equal(t.wanted('w'), true);
  // Janela que ja nasce fora nao quer video.
  assert.equal(t.see('x', false, 0), true);
  assert.equal(t.wanted('x'), false);
  t.drop('x');
  assert.equal(t.wanted('x'), false);
});

test('relogio do servidor: fica a ida e volta de menor atraso', () => {
  const r = v.clockOffset([
    { t0: 0, t1: 100, server: 1000 },
    { t0: 200, t1: 220, server: 1215 },
    { t0: 300, t1: 250, server: 5 }, // volta antes de ir: lixo
    null,
  ]);
  assert.deepEqual(r, { rtt: 20, offset: 1215 - 210 });
  assert.equal(v.clockOffset([]), null);
});
