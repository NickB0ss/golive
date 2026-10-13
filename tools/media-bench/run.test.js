'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { summaryLines, describeScenarios } = require('./run');
const { buildPlan } = require('./lib/config');

const RUN = path.join(__dirname, 'run.js');
const run = (...args) => spawnSync(process.execPath, [RUN, ...args], { encoding: 'utf8', timeout: 20000 });

test('--help sai 0 e nao abre o Electron', () => {
  const r = run('--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /media-bench/);
});

test('--list sai 0 e lista os 8 cenarios padrao', () => {
  const r = run('--list');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.split('\n').filter((l) => /@v\d/.test(l)).length, 8);
});

test('uso invalido sai 3 com a causa no stderr', () => {
  for (const args of [['--bogus'], ['--viewers=99'], ['--source=owned-window']]) {
    const r = run(...args);
    assert.equal(r.status, 3, args.join(' '));
    assert.match(r.stderr, /Uso invalido/);
  }
});

test('describeScenarios e summaryLines formatam sem lancar, com dado ausente', () => {
  const plan = buildPlan({ quick: true, only: 'direct-motion', viewers: '1' });
  assert.match(describeScenarios(plan), /direct-motion@v1/);
  const lines = summaryLines({
    status: 'partial', fatal: 'x',
    scenarios: [{ key: 'a', status: 'error', error: 'boom', roles: {}, cpu: null }],
  });
  assert.match(lines.join('\n'), /ERRO: boom/);
  assert.match(lines.join('\n'), /fatal: x/);
});
