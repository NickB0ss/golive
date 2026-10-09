'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { main, missingPrerequisites, describeScenarios, summaryLines } = require('./run');
const { buildPlan, parseArgv } = require('./lib/config');
const { EXIT } = require('./lib/report');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

async function quiet(fn) {
  const logs = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  try {
    return { code: await fn(), logs: logs.join('\n') };
  } finally {
    Object.assign(console, orig);
  }
}

test('--help sai com 0 e lista os pre-requisitos', async () => {
  const { code, logs } = await quiet(() => main(['--help']));
  assert.equal(code, EXIT.OK);
  assert.match(logs, /prepare-worker/);
  assert.match(logs, /--consumers/);
});

test('uso invalido sai com 3 sem abrir nada', async () => {
  const { code, logs } = await quiet(() => main(['--consumers=0']));
  assert.equal(code, EXIT.USAGE);
  assert.match(logs, /Uso invalido/);
  assert.equal((await quiet(() => main(['--nao-existe']))).code, EXIT.USAGE);
});

test('--list descreve os cenarios 1 e 4 sem abrir o Electron', async () => {
  const { code, logs } = await quiet(() => main(['--list', '--quick']));
  assert.equal(code, EXIT.OK);
  assert.match(logs, /consumidores=1/);
  assert.match(logs, /consumidores=4/);
  assert.match(logs, /listen=127\.0\.0\.1/);
});

test('pre-requisito ausente e listado com o comando que resolve (nenhum cenario conta como passado)', () => {
  const none = missingPrerequisites({ exists: () => false, workerReady: () => false });
  assert.equal(none.length, 3);
  assert.match(none.join('\n'), /npm ci --ignore-scripts/);
  assert.match(none.join('\n'), /npm run prepare-worker/);
  assert.match(none.join('\n'), /npm run bundle/);
  assert.deepEqual(missingPrerequisites({ exists: () => true, workerReady: () => true }), []);
});

test('describeScenarios e summaryLines mostram cenarios e o que nao passou', () => {
  const plan = buildPlan(parseArgv(['--quick']).options);
  assert.match(describeScenarios(plan), /sfu-loopback@c4/);
  const lines = summaryLines({
    status: 'partial', completed: 1, planned: 2, fatal: null,
    scenarios: [{ key: 'k', status: 'failed', codec: { realSender: { mimeType: 'video/H264' } }, consumers: [{ window: { fps: 29.9 } }], forwarding: { workerCpuPercentOfOneCore: 1.2 }, checks: [{ id: 'frames-flow', status: 'failed', detail: 'c0 sem quadros' }, { id: 'run', status: 'passed', detail: 'x' }] }],
  }).join('\n');
  assert.match(lines, /partial \(1\/2 cenarios\)/);
  assert.match(lines, /failed: frames-flow: c0 sem quadros/);
  assert.doesNotMatch(lines, /passed: run/);
});

test('isolamento: dependencias do experimento so em tools/sfu-spike, com versoes exatas e lock proprio', () => {
  const rootPkg = JSON.parse(read('package.json'));
  const all = { ...rootPkg.dependencies, ...rootPkg.devDependencies, ...rootPkg.optionalDependencies };
  assert.equal(Object.keys(all).some((n) => /mediasoup/i.test(n)), false, 'mediasoup nao pode entrar no package.json principal');
  assert.ok(Array.isArray(rootPkg.build.files) && !rootPkg.build.files.some((f) => /tools|sfu-spike/.test(f)), 'o instalador nao empacota tools/ (lista fechada em build.files)');

  const pkg = JSON.parse(read('tools', 'sfu-spike', 'package.json'));
  assert.deepEqual(pkg.dependencies, { mediasoup: '3.28.0', 'mediasoup-client': '3.24.4' });
  assert.equal(pkg.private, true);
  assert.equal(pkg.scripts.postinstall, undefined, 'sem postinstall: o worker e preparado de forma explicita');

  const lock = JSON.parse(read('tools', 'sfu-spike', 'package-lock.json'));
  assert.equal(lock.packages['node_modules/mediasoup'].version, '3.28.0');
  assert.equal(lock.packages['node_modules/mediasoup-client'].version, '3.24.4');
});

test('arquivos gerados ficam fora do git e do eslint', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /^node_modules\/$/m);
  assert.match(ignore, /^lab-out\/$/m);
  assert.match(ignore, /tools\/sfu-spike\/renderer\/mediasoup-client\.bundle\.js/);
  const eslint = read('eslint.config.js');
  assert.match(eslint, /tools\/sfu-spike\/renderer\/mediasoup-client\.bundle\.js/);
  assert.match(eslint, /tools\/sfu-spike\/node_modules\/\*\*/);
});

test('a pagina carrega so scripts locais e a CSP bloqueia rede', () => {
  const html = read('tools', 'sfu-spike', 'renderer', 'index.html');
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /src="https?:/);
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 6);
  for (const s of scripts) assert.ok(!/^[a-z]+:/i.test(s), `script nao local: ${s}`);
});

test('o codigo nunca escuta em 0.0.0.0 nem anuncia endereco publico', () => {
  for (const f of ['lib/sfu.js', 'main.js', 'lib/config.js']) {
    const src = read('tools', 'sfu-spike', f);
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(code, /announcedAddress\s*:|announcedIp\s*:|listenIps\s*:/, f);
  }
  const mainCode = read('tools', 'sfu-spike', 'main.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  assert.doesNotMatch(mainCode, /createServer|WebSocket|http\.listen|net\.listen/);
});
