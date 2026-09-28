'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const lib = require('./chatimagens');
const chatmedia = require('./chatmedia');
const L = require('./mesa-modules/midialinks');

const IMG = 'data:image/png;base64,iVBORw0KGgo=';

function msg(id, extra = {}) {
  return { type: 'chat', id: String(id), from: '2', name: 'Bia', text: '', ts: 1000 + id, ...extra };
}

test('o deposito acha a imagem pelo id e lista so as com imagem', () => {
  const s = lib.createStore({ isImage: chatmedia.isImageDataUrl });
  s.setHistory([msg(1, { text: 'oi' }), msg(2, { image: IMG, w: 10, h: 20 }), { type: 'chat', system: true, event: 'join', actor: 'Caio' }]);
  assert.equal(s.get('1'), null, 'mensagem sem imagem');
  assert.equal(s.get('2').image, IMG);
  assert.equal(s.get('2').name, 'Bia');
  assert.equal(s.get('2').w, 10);
  assert.deepEqual(s.list().map((i) => i.id), ['2']);
  assert.equal(s.get('nao existe'), null);
  assert.equal(s.get(2), null, 'id tem de ser texto');
});

test('imagem que o chat nao exibiria nao entra (http, data url de outro tipo)', () => {
  const s = lib.createStore({ isImage: chatmedia.isImageDataUrl });
  s.push(msg(1, { image: 'https://exemplo.com/x.png' }));
  s.push(msg(2, { image: 'data:text/html;base64,PGI+' }));
  assert.deepEqual(s.list(), []);
});

test('espelha o servidor: no maximo 8 imagens, a mais antiga sai inteira', () => {
  const s = lib.createStore({ isImage: chatmedia.isImageDataUrl });
  for (let i = 1; i <= 10; i += 1) s.push(msg(i, { image: IMG }));
  assert.deepEqual(s.list().map((i) => i.id), ['3', '4', '5', '6', '7', '8', '9', '10']);
  assert.equal(s.get('1'), null);
  assert.equal(s.get('2'), null);
});

test('espelha o servidor: 50 linhas, texto novo empurra a imagem velha para fora', () => {
  const s = lib.createStore({ isImage: chatmedia.isImageDataUrl });
  s.push(msg(1, { image: IMG }));
  for (let i = 2; i <= 50; i += 1) s.push(msg(i, { text: 'x' }));
  assert.ok(s.get('1'), '50 linhas: a imagem ainda esta');
  s.push({ type: 'chat', system: true, event: 'leave', actor: 'Caio' });
  assert.equal(s.get('1'), null, 'a 51a linha (mesmo de sistema) tira a primeira');
});

test('setHistory aplica os mesmos tetos que o servidor aplicou', () => {
  const s = lib.createStore({ isImage: chatmedia.isImageDataUrl });
  const hist = [];
  for (let i = 1; i <= 60; i += 1) hist.push(msg(i, i % 5 === 0 ? { image: IMG } : { text: 't' }));
  s.setHistory(hist);
  assert.deepEqual(s.list().map((i) => i.id), ['15', '20', '25', '30', '35', '40', '45', '50', '55', '60'].slice(-8));
});

test('onChange avisa a cada mudanca e o desfazedor para os avisos', () => {
  const s = lib.createStore();
  let n = 0;
  const off = s.onChange(() => { n += 1; });
  s.push(msg(1, { image: IMG }));
  s.setHistory([]);
  s.clear();
  assert.equal(n, 3);
  off();
  s.push(msg(2, { image: IMG }));
  assert.equal(n, 3);
  // Ouvinte que lanca nao derruba o deposito.
  s.onChange(() => { throw new Error('x'); });
  assert.doesNotThrow(() => s.push(msg(3)));
});

test('a copia devolvida nao mexe no deposito', () => {
  const s = lib.createStore();
  s.push(msg(1, { image: IMG }));
  s.get('1').image = 'mexido';
  s.list()[0].id = 'outro';
  assert.equal(s.get('1').image, IMG);
});

test('youtubeLinks acha os links de video, sem repetir, no maximo 3', () => {
  const t = 'olha https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30 e youtu.be/dQw4w9WgXcQ. tambem '
    + 'https://youtu.be/aaaaaaaaaaa, https://m.youtube.com/shorts/bbbbbbbbbbb e https://youtube.com/watch?v=ccccccccccc';
  const links = lib.youtubeLinks(t, L.parseYouTube);
  assert.deepEqual(links.map((l) => l.videoId), ['dQw4w9WgXcQ', 'aaaaaaaaaaa', 'bbbbbbbbbbb']);
  assert.equal(links[0].url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30');
  assert.equal(links[1].url, 'https://youtu.be/aaaaaaaaaaa', 'a virgula grudada nao entra no link');
});

test('youtubeLinks ignora o que nao e video do YouTube', () => {
  assert.deepEqual(lib.youtubeLinks('https://www.youtube.com/@canal e https://twitch.tv/x', L.parseYouTube), []);
  assert.deepEqual(lib.youtubeLinks('', L.parseYouTube), []);
  assert.deepEqual(lib.youtubeLinks(null, L.parseYouTube), []);
  assert.deepEqual(lib.youtubeLinks('youtu.be/dQw4w9WgXcQ', null), []);
});

test('isMsgId aceita o id do servidor e recusa lixo', () => {
  assert.equal(lib.isMsgId('123'), true);
  assert.equal(lib.isMsgId('abc_-9'), true);
  assert.equal(lib.isMsgId(''), false);
  assert.equal(lib.isMsgId('a b'), false);
  assert.equal(lib.isMsgId('x'.repeat(33)), false);
  assert.equal(lib.isMsgId(7), false);
});
