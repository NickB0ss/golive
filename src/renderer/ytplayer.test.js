'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const yp = require('./ytplayer');

const ID = 'M7lc1UVf-VE';
const YT = 'https://www.youtube-nocookie.com';

test('embedUrl: nocookie, jsapi, origem da pagina, sem controles do YouTube', () => {
  assert.equal(
    yp.embedUrl(ID, { origin: 'http://localhost' }),
    `${YT}/embed/${ID}?enablejsapi=1&origin=http%3A%2F%2Flocalhost&playsinline=1&controls=0&rel=0`,
  );
  assert.match(yp.embedUrl(ID, { origin: 'http://localhost', start: 42.9, mute: true }), /&start=42&mute=1$/);
  assert.throws(() => yp.embedUrl('../x'));
  assert.throws(() => yp.embedUrl(`${ID}"`));
});

test('mensagens no formato do widget', () => {
  assert.deepEqual(JSON.parse(yp.listeningJson(1)), { event: 'listening', id: 1, channel: 'widget' });
  assert.deepEqual(JSON.parse(yp.commandJson('seekTo', [12, true], 1)), { event: 'command', func: 'seekTo', args: [12, true], id: 1, channel: 'widget' });
});

test('readMessage confere a origem e a janela de quem mandou', () => {
  const janela = {};
  const data = JSON.stringify({ event: 'onReady', info: {} });
  assert.deepEqual(yp.readMessage({ origin: YT, source: janela, data }, janela), { event: 'onReady', info: {} });
  assert.equal(yp.readMessage({ origin: 'https://www.youtube.com', source: janela, data }, janela), null);
  assert.equal(yp.readMessage({ origin: 'null', source: janela, data }, janela), null);
  assert.equal(yp.readMessage({ origin: YT, source: {}, data }, janela), null, 'outro iframe da mesma origem');
  assert.equal(yp.readMessage({ origin: YT, source: janela, data: '{quebrado' }, janela), null);
  assert.equal(yp.readMessage({ origin: YT, source: janela, data: '"texto"' }, janela), null);
  assert.equal(yp.readMessage({ origin: YT, source: janela, data: 'x'.repeat(70000) }, janela), null);
  assert.deepEqual(yp.readMessage({ origin: YT, source: janela, data: { event: 'x' } }, janela), { event: 'x' });
});

test('estados e textos de erro', () => {
  assert.equal(yp.stateName(1), 'playing');
  assert.equal(yp.stateName(-1), 'unstarted');
  assert.equal(yp.stateName(0), 'ended');
  assert.equal(yp.stateName(9), 'unknown');
  assert.equal(yp.stateName('constructor'), 'unknown');
  assert.equal(yp.errorText(101), yp.errorText(150));
  assert.match(yp.errorText(150), /não deixa tocar fora do YouTube/);
  assert.match(yp.errorText(153), /recusou o player/);
  assert.match(yp.errorText('offline'), /Sem internet/);
  assert.equal(yp.isVideoError(150), true);
  assert.equal(yp.isVideoError(153), false, '153 e do app, nao do video');
});

test('createClock extrapola a posicao so tocando, e no maximo 2 s', () => {
  const c = yp.createClock();
  assert.equal(c.currentTime(0), null);
  c.apply({ currentTime: 10, playerState: 2, playbackRate: 1, duration: 200, videoData: { title: 'T', video_id: ID } }, 1000);
  assert.equal(c.currentTime(5000), 10, 'pausado nao anda');
  c.apply({ playerState: 1 }, 1000);
  assert.equal(c.currentTime(1500), 10.5);
  assert.equal(c.currentTime(9000), 12, 'sem noticia do player para em 2 s');
  c.apply({ playbackRate: 1.05 }, 1000);
  assert.equal(c.currentTime(2000), 11.05);
  c.assume(50, 3000);
  assert.equal(c.currentTime(3000), 50);
  assert.deepEqual([c.snapshot().title, c.snapshot().videoId, c.snapshot().duration], ['T', ID, 200]);
  c.apply({ videoData: { video_id: 'ruim' } }, 0);
  assert.equal(c.snapshot().videoId, ID);
});

/** DOM minimo: o bastante para create() montar, falar e desmontar. */
function fakeDom() {
  const listeners = new Map();
  const timers = new Map();
  let nextTimer = 1;
  let t = 0;
  const player = { sent: [], postMessage(msg, target) { this.sent.push([JSON.parse(msg), target]); } };
  const iframe = {
    attrs: {}, src: '', contentWindow: player, removed: false, onload: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(ev, fn) { if (ev === 'load') this.onload = fn; },
    remove() { this.removed = true; },
  };
  const win = {
    location: { origin: 'http://localhost' },
    navigator: { onLine: true },
    addEventListener(ev, fn) { listeners.set(ev, fn); },
    removeEventListener(ev, fn) { if (listeners.get(ev) === fn) listeners.delete(ev); },
    setInterval(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); },
    setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const doc = { createElement: () => iframe };
  const container = { children: [], appendChild(el) { this.children.push(el); } };
  return {
    win, doc, container, iframe, player, timers,
    now: () => t,
    tick(ms) { t += ms; },
    fromPlayer(obj, extra = {}) {
      const fn = listeners.get('message');
      if (fn) fn({ origin: YT, source: player, data: JSON.stringify(obj), ...extra });
    },
    listening: () => listeners.has('message'),
  };
}

test('create: atributos minimos, handshake, comandos so depois do onReady', () => {
  const d = fakeDom();
  const log = [];
  const p = yp.create({
    container: d.container, videoId: ID, start: 5, win: d.win, doc: d.doc, now: d.now,
    onReady: () => log.push('ready'), onState: (s) => log.push(`state:${s}`), onError: (c, txt) => log.push(`erro:${c}:${txt}`),
  });
  assert.equal(d.iframe.attrs.sandbox, 'allow-scripts allow-same-origin allow-popups');
  assert.equal(d.iframe.attrs.allow, 'autoplay; encrypted-media');
  assert.doesNotMatch(d.iframe.attrs.allow, /camera|microphone|display-capture|fullscreen/);
  assert.equal(d.iframe.attrs.referrerpolicy, 'strict-origin-when-cross-origin');
  assert.match(d.iframe.src, /origin=http%3A%2F%2Flocalhost/);
  assert.match(d.iframe.src, /start=5/);
  assert.equal(p.play(), false, 'antes do onReady nao manda comando');
  d.iframe.onload();
  assert.deepEqual(d.player.sent[0], [{ event: 'listening', id: 1, channel: 'widget' }, YT]);
  // Mensagem de outra origem ou de outra janela e ignorada
  d.fromPlayer({ event: 'onReady' }, { origin: 'https://evil.example' });
  d.fromPlayer({ event: 'onReady' }, { source: {} });
  assert.equal(p.ready, false);
  d.fromPlayer({ event: 'onReady', info: { playerState: 5 } });
  assert.equal(p.ready, true);
  assert.equal(d.timers.size, 0, 'parou de repetir listening e o prazo');
  const eventos = d.player.sent.filter(([m]) => m.func === 'addEventListener').map(([m]) => m.args[0]);
  assert.deepEqual(eventos, ['onStateChange', 'onError', 'onPlaybackRateChange']);
  d.player.sent.length = 0;
  p.play();
  p.seek(30);
  p.setRate(1.05);
  p.setVolume(250);
  p.load(ID, 7);
  assert.deepEqual(d.player.sent.map(([m]) => [m.func, m.args]), [
    ['playVideo', []], ['seekTo', [30, true]], ['setPlaybackRate', [1.05]], ['setVolume', [100]], ['loadVideoById', [ID, 7]],
  ]);
  d.fromPlayer({ event: 'infoDelivery', info: { playerState: 1, currentTime: 7 } });
  d.tick(500);
  assert.equal(p.currentTime(), 7.5);
  d.fromPlayer({ event: 'onError', info: 150 });
  assert.deepEqual(log, ['ready', 'state:playing', `erro:150:${yp.errorText(150)}`]);
  p.destroy();
  assert.equal(d.iframe.removed, true);
  assert.equal(d.listening(), false);
});

test('create: sem resposta no prazo vira "sem internet"', () => {
  const d = fakeDom();
  let erro = null;
  yp.create({ container: d.container, videoId: ID, win: d.win, doc: d.doc, now: d.now, onError: (c) => { erro = c; } });
  d.win.navigator.onLine = false;
  const [prazo] = [...d.timers.values()].slice(-1);
  prazo();
  assert.equal(erro, 'offline');
});
