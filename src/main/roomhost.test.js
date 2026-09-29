'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ERRO_PIN_INVALIDO, resolveRoomPin, resolveRoomMesa } = require('./roomhost');

const sorteio = () => 42;

test('PIN escolhido por quem cria e aceito quando tem 6 digitos', () => {
  const res = resolveRoomPin({ protect: true, pin: '004217', randomInt: sorteio });
  assert.deepEqual(res, { ok: true, pin: '004217' });
});

test('PIN escolhido fora do formato e recusado', () => {
  for (const pin of ['12345', '1234567', 'abcdef', '12 456', '１２３４５６', 123456, {}, [], true]) {
    const res = resolveRoomPin({ protect: true, pin, randomInt: sorteio });
    assert.deepEqual(res, { ok: false, error: ERRO_PIN_INVALIDO }, String(pin));
  }
});

test('protect sem pin sorteia 6 digitos com zeros a esquerda', () => {
  for (const pin of [undefined, null, '']) {
    const res = resolveRoomPin({ protect: true, pin, randomInt: sorteio });
    assert.deepEqual(res, { ok: true, pin: '000042' });
  }
});

test('sem protect a sala e aberta e o pin enviado e ignorado', () => {
  assert.deepEqual(resolveRoomPin({ protect: false, pin: '123456', randomInt: sorteio }), { ok: true, pin: null });
  assert.deepEqual(resolveRoomPin({ protect: false, pin: 'lixo', randomInt: sorteio }), { ok: true, pin: null });
});

test('o PIN que a migracao carrega (sala protegida) segue valendo, sem sorteio', () => {
  const migrada = resolveRoomPin({ protect: true, pin: '222222', randomInt: sorteio });
  assert.deepEqual(migrada, { ok: true, pin: '222222' });
  const aberta = resolveRoomPin({ protect: false, pin: null, randomInt: sorteio });
  assert.deepEqual(aberta, { ok: true, pin: null });
});

test('mesa: so o false literal desliga; o resto vale true', () => {
  assert.equal(resolveRoomMesa(false), false);
  for (const valor of [true, undefined, null, 0, '', 'false', {}]) assert.equal(resolveRoomMesa(valor), true);
});
