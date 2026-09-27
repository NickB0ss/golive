'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const J = require('./truco');

test('textoStatus explica espera, mao de onze e canto pendente', () => {
  assert.equal(J.textoStatus({ phase: 'waiting', me: { seat: -1 } }, () => 'Ana'), 'Escolha um lugar para sentar');
  assert.equal(
    J.textoStatus({ phase: 'eleven', hand: { eleven: 0 }, me: { team: 0 } }, () => 'Ana'),
    'Mão de onze: jogam por 3 ou correm'
  );
  assert.equal(
    J.textoStatus({
      phase: 'play',
      hand: { pending: { amount: 6, toTeam: 1 } },
      me: { team: 1 }
    }, () => 'Ana'),
    'Responder 6: aceitar, correr ou aumentar'
  );
});

test('acoes da view preservam segredo e permitem carta encoberta somente depois', () => {
  const v = { phase: 'play', hand: { rounds: [0], cards: [null, null], pending: null }, me: { can: { play: true } } };
  assert.deepEqual(J.acoesDaView(v, 1), [
    { kind: 'play', index: 1, covered: false },
    { kind: 'play', index: 1, covered: true }
  ]);
  const primeiraRodada = {
    phase: 'play',
    hand: { rounds: [], cards: ['As'], pending: null },
    me: { can: { play: true } }
  };
  assert.equal(J.acoesDaView(primeiraRodada, 0).length, 1);
});

test('rotulos mostram o proximo canto, manilha, rodadas e tempo', () => {
  const view = {
    hand: {
      vira: '3s',
      manilha: '4',
      value: 6,
      rounds: [0, null],
      deadline: 31000,
    },
  };
  assert.equal(J.rotuloCanto(view), 'Pedir 9');
  assert.equal(
    J.resumoMao(view, 1000),
    'Vira 3♠ · manilha 4 · vale 6 · 1ª dupla venceu 1 rodada · 2ª dupla venceu 0 rodadas · 30 s',
  );
});

test('acoes principais incluem levantar e os tres niveis de canto', () => {
  assert.deepEqual(J.acoesPrincipais({ me: { can: { stand: true } } }), [{ kind: 'stand' }]);
  assert.equal(J.rotuloCanto({ hand: { value: 1 } }), 'Pedir truco');
  assert.equal(J.rotuloCanto({ hand: { value: 3 } }), 'Pedir 6');
  assert.equal(J.rotuloCanto({ hand: { value: 9 } }), 'Pedir 12');
});
