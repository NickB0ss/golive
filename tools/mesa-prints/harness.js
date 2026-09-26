'use strict';

/*
 * Banco de prova da vista Mesa, sem Electron (spec 2026-09-24; plano de
 * passagem, "Ferramentas desta sessao").
 *
 * Sobe o servidor de sinalizacao DE VERDADE, abre o renderer no Chromium do
 * Playwright com a ponte `window.golive` simulada, entra na sala pelo
 * dialogo "Entrar por endereco" e poe outras pessoas na sala como clientes
 * `ws` crus (elas vao ao vivo, ligam camera, mexem o ponteiro e arrastam
 * janelas). As telas sao `canvas.captureStream` desenhando sem parar, postas
 * no palco pelo mesmo `ui.grid.showTile` que a track do WebRTC usaria.
 *
 * Uso: node tools/mesa-prints/harness.js [prints|checar|desempenho|tudo]
 *   PLAYWRIGHT=/caminho/do/playwright (padrao: o global do container)
 *
 * Nao entra no `npm test` (precisa de navegador).
 */

/* global window, document, requestAnimationFrame, getComputedStyle -- o codigo
   dentro de page.evaluate/addInitScript roda no navegador */

const path = require('node:path');
const fs = require('node:fs');
const WebSocket = require('ws');
const { createSignalingServer } = require('../../server/signaling-core');

const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright';
const { chromium } = require(PW);

const RAIZ = path.join(__dirname, '..', '..');
const PAGINA = `file://${path.join(RAIZ, 'src', 'renderer', 'index.html')}`;
const PRINTS = path.join(RAIZ, 'docs', 'prints', '2026-09-24-mesa');
const PRINTS_ACABAMENTO = path.join(RAIZ, 'docs', 'prints', '2026-09-25-acabamento');

const espera = (ms) => new Promise((r) => {
  setTimeout(r, ms);
});

/** Pessoa da sala falando o protocolo por um `ws` cru. */
async function pessoa(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const caixa = [];
  const ouvintes = new Set();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    caixa.push(m);
    for (const fn of ouvintes) fn(m);
  });
  await new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });
  const p = {
    name,
    id: null,
    caixa,
    envia: (msg) => ws.send(JSON.stringify(msg)),
    espera: (pred, ms = 5000) => new Promise((res, rej) => {
      const achou = caixa.find(pred);
      if (achou) {
        res(achou);
        return;
      }
      const t = setTimeout(() => {
        ouvintes.delete(fn);
        rej(new Error(`${name}: esperou demais por ${pred.toString()}`));
      }, ms);
      const fn = (m) => {
        if (pred(m)) {
          clearTimeout(t);
          ouvintes.delete(fn);
          res(m);
        }
      };
      ouvintes.add(fn);
    }),
    fecha: () => ws.close(),
  };
  p.envia({ type: 'join', room: 'geral', name, clientId: `cli-${name}` });
  p.id = (await p.espera((m) => m.type === 'welcome')).id;
  return p;
}

const PONTE = () => {
  // Quem abre o app no banco de prova e o lider: o 'join' leva o token de
  // quem criou a sala (no app ele vem do hostRoom).
  const enviar = WebSocket.prototype.send;
  WebSocket.prototype.send = function send(data) {
    if (typeof data === 'string' && data.includes('"type":"join"')) {
      const m = JSON.parse(data);
      m.ownerToken = 'banco-de-prova';
      return enviar.call(this, JSON.stringify(m));
    }
    return enviar.call(this, data);
  };
  const cbs = {};
  window.__cbs = cbs;
  window.golive = new Proxy({}, {
    get: (_, k) => {
      if (k === 'getNetworkAddress') return async () => ({ address: '26.114.8.201', kind: 'radmin' });
      if (k === 'getVersion') return async () => null;
      if (k === 'win') return { show() {} };
      if (String(k).startsWith('on')) return (cb) => { (cbs[k] ||= []).push(cb); };
      return async () => null;
    },
  });
};

/** Uma "tela" que se mexe: gradiente + um quadrado andando, a 30 qps. */
const FAKE_STREAM = ([rotulo, cor, w, h]) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  let t = 0;
  const pinta = () => {
    t += 1;
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#1D2F45');
    grad.addColorStop(1, cor);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.fillRect((t * 7) % w, h * 0.55, w * 0.08, w * 0.08);
    g.font = `${Math.round(h / 9)}px sans-serif`;
    g.fillText(rotulo, w * 0.05, h * 0.2);
    requestAnimationFrame(pinta);
  };
  pinta();
  (window.__canvases ||= []).push(c);
  return c.captureStream(30);
};

async function abrirSala(browser, port, { largura = 1440, altura = 900 } = {}) {
  const page = await browser.newPage({ viewport: { width: largura, height: altura } });
  const erros = [];
  page.on('console', (m) => {
    if (m.type() === 'error') erros.push(m.text());
  });
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  await page.addInitScript(PONTE);
  await page.goto(PAGINA);
  await page.click('#btn-join-address');
  await page.fill('#in-server', `ws://127.0.0.1:${port}`);
  await page.click('#btn-connect');
  await page.waitForSelector('#room-view:not(.hidden)');
  await page.waitForFunction(() => document.querySelector('#stage-member-count')?.textContent.includes('1'));
  return { page, erros };
}

async function mostrarTela(page, id, rotulo, cor, kind = 'screen', w = 1280, h = 720) {
  await page.evaluate(([fn, id, rotulo, cor, kind, w, h]) => {
    const fake = new Function(`return (${fn})`)();
    const stream = fake([rotulo, cor, w, h]);
    window.GoLive.ui.grid.showTile(id, rotulo, stream, { kind });
  }, [FAKE_STREAM.toString(), id, rotulo, cor, kind, w, h]);
}

/** Conteudo MINIMO so de teste (o de verdade e do time Janelas): uma nota
 * editavel e uma janela com iframe em branco, para medir. */
const CONTEUDO_DE_TESTE = () => {
  window.GoLive.mesaJanelas = window.GoLive.mesaJanelas || {};
  window.GoLive.mesaJanelas.nota = {
    type: 'nota',
    mount(el, api) {
      el.innerHTML = '<textarea aria-label="Nota" style="position:absolute;inset:32px 8px 8px;width:calc(100% - 16px);height:calc(100% - 40px);resize:none;border:0;border-radius:10px;background:var(--s2);color:var(--tx);font:15px/1.5 \'Work Sans\',sans-serif;padding:12px 14px"></textarea>';
      const ta = el.querySelector('textarea');
      ta.addEventListener('change', () => api.act({ kind: 'set', text: ta.value }));
      return {
        update(state) {
          if (document.activeElement !== ta) ta.value = state.text || '';
        },
        destroy() {},
        focus() { ta.focus(); },
      };
    },
  };
  window.GoLive.mesaJanelas.placar = {
    type: 'placar',
    mount(el) {
      el.innerHTML = '<iframe title="em branco" src="about:blank" style="position:absolute;inset:28px 0 0;width:100%;height:calc(100% - 28px);border:0;background:#fff"></iframe>';
      return { update() {}, destroy() {} };
    },
  };
};

async function prints(browser, port, s) {
  fs.mkdirSync(PRINTS, { recursive: true });
  const { page, erros } = await abrirSala(browser, port);
  await page.evaluate(CONTEUDO_DE_TESTE);
  const bia = await pessoa(port, 'Bia');
  const leo = await pessoa(port, 'Leo');
  const caio = await pessoa(port, 'Caio');
  await espera(300);

  // 1. Transmissao: o palco de hoje, com duas telas e uma camera.
  bia.envia({ type: 'broadcast-state', live: true });
  leo.envia({ type: 'broadcast-state', live: true });
  caio.envia({ type: 'camera-state', on: true });
  await espera(300);
  await mostrarTela(page, bia.id, 'Bia', '#4B5A3A');
  await mostrarTela(page, leo.id, 'Leo', '#3B2A63');
  await mostrarTela(page, `cam-${caio.id}`, 'Caio', '#173C4F', 'camera', 640, 480);
  await espera(600);
  await page.screenshot({ path: path.join(PRINTS, '01-transmissao.png') });
  const antes = await page.evaluate(() => ({ mesa: document.querySelectorAll('.mesa, .mesa-win').length }));

  // Tira todo mundo do ar para o print da mesa vazia.
  bia.envia({ type: 'broadcast-state', live: false });
  leo.envia({ type: 'broadcast-state', live: false });
  caio.envia({ type: 'camera-state', on: false });
  await espera(300);
  await page.click('#view-mesa');
  await page.waitForSelector('.mesa-loading[hidden]', { state: 'attached' });
  await espera(400);
  await page.screenshot({ path: path.join(PRINTS, '02-mesa-vazia.png') });

  // 3 telas + 1 camera + nota.
  const ana = await pessoa(port, 'Duda');
  for (const p of [bia, leo, ana]) p.envia({ type: 'broadcast-state', live: true });
  caio.envia({ type: 'camera-state', on: true });
  await espera(500);
  await mostrarTela(page, ana.id, 'Duda', '#5E3A2A');
  await page.mouse.click(1000, 300, { button: 'right' });
  await page.waitForSelector('.mesa-menu:not([hidden])');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('.mesa-menu [data-add="nota"]');
  await espera(200);
  await page.screenshot({ path: path.join(PRINTS, '04-menu-adicionar-janela.png') });
  await page.click('.mesa-menu [data-add="nota"]');
  await page.waitForSelector('.mesa-win[data-type="nota"]');
  await page.fill('.mesa-win[data-type="nota"] textarea', 'depois do CS: pizza ou esfiha?');
  await page.click('.mesa-zoom-btn[data-zoom="fit"]');
  await espera(700);
  // Pessoas na mesa, com o ponteiro.
  for (const p of [bia, leo]) {
    p.envia({ type: 'mesa-view', on: true });
    await p.espera((m) => m.type === 'mesa-sync');
  }
  await espera(200);
  const sync = bia.caixa.filter((m) => m.type === 'mesa-sync').pop();
  const alvo = sync.mesa.windows.find((w) => w.type === 'camera');
  bia.envia({ type: 'cursor', x: alvo.x + 40, y: alvo.y + 30 });
  leo.envia({ type: 'cursor', x: 1400, y: 1200 });
  await espera(250);
  await page.mouse.move(700, 120);
  await espera(150);
  await page.screenshot({ path: path.join(PRINTS, '03-mesa-3-telas-camera-nota.png') });

  // Alguem movendo: a Bia pega a camera e arrasta.
  bia.envia({ type: 'mesa-grab', id: alvo.id });
  await bia.espera((m) => m.type === 'mesa-grab' && m.id === alvo.id);
  for (let i = 1; i <= 6; i += 1) {
    const x = alvo.x + i * 30;
    const y = alvo.y + i * 20;
    bia.envia({ type: 'mesa-drag', id: alvo.id, x, y, w: alvo.w, h: alvo.h });
    bia.envia({ type: 'cursor', x: x + 40, y: y + 30 });
    await espera(60);
  }
  await espera(200);
  await page.screenshot({ path: path.join(PRINTS, '05-alguem-movendo.png') });

  // Menu de uma janela.
  const nota = await page.$('.mesa-win[data-type="nota"]');
  const caixa = await nota.boundingBox();
  await page.mouse.click(caixa.x + caixa.width / 2, caixa.y + 12, { button: 'right' });
  await espera(200);
  await page.screenshot({ path: path.join(PRINTS, '06-menu-da-janela.png') });
  await page.keyboard.press('Escape');

  // Menu "..." da sala (o primeiro a entrar e o lider): trava a mesa.
  await page.click('#btn-room-more');
  await page.check('#opt-mesa-leader-only');
  await espera(300);
  await page.screenshot({ path: path.join(PRINTS, '08-menu-da-sala-travas.png') });
  s.trava = await bia.espera((m) => m.type === 'mesa' && m.op === 'lock').then((m) => ({ leaderOnly: m.leaderOnly, lockSize: m.lockSize }));
  await page.uncheck('#opt-mesa-leader-only');
  await page.keyboard.press('Escape');

  // Volta a Transmissao: nada da mesa fica no DOM e as telas voltam.
  await page.click('#view-tx');
  await espera(300);
  const depois = await page.evaluate(() => ({
    mesa: document.querySelectorAll('.mesa, .mesa-win').length,
    tilesNoPalco: document.querySelectorAll('#grid .tile').length,
    videosTocando: [...document.querySelectorAll('#grid video')].filter((v) => !v.paused).length,
  }));
  await page.screenshot({ path: path.join(PRINTS, '07-de-volta-a-transmissao.png') });
  s.checagens = { antes, depois, erros: erros.filter((e) => !/mesa-janelas/.test(e) && !/ERR_FILE_NOT_FOUND/.test(e)), errosDeArquivoAusente: erros.filter((e) => /ERR_FILE_NOT_FOUND|mesa-janelas/.test(e)).length };
  for (const p of [bia, leo, caio, ana]) p.fecha();
  await page.close();
}

/** Conta quadros por rAF durante `ms` enquanto `acao` roda. */
async function medir(page, rotulo, acao, ms = 3000) {
  await page.evaluate(() => {
    window.__q = [];
    window.__medindo = true;
    const passo = (t) => {
      window.__q.push(t);
      if (window.__medindo) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  });
  const t0 = Date.now();
  await acao(t0, ms);
  const r = await page.evaluate(() => {
    window.__medindo = false;
    const q = window.__q;
    const dts = q.slice(1).map((t, i) => t - q[i]).sort((a, b) => a - b);
    const total = q[q.length - 1] - q[0];
    return {
      quadros: q.length,
      fps: Math.round(((q.length - 1) / total) * 1000 * 10) / 10,
      p50: Math.round(dts[Math.floor(dts.length * 0.5)] * 10) / 10,
      p95: Math.round(dts[Math.floor(dts.length * 0.95)] * 10) / 10,
      pior: Math.round(dts[dts.length - 1] * 10) / 10,
      longos: dts.filter((d) => d > 33.4).length,
    };
  });
  return { rotulo, ...r };
}

async function desempenho(browser, port, s) {
  const { page } = await abrirSala(browser, port, { largura: 1920, altura: 1080 });
  await page.evaluate(CONTEUDO_DE_TESTE);
  const gente = [];
  for (const n of ['Bia', 'Leo', 'Duda', 'Caio', 'Rafa']) gente.push(await pessoa(port, n));
  const [bia, leo, duda, caio, rafa] = gente;
  for (const p of [bia, leo, duda]) p.envia({ type: 'broadcast-state', live: true });
  for (const p of [caio, rafa]) p.envia({ type: 'camera-state', on: true });
  await espera(400);
  await mostrarTela(page, bia.id, 'Bia', '#4B5A3A', 'screen', 1920, 1080);
  await mostrarTela(page, leo.id, 'Leo', '#3B2A63', 'screen', 1920, 1080);
  await mostrarTela(page, duda.id, 'Duda', '#5E3A2A', 'screen', 1920, 1080);
  await mostrarTela(page, `cam-${caio.id}`, 'Caio', '#173C4F', 'camera', 1280, 720);
  await mostrarTela(page, `cam-${rafa.id}`, 'Rafa', '#2A4B3A', 'camera', 1280, 720);
  await espera(800);
  const res = [];
  res.push(await medir(page, 'Transmissão, parada (5 vídeos no palco)', async (t0, ms) => espera(ms)));

  await page.click('#view-mesa');
  await page.waitForSelector('.mesa-loading[hidden]', { state: 'attached' });
  // Um iframe em branco (conteudo de teste no lugar do placar).
  // Pelo + do dock: a janela nasce no meio da vista.
  await page.click('#btn-mesa-add');
  await page.click('.mesa-menu [data-add="placar"]');
  await page.waitForSelector('.mesa-win[data-type="placar"] iframe');
  await page.click('.mesa-zoom-btn[data-zoom="fit"]');
  await espera(800);
  const quantos = await page.evaluate(() => ({ janelas: document.querySelectorAll('.mesa-win').length, videos: document.querySelectorAll('.mesa-win video').length, iframes: document.querySelectorAll('.mesa-win iframe').length }));
  res.push(await medir(page, 'Mesa, parada', async (t0, ms) => espera(ms)));

  // Andar arrastando o fundo, sem parar.
  const fundo = async () => {
    const box = await page.$eval('.mesa', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    return { x: box.x + 30, y: box.y + box.h - 30 };
  };
  res.push(await medir(page, 'Mesa, andando (arrastar o fundo)', async (t0, ms) => {
    const p = await fundo();
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    let i = 0;
    while (Date.now() - t0 < ms) {
      i += 1;
      await page.mouse.move(p.x + Math.sin(i / 10) * 200, p.y - 60 + Math.cos(i / 10) * 60);
    }
    await page.mouse.up();
  }));
  res.push(await medir(page, 'Mesa, zoom na roda', async (t0, ms) => {
    await page.mouse.move(900, 500);
    let i = 0;
    while (Date.now() - t0 < ms) {
      i += 1;
      await page.mouse.wheel(0, i % 40 < 20 ? -40 : 40);
      await espera(8);
    }
  }));
  res.push(await medir(page, 'Mesa, arrastando uma tela', async (t0, ms) => {
    const r = await page.$eval('.mesa-win.is-media', (el) => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.mouse.move(r.x, r.y);
    await page.mouse.down();
    let i = 0;
    while (Date.now() - t0 < ms) {
      i += 1;
      await page.mouse.move(r.x + Math.sin(i / 12) * 250, r.y + Math.cos(i / 12) * 120);
    }
    await page.mouse.up();
  }));
  res.push(await medir(page, 'Mesa, voo do Ver tudo repetido', async (t0, ms) => {
    while (Date.now() - t0 < ms) {
      await page.keyboard.press('Escape');
      await page.focus('.mesa');
      await page.keyboard.press('+');
      await page.keyboard.press('+');
      await espera(100);
      await page.keyboard.press('0');
      await espera(450);
    }
  }));
  await page.click('#view-tx');
  await espera(300);
  res.push(await medir(page, 'Transmissão de novo, parada', async (t0, ms) => espera(ms)));
  s.desempenho = { quantos, res, agente: await page.evaluate(() => navigator.userAgent) };
  for (const p of gente) p.fecha();
  await page.close();
}

/** Conferencias de comportamento que so dao com DOM de verdade. */
async function checar(browser, port, s) {
  const { page, erros } = await abrirSala(browser, port);
  await page.evaluate(CONTEUDO_DE_TESTE);
  const bia = await pessoa(port, 'Bia');
  const ok = {};
  await page.click('#view-mesa');
  await page.waitForSelector('.mesa-loading[hidden]', { state: 'attached' });
  bia.envia({ type: 'mesa-view', on: true });
  await bia.espera((m) => m.type === 'mesa-sync');
  // Pelo + do dock.
  await page.click('#btn-mesa-add');
  await page.click('.mesa-menu [data-add="nota"]');
  const add = await bia.espera((m) => m.type === 'mesa' && m.op === 'add');
  const id = add.win.id;
  await page.waitForSelector(`.mesa-win[data-id="${id}"]`);
  ok.focoNaJanelaNova = await page.evaluate((i) => document.activeElement?.dataset?.id === i, id);
  // Setas movem 10 (Shift 100).
  await page.keyboard.press('ArrowRight');
  const m1 = await bia.espera((m) => m.type === 'mesa' && m.op === 'place');
  ok.setaMove10 = m1.x === add.win.x + 10 && m1.y === add.win.y;
  await page.keyboard.press('Shift+ArrowDown');
  const m2 = await bia.espera((m) => m.type === 'mesa' && m.op === 'place' && m.seq === m1.seq + 1);
  ok.shiftMove100 = m2.y === add.win.y + 100;
  // Alt+seta redimensiona.
  await page.keyboard.press('Alt+ArrowRight');
  const m3 = await bia.espera((m) => m.type === 'mesa' && m.op === 'place' && m.seq === m2.seq + 1);
  ok.altRedimensiona = m3.w === add.win.w + 10;
  // Arrastar pela alca: a Bia ve a vez, o arraste e o place.
  const alca = await page.$eval(`.mesa-win[data-id="${id}"] .mesa-handle`, (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(alca.x, alca.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(alca.x + i * 15, alca.y + i * 5);
    await espera(30);
  }
  ok.contornoDeOndeAssenta = await page.evaluate(() => Boolean(document.querySelector('.mesa-win.is-dragging')));
  await page.mouse.up();
  const grab = await bia.espera((m) => m.type === 'mesa-grab' && m.id === id);
  const drag = await bia.espera((m) => m.type === 'mesa-drag' && m.id === id);
  const place = await bia.espera((m) => m.type === 'mesa' && m.op === 'place' && m.seq === m3.seq + 1);
  await bia.espera((m) => m.type === 'mesa-release' && m.id === id);
  ok.arrasteComVez = Boolean(grab && drag && place && place.x > m3.x);
  // F: tela cheia; Esc volta.
  await page.focus(`.mesa-win[data-id="${id}"]`);
  await page.keyboard.press('f');
  ok.telaCheia = await page.evaluate(() => Boolean(document.querySelector('.mesa-win.is-full')) && document.body.classList.contains('mesa-full'));
  await page.keyboard.press('Escape');
  ok.escVolta = await page.evaluate(() => !document.querySelector('.mesa-win.is-full') && !document.body.classList.contains('mesa-full'));
  // Janela da Bia sendo movida: pegar e recusado com o nome dela.
  bia.envia({ type: 'mesa-grab', id });
  await espera(200);
  ok.chipBiaMovendo = await page.evaluate((i) => document.querySelector(`.mesa-win[data-id="${i}"] .mesa-moving`)?.textContent, id);
  bia.envia({ type: 'mesa-release', id });
  await espera(100);
  // Trava: a Bia (nao lider) nao consegue por janela.
  await page.click('#btn-room-more');
  await page.check('#opt-mesa-leader-only');
  await page.keyboard.press('Escape');
  const lock = await bia.espera((m) => m.type === 'mesa' && m.op === 'lock');
  bia.envia({ type: 'mesa', op: 'add', win: { type: 'nota', x: 0, y: 0, w: 320, h: 240 } });
  ok.travaRecusa = (await bia.espera((m) => m.type === 'mesa-denied' && m.op === 'add')).reason === 'locked' && lock.leaderOnly === true;
  // Delete tira da mesa.
  await page.focus(`.mesa-win[data-id="${id}"]`);
  await page.keyboard.press('Delete');
  ok.deleteTira = (await bia.espera((m) => m.type === 'mesa' && m.op === 'remove')).id === id;
  // Voltar a Transmissao desmonta tudo.
  await page.click('#view-tx');
  ok.nadaDaMesaNoDom = await page.evaluate(() => document.querySelectorAll('.mesa, .mesa-win, .mesa-menu').length === 0);
  await espera(300);
  const viewers = bia.caixa.filter((m) => m.type === 'mesa-viewers').pop();
  ok.mesaViewOff = viewers.peers.length === 1 && viewers.peers[0] === bia.id;
  ok.erros = erros.filter((e) => !/ERR_FILE_NOT_FOUND/.test(e));
  s.checagem = ok;
  bia.fecha();
  await page.close();
}

/** Uma imagem de verdade (PNG por canvas) para o chat: um "print" de mapa. */
const IMAGEM_DE_TESTE = () => {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 400;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 640, 400);
  grad.addColorStop(0, '#2B4A3A');
  grad.addColorStop(1, '#1D2F45');
  g.fillStyle = grad;
  g.fillRect(0, 0, 640, 400);
  g.strokeStyle = 'rgba(255,255,255,.35)';
  g.lineWidth = 2;
  for (let i = 0; i < 640; i += 40) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 400); g.stroke();
  }
  for (let j = 0; j < 400; j += 40) {
    g.beginPath(); g.moveTo(0, j); g.lineTo(640, j); g.stroke();
  }
  g.fillStyle = '#E8B04B';
  g.beginPath(); g.arc(420, 170, 26, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,.9)';
  g.font = '600 34px sans-serif';
  g.fillText('Mirage — bomb A', 36, 60);
  return c.toDataURL('image/jpeg', 0.82);
};

/** O acabamento de 2026-09-25: "Pôr na mesa" do chat (link do YouTube e
 * imagem), as janelas Imagem e Galeria, os controles do tile dentro da
 * janela da Mesa, as travas vistas da Transmissao e o cartao "Assistir"
 * na tira de miniaturas. `comPrints` tira os prints em PRINTS_ACABAMENTO. */
async function acabamento(browser, port, s, { comPrints = false } = {}) {
  if (comPrints) fs.mkdirSync(PRINTS_ACABAMENTO, { recursive: true });
  const foto = async (page, nome) => {
    if (comPrints) await page.screenshot({ path: path.join(PRINTS_ACABAMENTO, nome) });
  };
  const { page, erros } = await abrirSala(browser, port);
  const ok = {};
  const bia = await pessoa(port, 'Bia');
  bia.envia({ type: 'mesa-view', on: true });
  await bia.espera((m) => m.type === 'mesa-sync');
  const png = await page.evaluate(IMAGEM_DE_TESTE);
  bia.envia({ type: 'chat', text: 'olha esse clipe https://youtu.be/dQw4w9WgXcQ?t=42' });
  bia.envia({ type: 'chat', text: 'o bomb A é aqui', image: png, w: 640, h: 400 });
  const msgImg = await bia.espera((m) => m.type === 'chat' && m.image);
  await page.waitForSelector('.chat-line .chat-image');
  ok.botoesPorNaMesa = await page.evaluate(() => [...document.querySelectorAll('.chat-put')].map((b) => b.dataset.put));
  await foto(page, '01-chat-por-na-mesa.png');

  // 1. Da Transmissao: a imagem do chat vai para o meio da mesa.
  await page.click('.chat-put[data-put="imagem"]');
  const addImg = await bia.espera((m) => m.type === 'mesa' && m.op === 'add' && m.win.type === 'imagem');
  const actImg = await bia.espera((m) => m.type === 'mesa' && m.op === 'act' && m.id === addImg.win.id);
  ok.imagemPelaTransmissao = actImg.action.msgId === msgImg.id && !JSON.stringify(addImg).includes('base64');
  ok.avisoNaTransmissao = await page.evaluate(() => document.querySelector('#toast-text')?.textContent);

  // 2. Na Mesa: a imagem aparece ajustada a janela.
  await page.click('#view-mesa');
  await page.waitForSelector('.mesa-loading[hidden]', { state: 'attached' });
  await page.waitForSelector(`.mesa-win[data-id="${addImg.win.id}"] img.mj-img-foto[src^="data:image/jpeg"]`);
  ok.imagemNaMesa = await page.evaluate((i) => {
    const img = document.querySelector(`.mesa-win[data-id="${i}"] img.mj-img-foto`);
    return img.complete && img.naturalWidth === 640 && getComputedStyle(img).objectFit === 'contain';
  }, addImg.win.id);

  // 3. O link do YouTube, com a Mesa aberta: nasce no meio da vista.
  await page.click('.chat-put[data-put="youtube"]');
  const addYt = await bia.espera((m) => m.type === 'mesa' && m.op === 'add' && m.win.type === 'youtube');
  const actYt = await bia.espera((m) => m.type === 'mesa' && m.op === 'act' && m.id === addYt.win.id);
  ok.youtubePelaMesa = actYt.action.kind === 'load' && actYt.action.videoId === 'dQw4w9WgXcQ' && actYt.action.start === 42;

  // 4. Galeria: as imagens do chat, com "Pôr na mesa" em cada uma.
  await page.click('#btn-mesa-add');
  await page.click('.mesa-menu [data-add="galeria"]');
  const addGal = await bia.espera((m) => m.type === 'mesa' && m.op === 'add' && m.win.type === 'galeria');
  await page.waitForSelector(`.mesa-win[data-id="${addGal.win.id}"] .mj-gal-item img[src^="data:image/jpeg"]`);
  ok.galeriaMostra = await page.$$eval(`.mesa-win[data-id="${addGal.win.id}"] .mj-gal-item`, (l) => l.length);
  await page.click('.mesa-zoom-btn[data-zoom="fit"]');
  await espera(700);
  await foto(page, '02-imagem-e-galeria-na-mesa.png');
  await page.click(`.mesa-win[data-id="${addGal.win.id}"] .mj-gal-por`);
  const addImg2 = await bia.espera((m) => m.type === 'mesa' && m.op === 'add' && m.win.type === 'imagem' && m.win.id !== addImg.win.id);
  const actImg2 = await bia.espera((m) => m.type === 'mesa' && m.op === 'act' && m.id === addImg2.win.id);
  ok.galeriaPoeNaMesa = actImg2.action.msgId === msgImg.id;

  // 5. Imagem que saiu do historico: a janela diz isso. O servidor aceita
  // 3 imagens a cada 5 s por pessoa (e recusa o resto calado).
  await espera(5200);
  for (let i = 0; i < 8; i += 1) {
    bia.envia({ type: 'chat', text: '', image: png, w: 640, h: 400 });
    await espera(i % 3 === 2 ? 5200 : 50); // 3 imagens / 5 s por pessoa
  }
  await page.waitForFunction((i) => /saiu do histórico/.test(document.querySelector(`.mesa-win[data-id="${i}"] .mj-img-falta`)?.textContent || ''), addImg.win.id, { timeout: 10000 });
  ok.imagemSaiuDoHistorico = true;
  ok.galeriaNoTeto = await page.$$eval(`.mesa-win[data-id="${addGal.win.id}"] .mj-gal-item`, (l) => l.length);
  await foto(page, '03-imagem-que-saiu-do-historico.png');

  ok.erros = erros.filter((e) => !/ERR_FILE_NOT_FOUND|ytimg|youtube|net::/.test(e));
  (s.acabamento ||= {}).porNaMesa = ok;
  s.acabamento.tileNaMesa = await tileNaMesa(page, bia, erros, foto);
  bia.fecha();
  await page.close();
}

/** Volume, rabisco e reacoes do tile dentro da janela da Mesa, com a mesa
 * fora do zoom 100% (o transform do mundo nao pode entortar o rabisco). */
async function tileNaMesa(page, bia, erros, foto) {
  const ok = {};
  // Tira as janelas de antes do caminho: so a tela da Bia fica.
  const retrato = await (async () => {
    const r = bia.espera((m) => m.type === 'mesa-sync' && m !== bia.caixa.find((x) => x.type === 'mesa-sync'));
    bia.envia({ type: 'mesa-sync' });
    return (await r).mesa;
  })();
  for (const w of retrato.windows) bia.envia({ type: 'mesa', op: 'remove', id: w.id });
  bia.envia({ type: 'broadcast-state', live: true, annotate: true });
  const add = await bia.espera((m) => m.type === 'mesa' && m.op === 'add' && m.win.type === 'tela');
  await mostrarTela(page, bia.id, 'Bia', '#4B5A3A');
  const sel = `.mesa-win[data-id="${add.win.id}"]`;
  await page.waitForSelector(`${sel} .tile video`);
  await page.waitForSelector(`${sel} .tile.annotatable`);
  // Fora dos 100%: "Ver tudo" e depois dois passos de afastar.
  await page.click('.mesa-zoom-btn[data-zoom="fit"]');
  await espera(700);
  await page.click('.mesa-zoom-btn[data-zoom="out"]');
  await page.click('.mesa-zoom-btn[data-zoom="out"]');
  await espera(300);
  ok.zoom = await page.$eval('.mesa-zoom-val', (el) => el.textContent);
  const caixa = await page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(caixa.x + caixa.w * 0.3, caixa.y + caixa.h * 0.3);
  await espera(250);
  ok.barrasVisiveis = await page.$eval(sel, (el) => ['.tile-annot-bar', '.tile-react-bar'].map((s) => {
    const b = el.querySelector(s);
    const cs = getComputedStyle(b);
    return cs.display !== 'none' && cs.opacity === '1' && cs.pointerEvents !== 'none';
  }));
  // Reagir: abre a lista, manda a reacao, e nada disso pega a janela.
  const antesGrab = bia.caixa.filter((m) => m.type === 'mesa-grab').length;
  await page.click(`${sel} .tile-react-toggle`);
  ok.listaDeReacoesAbre = await page.$eval(`${sel} .tile-react-bar`, (el) => el.classList.contains('is-open'));
  await page.click(`${sel} .tile-react-btn >> nth=0`);
  ok.reacaoChega = Boolean(await bia.espera((m) => m.type === 'reaction'));
  // Rabisco: liga pela barra e risca do meio para a direita.
  await page.click(`${sel} .annot-toggle`);
  const v = await page.$eval(`${sel} .tile`, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const p0 = { x: v.x + v.w * 0.25, y: v.y + v.h * 0.5 };
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(p0.x + (v.w * 0.5 * i) / 10, p0.y - (v.h * 0.25 * i) / 10);
    await espera(20);
  }
  await page.mouse.up();
  const begin = await bia.espera((m) => m.type === 'annotate' && m.op === 'begin');
  await bia.espera((m) => m.type === 'annotate' && m.op === 'end');
  const pts = bia.caixa.filter((m) => m.type === 'annotate' && m.op === 'points').flatMap((m) => m.points);
  const fim = pts[pts.length - 1];
  const perto = (a, b) => Math.abs(a - b) < 0.02;
  ok.rabiscoNormalizado = perto(begin.x, 0.25) && perto(begin.y, 0.5) && perto(fim[0], 0.75) && perto(fim[1], 0.25);
  ok.rabiscoPontos = { comeco: [begin.x, begin.y], fim };
  await espera(100);
  ok.rabiscoNaoPegaAJanela = bia.caixa.filter((m) => m.type === 'mesa-grab').length === antesGrab;
  await foto(page, '04-tile-com-controles-na-mesa.png');
  // Volume: pelo menu da janela (o botao direito da Mesa).
  await page.click(`${sel} .annot-toggle`);
  await page.mouse.click(caixa.x + caixa.w * 0.5, caixa.y + caixa.h * 0.3, { button: 'right' });
  await page.waitForSelector('.mesa-menu [data-act="volume"]');
  await page.click('.mesa-menu [data-act="volume"]');
  await page.waitForSelector('.tile-menu .tile-menu-volume input');
  ok.menuDeVolume = await page.$eval('.tile-menu .tile-menu-name', (el) => el.textContent);
  await foto(page, '05-volume-da-tela-na-mesa.png');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 450);
  ok.erros = erros.filter((e) => !/ERR_FILE_NOT_FOUND|ytimg|youtube|net::/.test(e));
  return ok;
}

(async () => {
  const modo = process.argv[2] || 'tudo';
  const servidor = await createSignalingServer({ port: 0, ownerToken: 'banco-de-prova', log: () => {} });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', ...(process.env.SEM_VSYNC ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });
  const s = {};
  try {
    if (modo === 'prints' || modo === 'tudo') await prints(browser, servidor.port, s);
    if (modo === 'checar' || modo === 'tudo') await checar(browser, servidor.port, s);
    if (modo === 'checar' || modo === 'prints' || modo === 'tudo' || modo === 'acabamento') {
      await acabamento(browser, servidor.port, s, { comPrints: modo !== 'checar' });
    }
    if (modo === 'desempenho' || modo === 'tudo') await desempenho(browser, servidor.port, s);
  } finally {
    await browser.close();
    await servidor.close();
  }
  console.log(JSON.stringify(s, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
