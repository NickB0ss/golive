'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { linkParaNavegador } = require('./linksexternos');

const DO_YT = { url: 'https://www.youtube-nocookie.com/', policy: 'strict-origin-when-cross-origin' };
const DA_TWITCH = { url: 'https://player.twitch.tv/', policy: 'strict-origin-when-cross-origin' };
const DO_APP = { url: 'http://localhost/index.html', policy: 'strict-origin-when-cross-origin' };

function pedido(url, referrer = DO_YT) {
  return { url, frameName: '', features: '', disposition: 'foreground-tab', referrer };
}

test('logo/titulo do YouTube e da Twitch abrem no navegador', () => {
  assert.equal(linkParaNavegador(pedido('https://www.youtube.com/watch?v=M7lc1UVf-VE')), 'https://www.youtube.com/watch?v=M7lc1UVf-VE');
  assert.equal(linkParaNavegador(pedido('https://youtu.be/M7lc1UVf-VE?t=3')), 'https://youtu.be/M7lc1UVf-VE?t=3');
  assert.equal(linkParaNavegador(pedido('https://www.twitch.tv/gaules', DA_TWITCH)), 'https://www.twitch.tv/gaules');
  // O referrer pode vir com caminho (politica mais frouxa): conta a origem.
  assert.ok(linkParaNavegador(pedido('https://www.youtube.com/', { url: 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?x=1' })));
});

test('destino fora da lista, esquema ou porta estranhos: recusa', () => {
  for (const url of [
    'http://www.youtube.com/watch?v=x', 'https://youtube.com/watch', 'https://m.youtube.com/', 'https://www.youtube.com.evil.com/',
    'https://evil.com/?https://www.youtube.com/', 'https://user:pw@www.youtube.com/', 'https://www.youtube.com:8443/',
    'https://accounts.google.com/', 'file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', 'https://www.twitch.tv.evil/',
    'nao e url', `https://www.youtube.com/${'a'.repeat(3000)}`,
  ]) {
    assert.equal(linkParaNavegador(pedido(url)), null, url);
  }
});

test('so vale vindo de dentro dos players: da pagina do app ou sem referrer, recusa', () => {
  assert.equal(linkParaNavegador(pedido('https://www.youtube.com/', DO_APP)), null);
  assert.equal(linkParaNavegador(pedido('https://www.youtube.com/', { url: '', policy: 'no-referrer' })), null);
  assert.equal(linkParaNavegador(pedido('https://www.youtube.com/', { url: 'https://www.youtube.com/' })), null);
  assert.equal(linkParaNavegador(pedido('https://www.youtube.com/', { url: 'lixo' })), null);
  assert.equal(linkParaNavegador({ url: 'https://www.youtube.com/' }), null);
  assert.equal(linkParaNavegador(null), null);
});
