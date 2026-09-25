'use strict';

/*
 * Os conteudos das janelas DENTRO da Mesa de verdade: sobe o servidor de
 * sinalizacao, abre o renderer (src/renderer/index.html) no Chromium do
 * Playwright com a ponte `window.golive` simulada (a mesma ideia de
 * tools/mesa-prints/harness.js, que injeta conteudos de teste proprios e por
 * isso nao serve aqui), poe uma janela de cada tipo pela Bia (cliente `ws`
 * cru) e confere que a Vista montou o conteudo -- carregando comum.js e
 * tabuleiro.js sozinhos, porque a Vista so carrega `<tipo>.js` -- e que
 * clique, digitacao e arrastar de peca funcionam la dentro.
 *
 *   node tools/bancada-janelas/mesa-real.js
 */

/* global window, document -- o codigo dentro de page.evaluate roda no navegador */

const path = require('node:path');
const WebSocket = require('ws');
const { createSignalingServer } = require('../../server/signaling-core');

const PW = process.env.PLAYWRIGHT_DIR || '/opt/node22/lib/node_modules/playwright';
const { chromium } = require(PW);

const RAIZ = path.resolve(__dirname, '..', '..');
const PAGINA = `file://${path.join(RAIZ, 'src', 'renderer', 'index.html')}`;
const PRINTS = path.join(RAIZ, 'docs', 'prints', '2026-09-24-janelas');
// Os tabuleiros primeiro: no "Ver tudo" eles ficam em cima, longe do mapa
// (canto de baixo a esquerda), onde o arraste de peca e conferido.
const TIPOS = ['damas', 'xadrez', 'velha', 'lig4', 'placar', 'cronometro', 'nota', 'lista', 'enquete', 'sorteio', 'dados', 'roleta'];

const espera = (ms) => new Promise((r) => { setTimeout(r, ms); });
const falhas = [];
let conferidos = 0;
function conferir(cond, msg) {
  conferidos++;
  if (!cond) falhas.push(msg);
}

async function pessoa(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const caixa = [];
  ws.on('message', (raw) => caixa.push(JSON.parse(raw.toString())));
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const p = {
    caixa,
    envia: (m) => ws.send(JSON.stringify(m)),
    async espera(pred, ms = 5000) {
      const fim = Date.now() + ms;
      while (Date.now() < fim) {
        const achou = caixa.find(pred);
        if (achou) return achou;
        await espera(25);
      }
      throw new Error(`${name}: esperou demais`);
    },
    fecha: () => ws.close(),
  };
  p.envia({ type: 'join', room: 'geral', name, clientId: `cli-${name}` });
  p.id = (await p.espera((m) => m.type === 'welcome')).id;
  return p;
}

const PONTE = () => {
  const enviar = WebSocket.prototype.send;
  WebSocket.prototype.send = function send(data) {
    if (typeof data === 'string' && data.includes('"type":"join"')) {
      const m = JSON.parse(data);
      m.ownerToken = 'bancada-janelas';
      m.name = 'Ana';
      return enviar.call(this, JSON.stringify(m));
    }
    return enviar.call(this, data);
  };
  window.golive = new Proxy({}, {
    get: (_, k) => {
      if (k === 'getNetworkAddress') return async () => ({ address: '26.114.8.201', kind: 'radmin' });
      if (k === 'getVersion') return async () => null;
      if (k === 'win') return { show() {} };
      if (String(k).startsWith('on')) return () => {};
      return async () => null;
    },
  });
};

async function main() {
  const servidor = await createSignalingServer({ port: 0, ownerToken: 'bancada-janelas', log: () => {} });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const erros = [];
    page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
    page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
    await page.addInitScript(PONTE);
    await page.goto(PAGINA);
    await page.click('#btn-join-address');
    await page.fill('#in-server', `ws://127.0.0.1:${servidor.port}`);
    await page.click('#btn-connect');
    await page.waitForSelector('#room-view:not(.hidden)');
    const bia = await pessoa(servidor.port, 'Bia');
    await page.click('#view-mesa');
    await page.waitForSelector('.mesa-loading[hidden]', { state: 'attached' });
    bia.envia({ type: 'mesa-view', on: true });
    await bia.espera((m) => m.type === 'mesa-sync');

    // Uma janela de cada tipo, em grade, no tamanho padrao do modulo.
    const tamanhos = await page.evaluate((tipos) => Object.fromEntries(tipos.map((t) => [t, window.GoLive.mesaModules[t].size])), TIPOS);
    const ids = {};
    let x = 120;
    let y = 120;
    let alt = 0;
    for (const t of TIPOS) {
      const s = tamanhos[t];
      if (x + s.w > 2600) { x = 120; y += alt + 40; alt = 0; }
      bia.envia({ type: 'mesa', op: 'add', win: { type: t, x, y, w: s.w, h: s.h } });
      const add = await bia.espera((m) => m.type === 'mesa' && m.op === 'add' && m.win.type === t);
      ids[t] = add.win.id;
      x += s.w + 40;
      alt = Math.max(alt, s.h);
    }
    await espera(800);
    const montados = await page.evaluate((tipos) => Object.fromEntries(tipos.map((t) => [t, !!document.querySelector(`.mesa-win[data-type="${t}"] .mesa-content > .mj`)])), TIPOS);
    for (const t of TIPOS) conferir(montados[t], `${t}: a Vista montou o conteudo (e nao o resumo)`);
    conferir(await page.evaluate(() => !!window.GoLive.mesaJanelasComum && !!window.GoLive.mesaJanelasTabuleiro), 'comum.js e tabuleiro.js vieram sozinhos');

    // Clique no + do placar vira act na sala.
    const win = (t) => page.locator(`.mesa-win[data-type="${t}"]`);
    await page.click('.mesa-zoom-btn[data-zoom="fit"]').catch(() => {});
    await espera(500);
    await win('placar').scrollIntoViewIfNeeded().catch(() => {});
    await win('placar').locator('.mj-time').first().locator('.mj-pm button').nth(1).click();
    const act = await bia.espera((m) => m.type === 'mesa' && m.op === 'act' && m.id === ids.placar).catch(() => null);
    conferir(act && act.action.kind === 'score', 'placar: o + manda act pela Vista');

    // Nota: digitar e sair do campo salva.
    const area = win('nota').locator('textarea');
    await area.click();
    await area.pressSequentially('pizza ou esfiha?', { delay: 10 });
    await area.evaluate((a) => a.blur());
    const set = await bia.espera((m) => m.type === 'mesa' && m.op === 'act' && m.id === ids.nota).catch(() => null);
    conferir(set && set.action.text === 'pizza ou esfiha?', 'nota: o texto vai para a sala');

    // Damas: Ana senta e arrasta uma pedra; a janela nao se mexe e nao ha vez pedida.
    await win('damas').getByRole('button', { name: /^Sentar/ }).first().click();
    await bia.espera((m) => m.type === 'mesa' && m.op === 'act' && m.id === ids.damas);
    bia.envia({ type: 'mesa', op: 'act', id: ids.damas, action: { kind: 'sit', seat: 1 } });
    await espera(300);
    const antes = await win('damas').boundingBox();
    const casa = (l, c) => win('damas').locator(`.mj-casa[data-l="${l}"][data-c="${c}"]`).boundingBox();
    const a = await casa(5, 2);
    const b = await casa(4, 3);
    if (process.env.DEPURAR) console.log(await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return `${e.tagName}.${e.className} <- ${e.parentElement.className}`; }, [a.x + a.width / 2, a.y + a.height / 2]));
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * i) / 8, a.y + a.height / 2 + ((b.y - a.y) * i) / 8);
      await espera(20);
    }
    await page.mouse.up();
    const lance = await bia.espera((m) => m.type === 'mesa' && m.op === 'act' && m.id === ids.damas && m.action.kind === 'move').catch(() => null);
    conferir(!!lance, 'damas: arrastar a pedra joga');
    const depois = await win('damas').boundingBox();
    if (process.env.DEPURAR) console.log(JSON.stringify({ antes, depois, a, b, lance, seats: bia.caixa.filter((m) => m.id === ids.damas).map((m) => m.action) }));
    conferir(Math.abs(antes.x - depois.x) < 1 && Math.abs(antes.y - depois.y) < 1, 'damas: arrastar a pedra nao move a janela');
    conferir(!bia.caixa.some((m) => m.type === 'mesa-grab' && m.id === ids.damas), 'damas: arrastar a pedra nao pede a vez da janela');

    await page.mouse.move(5, 5);
    await espera(400);
    await page.screenshot({ path: path.join(PRINTS, 'mesa-real-ver-tudo.png') });

    const errosReais = erros.filter((e) => !/ERR_FILE_NOT_FOUND|net::|favicon/.test(e));
    conferir(errosReais.length === 0, `erros na pagina: ${errosReais.join(' | ')}`);
    bia.fecha();
  } finally {
    await browser.close();
    await servidor.close();
  }
  console.log(`${conferidos} conferencias, ${falhas.length} falha(s)`);
  for (const f of falhas) console.log(`  FALHOU ${f}`);
  process.exitCode = falhas.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
