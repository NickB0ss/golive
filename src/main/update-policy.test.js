'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdatePolicy } = require('./update-policy');

test('downloaded tardio do boot liberado fica pronto e nao instala', () => {
  const policy = createUpdatePolicy();
  policy.markBootReleased();

  assert.equal(
    policy.handleStatus({ status: 'downloaded', downloadSource: 'boot' }),
    'ready',
  );
});

test('downloaded do boot antes da liberacao pertence somente ao boot', () => {
  const policy = createUpdatePolicy();

  assert.equal(
    policy.handleStatus({ status: 'downloaded', downloadSource: 'boot' }),
    'boot-installing',
  );
});

test('downloaded manual instala somente no ciclo iniciado pelo clique', () => {
  const policy = createUpdatePolicy();
  policy.markBootReleased();

  assert.equal(
    policy.handleStatus({ status: 'downloaded', downloadSource: 'manual' }),
    'install-manual',
  );
});

test('downloaded manual com sala ativa fica pronto e nao instala', () => {
  const policy = createUpdatePolicy();
  policy.markBootReleased();
  policy.setRoomActive(true);

  assert.equal(
    policy.handleStatus({ status: 'downloaded', downloadSource: 'manual' }),
    'ready',
  );
});

test('clique depois de download tardio instala sem baixar outra vez', () => {
  const policy = createUpdatePolicy();
  policy.markBootReleased();
  policy.handleStatus({ status: 'downloaded', downloadSource: 'boot' });

  assert.equal(policy.requestManualUpdate(true), 'install-manual');
});

test('clique fora da sala depois de pacote pronto instala sem baixar outra vez', () => {
  const policy = createUpdatePolicy();
  policy.markBootReleased();
  policy.setRoomActive(true);
  policy.handleStatus({ status: 'downloaded', downloadSource: 'manual' });
  policy.setRoomActive(false);

  assert.equal(policy.requestManualUpdate(true), 'install-manual');
});
