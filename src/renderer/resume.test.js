'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planResume, kindsToReoffer } = require('./resume');

test('retomada sem mudancas adota todos os peers existentes', () => {
  assert.deepEqual(
    planResume({ resumed: true, welcomePeerIds: ['2', '3'], meshPeerIds: ['2', '3'] }),
    { adopt: true, offerTo: [], dropPeers: [] },
  );
});

test('retomada oferece so para o peer novo', () => {
  assert.deepEqual(
    planResume({ resumed: true, welcomePeerIds: ['2', '3'], meshPeerIds: ['2'] }),
    { adopt: true, offerTo: ['3'], dropPeers: [] },
  );
});

test('retomada derruba so o peer que saiu', () => {
  assert.deepEqual(
    planResume({ resumed: true, welcomePeerIds: ['2'], meshPeerIds: ['2', '3'] }),
    { adopt: true, offerTo: [], dropPeers: ['3'] },
  );
});

test('welcome sem retomada descarta a sessao orfa', () => {
  assert.deepEqual(
    planResume({ resumed: false, welcomePeerIds: ['2'], meshPeerIds: ['2'] }),
    { adopt: false, offerTo: [], dropPeers: [] },
  );
});

test('reoferta somente saidas ausentes, instaveis ou encerradas', () => {
  assert.deepEqual(
    kindsToReoffer({
      outConnStates: {
        screen: { exists: true, signalingState: 'stable', connectionState: 'connected' },
        camera: { exists: true, signalingState: 'have-local-offer', connectionState: 'connecting' },
        'screen@7': { exists: true, signalingState: 'stable', connectionState: 'failed' },
        'camera@7': { exists: true, signalingState: 'stable', connectionState: 'closed' },
        'screen@8': { exists: false },
      },
    }),
    ['camera', 'screen@7', 'camera@7', 'screen@8'],
  );
});

test('nao reoferta saidas saudaveis', () => {
  assert.deepEqual(
    kindsToReoffer({
      outConnStates: {
        screen: { exists: true, signalingState: 'stable', connectionState: 'connected' },
        camera: { exists: true, signalingState: 'stable', connectionState: 'disconnected' },
      },
    }),
    [],
  );
});
