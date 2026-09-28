'use strict';

/* global document, requestAnimationFrame, window */

/*
 * Bancada da sala Estudio com servidor real e tres paginas independentes.
 *
 * PLAYWRIGHT_DIR=C:/.../playwright node tools/bancada-sala/rodar.js
 */

const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const { createSignalingServer } = require('../../server/signaling-core');

const RAIZ = path.resolve(__dirname, '..', '..');
const PAGINA = `file://${path.join(RAIZ, 'src', 'renderer', 'index.html')}`;
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

async function transmitirCamera(pessoa) {
  await pessoa.page.click('#btn-toggle-camera');
  await pessoa.page.waitForFunction(() => (
    document.querySelector('#btn-toggle-camera')?.getAttribute('aria-pressed') === 'true'
  ));
}

/** O app assiste sozinho a primeira tela ao vivo; com duas no ar, a outra
 * fica so na coluna, com o Assistir. `idsPorNome` mapeia nome -> peerId. */
async function assistirPelaPresenca(pessoa, idsPorNome) {
  await pessoa.page.click('#btn-room-presence');
  const botao = pessoa.page.locator('#presence-pop .person').filter({
    has: pessoa.page.getByRole('button', { name: 'Assistir' }),
  }).getByRole('button', { name: 'Assistir' }).first();
  await botao.waitFor({ timeout: 15000 });
  const nome = await botao.evaluate((el) => el.closest('.person').querySelector('.person__name').textContent);
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
  // Todo popover da fonte nasce no HUD do proprio tile.
  const tile = page.locator('#grid .tile:not([hidden])').first();
  await tile.hover();
  await tile.locator(`[data-acao="${acao}"]`).click();
  const popover = page.locator('.pop:visible').last();
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
  await tile.hover();
  await tile.locator('[data-acao="menu"]').click();
  const menu = page.locator('.pop:visible').last();
  await menu.waitFor();
  return menu;
}

async function conferirQualidadeNosMenus(ana, bia, caio) {
  // Quem repassa uma tela (relay com folhas) nao tem teto: o submenu vem
  // bloqueado com o motivo. A arvore decide quem repassa, entao a bancada
  // procura um par espectador/tela livre em vez de fixar um.
  const pares = [[caio, bia], [ana, bia], [caio, ana], [bia, ana]];
  let escolhido = null;
  for (const [espectador, dona] of pares) {
    const seletor = `#tile-${dona.id}:not([hidden])`;
    if (!(await espectador.page.locator(seletor).count())) continue;
    const menu = await abrirMenuDoTile(espectador.page, seletor);
    const temQualidade = (await menu.textContent()).includes('Qualidade que você recebe');
    conferir(`qualidade aparece na tela de ${dona.nome} (${espectador.nome})`, temQualidade);
    if (!temQualidade) {
      await espectador.page.keyboard.press('Escape');
      continue;
    }
    await menu.locator('.menu__item').filter({ hasText: 'Qualidade que você recebe' }).click();
    const submenu = espectador.page.locator('.pop:visible').last();
    const opcao720 = submenu.locator('.menu__item').filter({ hasText: /^720p$/ });
    const existe = (await opcao720.count()) > 0;
    const bloqueado = !existe || (await opcao720.getAttribute('aria-disabled')) === 'true';
    if (bloqueado) {
      const texto = await submenu.textContent();
      const motivo = texto.includes('Você repassa esta tela para outras pessoas');
      const popovers = await espectador.page.locator('.pop:visible').count();
      conferir(`bloqueio mostra o motivo (${espectador.nome} repassa ${dona.nome})`, motivo,
        `${popovers} popover(s) visivel(is); ultimo: ${texto.replace(/\s+/g, ' ').trim().slice(0, 140)}`);
      await espectador.page.keyboard.press('Escape');
      await espectador.page.keyboard.press('Escape');
      continue;
    }
    escolhido = { espectador, dona };
    await opcao720.click();
    break;
  }
  if (escolhido) {
    // O view-state vai para quem serve a tela: a dona ou um relay no meio.
    const { espectador } = escolhido;
    const chegou = await Promise.any([ana, bia, caio].filter((p) => p !== espectador).map((p) => (
      esperarMensagem(p.page, new Function('mensagem', `return mensagem.type === 'view-state'
        && mensagem.from === ${JSON.stringify(espectador.id)} && /^screen/.test(mensagem.kind)
        && mensagem.maxWidth === 1280;`))
    ))).then(() => true, () => false);
    conferir('720p envia view-state maxWidth 1280', chegou, `${espectador.nome} vendo ${escolhido.dona.nome}`);
  } else {
    conferir('720p envia view-state maxWidth 1280', false, 'nenhum par espectador/tela sem bloqueio');
  }
  const menuProprio = await abrirMenuDoTile(ana.page, '#tile-me');
  conferir('qualidade não aparece na própria tela',
    !(await menuProprio.textContent()).includes('Qualidade que você recebe'));
  await ana.page.keyboard.press('Escape');
  const menuCamera = await abrirMenuDoTile(bia.page, `#tile-cam-${ana.id}`);
  conferir('qualidade não aparece na câmera',
    !(await menuCamera.textContent()).includes('Qualidade que você recebe'));
  await bia.page.keyboard.press('Escape');
}

/** Multi-fonte: a miniatura da tira sobe ao palco com um clique (e a de antes
 * desce); a tela cheia leva junto, em miniatura, quem estava a mostra. */
async function conferirDestaque(page) {
  const estado = () => page.evaluate(() => ({
    main: [...document.querySelectorAll('#grid .grid-main > .tile')].map((tile) => tile.id),
    strip: [...document.querySelectorAll('#grid .grid-strip > .tile')].map((tile) => tile.id),
  }));
  const antes = await estado();
  conferir('multi-fonte abre com tira de miniaturas', antes.strip.length > 0, JSON.stringify(antes));
  if (!antes.strip.length) return;
  const alvo = antes.strip[0];
  const caixa = await page.locator(`#${alvo} video`).boundingBox();
  await page.mouse.click(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
  await page.waitForTimeout(200);
  const depois = await estado();
  conferir('clique na miniatura a destaca sozinha no palco',
    depois.main.length === 1 && depois.main[0] === alvo && antes.main.every((id) => depois.strip.includes(id)),
    JSON.stringify(depois));
  const voltar = antes.main[0];
  await page.locator(`#${voltar}`).hover();
  await page.locator(`#${voltar} [data-acao="destacar"]`).click();
  await page.waitForTimeout(200);
  const troca = await estado();
  conferir('botão Destacar da miniatura troca o palco', troca.main.length === 1 && troca.main[0] === voltar, JSON.stringify(troca));
  await page.locator(`#${voltar}`).dblclick({ position: { x: 40, y: 200 } });
  await page.waitForTimeout(700);
  const miniaturas = await page.evaluate(() => document.querySelectorAll('.tile.fullscreen .pip-strip .pip-thumb').length);
  conferir('tela cheia leva as outras fontes em miniatura', miniaturas > 0, String(miniaturas));
  // Sai pelo mesmo gesto (o Esc e o da janela do Electron, que a bancada nao tem).
  await page.locator('.tile.fullscreen').dblclick({ position: { x: 40, y: 200 } });
  await page.waitForTimeout(500);
  conferir('duplo clique sai da tela cheia', await page.locator('.tile.fullscreen').count() === 0);
}

async function conferirErros(pessoas) {
  const erros = pessoas.flatMap((pessoa) => pessoa.erros.map((erro) => `${pessoa.nome}: ${erro}`));
  conferir('páginas sem erros de console', erros.length === 0, erros.join(' | '));
}

function relatar() {
  console.table(resultados.map((resultado) => ({
    checagem: resultado.nome,
    resultado: resultado.passou ? 'passou' : 'falhou',
    detalhe: resultado.detalhe,
  })));
  console.log(`${resultados.length} checagens, ${falhas.length} falha(s)`);
  for (const falha of falhas) console.log(`FALHOU ${falha}`);
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
    await caio.page.setViewportSize({ width: 1440, height: 900 });
    await assistirPelaPresenca(caio, { Ana: ana.id, Bia: bia.id });
    await conferirVideoRecebeClique(caio.page);
    await conferirDestaque(caio.page);
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
