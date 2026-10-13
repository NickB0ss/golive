'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { parseLaunchArgs, PROFILE_PREFIX } = require('./launch');

const tmp = os.tmpdir();
const good = [
  `--spike-config=${path.join(tmp, 'plan.json')}`,
  `--spike-report=${path.join(tmp, 'r.json')}`,
  `--spike-profile=${path.join(tmp, `${PROFILE_PREFIX}abc`)}`,
];

test('aceita argumentos internos validos', () => {
  assert.equal(parseLaunchArgs(good, tmp).ok, true);
});

test('recusa perfil fora da pasta temporaria, sem o prefixo ou que seja a propria pasta', () => {
  const swap = (profile) => parseLaunchArgs([good[0], good[1], `--spike-profile=${profile}`], tmp);
  assert.equal(swap(path.join(tmp, 'qualquer')).ok, false);
  assert.equal(swap(path.resolve(tmp, '..', `${PROFILE_PREFIX}x`)).ok, false);
  assert.equal(swap(tmp).ok, false);
  assert.equal(swap('relativo').ok, false);
});

test('recusa config/relatorio relativos ou sem .json', () => {
  assert.equal(parseLaunchArgs(['--spike-config=plan.json', good[1], good[2]], tmp).ok, false);
  assert.equal(parseLaunchArgs([good[0], `--spike-report=${path.join(tmp, 'r.txt')}`, good[2]], tmp).ok, false);
  assert.equal(parseLaunchArgs([], tmp).ok, false);
});
