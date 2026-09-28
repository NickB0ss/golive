'use strict';
/* global window, document, location */

// Spike do YouTube e da Twitch no PC real (docs/2026-09-24-spike-origem-local.md).
//
//   npx electron tools/spike-youtube/main.js
//
// Abre duas janelas lado a lado com o mesmo player do YouTube
// (youtube-nocookie, enablejsapi=1) e o da Twitch (parent=localhost):
//   A) pagina em file://            -- como o app abria ate a 0.21
//   B) pagina em http://localhost   -- servida sem socket, como a origem
//                                      local do app (src/main/origem.js)
// Cada pagina usa a mesma CSP do index.html, nao carrega script do YouTube e
// fala com o player so por postMessage: manda "listening", espera "onReady",
// manda "playVideo" e conta os "infoDelivery". No fim imprime um resumo por
// janela. Esperado: A mostra o erro 153 (ou nunca chega a tocar) e B toca.
// Precisa de internet. Nao e empacotado (build.files so leva src/ e server/).

const { app, BrowserWindow, net, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const VIDEO = process.env.SPIKE_VIDEO || 'M7lc1UVf-VE'; // video de exemplo da propria doc da API
const CANAL = process.env.SPIKE_CANAL || 'twitchgaming';
const ESPERA_MS = 15000;

const CSP = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; frame-src https://www.youtube-nocookie.com https://player.twitch.tv";

const HTML = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<title>spike</title>
<style>body{margin:0;background:#111;color:#eee;font:13px sans-serif}iframe{border:0;display:block}#s{padding:6px;white-space:pre-wrap}</style>
</head><body><div id="s">carregando...</div><script src="pagina.js"></script></body></html>`;

// Roda na pagina (serializada com toString). Nada de script de terceiros.
function pagina(video, canal, esperaMs) {
  const YT = 'https://www.youtube-nocookie.com';
  const out = { origem: location.origin, onReady: false, estados: [], erros: [], tempoMax: 0, twitch: [], outros: [] };
  const s = document.getElementById('s');
  const yt = document.createElement('iframe');
  yt.width = 640; yt.height = 360;
  yt.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  yt.src = `${YT}/embed/${video}?enablejsapi=1&playsinline=1&mute=1&origin=${encodeURIComponent(location.origin)}`;
  document.body.appendChild(yt);
  const tw = document.createElement('iframe');
  tw.width = 640; tw.height = 200;
  tw.allow = 'autoplay; fullscreen';
  tw.src = `https://player.twitch.tv/?channel=${canal}&parent=localhost&muted=true`;
  document.body.appendChild(tw);

  const mandar = (obj) => yt.contentWindow?.postMessage(JSON.stringify({ id: 1, channel: 'widget', ...obj }), YT);
  window.addEventListener('message', (e) => {
    let d = e.data;
    try { d = typeof d === 'string' ? JSON.parse(d) : d; } catch { /* texto cru */ }
    if (e.origin === YT) {
      if (d?.event === 'onReady' || d?.event === 'initialDelivery') {
        if (!out.onReady) { out.onReady = true; mandar({ event: 'command', func: 'playVideo', args: [] }); }
      }
      if (d?.event === 'onError' && !out.erros.includes(d.info)) out.erros.push(d.info);
      const st = d?.info?.playerState;
      if (typeof st === 'number' && out.estados[out.estados.length - 1] !== st) out.estados.push(st);
      if (typeof d?.info?.currentTime === 'number') out.tempoMax = Math.max(out.tempoMax, d.info.currentTime);
    } else if (e.origin === 'https://player.twitch.tv') {
      if (out.twitch.length < 8) out.twitch.push(JSON.stringify(d).slice(0, 160));
    } else if (out.outros.length < 5) {
      out.outros.push(e.origin);
    }
  });
  // Como a IFrame API faz: repete "listening" ate o player responder.
  const t = setInterval(() => { if (out.onReady) clearInterval(t); else mandar({ event: 'listening' }); }, 250);
  document.addEventListener('securitypolicyviolation', (e) => out.erros.push(`CSP ${e.violatedDirective} ${e.blockedURI}`));
  const tick = setInterval(() => { s.textContent = `${out.origem}  onReady=${out.onReady}  estados=${out.estados.join(',')}  t=${out.tempoMax.toFixed(1)}s  erros=${out.erros.join(',')}`; }, 300);
  setTimeout(() => { clearInterval(tick); document.title = 'RESULTADO ' + JSON.stringify(out); }, esperaMs);
}

const JS = `(${pagina.toString()})(${JSON.stringify(VIDEO)}, ${JSON.stringify(CANAL)}, ${ESPERA_MS});`;

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'golive-spike-yt-'));
fs.writeFileSync(path.join(pasta, 'index.html'), HTML);
fs.writeFileSync(path.join(pasta, 'pagina.js'), JS);

function abrir(nome, url, x) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({ x, y: 40, width: 680, height: 660, title: nome, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const fim = setTimeout(() => resolve({ nome, resultado: 'sem resposta' }), ESPERA_MS + 10000);
    w.webContents.on('page-title-updated', (_e, t) => {
      if (!t.startsWith('RESULTADO ')) return;
      clearTimeout(fim);
      resolve({ nome, resultado: JSON.parse(t.slice(10)) });
    });
    w.loadURL(url);
  });
}

app.whenReady().then(async () => {
  // Mesmo mecanismo da origem local do app, com esta pasta no lugar de src/renderer.
  session.defaultSession.protocol.handle('http', (req) => {
    const u = new URL(req.url);
    if (u.origin !== 'http://localhost') return net.fetch(req, { bypassCustomProtocolHandlers: true });
    const nome = u.pathname === '/pagina.js' ? 'pagina.js' : 'index.html';
    const tipo = nome.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
    return new Response(fs.readFileSync(path.join(pasta, nome)), { headers: { 'Content-Type': tipo } });
  });
  const res = await Promise.all([
    abrir('A) file://', pathToFileURL(path.join(pasta, 'index.html')).href, 20),
    abrir('B) http://localhost', 'http://localhost/index.html', 720),
  ]);
  console.log('\n=== Spike YouTube/Twitch (playerState: -1 nao iniciado, 1 tocando, 2 pausado, 3 carregando, 5 pronto)');
  for (const r of res) console.log(`\n${r.nome}\n${JSON.stringify(r.resultado, null, 2)}`);
  console.log('\nAs janelas ficam abertas para conferir a olho (erro 153 aparece dentro do player). Feche para sair.');
}).catch((err) => {
  console.error('spike falhou:', err);
  app.exit(1);
});
