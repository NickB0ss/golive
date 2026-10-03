'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const J = require('./poquer');

test('Pôquer envia estado proprio e alheio para a barra', () => {
  const chamadas = [];
  const api = { setStatus: (v) => chamadas.push(['status', v]), setTurn: (v) => chamadas.push(['turn', v]) };
  J.atualizarBarra(api, 'Pote 40 · flop', true);
  J.atualizarBarra(api, 'Vez de Bia', false);
  assert.deepEqual(chamadas, [['status', 'Pote 40 · flop'], ['turn', true], ['status', 'Vez de Bia'], ['turn', false]]);
});

const NB = ' ';

test('fichas: milhar com espaco fino', () => {
  assert.equal(J.fichas(1000), `1${NB}000`);
  assert.equal(J.fichas(80), '80');
  assert.equal(J.fichas('x'), '0');
});

test('posicao: quem ve fica embaixo (0) e a mesa gira no sentido horario', () => {
  assert.equal(J.posicao(3, 3), 0);
  assert.equal(J.posicao(4, 3), 1);
  assert.equal(J.posicao(2, 3), 7);
  assert.equal(J.posicao(5, -1), 5, 'quem so assiste ve a cadeira 0 embaixo');
  const baixo = J.coordenada(0);
  const esquerda = J.coordenada(2);
  const cima = J.coordenada(4);
  assert.ok(baixo.y > 80 && Math.abs(baixo.x - 50) < 0.01);
  assert.ok(esquerda.x < 20);
  assert.ok(cima.y < 20);
  assert.ok(J.coordenada(0, 0.6).y < baixo.y, 'a aposta fica mais perto do meio');
});

test('textoEvento: anuncios curtos em PT', () => {
  assert.equal(J.textoEvento({ kind: 'raise', to: 80 }, 'Bia'), 'Bia aumentou para 80');
  assert.equal(J.textoEvento({ kind: 'call', amount: 1200 }, 'Leo'), `Leo pagou 1${NB}200`);
  assert.equal(J.textoEvento({ kind: 'bet', to: 40 }, 'Ana'), 'Ana apostou 40');
  assert.equal(J.textoEvento({ kind: 'fold', timeout: true }, 'Caio'), 'Tempo esgotado: Caio desistiu');
  assert.equal(J.textoEvento({ kind: 'check' }, 'Caio'), 'Caio passou');
  assert.equal(J.textoEvento({ kind: 'allin', to: 500 }, 'Duda'), 'Duda foi all-in com 500');
  assert.equal(J.textoEvento({ kind: 'deal', hand: 3 }), 'Mão 3: cartas dadas');
  assert.equal(J.textoEvento({ kind: 'blinds' }, null, { sb: 25, bb: 50 }), 'Blinds agora 25/50');
  assert.equal(J.textoEvento(null, 'Bia'), '');
});

test('textoResultado: vencedor, divisao, pote paralelo, todos desistiram, devolucao', () => {
  const nome = (s) => ['Ana', 'Bia', 'Caio', 'Duda'][s];
  assert.deepEqual(J.textoResultado({ byFold: true, pots: [{ amount: 30, winners: [2], name: null }] }, nome), ['Caio levou 30']);
  assert.deepEqual(J.textoResultado({
    byFold: false,
    pots: [
      { amount: 400, winners: [1], name: 'Trinca de ases' },
      { amount: 600, winners: [0, 2], name: 'Flush' },
      { amount: 300, winners: [3], name: null },
    ],
  }, nome), [
    'Bia ganhou 400 com Trinca de ases (pote principal)',
    'Ana e Caio dividiram 600 com Flush (pote paralelo 1)',
    'Voltaram 300 para Duda',
  ]);
  assert.deepEqual(J.textoResultado(null, nome), []);
});

test('atalhos: meio pote, pote e all-in dentro dos limites', () => {
  const view = {
    me: { seat: 0, minRaise: 40, maxRaise: 1000, actions: ['raise'] },
    hand: { bets: [0, 10, 20, 0, 0, 0, 0, 0], currentBet: 20, pot: 30 },
  };
  // Pote: 20 + (30 + 20) = 70; meio: 20 + 25 = 45.
  assert.deepEqual(J.atalhos(view), { meio: 45, pote: 70, tudo: 1000 });
  const curto = { me: { seat: 0, minRaise: 40, maxRaise: 60, actions: ['raise'] }, hand: view.hand };
  assert.deepEqual(J.atalhos(curto), { meio: 45, pote: 60, tudo: 60 });
  assert.equal(J.atalhos({ me: { maxRaise: 0 }, hand: view.hand }), null);
});

test('rotulos dos botoes e segundos', () => {
  assert.equal(J.rotuloPagar({ canCheck: true }), 'Passar');
  assert.equal(J.rotuloPagar({ canCheck: false, toCall: 1500 }), `Pagar 1${NB}500`);
  assert.equal(J.rotuloAumentar({ actions: ['bet'], maxRaise: 1000 }, 40), 'Apostar 40');
  assert.equal(J.rotuloAumentar({ actions: ['raise'], maxRaise: 1000 }, 80), 'Aumentar para 80');
  assert.equal(J.rotuloAumentar({ actions: ['raise'], maxRaise: 1000 }, 1000), `All-in 1${NB}000`);
  assert.equal(J.segundos(10_500, 0), 11);
  assert.equal(J.segundos(0, 5000), 0);
});

test('linhaDeEstado nao repete o nome do jogo (ja esta na barra da janela)', () => {
  const v = { blinds: { sb: 10, bb: 20 }, handNo: 3, hand: { street: 'flop', result: null } };
  assert.equal(J.linhaDeEstado(v), 'Blinds 10/20 · mão 3 · Flop');
  assert.equal(J.linhaDeEstado({ blinds: { sb: 10, bb: 20 }, handNo: 0, hand: null }), 'Blinds 10/20');
  assert.ok(!J.linhaDeEstado(v).includes('Pôquer'));
});

// ---------- Montagem (DOM falso) ----------
require('./comum');
require('./cartas');
const { montar } = require('./dom-falso-leva3');
const pq = require('../mesa-modules/poquer');

test('poquer: cada lugar e uma cadeira comum e o livre convida a sentar', () => {
  const view = pq.view(pq.init({ random: () => 0.3 }), '1', { peers: [{ id: '1', name: 'Ana' }] });
  const t = montar(J, view);
  assert.equal(t.todos('.mj-pq-lugar').length, 8);
  assert.equal(t.todos('.mj-cadeira-livre').length, 8);
  assert.equal(t.achar('.mj-pq-titulo').textContent, 'Blinds 10/20');
  t.todos('.mj-cadeira-livre')[5].click();
  assert.deepEqual(t.acoes, [{ kind: 'sit', seat: 5 }]);
  t.destruir();
});
