// src/main/limpezajanela.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pararCapturasDe, criarLimpezaDaPagina, navegacaoDescartaPagina } = require('./limpezajanela');

function captura(log, nome) {
  return { stop: () => log.push(`stop ${nome}`) };
}

test('pararCapturasDe para so as capturas do sender que saiu', () => {
  const log = [];
  const donos = new WeakMap();
  const capturas = new Map();
  const janelaA = {};
  const janelaB = {};
  for (const [id, dono] of [[1, janelaA], [2, janelaB], [3, janelaA]]) {
    const c = captura(log, `#${id}`);
    donos.set(c, dono);
    capturas.set(id, c);
  }
  assert.equal(pararCapturasDe(capturas, donos, janelaA), 2);
  assert.deepEqual(log, ['stop #1', 'stop #3']);
  assert.deepEqual(Array.from(capturas.keys()), [2]);
});

test('pararCapturasDe segue em frente quando um stop() lanca', () => {
  const donos = new WeakMap();
  const dono = {};
  const capturas = new Map();
  const ruim = { stop() { throw new Error('ja parada'); } };
  const boa = { stop() { boa.parou = true; } };
  for (const [id, c] of [[1, ruim], [2, boa]]) {
    donos.set(c, dono);
    capturas.set(id, c);
  }
  assert.equal(pararCapturasDe(capturas, donos, dono), 2);
  assert.equal(boa.parou, true);
  assert.equal(capturas.size, 0);
});

test('a limpeza roda todos os passos na ordem e um que falha nao bloqueia os outros', async () => {
  const ordem = [];
  const logs = [];
  const limpar = criarLimpezaDaPagina({
    passos: [
      ['capturas', () => ordem.push('capturas')],
      ['overlay', () => { throw new Error('boom'); }],
      ['servidor', () => { ordem.push('servidor'); return Promise.reject(new Error('travou')); }],
      ['sala', () => ordem.push('sala')],
    ],
    log: (msg) => logs.push(msg),
  });
  limpar();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ordem, ['capturas', 'servidor', 'sala']);
  assert.equal(logs.length, 2);
  assert.match(logs[0], /overlay falhou: boom/);
  assert.match(logs[1], /servidor falhou: travou/);
});

test('navegacaoDescartaPagina: so o quadro principal, so depois da primeira carga', () => {
  const principal = { isMainFrame: true, isSameDocument: false };
  assert.equal(navegacaoDescartaPagina(principal, false), false); // primeira carga
  assert.equal(navegacaoDescartaPagina(principal, true), true); // recarga
  assert.equal(navegacaoDescartaPagina({ isMainFrame: false, isSameDocument: false }, true), false); // iframe
  assert.equal(navegacaoDescartaPagina({ isMainFrame: true, isSameDocument: true }, true), false); // #hash
  assert.equal(navegacaoDescartaPagina(undefined, true), false);
});
