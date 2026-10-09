'use strict';

/*
 * Verificacoes estaticas das paginas HTML da bancada: scripts existem, ordem de
 * carga, CSP presente, nada de script inline, e o preload expoe so o contrato.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RENDERER = path.join(__dirname, 'renderer');

function scripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({
    src: /\bsrc="([^"]+)"/.exec(m[1])?.[1] || null,
    inline: m[2].trim(),
  }));
}

for (const page of ['index.html', 'source-window.html']) {
  test(`${page}: CSP restritiva, nenhum script inline, todo src existe`, () => {
    const html = fs.readFileSync(path.join(RENDERER, page), 'utf8');
    assert.match(html, /Content-Security-Policy[^>]*default-src 'none'/);
    assert.match(html, /script-src 'self'/);
    for (const s of scripts(html)) {
      assert.equal(s.inline, '', 'script inline nao permitido pela CSP');
      assert.ok(s.src, 'script sem src');
      assert.ok(fs.existsSync(path.join(RENDERER, s.src)), `nao existe: ${s.src}`);
    }
  });
}

test('index.html: ordem de carga (producao -> metricas -> cena -> fonte -> topologia -> sampler -> cenario -> boot)', () => {
  const order = scripts(fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8')).map((s) => path.basename(s.src));
  const idx = (f) => {
    const i = order.indexOf(f);
    assert.ok(i >= 0, `${f} ausente`);
    return i;
  };
  const chain = ['txstats.js', 'rxstats.js', 'scene-math.js', 'metrics.js', 'scene.js', 'source.js',
    'topology.js', 'sampler.js', 'scenario.js', 'boot.js'];
  for (let i = 1; i < chain.length; i++) assert.ok(idx(chain[i - 1]) < idx(chain[i]), `${chain[i - 1]} deve vir antes de ${chain[i]}`);
  assert.ok(idx('screenrelay.js') < idx('source.js'));
  assert.equal(order.at(-1), 'boot.js');
});

test('index.html reaproveita os modulos de PRODUCAO (nao copias)', () => {
  const srcs = scripts(fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8')).map((s) => s.src);
  for (const f of ['txstats.js', 'rxstats.js', 'screenrelay.js']) {
    const rel = srcs.find((s) => s.endsWith(`/src/renderer/${f}`));
    assert.ok(rel, f);
    assert.ok(fs.existsSync(path.join(RENDERER, rel)), rel);
  }
});

test('preload expoe so o contrato da bancada, com contextBridge', () => {
  const src = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  assert.match(src, /contextBridge\.exposeInMainWorld\('mediaBench'/);
  const keys = [...src.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), ['armCapture', 'finish', 'getPlan', 'log', 'scenarioDone', 'scenarioStart']);
});

test('main nao importa nada de rede/sala/firewall/updater do app e usa perfil temporario', () => {
  const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  for (const proibido of ['firewall', 'discovery', 'updater', 'signaling', 'roomhost', 'requestSingleInstanceLock']) {
    assert.ok(!new RegExp(`require\\([^)]*${proibido}`).test(src), `main.js nao deve carregar ${proibido}`);
  }
  assert.match(src, /app\.setPath\('userData'/);
  assert.match(src, /nodeIntegration: false/);
  assert.match(src, /contextIsolation: true/);
  assert.ok(!/getUserMedia|sources\[0\]/.test(src));
});
