'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrust } = require('./trust');

const PREFIX = 'file:///x/renderer/index.html';

function fixture() {
  const mainFrame = { processId: 7, routingId: 1, url: `${PREFIX}` };
  const wc = { id: 5, mainFrame, isDestroyed: () => false };
  const trust = createTrust({ getWebContents: () => wc, urlPrefix: PREFIX });
  return { wc, mainFrame, trust };
}

test('aceita so o frame principal do webContents esperado, na URL esperada', () => {
  const { wc, mainFrame, trust } = fixture();
  assert.equal(trust.isTrusted({ sender: wc, senderFrame: mainFrame }), true);
  assert.equal(trust.ownerOf({ sender: wc }), 'wc:5');
});

test('recusa outro webContents, subframe, URL diferente, janela destruida e evento vazio', () => {
  const { wc, mainFrame, trust } = fixture();
  assert.equal(trust.isTrusted({ sender: { id: 9, mainFrame }, senderFrame: mainFrame }), false);
  assert.equal(trust.isTrusted({ sender: wc, senderFrame: { processId: 7, routingId: 2, url: PREFIX } }), false);
  assert.equal(trust.isTrusted({ sender: wc, senderFrame: { processId: 8, routingId: 1, url: PREFIX } }), false);
  assert.equal(trust.isTrusted({ sender: wc, senderFrame: { ...mainFrame, url: 'https://exemplo.com/' } }), false);
  assert.equal(trust.isTrusted({ sender: wc, senderFrame: null }), false);
  assert.equal(trust.isTrusted(null), false);
  const dead = createTrust({ getWebContents: () => ({ ...wc, isDestroyed: () => true }), urlPrefix: PREFIX });
  assert.equal(dead.isTrusted({ sender: wc, senderFrame: mainFrame }), false);
  const none = createTrust({ getWebContents: () => null, urlPrefix: PREFIX });
  assert.equal(none.isTrusted({ sender: wc, senderFrame: mainFrame }), false);
});
