'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const roomUi = require('./room-ui.js');

test('ordena fontes do barramento por tela antes de câmera e início', () => {
  const ordered = roomUi.ordenarFontes([
    { id: 'cam-bia', kind: 'camera', startedAt: 1 },
    { id: 'ana', kind: 'screen', startedAt: 20 },
    { id: 'bia', kind: 'screen', startedAt: 10 },
  ]);

  assert.deepEqual(ordered.map((source) => source.id), ['bia', 'ana', 'cam-bia']);
});

test('escolhe conversa fixada a partir de 1180px salvo preferência explícita', () => {
  assert.equal(roomUi.modoConversa(1180), 'pinned');
  assert.equal(roomUi.modoConversa(1179), 'peek');
  assert.equal(roomUi.modoConversa(960, 'closed'), 'closed');
});

test('traduz uma pessoa em nó de presença sem estados de conversa', () => {
  assert.equal(roomUi.estadoPessoa({ live: true }), 'live');
  assert.equal(roomUi.estadoPessoa({ mesa: true }), 'watching');
  assert.equal(roomUi.estadoPessoa({}), 'present');
});
