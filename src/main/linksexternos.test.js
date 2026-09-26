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

// ---------- linkDaMesa: janelas "Spotify Jam" e "Link" ----------

const { linkDaMesa, dominioPublico } = require('./linksexternos');
const jam = require('../renderer/mesa-modules/jam');

test('jam: so os links de Jam do Spotify, na forma canonica', () => {
  assert.equal(linkDaMesa('jam', 'https://spotify.link/AbCdEf12345'), 'https://spotify.link/AbCdEf12345');
  assert.equal(linkDaMesa('jam', 'https://spotify.link/AbCdEf12345?si=1'), 'https://spotify.link/AbCdEf12345');
  assert.equal(linkDaMesa('jam', 'https://open.spotify.com/socialsession/5ae7c0f6e1b24d9a'), 'https://open.spotify.com/socialsession/5ae7c0f6e1b24d9a');
  for (const url of [
    'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
    'http://spotify.link/AbCdEf12345', 'https://user@spotify.link/AbCdEf12345', 'https://spotify.link:8443/AbCdEf12345',
    'https://spotify.link.evil.com/AbCdEf12345', 'https://example.com/', 'spotify:socialsession:x', 'file:///C:/x',
  ]) {
    assert.equal(linkDaMesa('jam', url), null, url);
  }
});

test('jam: o processo principal e o modulo concordam no formato', () => {
  for (const url of [
    'https://spotify.link/AbCdEf12345', 'https://spotify.link/ab', 'https://spotify.link/AbC/def',
    'https://open.spotify.com/socialsession/5ae7c0f6e1b24d9a', 'https://open.spotify.com/intl-pt/socialsession/5ae7c0f6e1b24d9a',
    'https://open.spotify.com/socialsession/abc', 'https://open.spotify.com/album/x', 'https://spotify.link/Ab%2FCdEf12',
    'https://spotify.link./AbCdEf12345', 'HTTPS://SPOTIFY.LINK/AbCdEf12345', 'https://spotify.link/AbCdEf12345#x',
  ]) {
    assert.equal(linkDaMesa('jam', url), jam.parseJamUrl(url), url);
  }
});

test('link: qualquer site https com dominio, sem credencial nem porta', () => {
  assert.equal(linkDaMesa('link', 'https://example.com/a?b=1#c'), 'https://example.com/a?b=1#c');
  assert.equal(linkDaMesa('link', 'https://pt.wikipedia.org/wiki/Brasil'), 'https://pt.wikipedia.org/wiki/Brasil');
  // IDN vira punycode (o que a pessoa confirmou na janela e o mesmo).
  assert.equal(linkDaMesa('link', 'https://xn--pao-xla.com.br/'), 'https://xn--pao-xla.com.br/');
  for (const url of [
    'http://example.com/', 'https://user:pw@example.com/', 'https://user@example.com/', 'https://example.com:8443/',
    'https://127.0.0.1/', 'https://[::1]/', 'https://localhost/', 'https://roteador/', 'https://nas.local/',
    'https://192.168.0.1/', 'https://3232235521/', 'https://0x7f.1/', 'javascript:alert(1)', 'file:///C:/Windows/',
    'data:text/html,oi', 'https://exa mple.com/', 'https://example.com/\n', `https://example.com/${'a'.repeat(2100)}`,
    'https://-evil.com/', 'https://example.com./', '', null, 5,
  ]) {
    assert.equal(linkDaMesa('link', url), null, String(url));
  }
});

test('tipo desconhecido: recusa', () => {
  assert.equal(linkDaMesa('outro', 'https://example.com/'), null);
  assert.equal(linkDaMesa(undefined, 'https://spotify.link/AbCdEf12345'), null);
});

test('dominioPublico', () => {
  assert.equal(dominioPublico('example.com'), true);
  assert.equal(dominioPublico('a.b.c.example.co.uk'), true);
  for (const h of ['com', 'localhost', 'x.localhost', '10.0.0.1', '[::1]', 'a..com', 'x.lan', 'example.123', '']) {
    assert.equal(dominioPublico(h), false, h);
  }
});
