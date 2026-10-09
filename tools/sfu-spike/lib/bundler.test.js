'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { scanRequires, resolveRequest, buildBundle, exportsEntry, packagesIn, collectModules } = require('./bundler');

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfu-spike-bundler-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }
  return dir;
}

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

test('scanRequires acha require literal e ignora obj.require() e nomes parecidos', () => {
  const src = "const a = require('./a'); const b = require(\"pkg\"); x.require('nao'); myrequire('nao2');";
  assert.deepEqual(scanRequires(src).sort(), ['./a', 'pkg']);
});

test('empacota CommonJS relativo + pacote (browser/main/exports) + json + alias de node:events', () => {
  const dir = fixture({
    'entry.js': "const s = require('./sub'); const p = require('pkg'); const e = require('node:events'); const j = require('./data.json'); globalThis.out = { s, p, e, j, same: require('./sub') === s, self: this === module.exports };",
    'sub.js': "'use strict';\nexports.v = 7;\n",
    'data.json': '{"k": 3}',
    'node_modules/pkg/package.json': JSON.stringify({ name: 'pkg', main: './node.js', browser: './browser.js' }),
    'node_modules/pkg/node.js': "module.exports = 'node';",
    'node_modules/pkg/browser.js': "module.exports = 'browser';",
    'node_modules/events-alias/package.json': JSON.stringify({ name: 'events-alias', main: './events.js' }),
    'node_modules/events-alias/events.js': "module.exports = 'EV';",
  });
  try {
    const code = buildBundle(path.join(dir, 'entry.js'), { root: dir });
    const sandbox = { globalThis: {} };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(code, sandbox);
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.out)), { s: { v: 7 }, p: 'browser', e: 'EV', j: { k: 3 }, same: true, self: true });
  } finally { cleanup(dir); }
});

test('exports map: prefere browser/require/default', () => {
  const dir = fixture({
    'entry.js': "globalThis.out = require('lib');",
    'node_modules/lib/package.json': JSON.stringify({ name: 'lib', exports: { '.': { types: './x.d.ts', default: './lib/main.js' } } }),
    'node_modules/lib/lib/main.js': 'module.exports = 42;',
  });
  try {
    const sandbox = {};
    sandbox.globalThis = sandbox;
    vm.runInNewContext(buildBundle(path.join(dir, 'entry.js'), { root: dir }), sandbox);
    assert.equal(sandbox.out, 42);
  } finally { cleanup(dir); }
});

test('falha com mensagem util: pacote ausente, modulo nativo, ES module', () => {
  const dir = fixture({
    'a.js': "require('naoexiste');",
    'b.js': "require('node:fs');",
    'c.js': "require('./esm');",
    'esm.js': "import x from 'y';\nexport default 1;\n",
    'd.js': "require('./faltando');",
  });
  try {
    assert.throws(() => buildBundle(path.join(dir, 'a.js'), { root: dir }), /pacote naoexiste nao instalado/);
    assert.throws(() => buildBundle(path.join(dir, 'b.js'), { root: dir }), /nativo do Node/);
    assert.throws(() => buildBundle(path.join(dir, 'c.js'), { root: dir }), /ES module/);
    assert.throws(() => buildBundle(path.join(dir, 'd.js'), { root: dir }), /nao achei/);
    assert.throws(() => resolveRequest(path.join(dir, 'a.js'), 'node:crypto'), /nativo/);
  } finally { cleanup(dir); }
});

test('require que nao estava no grafo falha em execucao, nao em silencio', () => {
  const dir = fixture({ 'entry.js': "const r = require; globalThis.fn = () => r('./outro');" });
  try {
    const sandbox = {};
    sandbox.globalThis = sandbox;
    vm.runInNewContext(buildBundle(path.join(dir, 'entry.js'), { root: dir }), sandbox);
    assert.throws(() => sandbox.fn(), /require nao empacotado/);
  } finally { cleanup(dir); }
});

test('exports respeita a ORDEM das condicoes e tenta a irma quando a primeira nao serve (import nao conta)', () => {
  const pkg = { name: 'p', exports: { '.': { types: './t.d.ts', import: './esm.mjs', require: './cjs.js', default: './d.js' } } };
  assert.equal(exportsEntry(pkg, '.'), './cjs.js');
  const dflt = { name: 'p', exports: { '.': { node: './node.js', default: './d.js' } } };
  assert.equal(exportsEntry(dflt, '.'), './d.js');
  const aninhado = { name: 'p', exports: { '.': { node: { import: './x.mjs' }, default: './d.js' } } };
  assert.equal(exportsEntry(aninhado, '.'), './d.js');
  const ordem = { name: 'p', exports: { '.': { default: './d.js', browser: './b.js' } } };
  assert.equal(exportsEntry(ordem, '.'), './d.js'); // a ordem do arquivo manda
});

test('falha em vez de cair no build de Node: exports so de condicoes, subcaminho ausente, browser em objeto', () => {
  assert.throws(() => exportsEntry({ name: 'sc', exports: { node: './n.js', default: './d.js' } }, '.'), /so de condicoes/);
  assert.throws(() => exportsEntry({ name: 'p', exports: { '.': './a.js' } }, './x'), /subcaminho/);
  assert.throws(() => exportsEntry({ name: 'p', exports: { '.': { types: './t.d.ts' } } }, '.'), /sem condicao/);
  const dir = fixture({
    'entry.js': "require('pkg');",
    'node_modules/pkg/package.json': JSON.stringify({ name: 'pkg', main: './node.js', browser: { './node.js': './browser.js' } }),
    'node_modules/pkg/node.js': 'module.exports = 1;',
  });
  try {
    assert.throws(() => buildBundle(path.join(dir, 'entry.js'), { root: dir }), /"browser" em forma de object/);
  } finally { cleanup(dir); }
});

test('a resolucao para na raiz do spike: dependencia ausente nao e pega do node_modules de cima', () => {
  const outer = fixture({
    'node_modules/pkg/package.json': JSON.stringify({ name: 'pkg', main: './i.js' }),
    'node_modules/pkg/i.js': 'module.exports = "de fora";',
    'spike/entry.js': "require('pkg');",
  });
  try {
    const spike = path.join(outer, 'spike');
    assert.throws(() => buildBundle(path.join(spike, 'entry.js'), { root: spike }), /pacote pkg nao instalado/);
    // sem fronteira (uso direto de resolveRequest) o comportamento antigo de subir continua possivel
    assert.ok(resolveRequest(path.join(spike, 'entry.js'), 'pkg'));
  } finally { cleanup(outer); }
});

test('expectPackages trava a lista de pacotes do grafo', () => {
  const dir = fixture({
    'entry.js': "require('a'); require('b');",
    'node_modules/a/package.json': JSON.stringify({ name: 'a', main: './i.js' }),
    'node_modules/a/i.js': 'module.exports = 1;',
    'node_modules/b/package.json': JSON.stringify({ name: 'b', main: './i.js' }),
    'node_modules/b/i.js': 'module.exports = 2;',
  });
  try {
    assert.deepEqual(packagesIn(collectModules(path.join(dir, 'entry.js'), undefined, dir)), ['a', 'b']);
    assert.ok(buildBundle(path.join(dir, 'entry.js'), { root: dir, expectPackages: ['b', 'a'] }));
    assert.throws(() => buildBundle(path.join(dir, 'entry.js'), { root: dir, expectPackages: ['a'] }), /a mais: b/);
    assert.throws(() => buildBundle(path.join(dir, 'entry.js'), { root: dir, expectPackages: ['a', 'b', 'c'] }), /a menos: c/);
  } finally { cleanup(dir); }
});
