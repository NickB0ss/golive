'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deveAgrupar } = require('./chat-grouping');

const minuto = 60_000;

test('deveAgrupar agrupa mensagens do mesmo autor em ate cinco minutos', () => {
  assert.equal(
    deveAgrupar({ from: 'bia', ts: 10 * minuto }, { from: 'bia', ts: 15 * minuto }),
    true
  );
});

test('deveAgrupar nao agrupa autores diferentes', () => {
  assert.equal(
    deveAgrupar({ from: 'bia', ts: 10 * minuto }, { from: 'caio', ts: 11 * minuto }),
    false
  );
});

test('deveAgrupar nao agrupa mensagens com mais de cinco minutos', () => {
  assert.equal(
    deveAgrupar({ from: 'bia', ts: 10 * minuto }, { from: 'bia', ts: 15 * minuto + 1 }),
    false
  );
});

test('deveAgrupar nao agrupa atraves de separador ou evento de sistema', () => {
  assert.equal(
    deveAgrupar({ from: 'bia', ts: 10 * minuto, separadorDeDia: true }, { from: 'bia', ts: 11 * minuto }),
    false
  );
  assert.equal(
    deveAgrupar({ from: 'bia', ts: 10 * minuto, system: true }, { from: 'bia', ts: 11 * minuto }),
    false
  );
});
