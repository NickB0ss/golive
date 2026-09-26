'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./poquer-maos');
const baralho = require('./baralho');

const h = (s) => s.split(' ');
const best = (s) => M.best(h(s));
/** 1 se a ganha, -1 se b ganha, 0 empate. */
const cmp = (a, b) => M.compare(best(a), best(b));

test('categorias na ordem classica', () => {
  const maos = [
    ['Ah Kd 9c 7s 4h 3d 2c', 'Carta alta'],
    ['Ah Ad 9c 7s 4h 3d 2c', 'Par'],
    ['Ah Ad 9c 9s 4h 3d 2c', 'Dois pares'],
    ['Ah Ad Ac 9s 4h 3d 2c', 'Trinca'],
    ['9h 8d 7c 6s 5h Kd 2c', 'Sequência'],
    ['Ah Th 9h 7h 4h 3d 2c', 'Flush'],
    ['Ah Ad Ac 9s 9h 3d 2c', 'Full house'],
    ['Ah Ad Ac As 9h 3d 2c', 'Quadra'],
    ['9h 8h 7h 6h 5h Kd 2c', 'Straight flush'],
  ];
  maos.forEach(([m, cat], i) => {
    const r = best(m);
    assert.equal(r.category, cat, m);
    assert.equal(r.cat, i);
    if (i > 0) assert.equal(cmp(m, maos[i - 1][0]), 1, `${cat} ganha de ${maos[i - 1][1]}`);
  });
});

test('melhor 5 de 7 escolhe as cartas certas', () => {
  const r = best('Ah Kh 2h 3c Qh Jh 9h');
  assert.equal(r.category, 'Flush');
  assert.deepEqual(r.cards, h('Ah Kh Qh Jh 9h'));
  const f = best('Kd Kc 7s 7h 7d Kh 2c');
  assert.equal(f.name, 'Full house de reis com setes');
  assert.deepEqual(f.cards.map((c) => c[0]), ['K', 'K', 'K', '7', '7']);
});

test('sequencia A-2-3-4-5 vale e e a mais baixa', () => {
  const roda = best('Ah 2d 3c 4s 5h Kd Kc');
  assert.equal(roda.category, 'Sequência');
  assert.equal(roda.name, 'Sequência até o 5');
  assert.deepEqual(roda.cards.map((c) => c[0]), ['5', '4', '3', '2', 'A']);
  assert.equal(cmp('2h 3d 4c 5s 6h Kd 9c', 'Ah 2d 3c 4s 5h Kd 9c'), 1);
  // Q-K-A-2-3 nao e sequencia.
  assert.equal(best('Qh Kd Ac 2s 3h 8d 9c').category, 'Carta alta');
  // A-K-Q-J-T e a maior.
  assert.equal(best('Ah Kd Qc Js Th 2d 3c').name, 'Sequência até o ás');
});

test('straight flush, royal e o straight flush A-2-3-4-5', () => {
  assert.equal(best('As Ks Qs Js Ts 2d 3c').name, 'Royal flush');
  const baixo = best('As 2s 3s 4s 5s Kd Kc');
  assert.equal(baixo.name, 'Straight flush');
  assert.equal(cmp('As 2s 3s 4s 5s Kd Kc', 'Ad Ac Ah As Kd Kc 2h'), 1, 'straight flush ganha da quadra');
  assert.equal(cmp('6s 2s 3s 4s 5s Kd Kc', 'As 2s 3s 4s 5s Kd Kc'), 1);
  // Com sequencia maior sem naipe e straight flush menor, vale o straight flush.
  assert.equal(best('5s 6s 7s 8s 9s Td Jc').category, 'Straight flush');
});

test('desempate por kickers', () => {
  // Par igual, kicker decide.
  assert.equal(cmp('Ah Ad Kc 7s 4h 3d 2c', 'As Ac Qc 7d 4c 3h 2d'), 1);
  // Dois pares iguais, o quinto decide.
  assert.equal(cmp('Kh Kd 9c 9s Qh 3d 2c', 'Ks Kc 9d 9h Jh 3c 2d'), 1);
  // Dois pares: o par de cima decide antes do de baixo.
  assert.equal(cmp('Kh Kd 3c 3s 2h 5d 7c', 'Qs Qc Jd Jh 2c 5c 7d'), 1);
  // Trinca com kickers.
  assert.equal(cmp('7h 7d 7c As 2h 3d 9c', '7h 7d 7c Ks Qh 3c 9d'), 1);
  // Carta alta ate o quinto valor.
  assert.equal(cmp('Ah Kd 9c 7s 5h', 'Ad Kc 9d 7h 4c'), 1);
  // Flush: compara as cinco.
  assert.equal(cmp('Ah Qh 9h 5h 3h Kd', 'As Qs 9s 5s 2s Kc'), 1);
  // Quadra: o kicker decide.
  assert.equal(cmp('9h 9d 9c 9s Ah 2d 3c', '9h 9d 9c 9s Kh Qd Jc'), 1);
  // Full: a trinca manda.
  assert.equal(cmp('8h 8d 8c 2s 2h', '7h 7d 7c As Ah'), 1);
  // Sexta e setima cartas nao contam.
  assert.equal(cmp('Ah Ad Kc Qs Jh 3d 2c', 'As Ac Kd Qh Jc 4h 3c'), 0);
});

test('empates exatos (naipes nao desempatam; mesa joga)', () => {
  assert.equal(cmp('Ah Kd Qc Js 9h', 'Ad Kc Qh Jd 9s'), 0);
  // Mesa com sequencia: as duas maos jogam a mesa.
  const mesa = 'Th Jd Qc Ks As';
  assert.equal(cmp(`2c 3d ${mesa}`, `4h 5d ${mesa}`), 0);
  const w = M.winners([best(`2c 3d ${mesa}`), null, best(`4h 5d ${mesa}`)]);
  assert.deepEqual(w, [0, 2]);
  assert.deepEqual(M.winners([best('Ah Ad 2c 3s 7h'), best('Kh Kd 2d 3h 7c')]), [0]);
  assert.deepEqual(M.winners([null, null]), []);
});

test('nomes das maos', () => {
  assert.equal(best('Kh Kd 9c 7s 4h 3d 2c').name, 'Par de reis');
  assert.equal(best('Ah Ad 9c 9s 4h 3d 2c').name, 'Dois pares, ases e noves');
  assert.equal(best('6h 6d 6c 9s 4h Kd 2c').name, 'Trinca de seis');
  assert.equal(best('Th Td Tc Ts 4h 3d 2c').name, 'Quadra de dez');
  assert.equal(best('Ah Kd 9c 7s 4h 3d 2c').name, 'Carta alta, ás');
  assert.equal(best('Ah Th 9h 7h 4h 3d 2c').name, 'Flush');
});

test('entrada ruim devolve null e nao lanca', () => {
  assert.equal(M.best(null), null);
  assert.equal(M.best(h('Ah Kd 9c 7s')), null);
  assert.equal(M.best(h('Ah Kd 9c 7s 4h 3d 2c 5c')), null);
  assert.equal(M.best(h('Ah Ah 9c 7s 4h')), null);
  assert.equal(M.best(['Ah', 'Kd', '9c', '7s', 'Xx']), null);
  assert.equal(M.best(['Ah', 'Kd', '9c', '7s', 12]), null);
});

test('conferencia exaustiva: frequencias das 2 598 960 maos de 5 cartas', () => {
  const deck = baralho.newDeck();
  const freq = new Array(9).fill(0);
  const n = deck.length;
  for (let a = 0; a < n; a += 1) {
    for (let b = a + 1; b < n; b += 1) {
      for (let c = b + 1; c < n; c += 1) {
        for (let d = c + 1; d < n; d += 1) {
          for (let e = d + 1; e < n; e += 1) freq[M.eval5([deck[a], deck[b], deck[c], deck[d], deck[e]]).cat] += 1;
        }
      }
    }
  }
  assert.deepEqual(freq, [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
});

test('ordem total coerente em maos sorteadas (antissimetrica e transitiva)', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const maos = [];
  for (let i = 0; i < 60; i += 1) maos.push(M.best(baralho.shuffle(baralho.newDeck(), rnd).slice(0, 7)));
  for (const a of maos) {
    for (const b of maos) {
      assert.equal(M.compare(a, b), -M.compare(b, a) || 0);
      for (const c of maos.slice(0, 15)) {
        if (M.compare(a, b) >= 0 && M.compare(b, c) >= 0) assert.ok(M.compare(a, c) >= 0);
      }
    }
  }
});
