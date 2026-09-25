'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('./midialinks');

const ID = 'dQw4w9WgXcQ';

test('parseYouTube aceita os formatos de link do YouTube', () => {
  const casos = [
    [ID, 0],
    [`https://www.youtube.com/watch?v=${ID}`, 0],
    [`https://youtube.com/watch?v=${ID}&list=PL123&index=2`, 0],
    [`youtube.com/watch?v=${ID}`, 0],
    [`http://m.youtube.com/watch?v=${ID}&t=42`, 42],
    [`https://music.youtube.com/watch?v=${ID}&si=abc`, 0],
    [`https://youtu.be/${ID}`, 0],
    [`https://youtu.be/${ID}?t=90`, 90],
    [`https://youtu.be/${ID}?si=xyz&t=1m30s`, 90],
    [`https://www.youtube.com/shorts/${ID}`, 0],
    [`https://www.youtube.com/embed/${ID}?start=15`, 15],
    [`https://www.youtube-nocookie.com/embed/${ID}`, 0],
    [`https://www.youtube.com/live/${ID}?feature=share`, 0],
    [`https://www.youtube.com/watch?v=${ID}#t=1h2m3s`, 3723],
    [`  https://youtu.be/${ID}  `, 0],
  ];
  for (const [link, start] of casos) assert.deepEqual(L.parseYouTube(link), { videoId: ID, start }, link);
});

test('parseYouTube recusa o que nao e video do YouTube', () => {
  for (const ruim of [
    null, 5, '', 'abc', `${ID}x`, 'https://www.youtube.com/', `https://example.com/watch?v=${ID}`,
    `https://youtube.com.evil.com/watch?v=${ID}`, `javascript:alert(1)//youtu.be/${ID}`,
    'https://www.youtube.com/watch?v=curto', `https://www.youtube.com/channel/${ID}`,
    `https://youtu.be/${ID.slice(0, 10)}`, `ftp://youtu.be/${ID}`, 'x'.repeat(3000),
    `https://www.youtube.com/watch?v=${ID.slice(0, 10)}%22`,
  ]) {
    assert.equal(L.parseYouTube(ruim), null, String(ruim).slice(0, 60));
  }
});

test('parseStart le segundos, 1m30s e 01:30; o resto vira 0', () => {
  assert.equal(L.parseStart('90'), 90);
  assert.equal(L.parseStart('90s'), 90);
  assert.equal(L.parseStart('2m'), 120);
  assert.equal(L.parseStart('1h'), 3600);
  assert.equal(L.parseStart('01:30'), 90);
  assert.equal(L.parseStart('1:00:05'), 3605);
  assert.equal(L.parseStart('12.7'), 12);
  for (const ruim of ['', 'abc', '-5', '1x', '9'.repeat(20), null]) assert.equal(L.parseStart(ruim), 0);
});

test('parseTwitch aceita canal cru e links da Twitch', () => {
  assert.equal(L.parseTwitch('Gaules'), 'gaules');
  assert.equal(L.parseTwitch('@gaules'), 'gaules');
  assert.equal(L.parseTwitch('https://www.twitch.tv/Gaules'), 'gaules');
  assert.equal(L.parseTwitch('twitch.tv/alanzoka?sr=a'), 'alanzoka');
  assert.equal(L.parseTwitch('https://m.twitch.tv/some_one/'), 'some_one');
  assert.equal(L.parseTwitch('https://player.twitch.tv/?channel=abc_1&parent=x'), 'abc_1');
});

test('parseTwitch recusa o que nao e canal', () => {
  for (const ruim of [
    null, '', 'ab', 'a'.repeat(26), 'com espaco', 'https://www.twitch.tv/', 'https://www.twitch.tv/directory',
    'https://www.twitch.tv/videos/123', 'https://twitch.tv.evil.com/abc', 'https://example.com/abc', 'nome-com-hifen',
  ]) {
    assert.equal(L.parseTwitch(ruim), null, String(ruim));
  }
});

test('positionAt anda com o relogio do servidor so tocando', () => {
  const tocando = { playing: true, pos: 10, at: 1000, rate: 1 };
  assert.equal(L.positionAt(tocando, 1000), 10);
  assert.equal(L.positionAt(tocando, 3500), 12.5);
  assert.equal(L.positionAt(tocando, 500), 10, 'hora anterior ao at nao volta');
  assert.equal(L.positionAt({ ...tocando, rate: 2 }, 2000), 12);
  assert.equal(L.positionAt({ ...tocando, playing: false }, 99999), 10);
  assert.equal(L.positionAt({ ...tocando, at: null }, 99999), 10);
  assert.equal(L.positionAt(tocando, undefined), 10);
  assert.equal(L.positionAt(null, 1), 0);
  assert.equal(L.positionAt({ playing: true, pos: -1, at: 0 }, 1), 0);
});

test('formatPos e cleanText', () => {
  assert.equal(L.formatPos(0), '0:00');
  assert.equal(L.formatPos(65.9), '1:05');
  assert.equal(L.formatPos(3723), '1:02:03');
  assert.equal(L.formatPos(NaN), '0:00');
  assert.equal(L.cleanText('  a\u0000b \n c ', 10), 'a b c');
  assert.equal(L.cleanText('abcdef', 3), 'abc');
  assert.equal(L.cleanText(5, 3), null);
});
