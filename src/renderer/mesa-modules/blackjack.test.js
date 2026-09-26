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

// ---------- A mesa inteira: servidor simulado ----------

const PEERS = [{ id: 'bia', name: 'Bia' }, { id: 'leo', name: 'Leo' }, { id: 'ana', name: 'Ana' }];
const FILLER = require('./baralho').newDeck(2); // 104 cartas: o sapato nao passa da carta de corte

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** Sorte deterministica (LCG), para os testes. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const clock = 1_000_000;
let luck = seeded(7);

/** Como o servidor: validate (com a hora) -> prepare -> reduce, com o
 * estado sempre congelado (o reduce nunca pode mutar). */
function act(state, action, from, now = clock) {
  const c = { from, isLeader: false, now, peers: PEERS, random: luck };
  assert.equal(bj.validate(deepFreeze(state), action, c), true, `${from} ${JSON.stringify(action)}`);
  const prepared = bj.prepare(state, action, c);
  return deepFreeze(bj.reduce(state, prepared, { from, isLeader: false }));
}

function refuse(state, action, from, now = clock) {
  const r = bj.validate(state, action, { from, isLeader: false, now, peers: PEERS });
  assert.notEqual(r, true, `devia recusar ${JSON.stringify(action)}`);
  return r;
}

/** Mesa com `who` sentados (lugares 0, 1...) e o sapato comecando por `top`. */
function table(who, top) {
  let s = deepFreeze(bj.init({ random: seeded(1), now: clock }));
  who.forEach((id, i) => { s = act(s, { kind: 'sit', seat: i }, id); });
  return deepFreeze(Object.assign({}, s, { shoe: top.concat(FILLER) }));
}

/** Aposta de todos (na ordem) -> cartas na mesa. */
function betAll(s, who, amount = 100) {
  for (const id of who) s = act(s, { kind: 'bet', amount }, id);
  return s;
}

const handOf = (s, seat, k = 0) => s.hands.filter((h) => h.seat === seat)[k];
const withState = (s, extra) => deepFreeze(Object.assign({}, s, extra));

test('sentar da 1 000 fichas; 5 lugares; nome vem do prepare', () => {
  let s = bj.init({ random: seeded(1) });
  assert.equal(s.seats.length, 5);
  assert.equal(s.shoe.length, 312);
  s = act(s, { kind: 'sit', seat: 3 }, 'bia');
  assert.equal(s.chips[3], 1000);
  assert.equal(s.names[3], 'Bia');
  refuse(s, { kind: 'sit', seat: 3 }, 'leo');
  refuse(s, { kind: 'sit', seat: 5 }, 'leo');
  refuse(s, { kind: 'sit', seat: 0 }, 'bia');
  s = act(s, { kind: 'leave' }, 'bia');
  assert.equal(s.seats[3], null);
  assert.equal(s.chips[3], null);
});

test('apostas: 10 a 500, trocar e tirar, prazo de 20 s depois da primeira', () => {
  let s = table(['bia', 'leo'], []);
  refuse(s, { kind: 'bet', amount: 5 }, 'bia');
  refuse(s, { kind: 'bet', amount: 501 }, 'bia');
  refuse(s, { kind: 'bet', amount: 10.5 }, 'bia');
  refuse(s, { kind: 'bet', amount: 0 }, 'bia');
  assert.equal(bj.timeoutAt(s), null);
  s = act(s, { kind: 'bet', amount: 50 }, 'bia');
  assert.equal(s.chips[0], 950);
  assert.equal(bj.timeoutAt(s), clock + 20000);
  s = act(s, { kind: 'bet', amount: 30 }, 'bia', clock + 5000);
  assert.equal(s.chips[0], 970);
  assert.equal(bj.timeoutAt(s), clock + 20000, 'trocar a aposta nao renova o prazo');
  s = act(s, { kind: 'bet', amount: 0 }, 'bia');
  assert.equal(s.chips[0], 1000);
  assert.equal(bj.timeoutAt(s), null, 'sem aposta, sem prazo');
});

test('prazo de apostas: timeout so depois dos 20 s, e quem nao apostou fica fora', () => {
  let s = table(['bia', 'leo'], ['9s', 'Ts', '7d', '8c']);
  s = act(s, { kind: 'bet', amount: 100 }, 'bia');
  assert.equal(s.phase, 'bets');
  assert.match(refuse(s, { kind: 'timeout' }, 'leo', clock + 19999), /tempo/);
  s = act(s, { kind: 'timeout' }, 'ana', clock + 20000);
  assert.equal(s.phase, 'play');
  assert.equal(s.hands.length, 1);
  assert.equal(s.hands[0].seat, 0);
  assert.deepEqual(s.hands[0].cards, ['9s', '7d']);
  assert.deepEqual(s.dealer.cards, ['Ts', '8c']);
  assert.equal(s.chips[1], 1000);
  assert.equal(bj.timeoutAt(s), clock + 20000 + 30000, 'decisao tem 30 s');
});

test('todos apostaram: as cartas saem na hora, na ordem do cassino', () => {
  // bia 1a, leo 1a, banca aberta, bia 2a, leo 2a, banca fechada
  let s = table(['bia', 'leo'], ['Ts', '9h', '5c', '7s', '9d', 'Kd']);
  s = betAll(s, ['bia', 'leo']);
  assert.equal(s.phase, 'play');
  assert.deepEqual(handOf(s, 0).cards, ['Ts', '7s']);
  assert.deepEqual(handOf(s, 1).cards, ['9h', '9d']);
  assert.deepEqual(s.dealer.cards, ['5c', 'Kd']);
  assert.equal(s.turn, 0);
  assert.equal(s.round, 1);
  assert.equal(s.shoe.length, 104);
});

test('pedir, estourar, parar; banca pede ate 17; empate devolve', () => {
  // bia: T 6 + K estoura; leo: 9 9 para em 18; banca 5 K (15) + 3 = 18
  let s = table(['bia', 'leo'], ['Ts', '9h', '5c', '6s', '9d', 'Kd', 'Kc', '3h']);
  s = betAll(s, ['bia', 'leo']);
  refuse(s, { kind: 'hit' }, 'leo');
  s = act(s, { kind: 'hit' }, 'bia');
  assert.equal(handOf(s, 0).done, true);
  assert.equal(s.turn, 1, 'estourou: a vez passa');
  s = act(s, { kind: 'stand' }, 'leo');
  assert.equal(s.phase, 'bets', 'rodada acabou');
  assert.deepEqual(s.dealer.cards, ['5c', 'Kd', '3h']);
  assert.equal(s.dealer.revealed, true);
  assert.equal(handOf(s, 0).result, 'bust');
  assert.equal(handOf(s, 0).win, -100);
  assert.equal(handOf(s, 1).result, 'push');
  assert.equal(handOf(s, 1).win, 0);
  assert.equal(s.chips[0], 900);
  assert.equal(s.chips[1], 1000);
  assert.equal(bj.timeoutAt(s), null);
});

test('banca estoura: quem ficou vivo ganha 1:1', () => {
  let s = table(['bia'], ['Ts', '6c', '2s', 'Td', 'Kh']);
  s = betAll(s, ['bia'], 40);
  s = act(s, { kind: 'stand' }, 'bia');
  assert.deepEqual(s.dealer.cards, ['6c', 'Td', 'Kh']);
  assert.equal(handOf(s, 0).result, 'win');
  assert.equal(handOf(s, 0).win, 40);
  assert.equal(s.chips[0], 1040);
});

test('S17: banca com 17 macio para; com 16 macio pede', () => {
  let s = table(['bia'], ['Ts', 'As', '8h', '6d']);
  s = betAll(s, ['bia']);
  assert.equal(s.phase, 'insurance', 'as aberto oferece seguro');
  s = act(s, { kind: 'insurance', amount: 0 }, 'bia');
  s = act(s, { kind: 'stand' }, 'bia');
  assert.deepEqual(s.dealer.cards, ['As', '6d'], '17 macio para');
  assert.equal(handOf(s, 0).result, 'win');

  s = table(['bia'], ['Ts', 'As', '8h', '5d', '2c']);
  s = betAll(s, ['bia']);
  s = act(s, { kind: 'insurance', amount: 0 }, 'bia');
  s = act(s, { kind: 'stand' }, 'bia');
  assert.deepEqual(s.dealer.cards, ['As', '5d', '2c'], '16 macio pede e chega a 18');
  assert.equal(handOf(s, 0).result, 'push');
});

test('banca confere blackjack com dez aberto: encerra na hora, blackjack do jogador empata', () => {
  let s = table(['bia', 'leo'], ['As', '9h', 'Kc', 'Kd', '9d', 'Ah']);
  s = betAll(s, ['bia', 'leo']);
  assert.equal(s.phase, 'bets', 'rodada encerrada sem ninguem jogar');
  assert.equal(s.dealer.revealed, true);
  assert.equal(handOf(s, 0).result, 'push', 'blackjack contra blackjack');
  assert.equal(handOf(s, 1).result, 'lose');
  assert.equal(s.chips[0], 1000);
  assert.equal(s.chips[1], 900);
});

test('dez aberto sem blackjack: segue o jogo, sem seguro e sem mostrar a fechada', () => {
  let s = table(['bia'], ['9s', 'Kc', '9d', '7h']);
  s = betAll(s, ['bia']);
  assert.equal(s.phase, 'play');
  assert.equal(s.dealer.revealed, false);
});

test('banca confere blackjack com as aberto (depois do seguro)', () => {
  let s = table(['bia'], ['9s', 'Ac', '9d', 'Jh']);
  s = betAll(s, ['bia']);
  assert.equal(s.phase, 'insurance');
  s = act(s, { kind: 'insurance', amount: 0 }, 'bia');
  assert.equal(s.phase, 'bets');
  assert.equal(s.dealer.revealed, true);
  assert.equal(handOf(s, 0).result, 'lose');
  assert.equal(handOf(s, 0).cards.length, 2, 'ninguem joga contra blackjack da banca');
});

test('seguro pago 2:1 quando a banca tem blackjack', () => {
  let s = table(['bia', 'leo'], ['Ts', '9h', 'As', '8s', '9d', 'Kd']);
  s = betAll(s, ['bia', 'leo']);
  assert.equal(s.phase, 'insurance');
  assert.equal(bj.view(s, 'bia').me.insuranceMax, 50);
  refuse(s, { kind: 'insurance', amount: 51 }, 'bia');
  refuse(s, { kind: 'hit' }, 'bia');
  s = act(s, { kind: 'insurance', amount: 50 }, 'bia');
  assert.equal(s.chips[0], 850);
  assert.equal(s.phase, 'insurance', 'espera o leo');
  refuse(s, { kind: 'insurance', amount: 10 }, 'bia');
  s = act(s, { kind: 'insurance', amount: 0 }, 'leo');
  assert.equal(s.phase, 'bets');
  assert.equal(s.insuranceNet[0], 100);
  assert.equal(handOf(s, 0).result, 'lose');
  assert.equal(s.chips[0], 1000, 'perdeu 100 na mao, ganhou 100 no seguro');
  assert.equal(s.chips[1], 900);
});

test('seguro perdido quando a banca nao tem blackjack; timeout recusa por quem nao decidiu', () => {
  let s = table(['bia', 'leo'], ['Ts', '9h', 'As', 'Ks', '9d', '7d']);
  s = betAll(s, ['bia', 'leo']);
  s = act(s, { kind: 'insurance', amount: 20 }, 'bia');
  refuse(s, { kind: 'timeout' }, 'bia', clock + 29999);
  s = act(s, { kind: 'timeout' }, 'bia', clock + 30000);
  assert.equal(s.phase, 'play');
  assert.equal(s.insurance[1], 0);
  assert.equal(s.insuranceNet[0], -20);
  assert.equal(s.chips[0], 880);
  s = act(s, { kind: 'stand' }, 'bia');
  s = act(s, { kind: 'stand' }, 'leo');
  assert.equal(handOf(s, 0).result, 'win', '20 contra 18');
  assert.equal(s.chips[0], 1080);
});

test('blackjack natural paga 3:2 e nao joga', () => {
  let s = table(['bia', 'leo'], ['As', '9h', '7c', 'Kd', '9d', 'Td']);
  s = betAll(s, ['bia', 'leo'], 100);
  assert.equal(s.phase, 'play');
  assert.equal(s.turn, 1, 'bia com blackjack nao tem vez');
  s = act(s, { kind: 'stand' }, 'leo');
  assert.equal(handOf(s, 0).result, 'blackjack');
  assert.equal(handOf(s, 0).win, 150);
  assert.equal(s.chips[0], 1150);
  assert.equal(handOf(s, 1).result, 'win');
});

test('todos com blackjack: a banca so vira, nao pede', () => {
  let s = table(['bia'], ['As', '5c', 'Kd', '6d', '9h']);
  s = betAll(s, ['bia']);
  assert.equal(s.phase, 'bets');
  assert.deepEqual(s.dealer.cards, ['5c', '6d']);
  assert.equal(handOf(s, 0).result, 'blackjack');
});

test('dobrar: dobra a aposta, uma carta e para', () => {
  let s = table(['bia'], ['6s', '9c', '5h', '7d', 'Th', '8c']);
  s = betAll(s, ['bia'], 100);
  assert.ok(bj.view(s, 'bia').me.actions.includes('double'));
  s = act(s, { kind: 'double' }, 'bia');
  const h = handOf(s, 0);
  assert.equal(h.bet, 200);
  assert.equal(h.doubled, true);
  assert.deepEqual(h.cards, ['6s', '5h', 'Th']);
  assert.deepEqual(s.dealer.cards, ['9c', '7d', '8c'], 'banca 16 pede e estoura');
  assert.equal(h.result, 'win');
  assert.equal(h.win, 200);
  assert.equal(s.chips[0], 1200);
});

test('dobrar so com duas cartas e com fichas', () => {
  let s = table(['bia'], ['2s', '9c', '3h', '7d', '4c']);
  s = betAll(s, ['bia'], 100);
  s = act(s, { kind: 'hit' }, 'bia');
  assert.match(refuse(s, { kind: 'double' }, 'bia'), /duas cartas/);
  assert.ok(!bj.view(s, 'bia').me.actions.includes('double'));

  s = table(['bia'], ['2s', '9c', '3h', '7d', '4c']);
  s = act(s, { kind: 'bet', amount: 500 }, 'bia');
  s = withState(s, { chips: [400, null, null, null, null] });
  assert.match(refuse(s, { kind: 'double' }, 'bia'), /Fichas/);
});

test('dividir ate 4 maos, dobrar depois de dividir', () => {
  let s = table(['bia'], [
    '8s', '6c', '8d', 'Td', // bia 8 8, banca 6 T
    '8h', '3c', // 1a divisao: A = 8s 8h, B = 8d 3c
    '8c', 'Kh', // 2a (em A): A = 8s 8c, C = 8h Kh
    'As', '2c', // 3a (em A): A = 8s As, D = 8c 2c
    '5d', // D dobra: 8 2 5 = 15
    '9s', // B dobra: 8 3 9 = 20
    '7h', // banca 6 T 7 = 23
  ]);
  s = betAll(s, ['bia'], 100);
  assert.deepEqual(handOf(s, 0).cards, ['8s', '8d']);
  s = act(s, { kind: 'split' }, 'bia');
  assert.deepEqual(s.hands.map((h) => h.cards), [['8s', '8h'], ['8d', '3c']]);
  assert.equal(s.chips[0], 800);
  s = act(s, { kind: 'split' }, 'bia');
  assert.deepEqual(s.hands.map((h) => h.cards), [['8s', '8c'], ['8h', 'Kh'], ['8d', '3c']]);
  s = act(s, { kind: 'split' }, 'bia');
  assert.deepEqual(s.hands.map((h) => h.cards), [['8s', 'As'], ['8c', '2c'], ['8h', 'Kh'], ['8d', '3c']]);
  assert.equal(s.chips[0], 600);
  assert.ok(!bj.view(s, 'bia').me.actions.includes('split'));
  s = act(s, { kind: 'stand' }, 'bia'); // 19
  assert.equal(s.turn, 1);
  assert.ok(bj.view(s, 'bia').me.actions.includes('double'), 'dobrar depois de dividir');
  s = act(s, { kind: 'double' }, 'bia');
  assert.equal(s.hands[1].bet, 200);
  assert.equal(s.turn, 2);
  s = act(s, { kind: 'stand' }, 'bia'); // 18
  s = act(s, { kind: 'double' }, 'bia');
  assert.equal(s.phase, 'bets');
  assert.deepEqual(s.dealer.cards, ['6c', 'Td', '7h'], 'banca 23, estourou');
  assert.deepEqual(s.hands.map((h) => h.result), ['win', 'win', 'win', 'win']);
  assert.deepEqual(s.hands.map((h) => h.win), [100, 200, 100, 200]);
  assert.equal(s.chips[0], 1600);
});

test('quatro maos e o teto, mesmo com par', () => {
  let s = table(['bia'], ['8s', '6c', '8d', 'Td', '8h', '8c', '8c', '8h', '8d', '8s']);
  s = betAll(s, ['bia'], 10);
  s = act(s, { kind: 'split' }, 'bia');
  s = act(s, { kind: 'split' }, 'bia');
  s = act(s, { kind: 'split' }, 'bia');
  assert.equal(s.hands.length, 4);
  assert.ok(bj.samePair(s.hands[0].cards));
  assert.match(refuse(s, { kind: 'split' }, 'bia'), /4 mãos/);
});

test('figuras diferentes de mesmo valor se dividem (J e K)', () => {
  let s = table(['bia'], ['Js', '6c', 'Kd', 'Td', '5h', '4c']);
  s = betAll(s, ['bia'], 10);
  assert.ok(bj.view(s, 'bia').me.actions.includes('split'));
  s = act(s, { kind: 'split' }, 'bia');
  assert.deepEqual(s.hands.map((h) => h.cards), [['Js', '5h'], ['Kd', '4c']]);
});

test('ases divididos: uma carta cada, sem redividir, 21 depois de dividir paga 1:1', () => {
  let s = table(['bia', 'leo'], ['As', '9h', '7c', 'Ad', '9d', 'Td', 'Kh', 'Ac', '5s']);
  s = betAll(s, ['bia', 'leo'], 100);
  s = act(s, { kind: 'split' }, 'bia');
  assert.deepEqual(s.hands.filter((h) => h.seat === 0).map((h) => h.cards), [['As', 'Kh'], ['Ad', 'Ac']]);
  assert.ok(s.hands.filter((h) => h.seat === 0).every((h) => h.done && h.aces));
  assert.equal(s.turn, 2, 'a vez pula as duas maos de ases');
  const v = bj.view(s, 'bia');
  assert.equal(v.hands[0].blackjack, false, 'A+K dividido nao e blackjack');
  assert.equal(v.hands[0].total, 21);
  s = act(s, { kind: 'stand' }, 'leo');
  assert.deepEqual(s.dealer.cards, ['7c', 'Td']);
  const [a, b] = s.hands.filter((h) => h.seat === 0);
  assert.equal(a.result, 'win', 'A+K dividido paga 1:1, nao 3:2');
  assert.equal(a.win, 100);
  assert.equal(b.result, 'lose', 'A+A = 12 contra 17');
  assert.equal(s.chips[0], 1000);
});

test('ases divididos nao se dividem de novo nem pedem', () => {
  let s = table(['bia', 'leo'], ['As', '9h', '7c', 'Ad', '9d', 'Td', 'Ah', 'Ac']);
  s = betAll(s, ['bia', 'leo'], 100);
  s = act(s, { kind: 'split' }, 'bia');
  // As+Ah e Ad+Ac sao pares, mas as maos ja acabaram
  assert.equal(s.turn, 2);
  const st = withState(s, {
    turn: 0,
    hands: [Object.assign({}, s.hands[0], { done: false }), s.hands[1], s.hands[2]],
  });
  assert.match(refuse(st, { kind: 'split' }, 'bia'), /Ases divididos/);
  assert.ok(!bj.view(st, 'bia').me.actions.includes('split'));
});

test('pedir ate 21 para sozinho; timeout na decisao para a mao', () => {
  let s = table(['bia', 'leo'], ['5s', '9h', '9c', '6d', '8d', '8c', 'Ts']);
  s = betAll(s, ['bia', 'leo']);
  s = act(s, { kind: 'hit' }, 'bia'); // 5 6 + T = 21
  assert.equal(s.turn, 1, '21 para sozinho');
  const due = bj.timeoutAt(s);
  refuse(s, { kind: 'timeout' }, 'bia', due - 1);
  s = act(s, { kind: 'timeout' }, 'bia', due);
  assert.equal(s.phase, 'bets');
  assert.equal(handOf(s, 1).cards.length, 2, 'estourou o prazo: parou');
  assert.deepEqual(s.dealer.cards, ['9c', '8c']);
  assert.equal(handOf(s, 0).result, 'win');
  assert.equal(handOf(s, 1).result, 'push');
});

test('cada decisao renova os 30 s', () => {
  let s = table(['bia'], ['2s', '9c', '3h', '7d', '2c', '2d']);
  s = betAll(s, ['bia']);
  assert.equal(bj.timeoutAt(s), clock + 30000);
  s = act(s, { kind: 'hit' }, 'bia', clock + 10000);
  assert.equal(bj.timeoutAt(s), clock + 40000);
});

test('carta de corte a 75 %: a rodada seguinte embaralha um sapato novo', () => {
  let s = table(['bia'], []);
  s = withState(s, { shoe: FILLER.slice(0, 77) });
  assert.equal(s.shuffles, 1);
  s = act(s, { kind: 'bet', amount: 10 }, 'bia');
  assert.equal(s.shuffles, 2);
  assert.equal(s.reshuffled, true);
  assert.equal(s.shoe.length, 312 - 4);
  assert.equal(bj.view(s, 'bia').reshuffled, true);
  // com 78 (exatamente 75 % dados) ainda nao embaralha
  s = table(['bia'], []);
  s = withState(s, { shoe: FILLER.slice(0, 78) });
  s = act(s, { kind: 'bet', amount: 10 }, 'bia');
  assert.equal(s.shuffles, 1);
  assert.equal(s.reshuffled, false);
  assert.equal(s.shoe.length, 74);
});

test('sapato acabando no meio da rodada: o prepare manda a reserva', () => {
  let s = table(['bia'], []);
  s = withState(s, { shoe: ['2s', '9c', '3h', '7d', '2c'].concat(FILLER.slice(0, 80)) });
  s = betAll(s, ['bia']);
  s = withState(s, { shoe: [] });
  s = act(s, { kind: 'hit' }, 'bia');
  assert.equal(s.hands[0].cards.length, 3);
  assert.equal(s.shuffles, 2);
  assert.ok(s.shoe.length >= 300);
});

test('o prepare nunca aceita sapato nem hora vindos do cliente', () => {
  let s = table(['bia'], []);
  s = withState(s, { shoe: [] });
  const trapaca = { kind: 'bet', amount: 10, fresh: ['As', 'Kd', 'Ah', 'Kc'], at: 1 };
  const p = bj.prepare(s, trapaca, { from: 'bia', now: 5000, random: seeded(3), peers: PEERS });
  assert.equal(p.at, 5000);
  assert.equal(p.fresh.length, 312);
  assert.notDeepEqual(p.fresh.slice(0, 4), trapaca.fresh);
  assert.equal(bj.prepare(table(['bia'], []), trapaca, { from: 'bia', now: 1 }).fresh, undefined);
});

test('recompra: so sem fichas para a aposta minima e entre rodadas', () => {
  let s = table(['bia'], []);
  assert.match(refuse(s, { kind: 'rebuy' }, 'bia'), /sem fichas/);
  s = withState(s, { chips: [0, null, null, null, null] });
  assert.ok(bj.view(s, 'bia').me.actions.includes('rebuy'));
  assert.ok(!bj.view(s, 'bia').me.actions.includes('bet'));
  refuse(s, { kind: 'bet', amount: 10 }, 'bia');
  s = act(s, { kind: 'rebuy' }, 'bia');
  assert.equal(s.chips[0], 1000);
  // aposta 500, perde, recompra so depois da rodada
  s = withState(s, { chips: [500, null, null, null, null], shoe: ['Ts', '9h', '6c', 'Tc'].concat(FILLER) });
  s = act(s, { kind: 'bet', amount: 500 }, 'bia');
  assert.equal(s.chips[0], 0);
  assert.match(refuse(s, { kind: 'rebuy' }, 'bia'), /entre rodadas/);
  s = act(s, { kind: 'stand' }, 'bia');
  assert.equal(handOf(s, 0).result, 'lose');
  assert.equal(s.chips[0], 0);
  s = act(s, { kind: 'rebuy' }, 'bia');
  assert.equal(s.chips[0], 1000);
});

test('levantar: nao no meio da rodada; nas apostas pode, e se o resto ja apostou saem as cartas', () => {
  let s = table(['bia', 'leo'], ['Ts', '5c', '7s', 'Kd']);
  s = act(s, { kind: 'bet', amount: 100 }, 'bia');
  s = act(s, { kind: 'leave' }, 'leo');
  assert.equal(s.phase, 'play');
  assert.match(refuse(s, { kind: 'leave' }, 'bia'), /rodada/);
});

test('quem sai no meio: as maos saem, a vez passa com prazo novo, a banca joga pelo timeout', () => {
  let s = table(['bia', 'leo', 'ana'], ['Ts', '9h', '8c', '5c', '7s', '9d', '8d', 'Kd', '2h']);
  s = betAll(s, ['bia', 'leo', 'ana']);
  assert.equal(s.turn, 0);
  const due = bj.timeoutAt(s);
  // quem nao esta na vez sai: a vez continua da bia
  let d = deepFreeze(bj.dropPeer(s, 'leo'));
  assert.equal(d.hands.length, 2);
  assert.equal(d.turn, 0);
  assert.equal(d.seats[1], null);
  assert.equal(d.chips[1], null);
  assert.equal(bj.timeoutAt(d), due);
  // a bia (na vez) sai: vai para a ana com prazo renovado
  d = deepFreeze(bj.dropPeer(d, 'bia'));
  assert.equal(d.turn, 0);
  assert.equal(d.hands[0].seat, 2);
  assert.equal(bj.timeoutAt(d), due + 30000);
  // a ana sai: ninguem mais, a rodada e cancelada
  const vazio = bj.dropPeer(d, 'ana');
  assert.equal(vazio.phase, 'bets');
  assert.equal(vazio.hands.length, 0);
  assert.equal(bj.timeoutAt(vazio), null);
  // se a ultima mao sai, a banca joga no primeiro timeout
  s = act(s, { kind: 'stand' }, 'bia');
  s = act(s, { kind: 'stand' }, 'leo');
  d = deepFreeze(bj.dropPeer(s, 'ana'));
  assert.equal(d.phase, 'dealer');
  assert.equal(bj.timeoutAt(d), 0);
  assert.equal(bj.view(d, null).dealer.cards[1], null, 'ainda nao virou');
  d = act(d, { kind: 'timeout' }, 'bia');
  assert.equal(d.phase, 'bets');
  assert.deepEqual(d.dealer.cards, ['5c', 'Kd', '2h']);
  assert.deepEqual(d.hands.map((h) => h.result), ['push', 'win']);
  assert.equal(bj.dropPeer(s, 'zeca'), s, 'quem nao esta sentado nao muda nada');
});

test('quem sai com a vez e maos divididas: a vez vai para o proximo lugar', () => {
  let s = table(['bia', 'leo'], ['8s', '9h', '6c', '8d', '9d', 'Td', '3h', '4h']);
  s = betAll(s, ['bia', 'leo']);
  s = act(s, { kind: 'split' }, 'bia');
  s = act(s, { kind: 'stand' }, 'bia');
  assert.equal(s.turn, 1);
  const d = bj.dropPeer(s, 'bia');
  assert.equal(d.hands.length, 1);
  assert.equal(d.turn, 0);
  assert.equal(d.hands[0].seat, 1);
});

test('quem sai nas apostas: se o resto ja apostou, o prazo vence e o timeout da as cartas', () => {
  let s = table(['bia', 'leo'], ['Ts', '5c', '7s', 'Kd']);
  s = act(s, { kind: 'bet', amount: 100 }, 'bia');
  const d = deepFreeze(bj.dropPeer(s, 'leo'));
  assert.equal(bj.timeoutAt(d), 0);
  assert.equal(act(d, { kind: 'timeout' }, 'bia').phase, 'play');
  const f = deepFreeze(bj.dropPeer(s, 'bia'));
  assert.equal(bj.timeoutAt(f), null, 'sem aposta nenhuma, sem prazo');
});

test('quem sai no seguro: se era o ultimo a decidir, o prazo vence', () => {
  let s = table(['bia', 'leo'], ['Ts', '9h', 'As', '8s', '9d', '7d']);
  s = betAll(s, ['bia', 'leo']);
  s = act(s, { kind: 'insurance', amount: 0 }, 'bia');
  const d = deepFreeze(bj.dropPeer(s, 'leo'));
  assert.equal(bj.timeoutAt(d), 0);
  assert.equal(act(d, { kind: 'timeout' }, 'bia').phase, 'play');
});

test('migrate cancela a rodada, devolve as apostas (divisoes inclusive) e tira o sapato', () => {
  let s = table(['bia', 'leo'], ['8s', '9h', '6c', '8d', '9d', 'Td', '3h', '4h']);
  s = betAll(s, ['bia', 'leo'], 100);
  s = act(s, { kind: 'split' }, 'bia');
  assert.equal(s.chips[0], 800);
  const m = deepFreeze(bj.migrate(s));
  assert.equal(m.phase, 'bets');
  assert.deepEqual(m.chips.slice(0, 2), [1000, 1000]);
  assert.deepEqual(m.shoe, []);
  assert.deepEqual(m.hands, []);
  assert.deepEqual(m.dealer.cards, []);
  assert.deepEqual(m.seats.slice(0, 2), ['bia', 'leo']);
  assert.equal(bj.timeoutAt(m), null);
  // seguro ainda nao resolvido tambem volta
  let i = table(['bia'], ['Ts', 'As', '9d', '7d']);
  i = betAll(i, ['bia'], 100);
  i = act(i, { kind: 'insurance', amount: 50 }, 'bia');
  assert.equal(i.phase, 'play');
  assert.equal(bj.migrate(i).chips[0], 950, 'seguro ja perdido nao volta; a aposta sim');
  // apostas ainda nao dadas tambem voltam
  let b = table(['bia', 'leo'], []);
  b = act(b, { kind: 'bet', amount: 70 }, 'bia');
  const mb = deepFreeze(bj.migrate(b));
  assert.equal(mb.chips[0], 1000);
  assert.equal(mb.bets[0], 0);
  // o servidor novo da as cartas com um sapato novo (o prepare manda `fresh`)
  let n = act(mb, { kind: 'bet', amount: 10 }, 'bia');
  n = act(n, { kind: 'bet', amount: 10 }, 'leo');
  assert.equal(n.round, 1);
  assert.equal(n.shoe.length, 312 - 6);
});

test('view nunca vaza a carta fechada nem o sapato (varrendo o JSON)', () => {
  // a fechada (Qc) nao existe em mais lugar nenhum
  const top = ['Ts', '8h', '5c', '7s', '8d', 'Qc', '2h'];
  let s = table(['bia', 'leo'], top);
  s = withState(s, { shoe: top.concat(FILLER.filter((c) => c !== 'Qc')) });
  s = betAll(s, ['bia', 'leo']);
  assert.equal(s.dealer.cards[1], 'Qc');
  const proximas = s.shoe.slice(0, 5);
  for (const who of ['bia', 'leo', 'ana', null]) {
    const v = bj.view(s, who);
    const json = JSON.stringify(v);
    assert.ok(!json.includes('Qc'), `a fechada vazou para ${who}`);
    assert.ok(!/shoe"\s*:\s*\[/.test(json), 'sapato na view');
    for (const c of proximas) assert.ok(!json.includes(`"${c}"`), `proxima carta ${c} vazou`);
    assert.deepEqual(v.dealer.cards, ['5c', null]);
    assert.equal(v.dealer.total, 5);
    assert.equal(v.dealer.blackjack, false);
    assert.equal(v.shoeLeft, s.shoe.length);
    const tamanhos = [];
    JSON.parse(json, (k, val) => { if (Array.isArray(val)) tamanhos.push(val.length); return val; });
    assert.ok(Math.max(...tamanhos) <= 5, 'lista grande na view (sapato?)');
  }
  // na vez da banca, a fechada aparece
  s = act(s, { kind: 'stand' }, 'bia');
  s = act(s, { kind: 'stand' }, 'leo');
  const fim = bj.view(s, null);
  assert.deepEqual(fim.dealer.cards, ['5c', 'Qc', '2h']);
  assert.equal(fim.dealer.total, 17);
  assert.equal(fim.dealer.revealed, true);
});

test('view no seguro tambem esconde a fechada (mesmo a de blackjack)', () => {
  let s = table(['bia', 'leo'], ['Ts', '9h', 'As', '8s', '9d', 'Kd']);
  s = betAll(s, ['bia', 'leo']);
  const v = bj.view(s, 'leo');
  assert.equal(JSON.stringify(v).includes('Kd'), false);
  assert.deepEqual(v.me.actions, ['insurance']);
  assert.equal(v.me.seat, 1);
  assert.equal(v.me.insuranceMax, 50);
  assert.equal(v.deadline, clock + 30000);
  const ver = bj.view(s, null);
  assert.equal(ver.me.seat, -1);
  assert.deepEqual(ver.me.actions, ['sit']);
});

test('view.me ja traz as acoes calculadas', () => {
  let s = table(['bia', 'leo'], ['8s', '9h', '6c', '8d', '9d', 'Td']);
  let v = bj.view(s, 'bia');
  assert.deepEqual(v.me.actions, ['leave', 'bet']);
  assert.equal(v.me.minBet, 10);
  assert.equal(v.me.maxBet, 500);
  assert.equal(v.me.chips, 1000);
  s = betAll(s, ['bia', 'leo']);
  v = bj.view(s, 'bia');
  assert.deepEqual(v.me.actions, ['hit', 'stand', 'double', 'split']);
  assert.equal(v.me.hand, 0);
  assert.equal(v.turn, 0);
  assert.equal(v.hands[0].total, 16);
  assert.deepEqual(bj.view(s, 'leo').me.actions, [], 'nao e a vez do leo, e nao levanta no meio');
  const m = bj.view(withState(s, { hands: [Object.assign({}, s.hands[0], { cards: ['As', '6d'] }), s.hands[1]] }), 'bia');
  assert.equal(m.hands[0].soft, true);
  assert.equal(m.hands[0].total, 17);
  const cheio = withState(s, { seats: ['bia', 'leo', 'a', 'b', 'c'] });
  assert.deepEqual(bj.view(cheio, 'ana').me.actions, [], 'sem lugar livre, nao senta');
});

test('determinismo: a mesma sorte da as mesmas rodadas', () => {
  function jogar(seed) {
    luck = seeded(seed);
    let s = deepFreeze(bj.init({ random: seeded(seed), now: clock }));
    s = act(s, { kind: 'sit', seat: 0 }, 'bia');
    s = act(s, { kind: 'sit', seat: 2 }, 'leo');
    const trilha = [];
    let maior = 0;
    for (let r = 0; r < 60; r += 1) {
      s = act(s, { kind: 'bet', amount: 10 }, 'bia');
      s = act(s, { kind: 'bet', amount: 10 }, 'leo');
      for (let guard = 0; s.phase !== 'bets' && guard < 50; guard += 1) {
        if (s.phase === 'insurance') {
          for (const id of ['bia', 'leo']) if (bj.view(s, id).me.actions.includes('insurance')) s = act(s, { kind: 'insurance', amount: 0 }, id);
          continue;
        }
        const h = s.hands[s.turn];
        const id = s.seats[h.seat];
        const acts = bj.view(s, id).me.actions;
        let kind = bj.handValue(h.cards).total < 17 ? 'hit' : 'stand';
        if (acts.includes('split')) kind = 'split';
        else if (acts.includes('double') && bj.handValue(h.cards).total === 11) kind = 'double';
        s = act(s, { kind }, id);
        maior = Math.max(maior, JSON.stringify(s).length);
      }
      for (const [i, id] of [[0, 'bia'], [2, 'leo']]) if (s.chips[i] < 10) s = act(s, { kind: 'rebuy' }, id);
      trilha.push(JSON.stringify([s.dealer.cards, s.hands.map((h) => h.cards), s.chips]));
    }
    luck = seeded(7);
    return { trilha, s, maior };
  }
  const a = jogar(42);
  const b = jogar(42);
  const c = jogar(43);
  assert.deepEqual(a.trilha, b.trilha);
  assert.notDeepEqual(a.trilha, c.trilha);
  assert.ok(a.s.shuffles >= 2, `60 rodadas passam da carta de corte (${a.s.shuffles})`);
  assert.ok(a.maior < bj.maxStateBytes, `estado de ${a.maior} bytes`);
});

test('estado congelado: reduce, dropPeer, migrate e view nunca mutam', () => {
  const s = deepFreeze(betAll(table(['bia', 'leo'], ['8s', '9h', '6c', '8d', '9d', 'Td']), ['bia', 'leo']));
  const antes = JSON.stringify(s);
  act(s, { kind: 'split' }, 'bia');
  act(s, { kind: 'hit' }, 'bia');
  act(s, { kind: 'double' }, 'bia');
  bj.dropPeer(s, 'bia');
  bj.migrate(s);
  bj.view(s, 'bia');
  assert.equal(JSON.stringify(s), antes);
});

test('acao ruim nunca lanca e nao muda o estado', () => {
  const s = table(['bia'], []);
  for (const a of [null, 42, 'hit', {}, { kind: 'voar' }, { kind: 'bet' }, { kind: 'bet', amount: '10' }, { kind: 'sit', seat: -1 }, { kind: 'hit' }]) {
    assert.notEqual(bj.validate(s, a, { from: 'bia', now: clock }), true);
    assert.equal(bj.reduce(s, a, { from: 'bia' }), s);
  }
  assert.notEqual(bj.validate(s, { kind: 'rebuy' }, {}), true);
  assert.notEqual(bj.validate(s, { kind: 'bet', amount: 10 }, { from: 'zeca' }), true);
  assert.equal(bj.view(null, 'bia').me.seat, -1);
  assert.equal(bj.summary(null), 'Blackjack');
  assert.equal(bj.dropPeer(null, 'bia'), null);
});

test('summary em portugues', () => {
  assert.equal(bj.summary(table([], [])), 'Blackjack — lugares livres');
  let s = table(['bia', 'leo'], ['8s', '9h', '6c', '8d', '9d', 'Td']);
  assert.equal(bj.summary(s), 'Blackjack — 2 na mesa, apostas abertas');
  s = betAll(s, ['bia', 'leo']);
  assert.equal(bj.summary(s, PEERS), 'Blackjack — vez de Bia');
});
