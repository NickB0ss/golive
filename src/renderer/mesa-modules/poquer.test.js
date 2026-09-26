'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('./poquer');
const B = require('./baralho');
const registry = require('./index');

const PEERS = ['ana', 'bia', 'caio', 'duda', 'edu', 'fe', 'gil', 'hugo'].map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) }));
const T0 = 1_000_000;

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** Sorte fixa (LCG), para os testes repetirem. */
function lcg(seed) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/** Como no servidor: validate (acao crua) -> prepare -> reduce. */
function act(state, action, from, opts) {
  const o = opts || {};
  const now = o.now === undefined ? T0 : o.now;
  const ctx = { from, isLeader: !!o.leader, now, peers: PEERS, random: o.random || lcg(1) };
  const ok = P.validate(state, action, ctx);
  assert.equal(ok, true, `${from} ${JSON.stringify(action)}: ${ok}`);
  const prepared = P.prepare(deepFreeze(state), action, ctx);
  const next = P.reduce(deepFreeze(state), deepFreeze(prepared), { from, isLeader: !!o.leader });
  assert.notEqual(next, state, 'a acao deveria mudar o estado');
  return deepFreeze(next);
}

function denied(state, action, from, opts) {
  const o = opts || {};
  const r = P.validate(state, action, { from, isLeader: !!o.leader, now: o.now === undefined ? T0 : o.now, peers: PEERS });
  assert.notEqual(r, true, `${from} ${JSON.stringify(action)} deveria ser recusada`);
  assert.equal(typeof r, 'string');
  return r;
}

/** Senta `who` = { seat: peerId } e ajusta as fichas (opcional). */
function table(who, stacks) {
  let s = deepFreeze(P.init({}));
  for (const [seat, id] of Object.entries(who)) s = act(s, { kind: 'sit', seat: Number(seat) }, id);
  if (stacks) {
    const c = JSON.parse(JSON.stringify(s));
    for (const [seat, v] of Object.entries(stacks)) c.stacks[Number(seat)] = v;
    s = deepFreeze(c);
  }
  return s;
}

/**
 * Baralho arrumado para a proxima mao: `holes` = { seat: 'As Kd' },
 * `board` = 'Ah Kh Qh Jh Th'. Descobre a ordem da distribuicao dando as
 * cartas uma vez com o baralho em ordem (reduce e puro).
 */
function arrange(state, holes, board) {
  const probe = P.reduce(state, { kind: 'deal', at: T0 }, { from: state.seats.find((x) => x) });
  const h = probe.hand;
  const order = [];
  for (let k = 0; k < 8; k += 1) {
    const s = (h.sbSeat + k) % 8;
    if (h.status[s]) order.push(s);
  }
  const want = [];
  const hl = {};
  for (const [seat, txt] of Object.entries(holes)) hl[seat] = txt.split(' ');
  for (let r = 0; r < 2; r += 1) for (const s of order) want.push(hl[s] ? hl[s][r] : null);
  const bd = board ? board.split(' ') : [];
  const tail = [null, bd[0], bd[1], bd[2], null, bd[3], null, bd[4]];
  want.push(...tail);
  const used = new Set(want.filter(Boolean));
  const rest = B.newDeck().filter((c) => !used.has(c));
  return want.map((c) => c || rest.shift()).concat(rest);
}

/** Da as cartas com baralho arrumado (sem o prepare, que embaralharia). */
function dealWith(state, from, holes, board, at) {
  assert.equal(P.validate(state, { kind: 'deal' }, { from }), true);
  const deck = arrange(state, holes, board);
  return deepFreeze(P.reduce(deepFreeze(state), { kind: 'deal', at: at === undefined ? T0 : at, deck }, { from }));
}

const idAt = (s, seat) => s.seats[seat];
const turn = (s) => idAt(s, s.hand.toAct);
/** A pessoa da vez faz `action`. */
const play = (s, action, opts) => act(s, action, turn(s), opts);

// ---------- Basico ----------

test('registro: pôquer entra nos jogos, secreto, com view/migrate/timeoutAt', () => {
  const m = registry.get('poquer');
  assert.ok(m, JSON.stringify(registry.loadErrors));
  assert.equal(m.title, 'Pôquer');
  assert.equal(m.group, 'jogos');
  assert.equal(m.secret, true);
  for (const f of ['init', 'prepare', 'validate', 'reduce', 'view', 'migrate', 'timeoutAt', 'dropPeer', 'summary']) {
    assert.equal(typeof m[f], 'function', f);
  }
  assert.ok(registry.addable().some((x) => x.type === 'poquer'));
});

test('sentar da 1 000 fichas; cadeira ocupada, dupla e fora da faixa sao recusadas', () => {
  const s = table({ 0: 'ana', 5: 'bia' });
  assert.equal(s.stacks[0], 1000);
  assert.equal(s.names[5], 'Bia');
  denied(s, { kind: 'sit', seat: 5 }, 'caio');
  denied(s, { kind: 'sit', seat: 1 }, 'ana');
  denied(s, { kind: 'sit', seat: 8 }, 'caio');
  denied(s, { kind: 'sit', seat: '1' }, 'caio');
  denied(s, { kind: 'stand' }, 'caio');
  denied(s, { kind: 'nada' }, 'ana');
  denied(s, null, 'ana');
  const t = act(s, { kind: 'stand' }, 'bia');
  assert.equal(t.seats[5], null);
  assert.equal(t.stacks[5], 0);
});

test('dar as cartas: so sentado, com 2+ com fichas, e nao no meio da mao', () => {
  let s = table({ 0: 'ana' });
  assert.match(denied(s, { kind: 'deal' }, 'ana'), /2 pessoas/);
  s = act(s, { kind: 'sit', seat: 1 }, 'bia');
  denied(s, { kind: 'deal' }, 'caio');
  s = act(s, { kind: 'deal' }, 'ana');
  assert.equal(s.hand.no, 1);
  denied(s, { kind: 'deal' }, 'bia');
  assert.equal(s.hand.deck.length, 52 - 4);
});

// ---------- Blinds e botao ----------

test('mano a mano: o botao paga o small blind, fala primeiro no pre-flop e por ultimo depois', () => {
  let s = table({ 0: 'ana', 3: 'bia' });
  s = act(s, { kind: 'deal' }, 'ana');
  const h = s.hand;
  assert.equal(s.button, 0);
  assert.equal(h.sbSeat, 0);
  assert.equal(h.bbSeat, 3);
  assert.deepEqual([h.bets[0], h.bets[3]], [10, 20]);
  assert.deepEqual([s.stacks[0], s.stacks[3]], [990, 980]);
  assert.equal(h.toAct, 0, 'o botao fala primeiro no pre-flop');
  s = play(s, { kind: 'call' });
  assert.equal(s.hand.toAct, 3, 'o big blind tem a opcao');
  s = play(s, { kind: 'check' });
  assert.equal(s.hand.street, 'flop');
  assert.equal(s.hand.board.length, 3);
  assert.equal(s.hand.toAct, 3, 'depois do flop, o botao fala por ultimo');
  s = play(s, { kind: 'check' });
  assert.equal(s.hand.toAct, 0);
  // Proxima mao: o botao gira.
  s = play(s, { kind: 'fold' });
  assert.ok(s.hand.result);
  s = act(s, { kind: 'deal' }, 'ana');
  assert.equal(s.button, 3);
  assert.equal(s.hand.sbSeat, 3);
  assert.equal(s.hand.bbSeat, 0);
  assert.equal(s.hand.toAct, 3);
});

test('com 3+: small blind a esquerda do botao, big blind depois, fala quem esta depois do big blind; o botao gira', () => {
  let s = table({ 0: 'ana', 2: 'bia', 5: 'caio', 7: 'duda' });
  s = act(s, { kind: 'deal' }, 'ana');
  assert.deepEqual([s.button, s.hand.sbSeat, s.hand.bbSeat, s.hand.toAct], [0, 2, 5, 7]);
  s = play(s, { kind: 'call' }); // duda
  s = play(s, { kind: 'call' }); // ana (botao)
  s = play(s, { kind: 'call' }); // bia (sb)
  assert.equal(s.hand.toAct, 5, 'o big blind ainda fala');
  s = play(s, { kind: 'check' });
  assert.equal(s.hand.street, 'flop');
  assert.equal(s.hand.toAct, 2, 'depois do flop fala o primeiro a esquerda do botao');
  // Todos desistem ate sobrar um; proxima mao gira.
  s = play(s, { kind: 'check' });
  s = play(s, { kind: 'bet', to: 40 });
  s = play(s, { kind: 'fold' });
  s = play(s, { kind: 'fold' });
  s = play(s, { kind: 'fold' });
  assert.equal(s.hand.result.byFold, true);
  s = act(s, { kind: 'deal' }, 'bia');
  assert.deepEqual([s.button, s.hand.sbSeat, s.hand.bbSeat, s.hand.toAct], [2, 5, 7, 0]);
});

test('o botao pula cadeira vazia e quem esta sem fichas', () => {
  let s = table({ 1: 'ana', 4: 'bia', 6: 'caio' }, { 4: 0 });
  s = act(s, { kind: 'deal' }, 'ana');
  assert.equal(s.hand.status[4], null, 'sem fichas fica fora');
  assert.deepEqual([s.button, s.hand.sbSeat, s.hand.bbSeat], [1, 1, 6], 'viram mano a mano');
});

test('blind curto entra all-in e a aposta a pagar continua o big blind', () => {
  let s = table({ 0: 'ana', 1: 'bia', 2: 'caio' }, { 2: 15 });
  s = act(s, { kind: 'deal' }, 'ana');
  assert.equal(s.hand.bbSeat, 2);
  assert.equal(s.hand.status[2], 'allin');
  assert.equal(s.hand.bets[2], 15);
  assert.equal(s.hand.currentBet, 20);
});

test('lider troca os blinds entre as maos', () => {
  let s = table({ 0: 'ana', 1: 'bia' });
  denied(s, { kind: 'blinds', level: 3 }, 'ana');
  denied(s, { kind: 'blinds', level: 4 }, 'ana', { leader: true });
  s = act(s, { kind: 'blinds', level: 3 }, 'ana', { leader: true });
  s = act(s, { kind: 'deal' }, 'ana');
  assert.deepEqual([s.hand.sb, s.hand.bb], [50, 100]);
  denied(s, { kind: 'blinds', level: 0 }, 'ana', { leader: true });
  assert.deepEqual(P.view(s, 'ana').blinds, { sb: 50, bb: 100 });
});

// ---------- Apostas ----------

test('aposta minima = big blind; aumento minimo = o maior aumento da rodada', () => {
  let s = table({ 0: 'ana', 1: 'bia', 2: 'caio' });
  s = act(s, { kind: 'deal' }, 'ana'); // botao 0, sb 1, bb 2, fala 0
  assert.match(denied(s, { kind: 'raise', to: 39 }, 'ana'), /mínimo é 40/);
  denied(s, { kind: 'bet', to: 40 }, 'ana');
  denied(s, { kind: 'check' }, 'ana');
  assert.deepEqual(P.view(s, 'ana').me.minRaise, 40);
  s = play(s, { kind: 'raise', to: 60 }); // aumento de 40
  assert.equal(P.view(s, 'bia').me.minRaise, 100);
  denied(s, { kind: 'raise', to: 99 }, 'bia');
  s = play(s, { kind: 'raise', to: 100 });
  denied(s, { kind: 'raise', to: 139 }, 'caio');
  s = play(s, { kind: 'call' });
  s = play(s, { kind: 'call' });
  assert.equal(s.hand.street, 'flop');
  // Depois do flop: aposta minima = big blind.
  const who = turn(s);
  assert.match(denied(s, { kind: 'bet', to: 19 }, who), /mínimo é 20/);
  denied(s, { kind: 'raise', to: 40 }, who);
  denied(s, { kind: 'call' }, who);
  denied(s, { kind: 'bet', to: 1.5 }, who);
  denied(s, { kind: 'bet', to: 5000 }, who);
  s = play(s, { kind: 'bet', to: 20 });
  assert.equal(P.view(s, turn(s)).me.minRaise, 40);
  // Fora da vez.
  denied(s, { kind: 'fold' }, who);
  denied(s, { kind: 'fold' }, 'duda');
});

test('all-in menor que um aumento completo nao reabre a acao para quem ja agiu', () => {
  // ana (botao) 1000, bia 1000, caio 150.
  let s = table({ 0: 'ana', 1: 'bia', 2: 'caio' }, { 2: 150 });
  s = act(s, { kind: 'deal' }, 'ana');
  s = play(s, { kind: 'call' }); // ana
  s = play(s, { kind: 'call' }); // bia
  s = play(s, { kind: 'check' }); // caio
  assert.equal(s.hand.street, 'flop');
  assert.equal(turn(s), 'bia');
  s = play(s, { kind: 'bet', to: 100 }); // bia
  s = play(s, { kind: 'allin' }); // caio: 130, aumento de 30 < 100
  assert.equal(s.hand.currentBet, 130);
  assert.equal(s.hand.status[2], 'allin');
  // ana ainda nao agiu nesta rodada: pode aumentar, minimo 130 + 100.
  assert.equal(turn(s), 'ana');
  let v = P.view(s, 'ana').me;
  assert.ok(v.actions.includes('raise'));
  assert.equal(v.minRaise, 230);
  s = play(s, { kind: 'call' }); // ana paga 130
  // bia ja agiu (apostou 100): so paga ou desiste.
  assert.equal(turn(s), 'bia');
  v = P.view(s, 'bia').me;
  assert.deepEqual(v.actions.filter((a) => ['fold', 'check', 'call', 'bet', 'raise', 'allin'].includes(a)).sort(), ['call', 'fold']);
  assert.equal(v.toCall, 30);
  assert.match(denied(s, { kind: 'raise', to: 300 }, 'bia'), /aumentar/);
  assert.match(denied(s, { kind: 'allin' }, 'bia'), /aumentar/);
  s = play(s, { kind: 'call' });
  assert.equal(s.hand.street, 'turn');
});

test('all-in completo reabre; varios all-ins: potes paralelos (3 all-ins de tamanhos diferentes)', () => {
  // Botao 0 (ana 1000), sb 1 (bia 100), bb 2 (caio 300), 3 (duda 600).
  let s = table({ 0: 'ana', 1: 'bia', 2: 'caio', 3: 'duda' }, { 1: 100, 2: 300, 3: 600 });
  // bia (a menor) ganha o pote principal, caio o 1o paralelo, duda o 2o, ana perde tudo.
  s = dealWith(s, 'ana', {
    1: 'As Ad', // quadra de ases
    2: 'Ks Kd', // full de reis
    3: 'Qs Qd', // trinca de damas -> full? mesa abaixo
    0: '7c 2d',
  }, 'Ah Kh Qh 3c 9d');
  // Mesa: Ah Kh Qh 3c 9d. bia: trinca de ases (AAA); caio: trinca de reis; duda: trinca de damas; ana: nada.
  assert.equal(turn(s), 'duda');
  s = play(s, { kind: 'allin' }); // duda 600
  assert.equal(s.hand.currentBet, 600);
  s = play(s, { kind: 'call' }); // ana paga 600
  s = play(s, { kind: 'allin' }); // bia 100 (so completa)
  s = play(s, { kind: 'allin' }); // caio 300
  const h = s.hand;
  assert.ok(h.result, 'todos all-in (ou pagaram): corre a mesa ate o showdown');
  assert.deepEqual(h.board, ['Ah', 'Kh', 'Qh', '3c', '9d']);
  const pots = h.result.pots;
  // principal 100x4 = 400 (bia), paralelo 1: 200x3 = 600 (caio), paralelo 2: 300x2 = 600 (duda).
  assert.deepEqual(pots.map((p) => [p.amount, p.winners]), [[400, [1]], [600, [2]], [600, [3]]]);
  assert.equal(pots[0].name, 'Trinca de ases');
  assert.deepEqual(s.stacks.slice(0, 4), [400, 400, 600, 600]);
  assert.equal(s.stacks.reduce((a, b) => a + b, 0), 2000);
  assert.deepEqual(h.result.shown.slice().sort(), [0, 1, 2, 3]);
  // Todos veem todas as maos do showdown.
  const vv = P.view(s, null);
  assert.deepEqual(vv.hand.holes[1], ['As', 'Ad']);
  assert.equal(vv.hand.result.hands[1].category, 'Trinca');
});

test('aposta que ninguem pagou volta para quem apostou', () => {
  // ana 1000 aposta 500; bia so tem 100 e paga all-in; o resto volta.
  let s = table({ 0: 'ana', 1: 'bia' }, { 1: 100 });
  s = dealWith(s, 'ana', { 0: '2c 3d', 1: 'As Ad' }, 'Kh 8h 7s 4c 9d');
  s = play(s, { kind: 'raise', to: 500 }); // ana (botao/sb)
  s = play(s, { kind: 'call' }); // bia all-in por 100
  assert.ok(s.hand.result);
  assert.deepEqual([s.stacks[0], s.stacks[1]], [900, 200]);
});

test('empate divide o pote; a ficha impar vai para o primeiro a esquerda do botao', () => {
  // Blinds 5/10. ana botao (0), bia sb (1), caio bb (2).
  let s = table({ 0: 'ana', 1: 'bia', 2: 'caio' });
  s = act(s, { kind: 'blinds', level: 0 }, 'ana', { leader: true });
  s = dealWith(s, 'ana', { 0: '2c 3d', 1: '4c 5d', 2: '2d 3c' }, 'As Ks Qs Js Ts');
  s = play(s, { kind: 'call' }); // ana 10
  s = play(s, { kind: 'fold' }); // bia deixa 5
  s = play(s, { kind: 'check' }); // caio
  for (let k = 0; k < 6; k += 1) s = play(s, { kind: 'check' });
  const r = s.hand.result;
  assert.ok(r);
  assert.equal(r.pots.length, 1);
  assert.equal(r.pots[0].amount, 25);
  assert.deepEqual(r.pots[0].winners.slice().sort(), [0, 2]);
  assert.equal(r.pots[0].name, 'Royal flush');
  // caio (cadeira 2) e o primeiro a esquerda do botao entre os vencedores.
  assert.equal(s.stacks[2], 990 + 13);
  assert.equal(s.stacks[0], 990 + 12);
  assert.equal(s.stacks[1], 995);
});

test('split: sobra ficha a ficha a partir da esquerda do botao, dando a volta', () => {
  assert.deepEqual(P.split(10, [6, 1, 3], 5), [{ seat: 6, amount: 4 }, { seat: 1, amount: 3 }, { seat: 3, amount: 3 }]);
  assert.deepEqual(P.split(11, [2, 7], 7), [{ seat: 2, amount: 6 }, { seat: 7, amount: 5 }]);
});

test('computePots: niveis de all-in, e o que quem desistiu pos acima do ultimo nivel', () => {
  const pots = P.computePots([100, 300, 600, 600, 50, 700, 0, 0], [0, 1, 2, 3]);
  // quem desistiu: 4 (50) e 5 (700).
  assert.deepEqual(pots, [
    { amount: 100 * 5 + 50, seats: [0, 1, 2, 3] },
    { amount: 200 * 4, seats: [1, 2, 3] },
    { amount: 300 * 3 + 100, seats: [2, 3] },
  ]);
});

test('todos desistem: quem sobrou leva sem mostrar', () => {
  let s = table({ 0: 'ana', 1: 'bia', 2: 'caio' });
  s = act(s, { kind: 'deal' }, 'ana');
  s = play(s, { kind: 'fold' }); // ana
  s = play(s, { kind: 'fold' }); // bia
  const r = s.hand.result;
  assert.equal(r.byFold, true);
  assert.deepEqual(r.shown, []);
  assert.deepEqual(r.pots, [{ amount: 30, winners: [2], name: null }]);
  assert.equal(s.stacks[2], 1010);
  assert.equal(s.hand.deck.length, 0, 'o baralho some no fim da mao');
  const v = P.view(s, 'ana');
  assert.equal(v.hand.holes[2], null, 'o vencedor nao mostra');
  assert.ok(v.hand.holes[0], 'a propria mao continua visivel');
});

// ---------- Tempo ----------

test('tempo: 30 s por decisao; estourou, passa se puder, senao desiste', () => {
  let s = table({ 0: 'ana', 1: 'bia', 2: 'caio' });
  s = act(s, { kind: 'deal' }, 'ana', { now: T0 });
  assert.equal(P.timeoutAt(s), T0 + 30000);
  assert.match(denied(s, { kind: 'timeout' }, 'bia', { now: T0 + 29999 }), /tempo/);
  denied(s, { kind: 'timeout' }, 'bia', { now: undefined });
  // Qualquer um pode mandar; ana tinha 20 a pagar: desiste.
  s = act(s, { kind: 'timeout' }, 'caio', { now: T0 + 30000 });
  assert.equal(s.hand.status[0], 'folded');
  assert.equal(s.ev.timeout, true);
  assert.equal(P.timeoutAt(s), T0 + 60000, 'o prazo do proximo conta da hora da acao');
  s = act(s, { kind: 'call' }, 'bia', { now: T0 + 31000 });
  assert.equal(P.timeoutAt(s), T0 + 61000);
  // caio (bb) pode passar: o tempo passa por ele.
  s = act(s, { kind: 'timeout' }, 'ana', { now: T0 + 61000 });
  assert.equal(s.hand.street, 'flop');
  assert.equal(s.hand.status[2], 'in');
  // Mao acabou: nao ha prazo.
  s = act(s, { kind: 'fold' }, turn(s));
  assert.equal(P.timeoutAt(s), null);
  denied(s, { kind: 'timeout' }, 'ana', { now: T0 + 999999 });
});

// ---------- Recompra, saidas, entradas ----------

test('recompra: so com zero fichas e fora da mao; volta a 1 000', () => {
  let s = table({ 0: 'ana', 1: 'bia' }, { 1: 20 });
  denied(s, { kind: 'rebuy' }, 'ana');
  s = dealWith(s, 'ana', { 0: 'As Ad', 1: '2c 7d' }, 'Kh 8h 3s 4c 9d');
  // bia e o bb com 20: all-in no blind. ana paga e ganha.
  s = play(s, { kind: 'call' });
  assert.ok(s.hand.result);
  assert.equal(s.stacks[1], 0);
  denied(s, { kind: 'deal' }, 'ana');
  denied(s, { kind: 'rebuy' }, 'caio');
  s = act(s, { kind: 'rebuy' }, 'bia');
  assert.equal(s.stacks[1], 1000);
  s = act(s, { kind: 'deal' }, 'bia');
  assert.ok(s.hand && !s.hand.result);
});

test('quem senta no meio da mao entra na proxima', () => {
  let s = table({ 0: 'ana', 1: 'bia' });
  s = act(s, { kind: 'deal' }, 'ana');
  s = act(s, { kind: 'sit', seat: 4 }, 'caio');
  assert.equal(s.hand.status[4], null);
  const v = P.view(s, 'caio');
  assert.equal(v.me.inHand, false);
  assert.deepEqual(v.hand.holes, new Array(8).fill(null));
  s = play(s, { kind: 'fold' });
  s = act(s, { kind: 'deal' }, 'caio');
  assert.equal(s.hand.status[4], 'in');
});

test('quem levanta na vez desiste e a vez passa; as fichas que pos ficam no pote', () => {
  let s = table({ 0: 'ana', 1: 'bia', 2: 'caio' });
  s = act(s, { kind: 'deal' }, 'ana');
  s = play(s, { kind: 'raise', to: 100 }); // ana
  assert.equal(turn(s), 'bia');
  s = act(s, { kind: 'stand' }, 'bia');
  assert.equal(s.seats[1], null);
  assert.equal(s.hand.status[1], 'folded');
  assert.equal(s.hand.holes[1], null);
  assert.equal(turn(s), 'caio');
  assert.equal(s.hand.contrib[1], 10);
  s = play(s, { kind: 'fold' });
  assert.equal(s.stacks[0], 1000 + 10 + 20);
});

test('quem sai da sala no meio da mao (dropPeer) desiste e libera a cadeira', () => {
  let s = table({ 0: 'ana', 1: 'bia', 2: 'caio' });
  s = act(s, { kind: 'deal' }, 'ana', { now: T0 });
  // caio sai fora da vez: a vez (ana) e o prazo ficam.
  let t = deepFreeze(P.dropPeer(s, 'caio'));
  assert.equal(t.seats[2], null);
  assert.equal(t.hand.status[2], 'folded');
  assert.equal(t.hand.toAct, 0);
  assert.equal(t.hand.deadline, T0 + 30000);
  // ana sai na vez: vez de bia, prazo novo.
  t = deepFreeze(P.dropPeer(t, 'ana', T0 + 5000));
  assert.equal(t.hand.result && t.hand.result.byFold, true, 'sobrou so bia');
  assert.equal(t.stacks[1], 1000 + 20);
  assert.equal(P.dropPeer(t, 'ninguem'), t);
  // Mano a mano: o outro leva.
  let u = table({ 0: 'ana', 1: 'bia' });
  u = act(u, { kind: 'deal' }, 'ana');
  u = deepFreeze(P.dropPeer(u, 'bia'));
  assert.equal(u.stacks[0], 1020);
});

test('quem sai deixa a rodada acabar se so ele faltava responder', () => {
  // ana all-in; bia e caio: bia paga; caio sai antes de falar -> bia sozinha com ana all-in: corre a mesa.
  let s = table({ 0: 'ana', 1: 'bia', 2: 'caio' }, { 0: 200 });
  s = act(s, { kind: 'deal' }, 'ana');
  s = play(s, { kind: 'allin' }); // ana 200
  s = play(s, { kind: 'call' }); // bia 200
  assert.equal(turn(s), 'caio');
  s = deepFreeze(P.dropPeer(s, 'caio', T0 + 1000));
  assert.ok(s.hand.result, 'ninguem mais aposta: showdown');
  assert.equal(s.hand.board.length, 5);
  assert.equal(s.stacks[0] + s.stacks[1], 200 + 1000 + 20, "o blind de caio fica no pote");
});

// ---------- Migracao ----------

test('migrate cancela a mao e devolve as apostas; fichas e cadeiras ficam; sem segredo', () => {
  let s = table({ 0: 'ana', 1: 'bia', 2: 'caio' });
  s = act(s, { kind: 'deal' }, 'ana');
  s = play(s, { kind: 'raise', to: 100 });
  s = play(s, { kind: 'call' });
  const m = P.migrate(s);
  assert.equal(m.hand, null);
  assert.deepEqual(m.stacks.slice(0, 3), [1000, 1000, 1000]);
  assert.deepEqual(m.seats, s.seats);
  assert.equal(m.button, s.button);
  const json = JSON.stringify(m);
  for (const c of B.newDeck()) assert.ok(!json.includes(`"${c}"`), c);
  // Mao ja acabada: o resultado fica (as fichas ja foram pagas).
  s = play(s, { kind: 'fold' });
  s = play(s, { kind: 'fold' });
  const m2 = P.migrate(s);
  assert.deepEqual(m2.stacks, s.stacks);
});

// ---------- Determinismo e estado ----------

function playout(seed) {
  let s = table({ 0: 'ana', 2: 'bia', 4: 'caio', 6: 'duda' });
  for (let n = 0; n < 5; n += 1) {
    s = act(s, { kind: 'deal' }, 'ana', { random: lcg(seed + n) });
    let guard = 0;
    while (!s.hand.result && guard < 50) {
      const me = P.view(s, turn(s)).me;
      const a = me.canCheck ? { kind: 'check' } : { kind: 'call' };
      s = play(s, a);
      guard += 1;
    }
  }
  return s;
}

test('determinismo: a mesma sorte da o mesmo jogo; outra sorte, outro jogo', () => {
  assert.deepEqual(playout(42), playout(42));
  assert.notDeepEqual(playout(42).stacks, playout(43).stacks);
  // Fichas nunca somem nem aparecem.
  assert.equal(playout(7).stacks.reduce((a, b) => a + b, 0), 4000);
});

test('estado congelado: reduce nao muta o anterior (Object.freeze profundo) e cabe no teto', () => {
  let s = table({ 0: 'ana', 1: 'bia', 2: 'caio', 3: 'duda', 4: 'edu', 5: 'fe', 6: 'gil', 7: 'hugo' });
  const before = JSON.stringify(s);
  s = act(s, { kind: 'deal' }, 'ana');
  assert.ok(Object.isFrozen(s.hand.deck));
  assert.ok(JSON.stringify(s).length <= P.maxStateBytes, `${JSON.stringify(s).length} bytes`);
  for (let k = 0; k < 7; k += 1) s = play(s, { kind: 'call' });
  s = play(s, { kind: 'check' });
  assert.ok(JSON.stringify(s).length <= P.maxStateBytes);
  assert.equal(JSON.stringify(table({ 0: 'ana', 1: 'bia', 2: 'caio', 3: 'duda', 4: 'edu', 5: 'fe', 6: 'gil', 7: 'hugo' })), before);
  // Estado ou acao estranhos nao lancam.
  assert.equal(P.reduce(s, { kind: 'raise', to: 'x' }, { from: turn(s) }), s);
  assert.equal(typeof P.validate(null, { kind: 'deal' }, { from: 'ana' }), 'string');
  assert.equal(P.view(null, 'ana'), null);
  assert.equal(P.summary(null), 'Pôquer');
});

// ---------- View: informacao escondida ----------

/** Cartas que `peerId` pode ver agora: as dele, a mesa e as do showdown. */
function allowedCards(s, peerId) {
  const ok = new Set();
  const h = s.hand;
  if (!h) return ok;
  for (const c of h.board) ok.add(c);
  const seat = s.seats.indexOf(peerId);
  if (seat >= 0 && h.ids[seat] === peerId && h.holes[seat]) for (const c of h.holes[seat]) ok.add(c);
  if (h.result) for (const i of h.result.shown) for (const c of h.holes[i]) ok.add(c);
  return ok;
}

function assertNoLeak(s, viewers) {
  for (const who of viewers) {
    const v = P.view(s, who);
    const json = JSON.stringify(v);
    assert.ok(!/"deck"/.test(json), 'o baralho nunca vai na view');
    const ok = allowedCards(s, who);
    for (const c of B.newDeck()) {
      if (!ok.has(c)) assert.ok(!json.includes(`"${c}"`), `${who} viu ${c} (mao ${s.hand && s.hand.no}, ${s.hand && s.hand.street})`);
    }
  }
}

test('view nunca vaza carta alheia nem o baralho (varrendo o JSON a cada passo)', () => {
  const viewers = ['ana', 'bia', 'caio', 'duda', 'edu', null];
  let s = table({ 0: 'ana', 2: 'bia', 5: 'caio', 7: 'duda' });
  let rnd = 100;
  for (let n = 0; n < 6; n += 1) {
    s = act(s, { kind: 'deal' }, 'ana', { random: lcg(rnd += 1) });
    assertNoLeak(s, viewers);
    let guard = 0;
    while (!s.hand.result && guard < 60) {
      const me = P.view(s, turn(s)).me;
      // Mistura: alguns desistem, alguns aumentam, o resto paga/passa.
      const k = (guard + n) % 7;
      let a;
      if (k === 0 && me.actions.includes('fold') && !me.canCheck) a = { kind: 'fold' };
      else if (k === 3 && me.actions.includes('raise')) a = { kind: 'raise', to: me.minRaise };
      else if (k === 4 && me.actions.includes('bet')) a = { kind: 'bet', to: me.minRaise };
      else a = me.canCheck ? { kind: 'check' } : { kind: 'call' };
      s = play(s, a);
      assertNoLeak(s, viewers);
      guard += 1;
    }
    assert.ok(s.hand.result);
  }
  // Quem desistiu nao mostra, nem no showdown.
  let t = table({ 0: 'ana', 1: 'bia', 2: 'caio' });
  t = act(t, { kind: 'deal' }, 'ana');
  t = play(t, { kind: 'fold' });
  t = play(t, { kind: 'call' });
  t = play(t, { kind: 'check' });
  while (!t.hand.result) t = play(t, { kind: 'check' });
  assert.deepEqual(t.hand.result.shown.slice().sort(), [1, 2]);
  assert.equal(P.view(t, 'bia').hand.holes[0], null);
  assertNoLeak(t, ['ana', 'bia', 'caio', null]);
});

test('view: formato e o `me` ja calculado', () => {
  let s = table({ 0: 'ana', 1: 'bia', 2: 'caio' });
  let v = P.view(s, 'duda');
  assert.equal(v.hand, null);
  assert.equal(v.me.seat, -1);
  assert.ok(v.me.actions.includes('sit'));
  assert.ok(P.view(s, 'ana').me.actions.includes('deal'));
  assert.ok(P.view(s, 'ana').me.actions.includes('stand'));
  s = act(s, { kind: 'deal' }, 'ana');
  v = P.view(s, 'ana');
  assert.deepEqual(Object.keys(v).sort(), ['blinds', 'button', 'ev', 'hand', 'handNo', 'level', 'levels', 'me', 'names', 'seats', 'stacks']);
  assert.equal(v.me.seat, 0);
  assert.equal(v.me.myTurn, true);
  assert.equal(v.me.inHand, true);
  assert.equal(v.me.toCall, 20);
  assert.equal(v.me.canCheck, false);
  assert.equal(v.me.minRaise, 40);
  assert.equal(v.me.maxRaise, 1000);
  assert.deepEqual(v.me.actions.slice().sort(), ['allin', 'call', 'fold', 'raise', 'stand']);
  assert.equal(v.hand.holes[0].length, 2);
  assert.equal(v.hand.holes[1], null);
  assert.deepEqual(v.hand.cards, [2, 2, 2, 0, 0, 0, 0, 0]);
  assert.equal(v.hand.pot, 30);
  const vb = P.view(s, 'bia').me;
  assert.equal(vb.myTurn, false);
  assert.deepEqual(vb.actions, ['stand']);
  assert.equal(vb.toCall, 0);
  // Quem so assiste nao tem acao de jogo.
  const vn = P.view(s, null);
  assert.deepEqual(vn.me.actions, []);
  assert.ok(vn.hand.holes.every((c) => c === null));
  // Pote em andamento: so o recolhido das rodadas anteriores.
  s = play(s, { kind: 'call' });
  s = play(s, { kind: 'call' });
  s = play(s, { kind: 'check' });
  const vf = P.view(s, 'caio');
  assert.deepEqual(vf.hand.pots, [{ amount: 60, seats: [0, 1, 2] }]);
  assert.equal(vf.hand.board.length, 3);
});

test('ev: o ultimo acontecimento, para o anuncio', () => {
  let s = table({ 0: 'ana', 1: 'bia', 2: 'caio' });
  s = act(s, { kind: 'deal' }, 'ana');
  s = play(s, { kind: 'raise', to: 80 });
  assert.deepEqual({ ...s.ev, n: 0 }, { n: 0, seat: 0, kind: 'raise', name: 'Ana', to: 80 });
  s = play(s, { kind: 'call' });
  assert.equal(s.ev.kind, 'call');
  assert.equal(s.ev.amount, 70);
  s = play(s, { kind: 'fold' });
  assert.equal(s.ev.kind, 'fold');
  assert.equal(s.ev.name, 'Caio');
});

test('summary', () => {
  let s = P.init({});
  assert.equal(P.summary(s), 'Pôquer — cadeiras livres');
  s = table({ 0: 'ana', 1: 'bia' });
  assert.equal(P.summary(s), 'Pôquer 10/20 — 2 na mesa');
  s = act(s, { kind: 'deal' }, 'ana');
  assert.equal(P.summary(s), 'Pôquer 10/20 — 2 na mesa, mão 1, vez de Ana');
});
