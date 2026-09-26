'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const bj = require('./blackjack');
const registry = require('./index');

// ---------- Funcoes puras: valor da mao e regras da banca ----------

test('descritor segue o contrato (secao 9: blackjack, jogos, secreto)', () => {
  assert.equal(bj.type, 'blackjack');
  assert.equal(bj.title, 'Blackjack');
  assert.equal(bj.group, 'jogos');
  assert.equal(bj.secret, true);
  assert.equal(bj.size.w, 680);
  assert.equal(bj.size.h, 440);
  for (const f of ['init', 'prepare', 'validate', 'reduce', 'view', 'migrate', 'timeoutAt', 'dropPeer', 'summary']) {
    assert.equal(typeof bj[f], 'function', f);
  }
  const reg = registry.get('blackjack');
  assert.ok(reg, 'registrado');
  assert.ok(registry.MODULE_NAMES.includes('blackjack'));
  assert.ok(reg.maxStateBytes <= registry.MAX_STATE_BYTES_CAP);
});

test('cardValue: as 11, figuras e dez 10, numeros pelo valor', () => {
  assert.equal(bj.cardValue('As'), 11);
  for (const c of ['Th', 'Jd', 'Qc', 'Ks']) assert.equal(bj.cardValue(c), 10);
  assert.equal(bj.cardValue('2c'), 2);
  assert.equal(bj.cardValue('9h'), 9);
  assert.equal(bj.cardValue('xx'), 0);
  assert.equal(bj.cardValue(null), 0);
});

test('handValue: as vale 11 ou 1, macia e dura', () => {
  assert.deepEqual(bj.handValue([]), { total: 0, soft: false });
  assert.deepEqual(bj.handValue(['As', '6h']), { total: 17, soft: true });
  assert.deepEqual(bj.handValue(['As', '6h', 'Tc']), { total: 17, soft: false });
  assert.deepEqual(bj.handValue(['As', 'Ad']), { total: 12, soft: true });
  assert.deepEqual(bj.handValue(['As', 'Ad', 'Ah', 'Ac']), { total: 14, soft: true });
  assert.deepEqual(bj.handValue(['As', 'Ad', '9h']), { total: 21, soft: true });
  assert.deepEqual(bj.handValue(['As', 'Kd']), { total: 21, soft: true });
  assert.deepEqual(bj.handValue(['Ts', '6d']), { total: 16, soft: false });
  assert.deepEqual(bj.handValue(['Ts', '6d', 'Kh']), { total: 26, soft: false });
  assert.deepEqual(bj.handValue(['5s', 'As', 'As', 'Ks']), { total: 17, soft: false });
});

test('isBlackjack: as + dez em duas cartas, nunca depois de dividir nem com tres', () => {
  assert.equal(bj.isBlackjack(['As', 'Kd']), true);
  assert.equal(bj.isBlackjack(['Td', 'Ac']), true);
  assert.equal(bj.isBlackjack(['As', 'Kd'], true), false, '21 depois de dividir nao e blackjack');
  assert.equal(bj.isBlackjack(['7s', '7d', '7c']), false);
  assert.equal(bj.isBlackjack(['As', '9d']), false);
});

test('regras da banca: S17 (17 macio para), confere com as e com dez', () => {
  assert.equal(bj.dealerShouldHit(['Ts', '6d']), true);
  assert.equal(bj.dealerShouldHit(['As', '5d']), true, '16 macio pede');
  assert.equal(bj.dealerShouldHit(['As', '6d']), false, '17 macio para');
  assert.equal(bj.dealerShouldHit(['Ts', '7d']), false);
  assert.equal(bj.dealerShouldHit(['2s', '3d', 'As', 'Ac']), false, '2+3+1+11 = 17 macio para');
  assert.equal(bj.dealerShouldHit(['2s', '3d', 'As', 'Ac', '9h']), true, 'vira 16 duro e pede');
  assert.equal(bj.dealerPeeks('As'), true);
  assert.equal(bj.dealerPeeks('Kd'), true);
  assert.equal(bj.dealerPeeks('Td'), true);
  assert.equal(bj.dealerPeeks('9d'), false);
});

test('samePair: mesmo valor, inclusive figuras diferentes', () => {
  assert.equal(bj.samePair(['Js', 'Kd']), true);
  assert.equal(bj.samePair(['8s', '8d']), true);
  assert.equal(bj.samePair(['As', 'Ad']), true);
  assert.equal(bj.samePair(['9s', 'Td']), false);
  assert.equal(bj.samePair(['8s', '8d', '8c']), false);
});

test('payout e outcome: 3:2, 1:1, empate, estouro, banca estoura', () => {
  assert.equal(bj.payout('blackjack', 10), 25);
  assert.equal(bj.payout('blackjack', 25), 62, '3:2 arredonda para baixo');
  assert.equal(bj.payout('win', 30), 60);
  assert.equal(bj.payout('push', 30), 30);
  assert.equal(bj.payout('lose', 30), 0);
  assert.equal(bj.payout('bust', 30), 0);
  const h = (cards, split = false) => ({ cards, split });
  assert.equal(bj.outcome(h(['As', 'Kd']), ['Ts', '9d']), 'blackjack');
  assert.equal(bj.outcome(h(['As', 'Kd']), ['Ts', 'Ad']), 'push');
  assert.equal(bj.outcome(h(['As', 'Kd'], true), ['Ts', '9d']), 'win', '21 dividido paga 1:1');
  assert.equal(bj.outcome(h(['Ts', '9d', '2c']), ['Ts', 'Ad']), 'lose', '21 de 3 cartas perde para blackjack');
  assert.equal(bj.outcome(h(['Ts', '8d']), ['Ts', '8c']), 'push');
  assert.equal(bj.outcome(h(['Ts', '8d', '5c']), ['Ts', '6c', 'Kd']), 'bust', 'quem estoura perde mesmo se a banca estourar');
  assert.equal(bj.outcome(h(['Ts', '2d']), ['Ts', '6c', 'Kd']), 'win');
  assert.equal(bj.outcome(h(['Ts', '7d']), ['Ts', '8c']), 'lose');
});

test('no renderer o modulo carrega por <script>, sem require', () => {
  const dir = path.join(__dirname, '..');
  const context = vm.createContext({ window: {} });
  context.window.globalThis = context;
  vm.runInContext('window.GoLive = globalThis.GoLive = {};', context);
  for (const file of ['mesa-modules/baralho.js', 'mesa-modules/blackjack.js']) {
    vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), context, { filename: file });
  }
  const mod = context.window.GoLive.mesaModules.blackjack;
  assert.equal(mod.type, 'blackjack');
  const s = mod.init({ random: () => 0.5 });
  assert.equal(s.shoe.length, 312);
});
