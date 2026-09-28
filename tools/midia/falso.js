'use strict';

// YouTube, Twitch e i.ytimg falsos para a bancada da midia da Mesa
// (tools/midia/main.js). Um servidor HTTPS em 127.0.0.1 com certificado
// proprio; o Electron chega nele por `--host-resolver-rules` (mesma tecnica
// do spike da origem local, docs/2026-09-24-spike-origem-local.md), porque o
// proxy deste container recusa os dominios reais.
//
// O embed falso fala o protocolo de postMessage do widget do YouTube como o
// real (listening -> initialDelivery/onReady; infoDelivery a cada 250 ms;
// onStateChange/onError so para quem fez addEventListener; comandos
// playVideo, pauseVideo, seekTo, setPlaybackRate, loadVideoById, mute,
// unMute, setVolume) e responde para o `origin=` da URL, como o real.
// Ganchos de teste dentro do iframe (a bancada os chama por
// WebFrameMain.executeJavaScript): __skew (relogio do video mais rapido ou
// mais lento), __strictRates (arredonda a velocidade como a IFrame API
// avisa que pode), __jump(s) (o video pula sozinho), __log.
//
// Videos especiais: "bloqueado00" da erro 150 ao tocar; "curto......"
// dura 8 s. Sem Referer o player da erro 153, como o real desde 2025.

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOSTS = ['www.youtube-nocookie.com', 'player.twitch.tv', 'i.ytimg.com'];

function certificado() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golive-midia-cert-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2',
    '-subj', '/CN=golive-falso', '-addext', `subjectAltName=${HOSTS.map((h) => `DNS:${h}`).join(',')}`,
  ], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

// Roda DENTRO do iframe do embed falso (serializada com toString).
function embedFalso() {
  /* global window, document, location */
  const q = new URLSearchParams(location.search);
  const alvo = q.get('origin') || '*';
  let vid = location.pathname.split('/').pop();
  const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const ouvintes = new Set();
  let id = null;
  let estado = -1;
  let tocando = false;
  let base = { pos: Number(q.get('start')) || 0, t: performance.now() };
  let rate = 1;
  let volume = 100;
  let muted = q.get('mute') === '1';
  let bloqueado = false;
  window.__skew = 1;
  window.__strictRates = false;
  window.__vid = () => vid;
  window.__log = { referrer: document.referrer, ancestor: location.ancestorOrigins && location.ancestorOrigins[0], origensListening: [], cmds: [] };
  const dur = () => (vid.startsWith('curto') ? 8 : 300);
  const agora = () => performance.now();
  function pos() {
    if (!tocando) return base.pos;
    return Math.min(dur(), base.pos + ((agora() - base.t) / 1000) * rate * window.__skew);
  }
  function rebase() {
    base = { pos: pos(), t: agora() };
  }
  function mandar(obj) {
    window.parent.postMessage(JSON.stringify({ ...obj, id, channel: 'widget' }), alvo);
  }
  function mudar(novo) {
    if (novo === estado) return;
    estado = novo;
    if (ouvintes.has('onStateChange')) mandar({ event: 'onStateChange', info: novo });
  }
  function erro(code) {
    if (ouvintes.has('onError')) mandar({ event: 'onError', info: code });
  }
  function info() {
    return {
      currentTime: pos(), playerState: estado, playbackRate: rate, duration: dur(), volume, muted,
      videoData: { video_id: vid, title: `Vídeo falso ${vid}`, author: 'Canal falso' },
    };
  }
  function tocar() {
    if (!document.referrer) return erro(153);
    if (vid === 'bloqueado00') {
      bloqueado = true;
      return erro(150);
    }
    rebase();
    tocando = true;
    mudar(3);
    setTimeout(() => { if (tocando) mudar(1); }, 150);
    return null;
  }
  const cmds = {
    playVideo: tocar,
    pauseVideo: () => { rebase(); tocando = false; mudar(2); },
    stopVideo: () => { rebase(); tocando = false; mudar(5); },
    seekTo: ([s]) => { base = { pos: Math.max(0, Math.min(dur(), Number(s) || 0)), t: agora() }; },
    setPlaybackRate: ([r]) => {
      rebase();
      let novo = Number(r) || 1;
      // Como a IFrame API avisa: velocidade fora da lista vai para a mais
      // perto, na direcao de 1.
      if (window.__strictRates) novo = novo > 1 ? Math.max(...RATES.filter((x) => x <= novo)) : Math.min(...RATES.filter((x) => x >= novo));
      rate = novo;
      if (ouvintes.has('onPlaybackRateChange')) mandar({ event: 'onPlaybackRateChange', info: rate });
    },
    loadVideoById: ([v, s]) => {
      vid = String(v);
      bloqueado = false;
      base = { pos: Number(s) || 0, t: agora() };
      tocando = false;
      mudar(-1);
      tocar();
    },
    cueVideoById: ([v, s]) => { vid = String(v); base = { pos: Number(s) || 0, t: agora() }; tocando = false; mudar(5); },
    mute: () => { muted = true; },
    unMute: () => { muted = false; },
    setVolume: ([v]) => { volume = Number(v); },
    addEventListener: ([nome]) => { ouvintes.add(String(nome)); },
  };
  window.__jump = (s) => { base = { pos: Math.max(0, pos() + s), t: agora() }; };
  window.__fimEm = (s) => { base = { pos: Math.max(0, dur() - s), t: agora() }; };
  window.addEventListener('message', (e) => {
    let d;
    try { d = JSON.parse(e.data); } catch { return; }
    if (!d || typeof d !== 'object') return;
    if (d.event === 'listening') {
      id = d.id;
      window.__log.origensListening.push(e.origin);
      mandar({ event: 'initialDelivery', info: info() });
      mandar({ event: 'onReady', info: info() });
      if (estado === -1) mudar(5);
      return;
    }
    if (d.event === 'command' && Object.prototype.hasOwnProperty.call(cmds, d.func)) {
      window.__log.cmds.push([Math.round(agora()), d.func, d.args]);
      if (window.__log.cmds.length > 400) window.__log.cmds.shift();
      cmds[d.func](Array.isArray(d.args) ? d.args : []);
    }
  });
  setInterval(() => {
    if (tocando && pos() >= dur()) {
      base = { pos: dur(), t: agora() };
      tocando = false;
      mudar(0);
    }
    if (id !== null && !bloqueado) mandar({ event: 'infoDelivery', info: info() });
  }, 250);
  document.getElementById('v').textContent = `falso ${vid}`;
}

function twitchFalso() {
  const q = new URLSearchParams(location.search);
  const parent = q.get('parent');
  const anc = location.ancestorOrigins && location.ancestorOrigins[0];
  let ok = false;
  try {
    ok = !!parent && !!anc && new URL(anc).hostname === parent;
  } catch {
    ok = false;
  }
  document.body.dataset.ok = String(ok);
  document.body.dataset.canal = q.get('channel') || '';
  document.getElementById('s').textContent = ok ? `ao vivo: ${q.get('channel')}` : `erro de parent (${parent} x ${anc})`;
}

// PNG 1x1 (a "capa").
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function iniciar(porta = 0) {
  const log = [];
  const server = https.createServer(certificado(), (req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const u = new URL(req.url, `https://${host}`);
    log.push({ host, path: u.pathname + u.search, referer: req.headers.referer || null });
    if (host === 'i.ytimg.com') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(PNG);
    }
    if (host === 'www.youtube-nocookie.com' && u.pathname.startsWith('/embed/')) {
      const id = u.pathname.split('/').pop();
      // "Sem internet": o pedido fica pendurado e o player nunca responde.
      if (id === 'semrede0000') return undefined;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!DOCTYPE html><html><body style="margin:0;background:#222;color:#ddd;font:14px sans-serif">
<div id="v"></div><a id="logo" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">YouTube</a>
<script>(${embedFalso.toString()})();</script></body></html>`);
    }
    if (host === 'player.twitch.tv') {
      const canal = u.searchParams.get('channel') || '';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!DOCTYPE html><html><body style="margin:0;background:#1b1b24;color:#ddd;font:14px sans-serif">
<div id="s"></div><a id="logo" href="https://www.twitch.tv/${encodeURIComponent(canal)}" target="_blank" rel="noopener">Twitch</a>
<script>(${twitchFalso.toString()})();</script></body></html>`);
    }
    res.writeHead(404);
    return res.end();
  });
  return new Promise((resolve) => {
    server.listen(porta, '127.0.0.1', () => resolve({ port: server.address().port, hosts: HOSTS, log, close: () => server.close() }));
  });
}

module.exports = { iniciar, HOSTS };
