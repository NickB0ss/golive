'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./comum');
require('./tabuleiro');
const J = require('./batalha');
const batalha = require('../mesa-modules/batalha');

const PEERS = [{ id: '1', name: 'Ana' }, { id: '2', name: 'Bia' }];

function passo(s, action, from) {
  const c = { from, isLeader: false, peers: PEERS, now: 1000, random: () => 0.37 };
  assert.equal(batalha.validate(s, action, c), true, JSON.stringify(action));
  return batalha.reduce(s, batalha.prepare(s, action, c), c);
}

test('nomeCasa: coluna A..J, linha 1..10', () => {
  assert.equal(J.nomeCasa(0), 'A1');
  assert.equal(J.nomeCasa(9), 'J1');
  assert.equal(J.nomeCasa(92), 'C10');
});

test('marcas: navio, afundado, acerto e agua; afundado vence o acerto', () => {
  const m = J.marcas({
    ships: [{ size: 2, cells: [0, 1], sunk: true }, { size: 3, cells: [20, 21, 22], sunk: false }],
    shots: [[0, 1], [1, 1], [20, 1], [55, 0]],
  });
  assert.equal(m.get(0), 'afundado');
  assert.equal(m.get(1), 'afundado');
  assert.equal(m.get(20), 'acerto');
  assert.equal(m.get(21), 'navio');
  assert.equal(m.get(55), 'agua');
  assert.equal(m.get(99), undefined);
  assert.equal(J.rotuloCasa(55, 'agua'), 'F6: água');
  assert.equal(J.rotuloCasa(99, ''), 'J10: sem tiro');
});

test('textoUltimo diz quem acertou, a agua e o navio afundado', () => {
  const nome = (i) => ['Ana', 'Bia'][i];
  assert.equal(J.textoUltimo({ seat: 0, cell: 22, hit: true, sunk: null }, nome), 'Ana acertou C3');
  assert.equal(J.textoUltimo({ seat: 1, cell: 22, hit: false, sunk: null }, nome), 'Água em C3');
  assert.equal(J.textoUltimo({ seat: 1, cell: 22, hit: true, sunk: 2 }, nome), 'Bia afundou o Cruzador');
  assert.equal(J.textoUltimo(null, nome), '');
});

test('a janela liga os botoes pela view do servidor, nunca pelo validate', () => {
  let s = batalha.init({});
  s = passo(s, { kind: 'sit', seat: 0 }, '1');
  const vAna = batalha.view(s, '1', { peers: PEERS });
  assert.equal(J.podeDaView(vAna, { kind: 'shuffle' }), true);
  assert.equal(J.podeDaView(vAna, { kind: 'ready' }), true);
  assert.equal(J.podeDaView(vAna, { kind: 'fire', cell: 0 }), 'Não é a sua vez');
  assert.equal(J.podeDaView(vAna, { kind: 'sit', seat: 1 }), 'Cadeira ocupada');
  const vBia = batalha.view(s, '2', { peers: PEERS });
  assert.equal(J.podeDaView(vBia, { kind: 'sit', seat: 1 }), true);
  assert.equal(J.podeDaView(null, { kind: 'reset' }), 'Só quem está sentado ou o líder recomeça');
  assert.equal(J.textoPosicionando(vAna, () => 'Bia'), 'Sorteie a frota até gostar e diga Pronto');
  s = passo(s, { kind: 'ready' }, '1');
  assert.equal(J.textoPosicionando(batalha.view(s, '1', { peers: PEERS }), () => 'Bia'), 'Pronto. Esperando alguém sentar na outra cadeira');
  s = passo(s, { kind: 'sit', seat: 1 }, '2');
  assert.equal(J.textoPosicionando(batalha.view(s, '1', { peers: PEERS }), () => 'Bia'), 'Pronto. Esperando Bia');
  assert.equal(J.textoPosicionando(batalha.view(s, '9', { peers: PEERS }), () => 'Bia'), 'Posicionando as frotas');
});
