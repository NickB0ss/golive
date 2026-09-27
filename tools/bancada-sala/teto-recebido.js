'use strict';

/* global window, document, requestAnimationFrame */

/*
 * Exercita a qualidade recebida com o servidor real e duas paginas separadas.
 * A captura e um canvas para o roteiro nao depender do seletor do Electron.
 *
 * PLAYWRIGHT_DIR=C:/.../playwright node tools/bancada-sala/teto-recebido.js
 */

const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const { createSignalingServer } = require('../../server/signaling-core');

const RAIZ = path.resolve(__dirname, '..', '..');
const PAGINA = `file://${path.join(RAIZ, 'src', 'renderer', 'index.html')}`;
const espera = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function ponte({ nome, ehDona }) {
  const thumbnail = [
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwA',
    'FgAI/ScL2uQAAAABJRU5ErkJggg==',
  ].join('');
  const WebSocketOriginal = window.WebSocket;
  const enviarOriginal = WebSocketOriginal.prototype.send;
  WebSocketOriginal.prototype.send = function send(data) {
    if (typeof data === 'string' && data.includes('"type":"join"')) {
      const mensagem = JSON.parse(data);
      mensagem.name = nome;
      if (ehDona) mensagem.ownerToken = 'bancada-teto-recebido';
      return enviarOriginal.call(this, JSON.stringify(mensagem));
    }
    return enviarOriginal.call(this, data);
  };

  window.__caixa = [];
  window.WebSocket = new Proxy(WebSocketOriginal, {
    construct(alvo, args) {
      const socket = new alvo(...args);
      socket.addEventListener('message', (evento) => {
        try {
          window.__caixa.push(JSON.parse(evento.data));
        } catch {
          // Ruido fora do protocolo nao importa para este roteiro.
        }
      });
      return socket;
    },
  });

  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const contexto = canvas.getContext('2d');
  let quadro = 0;
  const pintar = () => {
    quadro += 1;
    contexto.fillStyle = quadro % 2 ? '#17324D' : '#254D73';
    contexto.fillRect(0, 0, canvas.width, canvas.height);
    requestAnimationFrame(pintar);
  };
  pintar();
  navigator.mediaDevices.getDisplayMedia = async () => canvas.captureStream(30);

  window.golive = new Proxy({}, {
    get: (_, chave) => {
      if (chave === 'getNetworkAddress') return async () => ({ address: '26.114.8.201', kind: 'radmin' });
      if (chave === 'getVersion') return async () => null;
      if (chave === 'listSources') {
        return async () => [{
          id: 'screen:bancada',
          name: 'Tela de bancada',
          thumbnail,
          isScreen: true,
          resolution: '1280×720',
          width: 1280,
          height: 720,
        }];
      }
      if (chave === 'selectSource') return async () => null;
      if (chave === 'win') return { show() {} };
      if (String(chave).startsWith('on')) return () => {};
      return async () => null;
    },
  });
}

async function esperarMensagem(page, predicado, tempoMs = 10000) {
  const fim = Date.now() + tempoMs;
  while (Date.now() < fim) {
    const caixa = await page.evaluate(() => window.__caixa);
    const mensagem = caixa.find(predicado);
    if (mensagem) return mensagem;
    await espera(50);
  }
  throw new Error('mensagem esperada nao chegou');
}

async function abrirPessoa(browser, servidor, nome, ehDona) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const erros = [];
  page.on('console', (mensagem) => {
    if (mensagem.type() === 'error') erros.push(mensagem.text());
  });
  page.on('pageerror', (erro) => erros.push(`pageerror: ${erro.message}`));
  await page.addInitScript(ponte, { nome, ehDona });
  await page.goto(PAGINA);
  await page.fill('#join-address', `127.0.0.1:${servidor.port}`);
  await page.press('#join-address', 'Enter');
  await page.waitForSelector('#room-view:not(.hidden)');
  const boasVindas = await esperarMensagem(page, (mensagem) => mensagem.type === 'welcome');
  return { page, id: boasVindas.id, nome, erros };
}

async function transmitirTela(pessoa) {
  await pessoa.page.click('#btn-toggle-share');
  await pessoa.page.waitForSelector('#picker:not(.hidden) .src-card');
  await pessoa.page.click('#btn-go-live');
  await pessoa.page.waitForSelector('#btn-pause-share:not(.hidden)');
}

async function main() {
  const servidor = await createSignalingServer({ port: 0 });
  const browser = await chromium.launch();
  const pessoas = [];
  try {
    const ana = await abrirPessoa(browser, servidor, 'Ana', true);
    const bia = await abrirPessoa(browser, servidor, 'Bia', false);
    pessoas.push(ana, bia);
    await transmitirTela(ana);
    await esperarMensagem(ana.page, (mensagem) => (
      mensagem.type === 'view-state' && mensagem.from === bia.id && mensagem.kind === 'screen'
    ));

    await bia.page.evaluate((tileId) => {
      window.GoLive.tetoRecebido.escolher(tileId, '720p');
    }, `${ana.id}:screen`);

    const estado = await esperarMensagem(ana.page, (mensagem) => (
      mensagem.type === 'view-state'
      && mensagem.from === bia.id
      && mensagem.kind === 'screen'
      && mensagem.maxWidth === 1280
    ));
    if (estado.maxWidth !== 1280) throw new Error(`maxWidth esperado 1280, recebido ${estado.maxWidth}`);
    const erros = pessoas.flatMap((pessoa) => pessoa.erros);
    if (erros.length) throw new Error(`erro de pagina: ${erros.join(' | ')}`);
    console.log('teto-recebido: view-state de Bia para Ana com maxWidth 1280');
  } finally {
    await Promise.all(pessoas.map((pessoa) => pessoa.page.close()));
    await browser.close();
    await servidor.close();
  }
}

main().catch((erro) => {
  console.error(`teto-recebido: ${erro.message}`);
  process.exitCode = 1;
});
