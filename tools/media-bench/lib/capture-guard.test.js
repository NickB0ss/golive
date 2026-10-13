'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeOwnedWindow, allowPermission } = require('./capture-guard');

function setup(over = {}) {
  const calls = { consumed: 0, listed: 0 };
  const state = { armed: true, trusted: true, owned: 'window:1:0' };
  const params = {
    request: { videoRequested: true, audioRequested: false, frame: { id: 'f' } },
    isArmed: () => state.armed,
    isTrustedFrame: () => state.trusted,
    ownedSourceId: () => state.owned,
    listSources: async () => {
      calls.listed += 1;
      return [{ id: 'screen:0:0' }, { id: 'window:2:0' }, { id: 'window:1:0', name: 'propria' }];
    },
    consume: () => { calls.consumed += 1; },
    ...over,
  };
  return { params, calls, state };
}

test('entrega EXATAMENTE a janela propria e gasta a armacao', async () => {
  const { params, calls } = setup();
  const r = await authorizeOwnedWindow(params);
  assert.equal(r.video.id, 'window:1:0');
  assert.equal(calls.consumed, 1);
});

test('nao armado, frame nao confiavel ou audio pedido: recusa sem listar fontes', async () => {
  for (const over of [
    { isArmed: () => false },
    { isTrustedFrame: () => false },
    { request: { videoRequested: true, audioRequested: true, frame: {} } },
    { request: { videoRequested: false, frame: {} } },
    { request: null },
  ]) {
    const { params, calls } = setup(over);
    assert.equal(await authorizeOwnedWindow(params), null);
    assert.equal(calls.listed, 0);
    assert.equal(calls.consumed, 0);
  }
});

test('janela propria ausente da lista: recusa, nunca cai em outra fonte', async () => {
  const { params, state, calls } = setup();
  state.owned = 'window:99:0';
  assert.equal(await authorizeOwnedWindow(params), null);
  assert.equal(calls.consumed, 0);
  state.owned = null;
  assert.equal(await authorizeOwnedWindow(params), null);
});

test('reconfere depois do await: armacao gasta, janela fechada ou frame trocado no intervalo', async () => {
  const a = setup();
  a.params.listSources = async () => { a.state.armed = false; return [{ id: 'window:1:0' }]; };
  assert.equal(await authorizeOwnedWindow(a.params), null);

  const b = setup();
  b.params.listSources = async () => { b.state.owned = null; return [{ id: 'window:1:0' }]; };
  assert.equal(await authorizeOwnedWindow(b.params), null);

  const c = setup();
  c.params.listSources = async () => { c.state.trusted = false; return [{ id: 'window:1:0' }]; };
  assert.equal(await authorizeOwnedWindow(c.params), null);
  assert.equal(a.calls.consumed + b.calls.consumed + c.calls.consumed, 0);
});

test('permissao: so captura de tela, armada, da pagina da bancada', () => {
  // Electron 44: getDisplayMedia chega como 'media' com mediaTypes vazio.
  const ok = { permission: 'media', mediaTypes: [], armed: true, fromBench: true };
  assert.equal(allowPermission(ok), true, 'sem isto o Chromium recusa o getDisplayMedia antes do handler');
  assert.equal(allowPermission({ ...ok, permission: 'display-capture', mediaTypes: undefined }), true);
  assert.equal(allowPermission({ ...ok, armed: false }), false);
  assert.equal(allowPermission({ ...ok, fromBench: false }), false);
  assert.equal(allowPermission({ ...ok, mediaTypes: ['video'] }), false, 'camera');
  assert.equal(allowPermission({ ...ok, mediaTypes: ['audio'] }), false, 'microfone');
  assert.equal(allowPermission({ ...ok, mediaTypes: undefined }), false, 'media sem tipos declarados');
  for (const permission of ['notifications', 'geolocation', 'clipboard-read', undefined]) {
    assert.equal(allowPermission({ ...ok, permission }), false, String(permission));
  }
});
