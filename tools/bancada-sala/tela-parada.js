'use strict';

/* global window, document, requestAnimationFrame, HTMLCanvasElement */

/*
 * Tela parada com o servidor real e duas paginas separadas: Ana transmite,
 * Bia assiste, e a imagem da Ana deixa de mudar por 20 s.
 *
 * O caso real (logs de 2026-10-07 e spike de 2026-10-25): a captura do
 * Windows so entrega quadro quando a tela muda. Com o relay por canvas, tela
 * parada virava ZERO quadros no fio -- o vigia da Bia lia isso como "origem
 * parou de enviar video" e refazia a conexao, e a imagem ficava presa no
 * ultimo quadro borrado do movimento. A captura falsa daqui reproduz o mesmo
 * comportamento: captureStream(30) so emite quando o canvas muda.
 *
 * Passa se, com a imagem parada, quadros continuam chegando na Bia e o vigia
 * nao diagnostica "origem" nem pede reoferta -- e se, com o envio parado de
 * verdade (controle), o vigia ainda diagnostica "origem".
 *
 * PLAYWRIGHT_DIR=C:/.../playwright [PLAYWRIGHT_CANAL=msedge] node tools/bancada-sala/tela-parada.js
 */

const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const { createSignalingServer } = require('../../server/signaling-core');

const RAIZ = path.resolve(__dirname, '..', '..');
const PAGINA = `file://${path.join(RAIZ, 'src', 'renderer', 'index.html')}`;
const PARADA_MS = 20000;
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
      if (ehDona) mensagem.ownerToken = 'bancada-tela-parada';
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
  let pintando = true;
  const pintar = () => {
    if (!pintando) return;
    quadro += 1;
    contexto.fillStyle = `hsl(${(quadro * 3) % 360},60%,35%)`;
    contexto.fillRect(0, 0, canvas.width, canvas.height);
    contexto.fillStyle = '#fff';
    contexto.font = '64px sans-serif';
    contexto.fillText(`bancada ${quadro}`, 80, 360);
    requestAnimationFrame(pintar);
  };
  pintar();
  // Envio parado de verdade (encoder ou relay parado): o relay usa
  // captureStream(0), que so emite por requestFrame. A mesma injecao do
  // laboratorio (tools/lab, `__lab.pararEnvio`).
  let envioParado = false;
  const capturarOriginal = HTMLCanvasElement.prototype.captureStream;
  HTMLCanvasElement.prototype.captureStream = function captureStream(...args) {
    const fluxo = capturarOriginal.apply(this, args);
    for (const trilha of fluxo.getVideoTracks()) {
      const pedir = trilha.requestFrame?.bind(trilha);
      if (pedir) trilha.requestFrame = () => { if (!envioParado) pedir(); };
    }
    return fluxo;
  };
  window.__tela = {
    parar() { pintando = false; },
    pararEnvio() { envioParado = true; pintando = false; },
    retomar() { envioParado = false; if (!pintando) { pintando = true; pintar(); } },
  };
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
  const linhas = [];
  page.on('console', (mensagem) => {
    linhas.push({ em: Date.now(), texto: mensagem.text() });
    if (mensagem.type() === 'error') erros.push(mensagem.text());
  });
  page.on('pageerror', (erro) => erros.push(`pageerror: ${erro.message}`));
  await page.addInitScript(ponte, { nome, ehDona });
  await page.goto(PAGINA);
  await page.fill('#join-address', `127.0.0.1:${servidor.port}`);
  await page.press('#join-address', 'Enter');
  await page.waitForSelector('#room-view:not(.hidden)');
  const boasVindas = await esperarMensagem(page, (mensagem) => mensagem.type === 'welcome');
  return { page, id: boasVindas.id, nome, erros, linhas };
}

async function transmitirTela(pessoa) {
  await pessoa.page.click('#btn-toggle-share');
  await pessoa.page.waitForSelector('#picker:not(.hidden) .src-card');
  await pessoa.page.click('#btn-go-live');
  await pessoa.page.waitForSelector('#btn-pause-share:not(.hidden)');
}

/** Quadros exibidos pelo tile da tela de `donaId` na pagina de quem assiste
 * (o mesmo numero que o vigia do app le), ou -1 sem tile. */
function quadrosExibidos(page, donaId) {
  return page.evaluate((id) => {
    const video = document.getElementById(`tile-${id}`)?.querySelector('video');
    return video?.getVideoPlaybackQuality?.().totalVideoFrames ?? -1;
  }, String(donaId));
}

async function esperarImagemAndando(page, donaId, tempoMs) {
  const fim = Date.now() + tempoMs;
  let antes = await quadrosExibidos(page, donaId);
  while (Date.now() < fim) {
    await espera(1000);
    const agora = await quadrosExibidos(page, donaId);
    if (antes >= 0 && agora > antes + 5) return agora;
    antes = agora;
  }
  throw new Error('a imagem da Ana nao andou na Bia');
}

async function main() {
  const servidor = await createSignalingServer({ port: 0 });
  const canal = process.env.PLAYWRIGHT_CANAL;
  const browser = await chromium.launch(canal ? { channel: canal } : {});
  const pessoas = [];
  const falhas = [];
  try {
    const ana = await abrirPessoa(browser, servidor, 'Ana', true);
    const bia = await abrirPessoa(browser, servidor, 'Bia', false);
    pessoas.push(ana, bia);
    await transmitirTela(ana);
    await esperarImagemAndando(bia.page, ana.id, 30000);
    // O vigia olha a cada 2 s: a folga garante que ele ja viu imagem.
    await espera(5000);

    const inicio = Date.now();
    const quadrosAntes = await quadrosExibidos(bia.page, ana.id);
    await ana.page.evaluate(() => window.__tela.parar());
    console.log(`tela-parada: imagem da Ana parada por ${PARADA_MS / 1000}s`);
    await espera(PARADA_MS);
    const quadrosDurante = (await quadrosExibidos(bia.page, ana.id)) - quadrosAntes;
    const fim = Date.now();
    await ana.page.evaluate(() => window.__tela.retomar());
    await esperarImagemAndando(bia.page, ana.id, 15000);

    const naJanela = bia.linhas.filter((l) => l.em >= inicio && l.em <= fim).map((l) => l.texto);
    const origem = naJanela.filter((t) => /origem parou de enviar video/.test(t));
    const reoferta = naJanela.filter((t) => /pedindo pra refazer a conexao/.test(t));
    console.log(`tela-parada: ${quadrosDurante} quadros exibidos na Bia com a imagem parada`);
    // Repeticao de ~5 quadros/s: 20 s parados dao ~100. A metade ja prova
    // que o fio nao ficou mudo (antes da correcao: 0).
    // Negativo: o tile foi recriado (o contador recomeca), sinal de reoferta.
    if (quadrosDurante < 0) falhas.push('o tile da Ana foi recriado com a imagem parada (contador de quadros recomecou)');
    else if (quadrosDurante < PARADA_MS / 1000 * 2) falhas.push(`so ${quadrosDurante} quadros chegaram com a imagem parada`);
    if (origem.length) falhas.push(`vigia diagnosticou "origem" com a imagem parada: ${origem[0].slice(0, 220)}`);
    if (reoferta.length) falhas.push(`vigia pediu reoferta com a imagem parada: ${reoferta[0].slice(0, 220)}`);

    // Controle: o vigia continua enxergando um envio parado de verdade. Sem
    // isto, "nenhum diagnostico" acima tambem passaria com o vigia cego.
    await espera(5000);
    const inicioEnvio = Date.now();
    await ana.page.evaluate(() => window.__tela.pararEnvio());
    console.log('tela-parada: envio da Ana parado (controle)');
    const fimEnvio = Date.now() + 20000;
    let viuOrigem = false;
    while (!viuOrigem && Date.now() < fimEnvio) {
      await espera(500);
      viuOrigem = bia.linhas.some((l) => l.em >= inicioEnvio && /origem parou de enviar video/.test(l.texto));
    }
    await ana.page.evaluate(() => window.__tela.retomar());
    if (!viuOrigem) falhas.push('com o envio parado de verdade, o vigia nao diagnosticou "origem" em 20 s');
    else console.log('tela-parada: com o envio parado, o vigia diagnosticou "origem"');
    await esperarImagemAndando(bia.page, ana.id, 30000);

    const erros = pessoas.flatMap((pessoa) => pessoa.erros);
    if (erros.length) falhas.push(`erro de pagina: ${erros.join(' | ')}`);
  } finally {
    await Promise.all(pessoas.map((pessoa) => pessoa.page.close()));
    await browser.close();
    await servidor.close();
  }
  if (falhas.length) throw new Error(falhas.join('; '));
  console.log('tela-parada: tela parada segue no fio, envio parado ainda e diagnosticado');
}

main().catch((erro) => {
  console.error(`tela-parada: ${erro.message}`);
  process.exitCode = 1;
});
