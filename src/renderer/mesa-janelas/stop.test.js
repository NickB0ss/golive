'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const janela = require('./stop');

test('Stop envia estado proprio e alheio para a barra', () => {
  const chamadas = [];
  const api = { setStatus: (v) => chamadas.push(['status', v]), setTurn: (v) => chamadas.push(['turn', v]) };
  janela.atualizarBarra(api, 'Letra A · escrevendo', true);
  janela.atualizarBarra(api, 'Corrigindo respostas', false);
  assert.deepEqual(chamadas, [
    ['status', 'Letra A · escrevendo'], ['turn', true], ['status', 'Corrigindo respostas'], ['turn', false],
  ]);
});

test('registra a janela Stop e calcula o relogio da rodada', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.stop, janela);
  assert.equal(janela.type, 'stop');
  assert.equal(janela.tempo(181000, 1000), '3:00');
  assert.equal(janela.tempo(1000, 1000), '0:00');
});

test('monta linhas de correcao com placar de anulacao', () => {
  const rows = janela.linhas({
    categories: ['Animal'],
    players: ['ana'],
    names: { ana: 'Ana' },
    answers: { ana: ['Anta'] },
    votes: [{ player: 'ana', category: 0, yes: 1, no: 2, mine: true, annulled: false }],
    points: [{ player: 'ana', category: 0, points: 10 }],
  });
  assert.deepEqual(rows, [{ player: 'ana', name: 'Ana', category: 0, answer: 'Anta', yes: 1, no: 2, points: 10 }]);
});
