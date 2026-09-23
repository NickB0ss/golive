'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickDisplayMediaStreams, replyOnce } = require('./displaymedia');

const TELA = { id: 'screen:0:0', name: 'Monitor 1' };
const JANELA = { id: 'window:42:0', name: 'Valorant' };

test('entrega a fonte escolhida, com loopback so no modo system', () => {
  assert.deepEqual(pickDisplayMediaStreams({ sources: [TELA, JANELA], selectedId: 'window:42:0', audioMode: 'system' }), { video: JANELA, audio: 'loopback' });
  assert.deepEqual(pickDisplayMediaStreams({ sources: [TELA, JANELA], selectedId: 'screen:0:0', audioMode: 'none' }), { video: TELA, audio: undefined });
});

test('fonte que sumiu da lista e recusa, nunca a primeira da lista', () => {
  assert.equal(pickDisplayMediaStreams({ sources: [TELA], selectedId: 'window:42:0', audioMode: 'none' }), null);
  assert.equal(pickDisplayMediaStreams({ sources: [], selectedId: 'screen:0:0' }), null);
  assert.equal(pickDisplayMediaStreams({ sources: undefined, selectedId: null }), null);
});

test('o callback e chamado uma vez so, mesmo se a primeira chamada lancar', () => {
  const chamadas = [];
  const logs = [];
  // Como o Electron 44: recusar com {} lanca, e a segunda chamada tambem.
  const callback = (streams) => {
    chamadas.push(streams);
    if (chamadas.length > 1) throw new TypeError('One-time callback was called more than once');
    if (!streams.video) throw new TypeError('Video was requested, but no video stream was provided');
  };
  const reply = replyOnce(callback, (l) => logs.push(l));
  assert.equal(reply(null), true);
  assert.equal(reply({}), false, 'o fallback de erro nao chama de novo');
  assert.deepEqual(chamadas, [{}]);
  assert.deepEqual(logs, [], 'o erro da recusa e esperado, nao vira log');
});

test('erro na ENTREGA da fonte vira log, sem subir', () => {
  const logs = [];
  const reply = replyOnce(() => { throw new Error('frame destruido'); }, (l) => logs.push(l));
  assert.doesNotThrow(() => reply({ video: TELA }));
  assert.deepEqual(logs, ['captura: o Electron recusou a fonte escolhida: frame destruido']);
});
