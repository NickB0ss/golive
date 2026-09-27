'use strict';

/* global document, getComputedStyle, window */

/*
 * Bancada das telas fora da sala, sem Electron nem servidor.
 *
 * PLAYWRIGHT_DIR=C:/.../playwright node tools/bancada-telas/rodar.js
 * PLAYWRIGHT_DIR=C:/.../playwright node tools/bancada-telas/rodar.js --sem-prints
 */

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');

const RAIZ = path.resolve(__dirname, '..', '..');
const PAGINA = `file://${path.join(RAIZ, 'src', 'renderer', 'index.html')}`;
const PRINTS = path.join(RAIZ, 'docs', 'prints', '2026-09-2x-estudio');
const SEM_PRINTS = process.argv.includes('--sem-prints');
const VISTAS = [
  { largura: 1366, altura: 768 },
  { largura: 1440, altura: 900 },
];
const TEMAS = ['estudio', 'paper'];
const SECOES = ['profile', 'appearance', 'voice', 'stats'];
const falhas = [];
const resultados = [];

function conferir(nome, passou, detalhe = '') {
  resultados.push({ nome, passou, detalhe });
  if (!passou) falhas.push(`${nome}${detalhe ? `: ${detalhe}` : ''}`);
}

function ponte() {
  const fonte = {
    id: 'screen:bancada',
    name: 'Tela de bancada',
    thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
      + 'AAAADUlEQVQIHWP4z8DwHwAFgAI/ScL2uQAAAABJRU5ErkJggg==',
    isScreen: true,
    resolution: '1280×720',
    width: 1280,
    height: 720,
  };
  window.golive = new Proxy({}, {
    get: (_, chave) => {
      if (chave === 'getVersion') return async () => '0.21.0';
      if (chave === 'getNetworkAddress') return async () => ({ address: '26.114.8.201', kind: 'radmin' });
      if (chave === 'listSources') return async () => [fonte];
      if (chave === 'selectSource') return async () => null;
      if (chave === 'win') return { show() {}, minimize() {}, maximize() {}, close() {} };
      if (String(chave).startsWith('on')) return () => {};
      return async () => null;
    },
  });
}

function salas(quantidade) {
  return Array.from({ length: quantidade }, (_, indice) => ({
    address: `26.114.8.${indice + 10}:49152`,
    name: `Sala ${String(indice + 1).padStart(2, '0')}`,
    hostName: `Pessoa ${indice + 1}`,
    peers: (indice % 4) + 1,
    protected: indice % 3 === 0,
    version: '0.21.0',
  }));
}

async function abrirPagina(browser) {
  const page = await browser.newPage({ viewport: { width: VISTAS[0].largura, height: VISTAS[0].altura } });
  const erros = [];
  page.on('console', (mensagem) => {
    if (mensagem.type() === 'error') erros.push(mensagem.text());
  });
  page.on('pageerror', (erro) => erros.push(`pageerror: ${erro.message}`));
  await page.addInitScript(ponte);
  await page.goto(PAGINA);
  await page.waitForFunction(() => Boolean(window.GoLive?.ui?.rooms?.render));
  return { page, erros };
}

async function montarLobby(page, quantidade) {
  await page.evaluate((itens) => {
    window.GoLive.ui.settings.close();
    window.GoLive.ui.rooms.render({
      onSelect() {},
      activeAddress: null,
      liveRooms: itens,
      isOnCooldown: () => false,
      appVersion: '0.21.0',
    });
  }, salas(quantidade));
  await page.waitForFunction(() => document.querySelector('#settings-modal')?.classList.contains('hidden'));
  await page.waitForFunction((esperado) => (
    document.querySelectorAll('#room-list-live .room-row').length === esperado
  ), quantidade);
}

async function montarConfiguracoes(page) {
  await page.evaluate(() => {
    const config = {
      name: 'Bancada',
      avatar: null,
      camera: {},
      liveNotifyEnabled: true,
      soundsEnabled: true,
      theme: { preset: 'estudio' },
      themes: [],
    };
    window.GoLive.ui.settings.open(config, {
      getConfig: () => config,
      getRecentSounds: () => [],
      onAvatarChange: async () => {},
      onCameraDeviceChange() {},
      onLiveNotifyChange() {},
      onNameChange() {},
      onSoundsChange() {},
      onTestSounds: async () => {},
      onThemeChange() {},
      onThemesChange() {},
      onToast() {},
    });
  });
  await page.waitForSelector('#settings-modal:not(.hidden)');
}

async function montarSeletor(page) {
  await page.evaluate(() => {
    window.GoLive.ui.picker.open({
      allowAnnotations: false,
      nativeAudioAvailable: true,
      onGoLive: async () => {},
      onQualityChange() {},
      quality: { preset: '1080p60', bitrate: 12_000_000 },
    });
  });
  await page.waitForSelector('#picker:not(.hidden) .source-card');
}

async function montarDialogo(page, estado) {
  await page.evaluate((nome) => {
    if (nome === 'criar') {
      window.GoLive.ui.dialogs.openCreateRoom({ onConfirm: async () => {} });
    } else if (nome === 'entrar') {
      window.GoLive.ui.dialogs.openJoinRoom({ address: 'ws://26.114.8.10:49152', onConnect: async () => {} });
    } else if (nome === 'confirmar') {
      window.GoLive.ui.dialogs.openConfirm({ title: 'Confirmar bancada', text: 'Texto de confirmação.' });
    }
  }, estado);
  const seletor = {
    criar: '#dialog-create-room',
    entrar: '#dialog-join-room',
    confirmar: '#dialog-confirm',
  }[estado];
  await page.waitForSelector(`${seletor}:not(.hidden)`);
}

async function montarDialogoTexto(page) {
  await montarConfiguracoes(page);
  await page.locator('.settings-cat[data-cat="appearance"]').click();
  await page.locator('#theme-temp').press('ArrowRight');
  await page.locator('#btn-theme-save').click();
  await page.waitForSelector('#dialog-text:not(.hidden)');
}

async function conferirSemRolagemHorizontal(page, nome) {
  const medidas = await page.evaluate(() => ({
    documento: document.documentElement.scrollWidth,
    janela: window.innerWidth,
  }));
  conferir(`${nome}: sem rolagem horizontal`, medidas.documento <= medidas.janela,
    `${medidas.documento}px > ${medidas.janela}px`);
}

async function conferirControlesAcessiveis(page, nome) {
  const problemas = await page.evaluate(() => {
    const camadaAtiva = () => {
      const dialogo = [...document.querySelectorAll('.modal:not(.hidden), .dialog:not(.hidden)')]
        .find((elemento) => getComputedStyle(elemento).display !== 'none');
      if (dialogo) return dialogo;
      for (const seletor of ['#picker:not(.hidden)', '#settings-modal:not(.hidden)']) {
        const elemento = document.querySelector(seletor);
        if (elemento) return elemento;
      }
      return document.body;
    };
    const visivel = (elemento) => {
      const estilo = getComputedStyle(elemento);
      const caixa = elemento.getBoundingClientRect();
      return !elemento.closest('.hidden') && estilo.display !== 'none' && estilo.visibility !== 'hidden'
        && caixa.width > 0 && caixa.height > 0 && caixa.left >= 0 && caixa.right <= window.innerWidth
        && caixa.top >= 0 && caixa.bottom <= window.innerHeight;
    };
    const nomeDoControle = (elemento) => {
      if (elemento.getAttribute('aria-label') || elemento.getAttribute('aria-labelledby')
        || elemento.getAttribute('title')) return true;
      if (elemento.labels?.length || elemento.closest('label')) return true;
      return Boolean(elemento.textContent.trim());
    };
    return [...camadaAtiva().querySelectorAll('button, input, select, textarea')]
      .filter(visivel)
      .flatMap((elemento) => {
        const rotulo = elemento.closest('label') || elemento.labels?.[0];
        const alvoVisual = rotulo || elemento;
        const caixa = alvoVisual.getBoundingClientRect();
        const ponto = document.elementFromPoint(caixa.left + caixa.width / 2, caixa.top + caixa.height / 2);
        const coberto = !ponto || !(ponto === alvoVisual || alvoVisual.contains(ponto));
        const id = elemento.id || elemento.outerHTML.slice(0, 80);
        const saida = [];
        if (!nomeDoControle(elemento)) saida.push(`${id} sem nome acessível`);
        if (coberto) saida.push(`${id} coberto por ${ponto?.id || ponto?.tagName || 'nada'}`);
        return saida;
      });
  });
  conferir(`${nome}: controles nomeados e descobertos`, problemas.length === 0, problemas.join(' | '));
}

async function tirarPrint(page, estado, tema, vista) {
  if (SEM_PRINTS) return;
  fs.mkdirSync(PRINTS, { recursive: true });
  const largura = `${vista.largura}x${vista.altura}`;
  const arquivo = `telas-${estado}-${tema}-${largura}.png`;
  await page.screenshot({ path: path.join(PRINTS, arquivo), fullPage: true });
}

/** Modais entram e saem com transicao: medir ou fotografar no meio dela pega
 * o anterior ainda por cima. Animacoes infinitas (pulso, spinner) nao contam. */
async function esperarAnimacoes(page) {
  await page.waitForFunction(() => document.getAnimations().every((animacao) => (
    animacao.playState !== 'running' || !Number.isFinite(animacao.effect?.getComputedTiming().endTime)
  )));
}

async function conferirEstado(page, estado, tema, vista) {
  const nome = `${estado} ${tema} ${vista.largura}×${vista.altura}`;
  await esperarAnimacoes(page);
  await conferirSemRolagemHorizontal(page, nome);
  await conferirControlesAcessiveis(page, nome);
  await tirarPrint(page, estado, tema, vista);
}

async function conferirConfiguracoes(page, tema, vista) {
  await page.locator('#titlebar').evaluate((titulo) => {
    titulo.hidden = false;
  });
  await montarConfiguracoes(page);
  for (const secao of SECOES) {
    await page.locator(`.settings-cat[data-cat="${secao}"]`).click();
    await page.waitForFunction((categoria) => {
      const painel = document.querySelector(`#settings-${categoria}`);
      return painel && !painel.classList.contains('hidden');
    }, secao);
    await conferirEstado(page, `config-${secao}`, tema, vista);
  }
  const estrutura = await page.evaluate(() => {
    const modal = document.querySelector('#settings-modal').getBoundingClientRect();
    const titulo = document.querySelector('#titlebar').getBoundingClientRect();
    const lobby = document.querySelector('#lobby-view');
    const sala = document.querySelector('#room-view');
    return {
      ocupaJanela: modal.top >= titulo.bottom - 1 && modal.width >= window.innerWidth - 1
        && modal.height >= window.innerHeight - titulo.bottom - 1,
      lobbyExiste: Boolean(lobby),
      lobbyInerte: lobby?.inert,
      lobbyInvisivel: Boolean(lobby) && getComputedStyle(lobby).visibility === 'hidden',
      salaExiste: Boolean(sala),
      salaInerte: sala?.inert,
      salaInvisivel: Boolean(sala) && getComputedStyle(sala).visibility === 'hidden',
      salaMensuravel: sala?.getBoundingClientRect().width > 0,
    };
  });
  conferir(`configurações ocupam a janela abaixo da faixa ${tema} ${vista.largura}×${vista.altura}`,
    estrutura.ocupaJanela, JSON.stringify(estrutura));
  // A vista anterior fica fora do Tab (inert) e invisivel, mas continua no
  // layout: display:none zeraria as medidas que a Mesa usa para o view-state.
  const lobbyIsolado = estrutura.lobbyInerte && estrutura.lobbyInvisivel;
  const salaIsolada = estrutura.salaInerte && estrutura.salaInvisivel && estrutura.salaMensuravel;
  conferir(`configurações isolam a vista anterior sem desmontar a sala ${tema} ${vista.largura}×${vista.altura}`,
    estrutura.lobbyExiste && estrutura.salaExiste && (lobbyIsolado || salaIsolada),
    JSON.stringify(estrutura));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#settings-modal')?.classList.contains('hidden'));
  conferir(`Esc volta das Configurações ${tema} ${vista.largura}×${vista.altura}`,
    await page.locator('#settings-modal').evaluate((elemento) => elemento.classList.contains('hidden')));
  await page.locator('#titlebar').evaluate((titulo) => {
    titulo.hidden = true;
  });
}

async function conferirDialogo(page, estado, primeiroCampo, tema, vista) {
  await montarDialogo(page, estado);
  const foco = await page.evaluate(() => document.activeElement?.id || '');
  conferir(`${estado}: foco no primeiro campo ${tema} ${vista.largura}×${vista.altura}`,
    foco === primeiroCampo, `foco em ${foco || 'nenhum'}`);
  await conferirEstado(page, `dialogo-${estado}`, tema, vista);
  await page.keyboard.press('Escape');
  const seletor = { criar: '#dialog-create-room', entrar: '#dialog-join-room', confirmar: '#dialog-confirm' }[estado];
  await page.waitForFunction((alvo) => document.querySelector(alvo)?.classList.contains('hidden'), seletor);
  conferir(`${estado}: Esc fecha diálogo ${tema} ${vista.largura}×${vista.altura}`, true);
}

async function conferirDialogoTexto(page, tema, vista) {
  await montarDialogoTexto(page);
  const foco = await page.evaluate(() => document.activeElement?.id || '');
  conferir(`texto: foco no primeiro campo ${tema} ${vista.largura}×${vista.altura}`,
    foco === 'dialog-text-input', `foco em ${foco || 'nenhum'}`);
  await conferirEstado(page, 'dialogo-texto', tema, vista);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#dialog-text')?.classList.contains('hidden'));
  conferir(`texto: Esc fecha diálogo ${tema} ${vista.largura}×${vista.altura}`, true);
  await page.evaluate(() => window.GoLive.ui.settings.close());
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
  const browser = await chromium.launch();
  const { page, erros } = await abrirPagina(browser);
  try {
    for (const vista of VISTAS) {
      await page.setViewportSize({ width: vista.largura, height: vista.altura });
      for (const tema of TEMAS) {
        await page.evaluate((preset) => window.GoLive.theme.apply({ preset }), tema);
        for (const quantidade of [0, 3, 12]) {
          await montarLobby(page, quantidade);
          await conferirEstado(page, `lobby-${quantidade}`, tema, vista);
        }
        await montarSeletor(page);
        await conferirEstado(page, 'seletor', tema, vista);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.querySelector('#picker')?.classList.contains('hidden'));
        conferir(`seletor: Esc fecha diálogo ${tema} ${vista.largura}×${vista.altura}`, true);
        await conferirConfiguracoes(page, tema, vista);
        await conferirDialogo(page, 'criar', 'in-room-name', tema, vista);
        await conferirDialogo(page, 'entrar', 'in-server', tema, vista);
        await conferirDialogo(page, 'confirmar', 'btn-confirm-cancel', tema, vista);
        await conferirDialogoTexto(page, tema, vista);
      }
    }
    conferir('página sem erros de console', erros.length === 0, erros.join(' | '));
  } finally {
    await page.close();
    await browser.close();
  }
  relatar();
  process.exitCode = falhas.length ? 1 : 0;
}

main().catch((erro) => {
  conferir('execução da bancada', false, erro.message);
  relatar();
  process.exitCode = 1;
});
