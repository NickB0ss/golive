'use strict';

/* global document, requestAnimationFrame, window */

/*
 * Bancada da sala Estudio com servidor real e tres paginas independentes.
 *
 * PLAYWRIGHT_DIR=C:/.../playwright node tools/bancada-sala/rodar.js
 * PLAYWRIGHT_DIR=C:/.../playwright node tools/bancada-sala/rodar.js --sem-prints
 */

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const { createSignalingServer } = require('../../server/signaling-core');

const RAIZ = path.resolve(__dirname, '..', '..');
const PAGINA = `file://${path.join(RAIZ, 'src', 'renderer', 'index.html')}`;
const PRINTS = path.join(RAIZ, 'docs', 'prints', '2026-09-2x-estudio');
const SEM_PRINTS = process.argv.includes('--sem-prints');
const falhas = [];
const resultados = [];

function conferir(nome, passou, detalhe = '') {
  resultados.push({ nome, passou, detalhe });
  if (!passou) falhas.push(`${nome}${detalhe ? `: ${detalhe}` : ''}`);
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
      if (ehDona) mensagem.ownerToken = 'bancada-sala';
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
          // Ruido fora do protocolo nao importa aqui.
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
    contexto.fillStyle = quadro % 2 ? '#17324d' : '#254d73';
    contexto.fillRect(0, 0, canvas.width, canvas.height);
    requestAnimationFrame(pintar);
  };
  pintar();
  const fluxo = () => canvas.captureStream(30);
  navigator.mediaDevices.getDisplayMedia = async () => fluxo();
  navigator.mediaDevices.getUserMedia = async () => fluxo();
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
  const fonte = predicado.toString();
  await page.waitForFunction((codigo) => {
    const confere = new Function('mensagem', `return (${codigo})(mensagem);`);
    return window.__caixa.some(confere);
  }, fonte, { timeout: tempoMs });
  return page.evaluate((codigo) => {
    const confere = new Function('mensagem', `return (${codigo})(mensagem);`);
    return window.__caixa.find(confere);
  }, fonte);
}

async function abrirPessoa(browser, servidor, nome, ehDona) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const erros = [];
  page.on('console', (mensagem) => {
    if (mensagem.type() === 'error') erros.push(mensagem.text());
  });
  page.on('pageerror', (erro) => erros.push(`pageerror: ${erro.message}`));
  await page.addInitScript(ponte, { nome, ehDona });
  await page.goto(PAGINA);
  await page.click('#btn-join-address');
  await page.fill('#in-server', `ws://127.0.0.1:${servidor.port}`);
  await page.click('#btn-connect');
  await page.waitForSelector('#room-view:not(.hidden)');
  const boasVindas = await esperarMensagem(page, (mensagem) => mensagem.type === 'welcome');
  return { page, id: boasVindas.id, nome, erros };
}

async function transmitirTela(pessoa) {
  await pessoa.page.click('#btn-toggle-share');
  await pessoa.page.waitForSelector('#picker:not(.hidden) .source-card');
  await pessoa.page.click('#btn-go-live');
  await pessoa.page.waitForSelector('#btn-pause-share:not(.hidden)');
}

async function transmitirCamera(pessoa) {
  await pessoa.page.click('#btn-toggle-camera');
  await pessoa.page.waitForFunction(() => (
    document.querySelector('#btn-toggle-camera')?.getAttribute('aria-pressed') === 'true'
  ));
}

async function conferirColunas(page, largura, altura) {
  await page.setViewportSize({ width: largura, height: altura });
  await page.waitForFunction(() => {
    const pessoas = document.querySelector('#people-panel');
    const grade = document.querySelector('#grid');
    const chat = document.querySelector('#chat-panel');
    return pessoas && grade && chat && pessoas.getBoundingClientRect().width > 0
      && grade.getBoundingClientRect().width > 0 && chat.getBoundingClientRect().width > 0;
  });
  const medidas = await page.evaluate(() => {
    const caixa = (seletor) => document.querySelector(seletor).getBoundingClientRect();
    const pessoas = caixa('#people-panel');
    const grade = caixa('#grid');
    const chat = caixa('#chat-panel');
    return {
      pessoas: pessoas.width,
      grade: grade.width,
      chat: chat.width,
      larguraDocumento: document.documentElement.scrollWidth,
      larguraJanela: window.innerWidth,
    };
  });
  const esperado = largura === 1440
    ? Math.abs(medidas.pessoas - 232) <= 1 && Math.abs(medidas.chat - 304) <= 1
    : medidas.pessoas > 0 && medidas.chat > 0;
  conferir(`colunas ${largura}×${altura}`, esperado && medidas.grade > 0, JSON.stringify(medidas));
  conferir(`sem rolagem horizontal ${largura}×${altura}`,
    medidas.larguraDocumento <= medidas.larguraJanela + 1,
    `${medidas.larguraDocumento}px > ${medidas.larguraJanela}px`);
}

async function conferirRecolhimentoAutomatico(page) {
  await page.setViewportSize({ width: 1279, height: 768 });
  await page.waitForFunction(() => document.body.dataset.pessoas === 'recolhido');
  const pessoasRecolhidas = await page.evaluate(() => document.body.dataset.pessoas === 'recolhido');
  conferir('pessoas recolhem abaixo de 1280', pessoasRecolhidas);
  await page.setViewportSize({ width: 1099, height: 768 });
  await page.waitForFunction(() => document.body.dataset.chat === 'recolhido');
  conferir('chat recolhe abaixo de 1100', await page.evaluate(() => document.body.dataset.chat === 'recolhido'));
}

async function conferirEscolhaManualPrevalece(page) {
  await page.setViewportSize({ width: 1099, height: 768 });
  await page.click('#btn-toggle-people');
  await page.click('#btn-toggle-side');
  const estado = await page.evaluate(() => ({
    pessoas: document.body.dataset.pessoas,
    chat: document.body.dataset.chat,
  }));
  conferir('escolha manual prevalece no recolhimento',
    estado.pessoas === 'aberto' && estado.chat === 'aberto', JSON.stringify(estado));
}

/** O app assiste sozinho a primeira tela ao vivo; com duas no ar, a outra
 * fica so na coluna, com o Assistir. `idsPorNome` mapeia nome -> peerId. */
async function assistirPelaPresenca(pessoa, idsPorNome) {
  const botao = pessoa.page.locator('.presenca .presenca-assistir').first();
  await botao.waitFor({ timeout: 15000 });
  const nome = await botao.evaluate((el) => el.closest('.presenca').querySelector('.presenca-nome').textContent);
  const id = idsPorNome[nome.trim()];
  await botao.click();
  const seletor = `#tile-${id}:not([hidden]) video`;
  const chegou = await pessoa.page.waitForFunction((sel) => document.querySelector(sel)?.videoWidth > 0, seletor, {
    timeout: 15000,
  }).then(() => true, () => false);
  // Na falha, o estado de cada tile diz se a tela nem veio ou veio escondida.
  const tiles = await pessoa.page.$$eval('#grid .tile', (els) => els.map((el) => (
    `${el.id}${el.hidden ? '[hidden]' : ''}:${el.querySelector('video')?.videoWidth ?? '-'}`
  )).join(' '));
  conferir('Assistir pela presença leva tela ao palco', chegou, `${nome.trim()} (${seletor}) tiles: ${tiles}`);
}

async function conferirVideoRecebeClique(page) {
  const resultadosVideo = await page.evaluate(() => [...document.querySelectorAll('#grid .tile video')].map((video) => {
    const caixa = video.getBoundingClientRect();
    const pontos = [
      [caixa.left + caixa.width / 2, caixa.top + caixa.height / 2],
      [caixa.left + 4, caixa.top + 4],
      [caixa.right - 4, caixa.top + 4],
      [caixa.left + 4, caixa.bottom - 4],
      [caixa.right - 4, caixa.bottom - 4],
    ];
    return pontos.every(([x, y]) => document.elementFromPoint(x, y) === video);
  }));
  conferir('vídeos recebem ponteiro no centro e cantos', resultadosVideo.length > 0 && resultadosVideo.every(Boolean));
}

async function abrirPopover(page, acao) {
  await page.locator(`.tile-bar-btn[data-acao="${acao}"]`).first().click();
  const popover = page.locator('.popover:visible').last();
  await popover.waitFor();
  return popover;
}

async function conferirPopoversOpacos(page) {
  const reacoes = await abrirPopover(page, 'reagir');
  const fundoReacoes = await reacoes.evaluate((elemento) => window.getComputedStyle(elemento).backgroundColor);
  conferir('reações abrem popover opaco', corOpaca(fundoReacoes), fundoReacoes);
  await page.keyboard.press('Escape');
  const menu = await abrirPopover(page, 'menu');
  const fundoMenu = await menu.evaluate((elemento) => window.getComputedStyle(elemento).backgroundColor);
  conferir('menu do vídeo abre popover opaco', corOpaca(fundoMenu), fundoMenu);
  conferir('menu do vídeo não tem Tela cheia', !(await menu.textContent()).includes('Tela cheia'));
  await page.keyboard.press('Escape');
}

function corOpaca(cor) {
  const rgba = cor.match(/^rgba?\(([^)]+)\)$/);
  if (!rgba) return false;
  const partes = rgba[1].split(',').map((parte) => Number(parte.trim()));
  return partes.length === 3 || partes[3] === 1;
}

async function abrirMenuDoTile(page, seletor) {
  const tile = page.locator(seletor).first();
  await tile.locator('.tile-bar-btn[data-acao="menu"]').click();
  const menu = page.locator('.popover:visible').last();
  await menu.waitFor();
  return menu;
}

async function conferirQualidadeNosMenus(ana, bia, caio) {
  const menuRemoto = await abrirMenuDoTile(caio.page, '.tile[data-kind="screen"]');
  conferir('qualidade aparece na tela de outra pessoa',
    (await menuRemoto.textContent()).includes('Qualidade que você recebe'));
  await menuRemoto.locator('.menu-item').filter({ hasText: 'Qualidade que você recebe' }).click();
  const opcao720 = caio.page.locator('.popover:visible .menu-item').filter({ hasText: /^720p$/ }).last();
  await opcao720.click();
  await esperarMensagem(ana.page, (mensagem) => (
    mensagem.type === 'view-state' && mensagem.from === caio.id && mensagem.kind === 'screen'
      && mensagem.maxWidth === 1280
  ));
  conferir('720p envia view-state maxWidth 1280', true);
  const menuProprio = await abrirMenuDoTile(ana.page, '.tile[data-kind="screen"]');
  conferir('qualidade não aparece na própria tela',
    !(await menuProprio.textContent()).includes('Qualidade que você recebe'));
  await ana.page.keyboard.press('Escape');
  const menuCamera = await abrirMenuDoTile(bia.page, '.tile[data-kind="camera"]');
  conferir('qualidade não aparece na câmera',
    !(await menuCamera.textContent()).includes('Qualidade que você recebe'));
  await bia.page.keyboard.press('Escape');
}

async function conferirErros(pessoas) {
  const erros = pessoas.flatMap((pessoa) => pessoa.erros.map((erro) => `${pessoa.nome}: ${erro}`));
  conferir('páginas sem erros de console', erros.length === 0, erros.join(' | '));
}

async function tirarPrint(page, largura, altura) {
  if (SEM_PRINTS) return;
  fs.mkdirSync(PRINTS, { recursive: true });
  await page.screenshot({ path: path.join(PRINTS, `sala-${largura}x${altura}.png`), fullPage: true });
}

function relatar() {
  console.table(resultados.map((resultado) => ({
    checagem: resultado.nome,
    resultado: resultado.passou ? 'passou' : 'falhou',
    detalhe: resultado.detalhe,
  })));
  console.log(`${resultados.length} checagens, ${falhas.length} falha(s)`);
  for (const falha of falhas) console.log(`FALHOU ${falha}`);
  if (!SEM_PRINTS) console.log(`prints em ${path.relative(RAIZ, PRINTS)}`);
}

async function main() {
  const servidor = await createSignalingServer({ port: 0, ownerToken: 'bancada-sala', log: () => {} });
  const browser = await chromium.launch();
  const pessoas = [];
  try {
    const ana = await abrirPessoa(browser, servidor, 'Ana', true);
    const bia = await abrirPessoa(browser, servidor, 'Bia', false);
    const caio = await abrirPessoa(browser, servidor, 'Caio', false);
    pessoas.push(ana, bia, caio);
    await transmitirTela(ana);
    await transmitirCamera(ana);
    await transmitirTela(bia);
    await transmitirCamera(bia);
    await conferirColunas(caio.page, 1440, 900);
    await tirarPrint(caio.page, 1440, 900);
    await conferirColunas(caio.page, 1366, 768);
    await tirarPrint(caio.page, 1366, 768);
    await conferirRecolhimentoAutomatico(caio.page);
    await conferirEscolhaManualPrevalece(caio.page);
    await caio.page.setViewportSize({ width: 1440, height: 900 });
    await assistirPelaPresenca(caio, { Ana: ana.id, Bia: bia.id });
    await conferirVideoRecebeClique(caio.page);
    await conferirPopoversOpacos(caio.page);
    await conferirQualidadeNosMenus(ana, bia, caio);
    await conferirErros(pessoas);
  } finally {
    await Promise.all(pessoas.map((pessoa) => pessoa.page.close()));
    await browser.close();
    await servidor.close();
  }
  relatar();
  process.exitCode = falhas.length ? 1 : 0;
}

main().catch((erro) => {
  conferir('execução da bancada', false, erro.message);
  relatar();
  process.exitCode = 1;
});
