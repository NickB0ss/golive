'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { parseLaunchArgs, PROFILE_PREFIX } = require('./launch');

const tmp = os.tmpdir();
const good = [
  `--bench-config=${path.join(tmp, `${PROFILE_PREFIX}x`, 'plan.json')}`,
  `--bench-report=${path.join(tmp, 'r.json')}`,
  `--bench-profile=${path.join(tmp, `${PROFILE_PREFIX}x`)}`,
];

test('aceita os tres argumentos internos validos', () => {
  const r = parseLaunchArgs(['electron', 'main.js', ...good], tmp);
  assert.equal(r.ok, true, r.errors.join());
});

test('perfil fora do temp, sem prefixo, ou o proprio temp: recusa (o launcher apaga a pasta)', () => {
  const fora = path.resolve(tmp, '..', `${PROFILE_PREFIX}x`);
  for (const profile of [path.join(tmp, 'outra'), fora, tmp, os.homedir()]) {
    const r = parseLaunchArgs([good[0], good[1], `--bench-profile=${profile}`], tmp);
    assert.equal(r.ok, false, profile);
  }
});

test('caminhos relativos ou sem .json sao recusados', () => {
  assert.equal(parseLaunchArgs(['--bench-config=plan.json', good[1], good[2]], tmp).ok, false);
  assert.equal(parseLaunchArgs([good[0], `--bench-report=${path.join(tmp, 'r.txt')}`, good[2]], tmp).ok, false);
  assert.equal(parseLaunchArgs([], tmp).ok, false);
});
