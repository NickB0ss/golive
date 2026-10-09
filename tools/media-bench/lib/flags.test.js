'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PRODUCTION_TOP_SWITCHES, applyBenchFlags } = require('./flags');

test('o espelho das flags do topo bate com src/main.js (deteccao de deriva)', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'main.js'), 'utf8');
  for (const [name] of PRODUCTION_TOP_SWITCHES) {
    assert.ok(main.includes(`appendSwitch('${name}')`), `src/main.js nao liga mais ${name}: atualize tools/media-bench/lib/flags.js`);
  }
});

test('applyBenchFlags liga as features do chromiumflags e as flags do topo, e informa o efetivo', () => {
  const sw = new Map();
  const commandLine = {
    appendSwitch: (n, v = '') => sw.set(n, v),
    getSwitchValue: (n) => sw.get(n) ?? '',
    hasSwitch: (n) => sw.has(n),
  };
  const out = applyBenchFlags(commandLine, { error() { throw new Error('nao deveria logar erro'); } });
  assert.equal(out.chromiumFlagsValid, true);
  assert.match(out.enableFeatures, /WebRtcAllowH264Send/);
  assert.match(out.disableFeatures, /WebRtcHideLocalIpsWithMdns/);
  assert.ok(out.topSwitches.every((s) => s.present));
  assert.equal(out.topSwitches.length, 4);
});
