'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../i18n');
const J = require('./truco');

test('Truco envia estado proprio e alheio para a barra', () => {
  const chamadas = [];
  const api = { setStatus: (v) => chamadas.push(['status', v]), setTurn: (v) => chamadas.push(['turn', v]) };
  J.atualizarBarra(api, '1 × 0 · Sua vez', true);
  J.atualizarBarra(api, '1 × 0 · Vez de Bia', false);
  assert.deepEqual(chamadas, [
    ['status', '1 × 0 · Sua vez'], ['turn', true], ['status', '1 × 0 · Vez de Bia'], ['turn', false],
  ]);
});

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

// ---------- Montagem (DOM falso) ----------
require('./comum');
require('./cartas');
const { montar } = require('./dom-falso-leva3');

const vazia = (extra = {}) => ({
  phase: 'waiting', seats: [null, null, null, null], scores: [0, 0], hand: null,
  me: { seat: -1, team: null, can: { sit: true } }, ...extra,
});

test('truco sem ninguem mostra o vazio com as 4 cadeiras em cruz e sem repetir o titulo', () => {
  const t = montar(J, vazia());
  assert.equal(t.achar('.mj-vazio').hidden, false);
  assert.equal(t.todos('.mj-cadeira-livre').length, 4);
  assert.equal(t.todos('.mj-tr-cruz').length, 1);
  assert.notEqual(t.achar('.mj-vazio-titulo').textContent, 'Truco');
  t.todos('.mj-cadeira-livre')[2].click();
  assert.deepEqual(t.acoes, [{ kind: 'sit', seat: 2 }]);
  t.destruir();
});

test('truco com a mao em jogo esconde o vazio e deixa o canto como acao secundaria', () => {
  const view = vazia({
    phase: 'play',
    seats: ['1', '2', '3', '4'],
    hand: { vira: '3s', manilha: '4', value: 1, rounds: [], cards: ['As', 'Kd', '7c'], table: [], turn: 0 },
    me: { seat: 0, team: 0, can: { play: true, call: true } },
  });
  const t = montar(J, view);
  assert.equal(t.achar('.mj-vazio').hidden, true);
  assert.equal(t.todos('.mj-acoes').length, 1);
  assert.equal(t.botao('Pedir truco').classList.contains('mj-fantasma'), true);
  t.destruir();
});

test('truco: so a carta que acabou de cair na mesa gira', () => {
  const base = {
    phase: 'play',
    seats: ['1', '2', '3', '4'],
    hand: { vira: '3s', manilha: '4', value: 1, rounds: [], cards: [], turn: 1, table: [{ seat: 0, card: 'As' }] },
    me: { seat: 0, team: 0, can: {} },
  };
  const t = montar(J, base);
  assert.equal(t.todos('.is-vira').length, 1);
  t.atualizar(base);
  assert.equal(t.todos('.is-vira').length, 0, 'a mesma carta nao gira de novo');
  t.destruir();
});
