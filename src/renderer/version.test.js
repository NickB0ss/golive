'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse, compare, same, mismatchText, mismatchBadge } = require('./version');

test('parse le "0.5.0", "v0.5.0" e pre-release', () => {
  assert.deepEqual(parse('0.5.0'), [0, 5, 0]);
  assert.deepEqual(parse('v0.5.0'), [0, 5, 0]);
  assert.deepEqual(parse(' 1.10.2-beta.3 '), [1, 10, 2]);
});

test('parse devolve null pro que nao e versao', () => {
  assert.equal(parse('0.5'), null);
  assert.equal(parse('abc'), null);
  assert.equal(parse(null), null);
  assert.equal(parse(undefined), null);
});

test('compare ordena por numero, nao por string', () => {
  // "0.10.0" < "0.9.0" numa comparacao de string -- aqui nao.
  assert.equal(compare('0.9.0', '0.10.0'), -1);
  assert.equal(compare('0.10.0', '0.9.0'), 1);
  assert.equal(compare('0.5.0', '0.5.0'), 0);
  assert.equal(compare('1.0.0', '0.9.9'), 1);
});

test('compare devolve null quando alguma versao e ilegivel', () => {
  assert.equal(compare('0.5.0', 'nightly'), null);
  assert.equal(compare(null, '0.5.0'), null);
});

test('same e igualdade exata, ignorando espaco e o "v" da frente', () => {
  assert.ok(same('0.5.0', 'v0.5.0'));
  assert.ok(same(' 0.5.0 ', '0.5.0'));
  assert.ok(!same('0.5.0', '0.5.1'));
  assert.ok(!same('0.5.0', null));
  assert.ok(!same('', ''));
});

test('mismatchText diz que EU tenho de atualizar quando a sala e mais nova', () => {
  const txt = mismatchText({ mine: '0.5.0', theirs: '0.6.0' });
  assert.match(txt, /Atualize o GoLive/);
  assert.match(txt, /0\.6\.0/);
});

test('mismatchText diz que o DONO tem de atualizar quando a sala e mais velha', () => {
  const txt = mismatchText({ mine: '0.6.0', theirs: '0.5.0' });
  assert.match(txt, /Quem criou a sala precisa atualizar/);
});

test('mismatchText nao inventa direcao com versao ilegivel', () => {
  const txt = mismatchText({ mine: null, theirs: '0.6.0' });
  assert.match(txt, /mesma versão/);
  assert.doesNotMatch(txt, /Atualize o GoLive/);
  assert.match(mismatchText({ mine: '0.6.0', theirs: null }), /versão diferente da sua/);
});

test('mismatchBadge distingue "atualize" de "desatualizada"', () => {
  assert.equal(mismatchBadge({ mine: '0.5.0', theirs: '0.6.0' }), 'v0.6.0 · atualize');
  assert.equal(mismatchBadge({ mine: '0.6.0', theirs: '0.5.0' }), 'v0.5.0 · desatualizada');
  assert.equal(mismatchBadge({ mine: '0.6.0', theirs: null }), 'versão diferente');
});
