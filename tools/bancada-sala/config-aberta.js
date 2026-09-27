'use strict';

/* global document, requestAnimationFrame, window */

/*
 * Prova a transmissao com Configuracoes aberta, no servidor real e em duas
 * paginas. A vista escondida precisa continuar com medidas para a Mesa.
 *
 * PLAYWRIGHT_DIR=C:/.../playwright node tools/bancada-sala/config-aberta.js
 */

const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const { createSignalingServer } = require('../../server/signaling-core');

const RAIZ = path.resolve(__dirname, '..', '..');
const PAGINA = `file://${path.join(RAIZ, 'src', 'renderer', 'index.html')}`;
const JANELA_MS = 3000;

function espera(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
      if (ehDona) mensagem.ownerToken = 'bancada-config-aberta';
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
          // Ruido fora do protocolo nao participa desta prova.
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
    contexto.fillStyle = quadro % 2 ? 'CanvasText' : 'Canvas';
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

async function esperarVideo(pessoa, id, seletor = `#tile-${id} video`) {
  const chegou = await pessoa.page.waitForFunction((alvo) => {
    const video = document.querySelector(alvo);
    return video && video.videoWidth > 0;
  }, seletor, { timeout: 5000 }).then(() => true, () => false);
  if (!chegou) {
    const tiles = await pessoa.page.$$eval('#grid .tile', (elementos) => elementos.map((elemento) => (
      `${elemento.id}:${elemento.hidden}:${elemento.querySelector('video')?.videoWidth || 0}`
    )).join(' '));
    throw new Error(`video nao chegou em ${seletor}; tiles ${tiles}`);
  }
  return seletor;
}

async function medirQuadros(page, seletor) {
  const antes = await page.$eval(seletor, (video) => video.getVideoPlaybackQuality().totalVideoFrames);
  await espera(JANELA_MS);
  const depois = await page.$eval(seletor, (video) => video.getVideoPlaybackQuality().totalVideoFrames);
  if (depois <= antes) throw new Error(`video sem quadros novos (${antes} -> ${depois})`);
  return { antes, depois };
}

async function abrirConfiguracoes(page) {
  await page.mouse.move(700, 100);
  await page.click('#btn-room-settings');
  await page.waitForSelector('#settings-modal:not(.hidden)');
}

async function reenviarViewState(page, origemId) {
  await page.evaluate((id) => {
    const tileId = `${id}:screen`;
    const escolha = window.GoLive.tetoRecebido.escolha(tileId);
    window.GoLive.tetoRecebido.escolher(tileId, escolha);
  }, origemId);
}

async function conferirVistaConfiguracoes(page, origem, aoVivo) {
  const estrutura = await page.evaluate(() => {
    const settings = document.querySelector('#settings-modal');
    const titulo = document.querySelector('#titlebar');
    const sala = document.querySelector('#room-view');
    const tally = document.querySelector('#settings-live-tally');
    const caixa = settings.getBoundingClientRect();
    const barra = titulo.getBoundingClientRect();
    return {
      abaixoDaFaixa: caixa.top >= barra.bottom - 1,
      folhaAncorada: caixa.width > 0 && caixa.width <= window.innerWidth
        && caixa.right >= window.innerWidth - 1 && caixa.bottom >= window.innerHeight - 1,
      salaInerte: sala.inert,
      salaMensuravel: sala.getBoundingClientRect().width > 0,
      focoNaSecao: document.activeElement === document.querySelector('.settings-cat.active'),
      tallyVisivel: !tally.classList.contains('hidden'),
    };
  });
  const tallyCorreto = estrutura.tallyVisivel === aoVivo;
  if (!estrutura.abaixoDaFaixa || !estrutura.folhaAncorada || !estrutura.salaInerte
    || !estrutura.salaMensuravel || !estrutura.focoNaSecao || !tallyCorreto) {
    throw new Error(`${origem}: vista de Configuracoes invalida ${JSON.stringify(estrutura)}`);
  }
}

async function conferirViewStates(ana, idBia, inicio, larguraAntes, naMesa) {
  const estados = await ana.page.evaluate(({ id, inicioCaixa }) => (
    window.__caixa.slice(inicioCaixa).filter((mensagem) => (
      mensagem.type === 'view-state' && mensagem.from === id && mensagem.kind === 'screen'
    ))
  ), { id: idBia, inicioCaixa: inicio });
  if (!estados.length) throw new Error('Bia não enviou view-state durante a medição');
  if (estados.some((estado) => estado.watching === false)) {
    throw new Error(`Bia enviou watching:false: ${JSON.stringify(estados)}`);
  }
  if (naMesa && estados.some((estado) => (
    !Number.isFinite(estado.maxWidth) || estado.maxWidth < larguraAntes
  ))) {
    throw new Error(`Bia perdeu o teto da Mesa: ${JSON.stringify(estados)}`);
  }
  if (!naMesa && estados.some((estado) => estado.maxWidth !== larguraAntes)) {
    throw new Error(`Bia mudou maxWidth na Transmissao: ${JSON.stringify(estados)}`);
  }
}

async function medirConfiguracoes(ana, bia, seletor, naMesa) {
  await abrirConfiguracoes(ana.page);
  console.log('config-aberta: Configurações de Ana abertas');
  await conferirVistaConfiguracoes(ana.page, 'Ana', true);
  const quadrosAna = await medirQuadros(bia.page, seletor);
  console.log('config-aberta: Bia recebeu com Configurações de Ana');
  const larguraAntes = await ana.page.evaluate((id) => {
    const estados = window.__caixa.filter((mensagem) => (
      mensagem.type === 'view-state' && mensagem.from === id && mensagem.kind === 'screen'
    ));
    return estados.at(-1)?.maxWidth ?? null;
  }, bia.id);
  if (naMesa && !Number.isFinite(larguraAntes)) {
    throw new Error('Bia nao tinha teto finito antes de abrir Configuracoes na Mesa');
  }
  const inicio = await ana.page.evaluate(() => window.__caixa.length);
  await abrirConfiguracoes(bia.page);
  // Reenvia pelo caminho da escolha para medir o estado com a vista aberta.
  await reenviarViewState(bia.page, ana.id);
  console.log('config-aberta: Configurações de Bia abertas');
  await conferirVistaConfiguracoes(bia.page, 'Bia', false);
  const quadrosBia = await medirQuadros(bia.page, seletor);
  console.log('config-aberta: Bia recebeu com Configurações próprias');
  await conferirViewStates(ana, bia.id, inicio, larguraAntes, naMesa);
  return { quadrosAna, quadrosBia };
}

async function abrirMesaComTela(bia, idAna) {
  await bia.page.evaluate(() => window.GoLive.ui.settings.close());
  const focoRestaurado = await bia.page.evaluate(() => document.activeElement?.id === 'btn-room-settings');
  if (!focoRestaurado) throw new Error('o foco não voltou ao botão que abriu Configurações');
  console.log('config-aberta: Configurações de Bia fechadas para a Mesa');
  await bia.page.click('#view-mesa');
  console.log('config-aberta: Bia pediu a vista Mesa');
  const montada = await bia.page.waitForSelector('.mesa-loading[hidden]', {
    state: 'attached',
    timeout: 5000,
  })
    .then(() => true, () => false);
  if (!montada) {
    const mensagens = await bia.page.evaluate(() => window.__caixa.filter((mensagem) => (
      mensagem.type === 'mesa-sync' || mensagem.type === 'mesa-viewers'
    )));
    throw new Error(`Mesa de Bia não sincronizou: ${JSON.stringify(mensagens)}`);
  }
  console.log('config-aberta: Mesa de Bia montada');
  const seletor = '.mesa-win .tile video';
  await esperarVideo(bia, idAna, seletor);
  console.log('config-aberta: Bia recebeu a tela na Mesa');
  return seletor;
}

async function main() {
  const servidor = await createSignalingServer({ port: 0 });
  const browser = await chromium.launch();
  const pessoas = [];
  try {
    const ana = await abrirPessoa(browser, servidor, 'Ana', true);
    const bia = await abrirPessoa(browser, servidor, 'Bia', false);
    pessoas.push(ana, bia);
    console.log('config-aberta: pessoas conectadas');
    await transmitirTela(ana);
    console.log('config-aberta: Ana transmitindo');
    const seletorTransmissao = await esperarVideo(bia, ana.id);
    console.log('config-aberta: Bia recebeu a tela');
    await esperarMensagem(ana.page, (mensagem) => (
      mensagem.type === 'view-state' && mensagem.from === bia.id && mensagem.kind === 'screen'
    ));
    const antesTransmissao = await medirQuadros(bia.page, seletorTransmissao);
    const transmissao = await medirConfiguracoes(ana, bia, seletorTransmissao, false);
    await ana.page.evaluate(() => window.GoLive.ui.settings.close());
    await bia.page.evaluate(() => window.GoLive.ui.settings.close());
    const seletorMesa = await abrirMesaComTela(bia, ana.id);
    const antesMesa = await medirQuadros(bia.page, seletorMesa);
    console.log('config-aberta: esperando o teto da Mesa');
    await esperarMensagem(ana.page, (mensagem) => (
      mensagem.type === 'view-state'
      && mensagem.from === bia.id
      && mensagem.kind === 'screen'
      && Number.isFinite(mensagem.maxWidth)
    ));
    const larguraAntes = await ana.page.evaluate((id) => {
      const estados = window.__caixa.filter((mensagem) => (
        mensagem.type === 'view-state'
        && mensagem.from === id
        && mensagem.kind === 'screen'
        && Number.isFinite(mensagem.maxWidth)
      ));
      return estados.at(-1)?.maxWidth || null;
    }, bia.id);
    console.log(`config-aberta: teto da Mesa ${larguraAntes}`);
    const mesa = await medirConfiguracoes(ana, bia, seletorMesa, true);
    const erros = pessoas.flatMap((pessoa) => pessoa.erros);
    if (erros.length) throw new Error(`erro de pagina: ${erros.join(' | ')}`);
    console.log(`config-aberta: transmissão ${JSON.stringify({ antesTransmissao, transmissao })}`);
    console.log(`config-aberta: Mesa ${JSON.stringify({ antesMesa, mesa, larguraAntes })}`);
  } finally {
    await Promise.all(pessoas.map((pessoa) => pessoa.page.close()));
    await browser.close();
    await servidor.close();
  }
}

main().catch((erro) => {
  console.error(`config-aberta: ${erro.message}`);
  process.exitCode = 1;
});
