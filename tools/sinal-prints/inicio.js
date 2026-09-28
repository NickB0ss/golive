'use strict';

/* Bancada visual do Início Sinal. Não entra no npm test: precisa Chromium. */
/* global document, window */
const fs = require('node:fs');
const path = require('node:path');

const playwrightDir = process.env.PLAYWRIGHT_DIR || 'C:/Users/nicol/Desktop/portfolio-nubinho/node_modules/playwright';
const { chromium } = require(playwrightDir);
const root = path.join(__dirname, '..', '..');
const pageUrl = `file://${path.join(root, 'src', 'renderer', 'index.html')}`;
const output = path.join(root, 'docs', 'redesign-greenfield', 'prints', 'inicio');
const sizes = [[1440, 900], [1180, 760], [960, 600]];

function bridge() {
  const handlers = {};
  // Guardados para os cenarios dispararem eventos pelo caminho real do app.
  window.__pontes = handlers;
  window.golive = new Proxy({}, {
    get: (_, key) => {
      if (key === 'win') return { platform: 'win32', minimize() {}, toggleMaximize() {}, close() {}, onMaximizeChange() {} };
      if (key === 'getNetworkAddress') return async () => ({ address: '26.12.4.8', kind: 'radmin' });
      if (key === 'getVersion') return async () => '0.21.0';
      if (String(key).startsWith('on')) return (fn) => { handlers[key] = fn; };
      return async () => null;
    },
  });
  if (!localStorage.getItem('golive')) localStorage.setItem('golive', JSON.stringify({ v: 1, name: 'Nick', clientId: crypto.randomUUID() }));
}

async function setup(browser, width, height) {
  const errors = [];
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(bridge);
  await page.goto(pageUrl);
  await page.waitForTimeout(150);
  return { page, errors };
}

async function state(page, kind) {
  await page.evaluate((scenario) => {
    const rooms = [
      { name: 'Sala do Caio', address: '26.3.1.9:47800', peers: 4 },
      { name: 'Churras', address: '26.1.0.2:47810', peers: 2, protected: true },
      { name: 'Sala antiga', address: '26.8.0.1:47800', peers: 3, version: '0.20.0' },
    ];
    if (scenario === 'empty') rooms.length = 0;
    if (scenario === 'offline') {
      window.GoLive.ui.rooms.setNetworkStatus(null);
      rooms.length = 0;
    }
    const activeAddress = scenario === 'joining' ? rooms[0].address : null;
    window.GoLive.ui.rooms.render({ liveRooms: rooms, appVersion: '0.21.0', activeAddress, onSelect() {} });
    if (scenario === 'downloading') {
      window.__pontes.onUpdateStatus({ status: 'downloading', version: '0.22.0', progress: 62 });
    }
    if (scenario === 'criar') document.querySelector('#btn-create-room').click();
    if (scenario === 'pin') {
      window.GoLive.ui.dialogs.openJoinRoom({ address: '26.3.1.9:47800', showPinField: true, onConnect() {} });
      document.querySelector('#setup-error').textContent = 'PIN errado. Restam 4 tentativas.';
    }
    if (scenario === 'invalid') {
      document.querySelector('#lobby-error').textContent = 'Informe um endereço no formato IP:porta.';
    }
  }, kind);
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch();
  const allErrors = [];
  try {
    for (const [width, height] of sizes) {
      for (const scenario of ['first', 'rooms', 'joining', 'empty', 'offline', 'downloading', 'invalid', 'criar', 'pin']) {
        const { page, errors } = await setup(browser, width, height);
        if (scenario === 'first') {
          // Primeira vez de verdade: sem apelido salvo antes de o app carregar.
          await page.evaluate(() => {
            const cfg = JSON.parse(localStorage.getItem('golive'));
            localStorage.setItem('golive', JSON.stringify({ ...cfg, name: '' }));
          });
          await page.reload();
          await page.waitForTimeout(150);
        }
        await state(page, scenario);
        await page.waitForTimeout(400); // animacoes de entrada (dialogo, faixa) terminam
        await page.screenshot({ path: path.join(output, `${scenario}-${width}x${height}.png`) });
        allErrors.push(...errors.map((error) => `${scenario}-${width}x${height}: ${error}`));
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (allErrors.length) throw new Error(`Erros de console:\n${allErrors.join('\n')}`);
})().catch((error) => { console.error(error); process.exit(1); });
