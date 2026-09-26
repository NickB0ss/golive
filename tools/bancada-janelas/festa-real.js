'use strict';

/*
 * As janelas da Festa (jam, sons, link) DENTRO da Mesa de verdade, como
 * mesa-real.js faz com as outras: sobe o servidor de sinalizacao, abre o
 * renderer no Chromium do Playwright com a ponte `window.golive` simulada
 * (aqui com `abrirLinkDaMesa` anotando os pedidos) e poe uma janela de cada
 * tipo pela Bia (cliente `ws` cru). Confere que a Vista monta o conteudo e,
 * com o servidor real (validate -> prepare -> reduce):
 *
 * - sons: o som da Bia toca no PC da Ana; o segundo som dela em 3 s e
 *   recusado pelo servidor; o `at` vem da hora do servidor;
 * - jam: o link vai para a sala; "Entrar no Jam" pede a ponte com 'jam';
 * - link: "Abrir no navegador" pergunta o dominio e so depois pede a ponte.
 *
 *   node tools/bancada-janelas/festa-real.js
 */

/* global window, document, AudioContext -- o codigo dentro de page.evaluate/addInitScript roda no navegador */

const path = require('node:path');
const WS = require('ws');
const { createSignalingServer } = require('../../server/signaling-core');

const PW = process.env.PLAYWRIGHT_DIR || '/opt/node22/lib/node_modules/playwright';
const { chromium } = require(PW);

const RAIZ = path.resolve(__dirname, '..', '..');
const PAGINA = `file://${path.join(RAIZ, 'src', 'renderer', 'index.html')}`;
const PRINTS = path.join(RAIZ, 'docs', 'prints', '2026-09-25-festa');
const TIPOS = ['jam', 'sons', 'link'];

const espera = (ms) => new Promise((r) => { setTimeout(r, ms); });
const falhas = [];
let conferidos = 0;
function conferir(cond, msg) {
  conferidos++;
  if (!cond) falhas.push(msg);
}

async function pessoa(port, name) {
  const ws = new WS(`ws://127.0.0.1:${port}`);
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
      m.ownerToken = 'bancada-festa';
      m.name = 'Ana';
      return enviar.call(this, JSON.stringify(m));
    }
    return enviar.call(this, data);
  };
  window.linksAbertos = [];
  window.sonsTocados = 0;
  const criar = AudioContext.prototype.createDynamicsCompressor;
  AudioContext.prototype.createDynamicsCompressor = function () {
    window.sonsTocados++;
    return criar.call(this);
  };
  window.golive = new Proxy({}, {
    get: (_, k) => {
      if (k === 'abrirLinkDaMesa') return async (tipo, url) => { window.linksAbertos.push([tipo, url]); return { ok: true }; };
      if (k === 'getNetworkAddress') return async () => ({ address: '26.114.8.201', kind: 'radmin' });
      if (k === 'getVersion') return async () => null;
      if (k === 'win') return { show() {} };
      if (String(k).startsWith('on')) return () => {};
      return async () => null;
    },
  });
};

async function main() {
  const servidor = await createSignalingServer({ port: 0, ownerToken: 'bancada-festa', log: () => {} });
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

    // No menu "Adicionar janela" (pelo registro).
    const noMenu = await page.evaluate((tipos) => {
      const reg = window.GoLive.mesaRegistry;
      const lista = reg.addable().map((m) => `${m.type}:${m.group}`);
      return tipos.map((t) => lista.find((x) => x.startsWith(`${t}:`)) || null);
    }, TIPOS);
    conferir(noMenu.join() === 'jam:assistir,sons:noite,link:ferramentas', `no menu, nos grupos certos (${noMenu.join()})`);

    const tamanhos = await page.evaluate((tipos) => Object.fromEntries(tipos.map((t) => [t, window.GoLive.mesaModules[t].size])), TIPOS);
    const ids = {};
    let x = 1400;
    for (const t of TIPOS) {
      const s = tamanhos[t];
      bia.envia({ type: 'mesa', op: 'add', win: { type: t, x, y: 1200, w: s.w, h: s.h } });
      const add = await bia.espera((m) => m.type === 'mesa' && m.op === 'add' && m.win.type === t);
      ids[t] = add.win.id;
      x += s.w + 40;
    }
    await espera(800);
    const montados = await page.evaluate((tipos) => Object.fromEntries(tipos.map((t) => [t, !!document.querySelector(`.mesa-win[data-type="${t}"] .mesa-content > .mj`)])), TIPOS);
    for (const t of TIPOS) conferir(montados[t], `${t}: a Vista montou o conteudo (e nao o resumo)`);
    await page.click('.mesa-zoom-btn[data-zoom="fit"]').catch(() => {});
    await espera(500);
    const win = (t) => page.locator(`.mesa-win[data-type="${t}"]`);

    // Sons: o som da Bia toca aqui; o segundo em 3 s o servidor recusa.
    const antes = Date.now();
    bia.envia({ type: 'mesa', op: 'act', id: ids.sons, action: { kind: 'play', sound: 'sino', at: 1, by: 'x' } });
    const eco = await bia.espera((m) => m.type === 'mesa' && m.op === 'act' && m.id === ids.sons);
    conferir(eco.action.at >= antes && eco.action.at <= Date.now() && eco.action.by === bia.id, `sons: at e by vem do servidor (${JSON.stringify(eco.action)})`);
    await espera(200);
    conferir((await page.evaluate(() => window.sonsTocados)) === 1, 'sons: o som da Bia tocou no PC da Ana');
    bia.envia({ type: 'mesa', op: 'act', id: ids.sons, action: { kind: 'play', sound: 'apito' } });
    const negado = await bia.espera((m) => m.type === 'mesa-denied' && m.id === ids.sons).catch(() => null);
    conferir(negado && negado.reason === 'invalid' && /Espere/.test(negado.detail || ''), `sons: o servidor recusa o segundo som em 3 s (${JSON.stringify(negado)})`);
    await win('sons').getByRole('button', { name: 'Tocar Buzina para todos' }).click();
    const daAna = await bia.espera((m) => m.type === 'mesa' && m.op === 'act' && m.id === ids.sons && m.action.sound === 'buzina').catch(() => null);
    conferir(!!daAna, 'sons: o clique da Ana vira act');
    await espera(200);
    conferir((await page.evaluate(() => window.sonsTocados)) === 2, 'sons: a Ana ouve o proprio som');

    // Jam: a Bia cola; a Ana entra pela ponte e marca "Entrei".
    bia.envia({ type: 'mesa', op: 'act', id: ids.jam, action: { kind: 'set', url: 'https://spotify.link/AbCdEf12345?si=1' } });
    await bia.espera((m) => m.type === 'mesa' && m.op === 'act' && m.id === ids.jam);
    await espera(200);
    await win('jam').getByRole('button', { name: 'Entrar no Jam' }).click();
    await espera(100);
    const abertos = await page.evaluate(() => window.linksAbertos.slice());
    conferir(JSON.stringify(abertos) === JSON.stringify([['jam', 'https://spotify.link/AbCdEf12345']]), `jam: Entrar pede a ponte (${JSON.stringify(abertos)})`);
    await win('jam').locator('button', { hasText: 'Entrei' }).click();
    const entrou = await bia.espera((m) => m.type === 'mesa' && m.op === 'act' && m.id === ids.jam && m.action.kind === 'join').catch(() => null);
    conferir(!!entrou, 'jam: Entrei vira act');

    // Link: pergunta o dominio antes de abrir.
    bia.envia({ type: 'mesa', op: 'act', id: ids.link, action: { kind: 'set', url: 'https://pt.wikipedia.org/wiki/Truco', title: 'Regras do truco' } });
    await bia.espera((m) => m.type === 'mesa' && m.op === 'act' && m.id === ids.link);
    await espera(200);
    await win('link').getByRole('button', { name: 'Abrir no navegador' }).click();
    conferir((await win('link').locator('.mj-link-pergunta').textContent()) === 'Abrir pt.wikipedia.org no seu navegador?', 'link: pergunta o dominio');
    await page.mouse.move(5, 5);
    await espera(300);
    await page.screenshot({ path: path.join(PRINTS, 'festa-mesa-real.png') });
    await win('link').locator('.mj-link-confirma').getByRole('button', { name: 'Abrir', exact: true }).click();
    await espera(100);
    const todos = await page.evaluate(() => window.linksAbertos.slice());
    conferir(todos.length === 2 && todos[1][0] === 'link' && todos[1][1] === 'https://pt.wikipedia.org/wiki/Truco', `link: Abrir pede a ponte (${JSON.stringify(todos)})`);

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
