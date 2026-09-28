'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canNavigateTo } = require('./navigation');

test('canNavigateTo aceita somente a pagina local esperada', () => {
  const local = 'file:///C:/GoLive/src/renderer/index.html';

  assert.equal(canNavigateTo(local, local), true);
  assert.equal(canNavigateTo('https://exemplo.invalido/', local), false);
  assert.equal(canNavigateTo('file:///C:/GoLive/src/renderer/espiar.html', local), false);
  assert.equal(canNavigateTo('not a url', local), false);
});

test('canNavigateTo na origem local (http://localhost, src/main/origem.js)', () => {
  const principal = 'http://localhost/index.html';

  assert.equal(canNavigateTo(principal, principal), true);
  assert.equal(canNavigateTo('http://LOCALHOST/index.html', principal), true);
  // Outra pagina da mesma origem herdaria o preload da janela.
  assert.equal(canNavigateTo('http://localhost/espiar.html', principal), false);
  assert.equal(canNavigateTo('http://localhost/vazia.html', principal), false);
  // Mesmo arquivo em outra origem (porta, IP, https, file://) nao e o app.
  assert.equal(canNavigateTo('http://localhost:8080/index.html', principal), false);
  assert.equal(canNavigateTo('http://127.0.0.1/index.html', principal), false);
  assert.equal(canNavigateTo('https://localhost/index.html', principal), false);
  assert.equal(canNavigateTo('file:///C:/GoLive/src/renderer/index.html', principal), false);
  // Um submit acidental de <form> (?) tambem nao navega.
  assert.equal(canNavigateTo('http://localhost/index.html?', principal), false);
  // O player da Mesa nunca toma a janela.
  assert.equal(canNavigateTo('https://www.youtube-nocookie.com/embed/x', principal), false);
});
