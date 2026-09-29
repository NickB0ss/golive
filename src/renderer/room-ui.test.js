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

test('PIN da sala: só 6 dígitos valem, e o campo descarta o que não é dígito', () => {
  assert.equal(roomUi.pinDaSalaValido('123456'), true);
  assert.equal(roomUi.pinDaSalaValido('000000'), true);
  assert.equal(roomUi.pinDaSalaValido('12345'), false);
  assert.equal(roomUi.pinDaSalaValido('1234567'), false);
  assert.equal(roomUi.pinDaSalaValido('dddddd'), false);
  assert.equal(roomUi.pinDaSalaValido(''), false);
  assert.equal(roomUi.soDigitosDoPin('12ab3'), '123');
  assert.equal(roomUi.soDigitosDoPin(' 98-76 54 32'), '987654');
  assert.equal(roomUi.soDigitosDoPin(null), '');
});

test('vistas exclusivas: sala Mesa so permite a Mesa, sala so transmissoes so permite o palco', () => {
  assert.equal(roomUi.vistaPermitida('mesa', true), true);
  assert.equal(roomUi.vistaPermitida('tx', true), false);
  assert.equal(roomUi.vistaPermitida('transmissao', true), false);
  assert.equal(roomUi.vistaPermitida('mesa', false), false);
  assert.equal(roomUi.vistaPermitida('tx', false), true);
  assert.equal(roomUi.vistaPermitida('transmissao', false), true);
});

test('fonte do barramento: cam-<id> e camera, o resto e a tela de quem tem aquele id', () => {
  assert.deepEqual(roomUi.fonteDoTile('cam-7'), { kind: 'camera', peerId: '7' });
  assert.deepEqual(roomUi.fonteDoTile('12'), { kind: 'screen', peerId: '12' });
  assert.deepEqual(roomUi.fonteDoTile(null), { kind: 'screen', peerId: '' });
});

test('clique numa fonte: centraliza a janela na Mesa, escolhe o que assistir no palco', () => {
  assert.equal(roomUi.cliqueDaFonte(true), 'centralizar');
  assert.equal(roomUi.cliqueDaFonte(true, { ctrl: true }), 'centralizar');
  assert.equal(roomUi.cliqueDaFonte(false), 'assistir');
  assert.equal(roomUi.cliqueDaFonte(false, { ctrl: true }), 'somar');
});

test('Ver junto, o x de largar e o Modo teatro so existem no palco', () => {
  assert.equal(roomUi.controlesDoPalco(true), false);
  assert.equal(roomUi.controlesDoPalco(false), true);
});
