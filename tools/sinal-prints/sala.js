'use strict';

/*
 * Bancada visual da Sala (redesign Sinal). Sobe o servidor de sinalizacao de verdade, abre index.html no Chromium
 * do Playwright com a ponte window.golive simulada, entra pelo formulario do Inicio e poe outras pessoas na sala
 * como clientes ws crus. As telas sao canvas.captureStream postos no palco pelo mesmo ui.grid.showTile que a
 * track do WebRTC usaria. Nao entra no npm test (precisa de navegador).
 *
 * Uso: PLAYWRIGHT_DIR=<playwright> node tools/sinal-prints/sala.js [LxA ...]
 */

/* global window, document, requestAnimationFrame, WebSocket */

const fs = require('node:fs');
const path = require('node:path');
const NodeWebSocket = require('ws');
const { createSignalingServer } = require('../../server/signaling-core');

const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'C:/Users/nicol/Desktop/portfolio-nubinho/node_modules/playwright');
const RAIZ = path.join(__dirname, '..', '..');
const PAGINA = `file://${path.join(RAIZ, 'src', 'renderer', 'index.html')}`;
const SAIDA = path.join(RAIZ, 'docs', 'redesign-greenfield', 'prints', 'sala');
const TAMANHOS = process.argv.slice(2).length
  ? process.argv.slice(2).map((t) => t.split('x').map(Number))
  : [[1440, 900], [1180, 760], [960, 600]];

const espera = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** Pessoa da sala falando o protocolo por um ws cru. */
async function pessoa(port, name) {
  const ws = new NodeWebSocket(`ws://127.0.0.1:${port}`);
  const caixa = [];
  ws.on('message', (raw) => caixa.push(JSON.parse(raw.toString())));
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const envia = (msg) => ws.send(JSON.stringify(msg));
  envia({ type: 'join', room: 'geral', name, clientId: `cli-${name}` });
  for (let i = 0; i < 100 && !caixa.some((m) => m.type === 'welcome'); i += 1) await espera(20);
  const id = caixa.find((m) => m.type === 'welcome').id;
  return { name, id, envia, fecha: () => ws.close() };
}

/** Ponte simulada: o app acha que esta no Windows, com rede Radmin, e entra como quem criou a sala. */
const PONTE = () => {
  const enviar = WebSocket.prototype.send;
  WebSocket.prototype.send = function send(data) {
    if (typeof data === 'string' && data.includes('"type":"join"')) {
      const m = JSON.parse(data);
      m.ownerToken = 'banco-de-prova';
      return enviar.call(this, JSON.stringify(m));
    }
    return enviar.call(this, data);
  };
  window.golive = new Proxy({}, {
    get: (_, k) => {
      if (k === 'getNetworkAddress') return async () => ({ address: '26.114.8.201', kind: 'radmin' });
      if (k === 'getVersion') return async () => null;
      if (k === 'listSources') {
        // Fontes de mentira com miniatura desenhada aqui mesmo.
        const shot = (cor, texto) => {
          const c = document.createElement('canvas');
          c.width = 320;
          c.height = 180;
          const g = c.getContext('2d');
          g.fillStyle = cor;
          g.fillRect(0, 0, 320, 180);
          g.fillStyle = 'rgba(255,255,255,.8)';
          g.font = '22px sans-serif';
          g.fillText(texto, 16, 40);
          return c.toDataURL();
        };
        return async (tipos) => (tipos.includes('screen')
          ? [{ id: 's1', name: 'Tela 1', isScreen: true, height: 1080, thumbnail: shot('#26415c', 'Tela 1') },
            { id: 's2', name: 'Tela 2', isScreen: true, height: 1440, thumbnail: shot('#3b2a4a', 'Tela 2') }]
          : ['VALORANT', 'Discord', 'Google Chrome — Documentação do Radmin', 'Spotify', 'OBS 30.2'].map((n, i) => (
            { id: `w${i}`, name: n, isScreen: false, thumbnail: shot(['#1d3b2a', '#2a2a4a', '#4a3a1d', '#1d4a3a', '#3a1d1d'][i], n) })));
      }
      if (k === 'win') {
        return { platform: 'win32', minimize() {}, toggleMaximize() {}, close() {}, onMaximizeChange() {}, show() {} };
      }
      if (String(k).startsWith('on')) return () => {};
      return async () => null;
    },
  });
  if (!localStorage.getItem('golive')) {
    localStorage.setItem('golive', JSON.stringify({ v: 1, name: 'Nick', clientId: 'cli-nick' }));
  }
};

/** Uma "tela" que se mexe, a 30 qps. */
const TELA_FALSA = ([rotulo, cor, w, h]) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  let t = 0;
  const pinta = () => {
    t += 1;
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#16324a');
    grad.addColorStop(1, cor);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.8)';
    g.fillRect((t * 7) % w, h * 0.55, w * 0.08, w * 0.08);
    g.font = `${Math.round(h / 9)}px sans-serif`;
    g.fillText(rotulo, w * 0.05, h * 0.2);
    requestAnimationFrame(pinta);
  };
  pinta();
  return c.captureStream(30);
};

async function mostrarTela(page, id, rotulo, cor, kind = 'screen', w = 1280, h = 720) {
  await page.evaluate(([fn, id2, rot, c, k, w2, h2]) => {
    const fake = new Function(`return (${fn})`)();
    window.GoLive.ui.grid.showTile(id2, rot, fake([rot, c, w2, h2]), { kind: k });
  }, [TELA_FALSA.toString(), id, rotulo, cor, kind, w, h]);
}

async function foto(page, nome, w, h) {
  await espera(250);
  await page.screenshot({ path: path.join(SAIDA, `${nome}-${w}x${h}.png`) });
}

async function rodada(browser, port, [w, h]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const erros = [];
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  await page.addInitScript(PONTE);
  await page.goto(PAGINA);
  await page.fill('#join-address', `127.0.0.1:${port}`);
  await page.press('#join-address', 'Enter');
  await page.waitForSelector('#room-view:not(.hidden)', { timeout: 8000 });
  await espera(400);
  await foto(page, '01-sozinho', w, h);

  const bia = await pessoa(port, 'Bia');
  const leo = await pessoa(port, 'Leo');
  const caio = await pessoa(port, 'Caio');
  await espera(300);
  bia.envia({ type: 'broadcast-state', live: true, annotate: true });
  leo.envia({ type: 'broadcast-state', live: true });
  caio.envia({ type: 'camera-state', on: true });
  await espera(300);
  await mostrarTela(page, bia.id, 'Bia', '#4B5A3A');
  await mostrarTela(page, leo.id, 'Leo', '#3B2A63');
  await mostrarTela(page, `cam-${caio.id}`, 'Caio', '#173C4F', 'camera', 640, 480);
  bia.envia({ type: 'chat', text: 'alguém vem de sage? tô cansada de ser a única que cura' });
  bia.envia({ type: 'chat', text: 'e liga o som, tá mudo' });
  leo.envia({ type: 'chat', text: 'bora mais uma depois dessa? quem perder abre o truco na Mesa 😂' });
  await espera(700);
  await foto(page, '02-ao-vivo', w, h);

  // HUD de um tile com o mouse em cima.
  const tile = await page.$('#grid .tile:not([hidden])');
  if (tile) {
    const caixa = await tile.boundingBox();
    await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
    await foto(page, '03-hud', w, h);
  }

  leo.envia({ type: 'broadcast-state', live: true, paused: true });
  await espera(400);
  await foto(page, '04-pausada', w, h);

  await page.click('#btn-room-presence').catch((e) => erros.push(`presenca: ${e.message}`));
  await foto(page, '05-presenca', w, h);
  await page.keyboard.press('Escape');
  await page.click('#btn-room-more').catch((e) => erros.push(`menu da sala: ${e.message}`));
  await foto(page, '06-menu-sala', w, h);
  await page.keyboard.press('Escape');

  // O seletor de fonte (Transmitir), com as telas e depois as janelas.
  await page.click('#btn-toggle-share');
  await espera(600);
  await foto(page, '13-transmitir-telas', w, h);
  await page.click('#picker-tabs [data-tab="window"]');
  await page.click('#picker-grid .src-card');
  await foto(page, '14-transmitir-janelas', w, h);
  await page.keyboard.press('Escape');

  // Voce transmitindo e depois pausado (a UI recebe o estado pelo mesmo setToggleState que o app usa).
  await page.evaluate(() => {
    window.GoLive.ui.setToggleState('share', 'on');
    document.getElementById('btn-pause-share').classList.remove('hidden');
    document.getElementById('btn-swap-share').classList.remove('hidden');
  });
  await foto(page, '08-transmitindo', w, h);
  await page.evaluate(() => window.GoLive.ui.setToggleState('pause', 'on'));
  await foto(page, '09-transmitindo-pausado', w, h);
  await page.evaluate(() => {
    window.GoLive.ui.setToggleState('pause', 'off');
    window.GoLive.ui.setToggleState('share', 'off');
  });

  // Conversa espiando: as mensagens surgem sobre o programa.
  if (await page.isVisible('#btn-conv-peek')) await page.click('#btn-conv-peek');
  bia.envia({ type: 'chat', text: 'olha o placar aí' });
  leo.envia({ type: 'chat', text: 'vou pegar água, já volto' });
  await espera(500);
  await foto(page, '10-conversa-espiando', w, h);
  await page.click('#btn-conv-toggle');

  // Tela cheia e teatro.
  const alvo = await page.$('#grid .tile:not([hidden])');
  if (alvo) {
    await alvo.dblclick();
    await espera(500);
    await foto(page, '11-tela-cheia', w, h);
    await page.keyboard.press('Escape');
    await alvo.dblclick().catch(() => {});
    await espera(300);
  }
  await page.keyboard.press('t');
  await espera(300);
  await foto(page, '12-teatro', w, h);
  await page.keyboard.press('t');

  for (const p of [bia, leo, caio]) p.fecha();
  await espera(600);
  await foto(page, '07-todos-sairam', w, h);
  await page.close();
  return erros;
}

(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const servidor = await createSignalingServer({ port: 0, ownerToken: 'banco-de-prova', log: () => {} });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const todos = [];
  try {
    for (const t of TAMANHOS) {
      const erros = await rodada(browser, servidor.port, t);
      todos.push(...erros.map((e) => `${t.join('x')}: ${e}`));
    }
  } finally {
    await browser.close();
    await servidor.close();
  }
  if (todos.length) {
    console.error(todos.join('\n'));
    process.exit(1);
  }
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
