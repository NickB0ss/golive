'use strict';

/*
 * Passada visual das 7 janelas da segunda leva (truco, oito, domino, stop,
 * quiz, quadro, desenha), no molde de mesa-real.js: servidor de sinalizacao
 * de verdade, 2 a 3 pessoas em PAGINAS SEPARADAS do Chromium (nao paineis
 * de uma pagina so), cada uma entrando pela UI de verdade (index.html) e
 * jogando pelos proprios botoes da janela -- nunca chamando validate/reduce
 * por fora.
 *
 * Para cada tipo: sobe um servidor novo, abre as pessoas necessarias, poe a
 * janela no tamanho padrao do modulo (jogo real ate pelo menos uma
 * rodada/mao) e uma segunda instancia no tamanho minimo (so pra medir
 * layout), confere:
 *   - conteudo cabe sem rolagem nem corte (mesma medida do poquer-rodar.js);
 *   - nenhum controle visivel sai do corpo abaixo da barra da janela;
 *   - cada pessoa ve so o que deve (cartas/pecas/palavra alheias nunca
 *     aparecem no que o socket dela recebeu);
 *   - sem erro de console.
 * Tira prints em docs/prints/2026-09-26-leva2/.
 *
 *   node tools/bancada-janelas/leva2-real.js
 *   node tools/bancada-janelas/leva2-real.js --sem-prints
 *   node tools/bancada-janelas/leva2-real.js truco oito   # so esses tipos
 *
 * Usa o Playwright do sistema (PLAYWRIGHT_DIR) e os navegadores que ja
 * estao la; nao instala nada. Nao entra no `npm test` (precisa de
 * navegador).
 */

/* global window, document */

const path = require('node:path');
const fs = require('node:fs');
const { createSignalingServer } = require('../../server/signaling-core');
const { BAR_H } = require('../../src/renderer/mesa-modules/index.js');

const PW = process.env.PLAYWRIGHT_DIR || '/opt/node22/lib/node_modules/playwright';
const { chromium } = require(PW);

const RAIZ = path.resolve(__dirname, '..', '..');
const PAGINA = `file://${path.join(RAIZ, 'src', 'renderer', 'index.html')}`;
const PRINTS = path.join(RAIZ, 'docs', 'prints', '2026-09-26-leva2');

const args = process.argv.slice(2);
const semPrints = args.includes('--sem-prints');
const pedidos = args.filter((a) => !a.startsWith('--'));

const falhas = [];
let conferidos = 0;
function conferir(cond, msg) {
  conferidos++;
  if (!cond) falhas.push(msg);
}
const espera = (ms) => new Promise((r) => { setTimeout(r, ms); });

// ---------------------------------------------------------------------
// Infra: servidor de verdade + pessoas em paginas separadas de verdade.
// ---------------------------------------------------------------------

/** Roda no navegador (addInitScript): injeta nome (e, so pra Ana, o
 * ownerToken) no `join` e guarda toda mensagem recebida em
 * `window.__caixa`, alem da conexao viva em `window.__ws` -- so pra dar
 * `add`/`sit`/etc. pelo mesmo canal que a pessoa usaria (a Vista continua
 * sendo quem desenha, ninguem chama o modulo por fora).
 *
 * So a PRIMEIRA pessoa leva o token: se todo mundo entrasse com o mesmo
 * `ownerToken`, todo mundo virava "dono" da sala (`isLeader() === true`)
 * pra sempre, e testes de "so o lider" ou "so quem pos a janela" (Quadro:
 * `podeLimpar()`) passariam por engano mesmo quebrados de verdade. */
function PONTE({ nome, ehDona, idioma }) {
  const OrigWS = window.WebSocket;
  const enviarOriginal = OrigWS.prototype.send;
  OrigWS.prototype.send = function send(data) {
    if (typeof data === 'string' && data.includes('"type":"join"')) {
      const m = JSON.parse(data);
      if (ehDona) m.ownerToken = 'bancada-leva2';
      m.name = nome;
      return enviarOriginal.call(this, JSON.stringify(m));
    }
    return enviarOriginal.call(this, data);
  };
  window.__caixa = [];
  window.WebSocket = new Proxy(OrigWS, {
    construct(alvo, args2) {
      const inst = new alvo(...args2);
      window.__ws = inst;
      inst.addEventListener('message', (e) => {
        try { window.__caixa.push(JSON.parse(e.data)); } catch { /* ignora ruido */ }
      });
      return inst;
    },
  });
  window.golive = new Proxy({}, {
    get: (_, k) => {
      // So na sala mista: o idioma que o processo principal entregaria ao preload.
      if (k === 'idioma' && idioma) return { preferencia: idioma, ativo: idioma };
      if (k === 'getNetworkAddress') return async () => ({ address: '26.114.8.201', kind: 'radmin' });
      if (k === 'getVersion') return async () => null;
      if (k === 'win') return { show() {} };
      if (String(k).startsWith('on')) return () => {};
      return async () => null;
    },
  });
}

async function caixaDe(page) {
  return page.evaluate(() => window.__caixa || []);
}

/** So serve para condicoes que nascem UMA vez e ficam valendo (uma pessoa
 * sentou, a fase mudou): `caixa.find` acha a primeira mensagem que bate,
 * que e exatamente a hora da transicao. NAO serve para "qual e o estado
 * agora" -- para isso, `ultimoEstado`. */
async function esperaMsg(page, pred, ms = 6000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const caixa = await caixaDe(page);
    const achou = caixa.find(pred);
    if (achou) return achou;
    await espera(30);
  }
  throw new Error('esperou demais por mensagem');
}

/** O estado MAIS RECENTE que a pessoa recebeu para a janela `id` (state ou
 * o `add` inicial). Ao contrario de `esperaMsg` (que acha a primeira
 * mensagem que bate e nunca muda depois disso), isto acompanha o jogo
 * andando -- e o que os lacos de "jogue ate acabar" precisam. */
async function ultimoEstado(page, id) {
  const caixa = await caixaDe(page);
  for (let i = caixa.length - 1; i >= 0; i--) {
    const m = caixa[i];
    if (m.type === 'mesa' && m.id === id && (m.op === 'state' || m.op === 'add')) {
      return m.op === 'add' ? m.win.state : m.state;
    }
  }
  return null;
}

async function abrirPessoa(browser, servidor, nome, ehDona = false, idioma = null) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const erros = [];
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  await page.addInitScript(PONTE, { nome, ehDona, idioma });
  await page.goto(PAGINA);
  await page.fill('#join-address', `127.0.0.1:${servidor.port}`);
  await page.press('#join-address', 'Enter');
  await page.waitForSelector('#room-view:not(.hidden)');
  const welcome = await esperaMsg(page, (m) => m.type === 'welcome', 6000);
  // Sala Mesa: a Mesa abre sozinha ao receber o welcome (nao ha item da Mesa no barramento).
  await page.waitForSelector('.mesa-loading[hidden]', { state: 'attached' });
  await page.waitForFunction(() => window.GoLive.salaVista.isMesa());
  conferir(!(await page.$('#view-mesa')), `${nome}: sobrou o item da Mesa no barramento`);
  return { page, nome, id: welcome.id, erros };
}

/** Os tamanhos `w`,`h` sao do CONTEUDO (como no modulo); a barra da janela
 * (BAR_H) entra aqui. Poe uma janela do `tipo` pelo canal de sinalizacao de
 * verdade (mesmo que a Vista manda ao clicar "Adicionar janela"), pela conexao da PRIMEIRA
 * pessoa. Devolve o id que o servidor deu. */
async function adicionarJanela(pessoa, tipo, x, y, w, h) {
  await pessoa.page.evaluate(({ tipo: t, x: x2, y: y2, w: w2, h: h2 }) => {
    window.__ws.send(JSON.stringify({ type: 'mesa', op: 'add', win: { type: t, x: x2, y: y2, w: w2, h: h2 } }));
  }, { tipo, x, y, w, h: h + BAR_H });
  const add = await esperaMsg(pessoa.page, (m) => m.type === 'mesa' && m.op === 'add' && m.win.type === tipo && m.win.x === x, 6000);
  return add.win.id;
}

function janela(page, id) {
  return page.locator(`.mesa-win[data-id="${id}"]`);
}

/** Conteudo cabe sem rolar/cortar, fica dentro do corpo e tem controles nomeados. */
async function conferirGeometria(page, rotulo) {
  const r = await page.evaluate(() => {
    const out = { vaza: [], semNome: 0, foraDoCorpo: [] };
    for (const win of document.querySelectorAll('.mesa-win')) {
      const conteudo = win.querySelector('.mesa-content');
      const corpo = win.querySelector('.mesa-win-body');
      const mj = conteudo && conteudo.firstElementChild;
      if (!mj || !corpo) continue;
      const rotulo2 = `${win.dataset.type}#${win.dataset.id}`;
      if (mj.scrollWidth > mj.clientWidth + 1 || mj.scrollHeight > mj.clientHeight + 1) {
        out.vaza.push(`${rotulo2}: ${mj.scrollWidth}x${mj.scrollHeight} > ${mj.clientWidth}x${mj.clientHeight}`);
      }
      const caixaConteudo = conteudo.getBoundingClientRect();
      const caixaCorpo = corpo.getBoundingClientRect();
      if (caixaConteudo.top < caixaCorpo.top || caixaConteudo.bottom > caixaCorpo.bottom) {
        out.foraDoCorpo.push(`${rotulo2}: conteudo atravessa a barra`);
      }
      for (const b of mj.querySelectorAll('button, input, select, textarea')) {
        if (b.offsetParent === null) continue;
        const nome = b.getAttribute('aria-label') || (b.textContent && b.textContent.trim()) || b.getAttribute('title') || b.getAttribute('placeholder');
        if (!nome) out.semNome++;
        const rc = b.getBoundingClientRect();
        if (rc.height > 0 && (rc.top < caixaCorpo.top || rc.bottom > caixaCorpo.bottom)) {
          out.foraDoCorpo.push(`${rotulo2}: "${nome}" sai do corpo`);
        }
      }
    }
    return out;
  });
  conferir(r.vaza.length === 0, `${rotulo}: conteudo sai da janela (${r.vaza.join('; ')})`);
  conferir(r.semNome === 0, `${rotulo}: ${r.semNome} controle(s) sem rotulo`);
  conferir(r.foraDoCorpo.length === 0, `${rotulo}: controle sai do corpo (${r.foraDoCorpo.join('; ')})`);
}

/** Nenhum dos textos de `proibidos` (cartas/pecas/palavra da pessoa `dono`)
 * pode aparecer em NENHUMA mensagem que chegou pelo socket de `outra`. */
async function semVazamento(outra, proibidos, rotulo) {
  const lista = proibidos.filter(Boolean);
  if (!lista.length) return;
  const bruto = await outra.page.evaluate(() => JSON.stringify(window.__caixa));
  const vazou = lista.filter((t) => bruto.includes(t));
  conferir(vazou.length === 0, `${rotulo}: ${outra.nome} recebeu "${vazou.join(', ')}"`);
}

async function fecharPessoas(pessoas) {
  for (const p of pessoas) await p.page.close();
}

function erroDePagina(pessoa) {
  return pessoa.erros.filter((e) => !/ERR_FILE_NOT_FOUND|favicon/.test(e));
}

async function conferirSemErro(pessoas, rotulo) {
  for (const p of pessoas) {
    const erros = erroDePagina(p);
    conferir(erros.length === 0, `${rotulo}: erro na pagina de ${p.nome}: ${erros.join(' | ')}`);
  }
}

/** "Ver tudo": poe as janelas dentro do que a pessoa enxerga (o mundo da
 * mesa comeca perto de -600,-600 -- bem fora do que a camera mostra ao
 * abrir -- entao clicar direto num botao de uma janela recem-posta falha
 * com "outside of the viewport" sem isto). Chama em CADA pagina, porque o
 * zoom e por pessoa. A Vista tambem tem um "seguir a propria janela"
 * (mesa-view.js: `flyTo` quando a janela que a pessoa mexeu sai da tela):
 * espera um pouco antes E clica duas vezes, senao um eco tardio da ultima
 * jogada do laco de jogo reabre o voo da camera bem na hora do fit. */
async function verTudo(...pessoas) {
  await espera(250);
  for (const p of pessoas) {
    await p.page.click('.mesa-zoom-btn[data-zoom="fit"]').catch(() => {});
  }
  await espera(400);
  for (const p of pessoas) {
    await p.page.click('.mesa-zoom-btn[data-zoom="fit"]').catch(() => {});
  }
  await espera(400);
}

/** Tela cheia (mesma ideia do mesa-real.js para poquer/blackjack): no "Ver
 * tudo" com mais de uma janela a caixa fica pequena e os controles do
 * canto (avatar/tela cheia/tirar) tem tamanho fixo na tela, entao ficam
 * por cima do que seria clicavel perto da borda. Tela cheia tira a janela
 * do zoom da mesa e da tamanho de sobra -- como uma pessoa faria antes de
 * jogar de verdade numa janela pequena. */
async function telaCheia(w) {
  await w.hover();
  await w.locator('.mesa-bar-title').dblclick();
  await espera(250);
}
async function sairTelaCheia(pessoa) {
  await pessoa.page.keyboard.press('Escape');
  await espera(250);
}

async function print(page, nome) {
  if (semPrints) return;
  fs.mkdirSync(PRINTS, { recursive: true });
  await page.screenshot({ path: path.join(PRINTS, `${nome}.png`) });
}

// ---------------------------------------------------------------------
// Truco (2 jogadores, 720x460 / 520x330)
// ---------------------------------------------------------------------

async function cenaTruco(browser) {
  const servidor = await createSignalingServer({ port: 0, ownerToken: 'bancada-leva2', log: () => {} });
  const rotulo = 'truco';
  try {
    const ana = await abrirPessoa(browser, servidor, 'Ana', true);
    const bia = await abrirPessoa(browser, servidor, 'Bia');
    const pessoas = [ana, bia];
    const id = await adicionarJanela(ana, 'truco', 140, 140, 720, 460);
    const idMin = await adicionarJanela(ana, 'truco', 1000, 140, 520, 330);
    await espera(500);
    await verTudo(ana, bia);

    const wAna = janela(ana.page, id);
    const wBia = janela(bia.page, id);
    await wAna.locator('.mj-tr-pos-0').getByRole('button', { name: 'Sentar' }).click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.seats[0]);
    await wBia.locator('.mj-tr-pos-1').getByRole('button', { name: 'Sentar' }).click();
    await esperaMsg(ana.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.seats[1]);
    await espera(200);
    await wAna.getByRole('button', { name: 'Dar as cartas' }).click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.hand);
    await espera(200);

    // Segredo: as cartas visiveis de cada um (aria-label das cartas
    // proprias, nunca as cobertas) nao podem aparecer no socket do outro.
    const cartasDe = async (w) => w.locator('.mj-tr-carta .mj-carta:not(.is-verso)').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    await semVazamento(bia, await cartasDe(wAna), `${rotulo}: mao da Ana`);
    await semVazamento(ana, await cartasDe(wBia), `${rotulo}: mao da Bia`);

    // Joga uma mao inteira: quem estiver na vez clica a primeira carta
    // descoberta ("Jogar"), ate a mao acabar (phase sai de 'play').
    let acabou = false;
    for (let i = 0; i < 30 && !acabou; i++) {
      const view = await ultimoEstado(ana.page, id);
      if (!view || view.phase === 'waiting' || view.phase === 'finished') { acabou = true; break; }
      for (const w of [wAna, wBia]) {
        const botaoJogar = w.locator('.mj-tr-carta').getByRole('button', { name: 'Jogar' }).first();
        if (await botaoJogar.count() && (await botaoJogar.getAttribute('aria-disabled')) !== 'true') {
          await botaoJogar.click();
          await espera(200);
        }
      }
      await espera(80);
    }
    conferir(acabou, `${rotulo}: a mao terminou depois de jogar as cartas`);

    // Tamanho minimo: so sentar e conferir o layout (sem jogar a mao toda).
    await verTudo(ana);
    await janela(ana.page, idMin).locator('.mj-tr-pos-0').getByRole('button', { name: 'Sentar' }).click();
    await espera(200);

    await conferirGeometria(ana.page, `${rotulo}/padrao`);
    await conferirGeometria(bia.page, `${rotulo}/padrao (Bia)`);
    await print(ana.page, 'truco-padrao');
    await print(bia.page, 'truco-padrao-bia');
    await ana.page.mouse.move(5, 5);
    await print(ana.page, 'truco-minimo');

    await conferirSemErro(pessoas, rotulo);
    await fecharPessoas(pessoas);
  } finally {
    await servidor.close();
  }
}

// ---------------------------------------------------------------------
// Oito maluco (2 jogadores, 640x400 / 420x280)
// ---------------------------------------------------------------------

async function cenaOito(browser) {
  const servidor = await createSignalingServer({ port: 0, ownerToken: 'bancada-leva2', log: () => {} });
  const rotulo = 'oito';
  try {
    const ana = await abrirPessoa(browser, servidor, 'Ana', true);
    const bia = await abrirPessoa(browser, servidor, 'Bia');
    const pessoas = [ana, bia];
    const id = await adicionarJanela(ana, 'oito', 140, 140, 640, 400);
    const idMin = await adicionarJanela(ana, 'oito', 900, 140, 420, 280);
    await espera(400);
    await verTudo(ana, bia);

    const wAna = janela(ana.page, id);
    const wBia = janela(bia.page, id);
    await wAna.locator('.mj-oito-selecao').selectOption('s').catch(() => {});
    await wAna.getByRole('button', { name: /^Sentar/ }).first().click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.seats.some(Boolean));
    await wBia.getByRole('button', { name: /^Sentar/ }).first().click();
    await esperaMsg(ana.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.seats.filter(Boolean).length === 2);
    await espera(200);
    await wAna.locator('.mj-oito-iniciar').click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.phase === 'play');
    await espera(200);

    const cartasDe = async (w) => w.locator('.mj-oito-minha .mj-oito-carta').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    await semVazamento(bia, await cartasDe(wAna), `${rotulo}: mao da Ana`);
    await semVazamento(ana, await cartasDe(wBia), `${rotulo}: mao da Bia`);

    // Tela cheia: no "Ver tudo" com 2 janelas de oito a caixa fica pequena
    // e os controles do canto atrapalham cliques perto da borda.
    await telaCheia(wAna);
    await telaCheia(wBia);

    let acabou = false;
    for (let i = 0; i < 200 && !acabou; i++) {
      const view = await ultimoEstado(ana.page, id);
      if (view && (view.phase === 'finished' || view.last)) { acabou = true; break; }
      for (const w of [wAna, wBia]) {
        const jogavel = w.locator('.mj-oito-carta:not([aria-disabled="true"])').first();
        if (await jogavel.count()) {
          await jogavel.click();
          await espera(100);
          continue;
        }
        const comprar = w.locator('.mj-oito-comprar');
        if ((await comprar.getAttribute('aria-disabled')) !== 'true') {
          await comprar.click();
          await espera(100);
        }
      }
      await espera(60);
    }
    conferir(acabou, `${rotulo}: a rodada terminou (alguem descartou a ultima carta)`);
    await sairTelaCheia(ana);
    await sairTelaCheia(bia);

    await verTudo(ana);
    await janela(ana.page, idMin).getByRole('button', { name: /^Sentar/ }).first().click();
    await espera(200);

    await conferirGeometria(ana.page, `${rotulo}/padrao`);
    await conferirGeometria(bia.page, `${rotulo}/padrao (Bia)`);
    await print(ana.page, 'oito-padrao');
    await ana.page.mouse.move(5, 5);
    await print(ana.page, 'oito-minimo');

    await conferirSemErro(pessoas, rotulo);
    await fecharPessoas(pessoas);
  } finally {
    await servidor.close();
  }
}

// ---------------------------------------------------------------------
// Domino (2 jogadores, 720x480 / 420x300)
// ---------------------------------------------------------------------

async function cenaDomino(browser) {
  const servidor = await createSignalingServer({ port: 0, ownerToken: 'bancada-leva2', log: () => {} });
  const rotulo = 'domino';
  try {
    const ana = await abrirPessoa(browser, servidor, 'Ana', true);
    const bia = await abrirPessoa(browser, servidor, 'Bia');
    const pessoas = [ana, bia];
    const id = await adicionarJanela(ana, 'domino', 140, 140, 720, 480);
    const idMin = await adicionarJanela(ana, 'domino', 1000, 140, 420, 300);
    await espera(400);
    await verTudo(ana, bia);

    const wAna = janela(ana.page, id);
    const wBia = janela(bia.page, id);
    await wAna.locator('.mj-do-lugar').nth(0).getByRole('button', { name: 'Sentar' }).click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.seats.some(Boolean));
    await wBia.locator('.mj-do-lugar').nth(1).getByRole('button', { name: 'Sentar' }).click();
    await esperaMsg(ana.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.seats.filter(Boolean).length === 2);
    await espera(200);
    await wAna.locator('.mj-do-topo button', { hasText: 'Nova mão' }).click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.phase === 'play');
    await espera(200);

    const pedrasDe = async (w) => w.locator('.mj-do-mao .mj-do-pedra').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    await semVazamento(bia, await pedrasDe(wAna), `${rotulo}: pedras da Ana`);
    await semVazamento(ana, await pedrasDe(wBia), `${rotulo}: pedras da Bia`);

    await telaCheia(wAna);
    await telaCheia(wBia);

    let acabou = false;
    for (let i = 0; i < 150 && !acabou; i++) {
      const view = await ultimoEstado(ana.page, id);
      if (view && view.phase === 'done') { acabou = true; break; }
      for (const w of [wAna, wBia]) {
        const jogavel = w.locator('.mj-do-mao .mj-do-pedra:not([aria-disabled="true"])').first();
        if (await jogavel.count()) {
          await jogavel.click();
          await espera(120);
          continue;
        }
        const comprar = w.locator('.mj-do-acoes button', { hasText: 'Comprar' });
        if ((await comprar.getAttribute('aria-disabled')) !== 'true') {
          await comprar.click();
          await espera(120);
          continue;
        }
        const passar = w.locator('.mj-do-acoes button', { hasText: 'Passar' });
        if ((await passar.getAttribute('aria-disabled')) !== 'true') {
          await passar.click();
          await espera(120);
        }
      }
      await espera(60);
    }
    conferir(acabou, `${rotulo}: a mao terminou (bateu ou trancou)`);
    await sairTelaCheia(ana);
    await sairTelaCheia(bia);

    await verTudo(ana);
    await janela(ana.page, idMin).locator('.mj-do-lugar').nth(0).getByRole('button', { name: 'Sentar' }).click();
    await espera(200);

    await conferirGeometria(ana.page, `${rotulo}/padrao`);
    await conferirGeometria(bia.page, `${rotulo}/padrao (Bia)`);
    await print(ana.page, 'domino-padrao');
    await ana.page.mouse.move(5, 5);
    await print(ana.page, 'domino-minimo');

    await conferirSemErro(pessoas, rotulo);
    await fecharPessoas(pessoas);
  } finally {
    await servidor.close();
  }
}

// ---------------------------------------------------------------------
// Stop / Adedonha (3 pessoas, pra ter maioria de verdade na anulacao)
// ---------------------------------------------------------------------

async function cenaStop(browser) {
  const servidor = await createSignalingServer({ port: 0, ownerToken: 'bancada-leva2', log: () => {} });
  const rotulo = 'stop';
  try {
    const ana = await abrirPessoa(browser, servidor, 'Ana', true);
    const bia = await abrirPessoa(browser, servidor, 'Bia');
    const caio = await abrirPessoa(browser, servidor, 'Caio');
    const pessoas = [ana, bia, caio];
    // Ana poe a janela: e quem cria (createdBy), so ela comeca/encerra.
    const id = await adicionarJanela(ana, 'stop', 140, 140, 720, 460);
    const idMin = await adicionarJanela(ana, 'stop', 1000, 140, 520, 340);
    await espera(400);
    await verTudo(ana, bia, caio);

    const wAna = janela(ana.page, id);
    const wBia = janela(bia.page, id);
    const wCaio = janela(caio.page, id);
    await wAna.getByRole('button', { name: 'Começar rodada' }).click();
    const iniciou = await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.phase === 'writing');
    const letra = iniciou.state.letter;
    conferir(typeof letra === 'string' && letra.length === 1, `${rotulo}: sorteou uma letra (${letra})`);
    await espera(200);

    // Cada um preenche as respostas (nao precisa acertar a categoria: so
    // testa o visual do preenchimento e do sigilo ate a correcao).
    for (const [w, pessoa] of [[wAna, 'ana'], [wBia, 'bia'], [wCaio, 'caio']]) {
      const campos = w.locator('.mj-stop-answers input');
      const n = await campos.count();
      for (let i = 0; i < n; i++) await campos.nth(i).fill(`${letra}-${pessoa}-${i}`);
      // As respostas so vao pra sala ao apertar "Guardar respostas" (nao
      // ha envio a cada tecla nem ao sair do campo, diferente da Nota).
      await w.getByRole('button', { name: 'Guardar respostas' }).click();
      await espera(80);
    }
    await espera(150);

    // Sigilo: antes do STOP, a resposta de uma pessoa nao pode chegar a
    // outra (a `view` so manda `myAnswers` de quem pediu).
    await semVazamento(bia, ['ana-0', 'ana-1'], `${rotulo}: respostas da Ana`);
    await semVazamento(ana, ['bia-0', 'bia-1'], `${rotulo}: respostas da Bia`);

    await wAna.getByRole('button', { name: 'STOP' }).click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.phase === 'review');
    await espera(250);

    // Correcao: anula uma resposta por votacao (maioria de 3 = 2 votos).
    await wAna.locator('.mj-stop-row').first().getByRole('button', { name: /^Anular/ }).click();
    await wBia.locator('.mj-stop-row').first().getByRole('button', { name: /^Anular/ }).click();
    await espera(200);
    await wAna.getByRole('button', { name: 'Somar e próxima rodada' }).click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.phase === 'setup');
    await espera(150);

    await conferirGeometria(ana.page, `${rotulo}/padrao`);
    await conferirGeometria(bia.page, `${rotulo}/padrao (Bia)`);
    await print(ana.page, 'stop-padrao');

    await verTudo(ana);
    await janela(ana.page, idMin).getByRole('button', { name: 'Começar rodada' }).click();
    await espera(300);
    await conferirGeometria(ana.page, `${rotulo}/minimo`);
    await ana.page.mouse.move(5, 5);
    await print(ana.page, 'stop-minimo');

    await conferirSemErro(pessoas, rotulo);
    await fecharPessoas(pessoas);
  } finally {
    await servidor.close();
  }
}

// ---------------------------------------------------------------------
// Quiz (2 jogadores, entram automaticamente ao criar a janela)
// ---------------------------------------------------------------------

async function cenaQuiz(browser) {
  const servidor = await createSignalingServer({ port: 0, ownerToken: 'bancada-leva2', log: () => {} });
  const rotulo = 'quiz';
  try {
    const ana = await abrirPessoa(browser, servidor, 'Ana', true);
    const bia = await abrirPessoa(browser, servidor, 'Bia');
    const pessoas = [ana, bia];
    const id = await adicionarJanela(ana, 'quiz', 140, 140, 560, 460);
    await espera(300);
    const idMin = await adicionarJanela(ana, 'quiz', 800, 140, 360, 320);
    await espera(400);
    await verTudo(ana, bia);

    const wAna = janela(ana.page, id);
    const wBia = janela(bia.page, id);
    // O Quiz nasce em preparo (todos os temas marcados): alguem aperta Comecar.
    await wAna.getByRole('button', { name: 'Começar' }).click();
    await janela(ana.page, idMin).getByRole('button', { name: 'Começar' }).click();
    await wAna.locator('.mj-quiz-alternativas .mj-quiz-opcao').first().waitFor();

    // Sigilo: antes dos dois responderem, ninguem sabe o que o outro
    // escolheu (view.me e so a propria escolha; history fica vazio).
    await wAna.locator('.mj-quiz-alternativas .mj-quiz-opcao').first().click();
    const antesDeBia = await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id);
    conferir(antesDeBia.state.history.length === 0 && antesDeBia.state.revealed === null,
      `${rotulo}: a rodada nao revela nada antes de todos responderem`);
    await espera(150);
    await wBia.locator('.mj-quiz-alternativas .mj-quiz-opcao').first().click();
    const depois = await esperaMsg(ana.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.history.length >= 1);
    conferir(depois.state.round >= 1 || depois.state.finished, `${rotulo}: a rodada avancou depois dos dois responderem`);
    await espera(200);

    await conferirGeometria(ana.page, `${rotulo}/padrao`);
    await conferirGeometria(bia.page, `${rotulo}/padrao (Bia)`);
    await print(ana.page, 'quiz-padrao');

    await janela(ana.page, idMin).locator('.mj-quiz-alternativas .mj-quiz-opcao').first().waitFor();
    await conferirGeometria(ana.page, `${rotulo}/minimo`);
    await ana.page.mouse.move(5, 5);
    await print(ana.page, 'quiz-minimo');

    await conferirSemErro(pessoas, rotulo);
    await fecharPessoas(pessoas);
  } finally {
    await servidor.close();
  }
}

// ---------------------------------------------------------------------
// Quadro (2 pessoas rabiscam juntas; sem cadeira nem acao no estado)
// ---------------------------------------------------------------------

async function cenaQuadro(browser) {
  const servidor = await createSignalingServer({ port: 0, ownerToken: 'bancada-leva2', log: () => {} });
  const rotulo = 'quadro';
  try {
    const ana = await abrirPessoa(browser, servidor, 'Ana', true);
    const bia = await abrirPessoa(browser, servidor, 'Bia');
    const pessoas = [ana, bia];
    const id = await adicionarJanela(ana, 'quadro', 140, 140, 640, 480);
    const idMin = await adicionarJanela(ana, 'quadro', 900, 140, 320, 240);
    await espera(400);
    await verTudo(ana, bia);

    const wAna = janela(ana.page, id);
    const wBia = janela(bia.page, id);
    const canvasAna = wAna.locator('.mj-qd-canvas');
    const canvasBia = wBia.locator('.mj-qd-canvas');
    await canvasAna.waitFor();
    const caixaAna = await canvasAna.boundingBox();
    await ana.page.mouse.move(caixaAna.x + 20, caixaAna.y + 20);
    await ana.page.mouse.down();
    await ana.page.mouse.move(caixaAna.x + 80, caixaAna.y + 80, { steps: 6 });
    await ana.page.mouse.up();
    await espera(300);
    const traçoChegouEmBia = await bia.page.evaluate(() => true).then(async () => {
      const n = await canvasBia.evaluate((c) => c.width);
      return n > 0;
    });
    conferir(traçoChegouEmBia, `${rotulo}: o canvas da Bia tem tamanho (renderizou)`);
    const pixelsAna = await canvasAna.evaluate((c) => { const ctx = c.getContext('2d'); return [...ctx.getImageData(0, 0, c.width, c.height).data].some((v, i) => i % 4 === 3 && v > 0); });
    const pixelsBia = await canvasBia.evaluate((c) => { const ctx = c.getContext('2d'); return [...ctx.getImageData(0, 0, c.width, c.height).data].some((v, i) => i % 4 === 3 && v > 0); });
    conferir(pixelsAna, `${rotulo}: o traco da Ana apareceu no proprio canvas`);
    conferir(pixelsBia, `${rotulo}: o traco da Ana chegou ao canvas da Bia pela rede`);

    // Bia (nao e dona) tambem pode desenhar -- "todo mundo rabisca".
    const caixaBia = await canvasBia.boundingBox();
    await bia.page.mouse.move(caixaBia.x + 100, caixaBia.y + 40);
    await bia.page.mouse.down();
    await bia.page.mouse.move(caixaBia.x + 140, caixaBia.y + 90, { steps: 6 });
    await bia.page.mouse.up();
    await espera(300);

    // Limpar: so quem pos (Ana) ou o lider. Bia tenta e ve o aviso.
    // aria-disabled (nao "disabled" de verdade -- comum.js#ligado): o
    // clique de um mouse de verdade chega ao JS mesmo assim; so o
    // Playwright bloqueia por padrao, entao forca.
    await wBia.getByRole('button', { name: 'Limpar' }).click({ force: true });
    const avisoBia = await wBia.locator('.mj-aviso.is-on').textContent().catch(() => '');
    conferir(!!avisoBia, `${rotulo}: Bia tentando limpar ve o motivo (${avisoBia})`);
    await wAna.getByRole('button', { name: 'Limpar' }).click();
    await espera(300);
    const limpouAna = await canvasAna.evaluate((c) => { const ctx = c.getContext('2d'); return ![...ctx.getImageData(0, 0, c.width, c.height).data].some((v, i) => i % 4 === 3 && v > 0); });
    conferir(limpouAna, `${rotulo}: Ana (dona da janela) limpa o quadro`);

    await conferirGeometria(ana.page, `${rotulo}/padrao`);
    await conferirGeometria(bia.page, `${rotulo}/padrao (Bia)`);
    await print(ana.page, 'quadro-padrao');

    await conferirGeometria(ana.page, `${rotulo}/minimo (mesma pagina, 2a janela)`);
    await ana.page.mouse.move(5, 5);
    await print(ana.page, 'quadro-minimo');
    void idMin;

    await conferirSemErro(pessoas, rotulo);
    await fecharPessoas(pessoas);
  } finally {
    await servidor.close();
  }
}

// ---------------------------------------------------------------------
// Desenha e adivinha (2 pessoas: Ana desenha, Bia chuta)
// ---------------------------------------------------------------------

async function cenaDesenha(browser) {
  const servidor = await createSignalingServer({ port: 0, ownerToken: 'bancada-leva2', log: () => {} });
  const rotulo = 'desenha';
  try {
    const ana = await abrirPessoa(browser, servidor, 'Ana', true);
    const bia = await abrirPessoa(browser, servidor, 'Bia');
    const pessoas = [ana, bia];
    const id = await adicionarJanela(ana, 'desenha', 140, 140, 720, 560);
    const idMin = await adicionarJanela(ana, 'desenha', 1000, 140, 460, 400);
    await espera(400);
    await verTudo(ana, bia);

    const wAna = janela(ana.page, id);
    const wBia = janela(bia.page, id);
    await wAna.getByRole('button', { name: 'Entrar na rodada' }).click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.players.length >= 1);
    await wBia.getByRole('button', { name: 'Entrar na rodada' }).click();
    await esperaMsg(ana.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.players.length >= 2);
    await espera(200);
    await wAna.getByRole('button', { name: 'Começar' }).click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.phase === 'choosing');
    await espera(200);

    // So quem desenha ve as 3 opcoes; e quem foi o primeiro a entrar
    // (Ana) e o primeiro da vez.
    const opcoesAna = await wAna.locator('.mj-ds-opcoes .mj-ds-opcao').evaluateAll((els) => els.map((e) => e.textContent.trim()));
    conferir(opcoesAna.filter(Boolean).length === 3, `${rotulo}: Ana (desenhista) ve as 3 opcoes (${opcoesAna})`);
    const opcoesBia = await wBia.locator('.mj-ds-opcoes').isVisible();
    conferir(!opcoesBia, `${rotulo}: Bia nao ve a escolha da palavra`);
    await semVazamento(bia, opcoesAna, `${rotulo}: as 3 opcoes da Ana`);

    const palavra = opcoesAna[0];
    await wAna.locator('.mj-ds-opcoes .mj-ds-opcao').first().click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state.phase === 'drawing');
    await espera(200);

    // Sigilo: a palavra escolhida nunca pode chegar ao socket de quem
    // ainda nao acertou (Bia).
    await semVazamento(bia, [palavra], `${rotulo}: a palavra "${palavra}"`);
    const vistaAna = await wAna.locator('.mj-ds-palavra').textContent();
    conferir(vistaAna.trim() === palavra, `${rotulo}: Ana ve a propria palavra (${vistaAna})`);
    const vistaBia = await wBia.locator('.mj-ds-palavra').textContent();
    conferir(!vistaBia.includes(palavra) && /^_/.test(vistaBia.trim()), `${rotulo}: Bia ve so o tamanho (${vistaBia})`);

    // Ana desenha um traco de verdade; confere que chega ao canvas da Bia.
    const canvasAna = wAna.locator('.mj-ds-canvas');
    const canvasBia = wBia.locator('.mj-ds-canvas');
    const caixaAna = await canvasAna.boundingBox();
    await ana.page.mouse.move(caixaAna.x + 30, caixaAna.y + 30);
    await ana.page.mouse.down();
    await ana.page.mouse.move(caixaAna.x + 120, caixaAna.y + 90, { steps: 8 });
    await ana.page.mouse.up();
    await espera(300);
    const pixelsBia = await canvasBia.evaluate((c) => { const ctx = c.getContext('2d'); return [...ctx.getImageData(0, 0, c.width, c.height).data].some((v, i) => i % 4 === 3 && v > 0); });
    conferir(pixelsBia, `${rotulo}: o traco da Ana chegou ao canvas da Bia`);

    // Bia (nao desenha) nao tem canvas clicavel -- checa que o pointerdown
    // dela nao manda `annotate` nenhum (o servidor tambem recusaria).
    const antesQtd = (await bia.page.evaluate(() => window.__caixa.length));
    const caixaBia = await canvasBia.boundingBox();
    await bia.page.mouse.move(caixaBia.x + 50, caixaBia.y + 50);
    await bia.page.mouse.down();
    await bia.page.mouse.move(caixaBia.x + 60, caixaBia.y + 60);
    await bia.page.mouse.up();
    await espera(200);
    // So as mensagens DEPOIS de antesQtd: Ana ja mandou 'annotate' antes
    // (o traco que acabou de chegar ao canvas de Bia), entao olhar a
    // caixa inteira sempre acharia um -- nao provaria nada do clique dela.
    const mandouTraco = await bia.page.evaluate((corte) => window.__caixa.slice(corte).some((m) => m.type === 'annotate'), antesQtd);
    conferir(!mandouTraco, `${rotulo}: Bia (nao desenha) nao consegue rabiscar`);

    // Bia chuta (errado de proposito -- nao sabe a palavra) e ve o evento.
    await wBia.locator('.mj-ds-campo').fill('resposta-errada-de-teste');
    await wBia.locator('.mj-ds-palpite button').click();
    await espera(300);
    const avisoAna = await wAna.locator('.mj-aviso.is-on').textContent().catch(() => '');
    conferir(avisoAna.includes('chutou'), `${rotulo}: o chute errado de Bia aparece pra Ana (${avisoAna})`);

    await conferirGeometria(ana.page, `${rotulo}/padrao`);
    await conferirGeometria(bia.page, `${rotulo}/padrao (Bia)`);
    await print(ana.page, 'desenha-padrao-ana');
    await print(bia.page, 'desenha-padrao-bia');

    await verTudo(ana);
    await janela(ana.page, idMin).getByRole('button', { name: 'Entrar na rodada' }).click();
    await espera(200);
    await conferirGeometria(ana.page, `${rotulo}/minimo`);
    await ana.page.mouse.move(5, 5);
    await print(ana.page, 'desenha-minimo');

    await conferirSemErro(pessoas, rotulo);
    await fecharPessoas(pessoas);
  } finally {
    await servidor.close();
  }
}

// ---------------------------------------------------------------------

// Sala mista: Ana em pt-BR (dona) e Bia em es na MESMA sala. Entre PCs so
// viajam codigos; cada pessoa monta o texto no proprio idioma. O texto
// esperado sai dos dicionarios de verdade, nunca de frase escrita a mao.

const DICIONARIOS = {
  'pt-BR': require('../../src/renderer/i18n/pt-BR'),
  es: require('../../src/renderer/i18n/es'),
};

/** Texto do dicionario `idioma` para `chave`, com {valores} preenchidos. */
function texto(idioma, chave, valores = {}) {
  const bruto = DICIONARIOS[idioma][chave];
  if (typeof bruto !== 'string') throw new Error(`sem texto ${idioma}/${chave}`);
  return bruto.replace(/\{(\w+)\}/g, (inteiro, nome) => (nome in valores ? String(valores[nome]) : inteiro));
}

/** Espera `fn` devolver algo verdadeiro (so para ler o DOM mudando). */
async function ate(fn, ms = 6000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const v = await fn();
    if (v) return v;
    await espera(40);
  }
  return null;
}

/** Algum `.mj-aviso` da pagina tem exatamente `esperado`? */
function temAviso(page, esperado) {
  return page.evaluate((e) => [...document.querySelectorAll('.mj-aviso')].some((n) => n.textContent.trim() === e),
    esperado);
}

function avisosDe(page) {
  return page.evaluate(() => [...document.querySelectorAll('.mj-aviso')].map((n) => `${n.className}|${n.textContent}`));
}

async function cenaMista(browser) {
  const servidor = await createSignalingServer({ port: 0, ownerToken: 'bancada-leva2', log: () => {} });
  const rotulo = 'mista';
  try {
    const ana = await abrirPessoa(browser, servidor, 'Ana', true, 'pt-BR');
    const bia = await abrirPessoa(browser, servidor, 'Bia', false, 'es');
    const pessoas = [ana, bia];
    const lingua = { Ana: 'pt-BR', Bia: 'es' };
    const ativos = await Promise.all(pessoas.map((p) => p.page.evaluate(() => window.GoLive.i18n.idiomaAtivo())));
    conferir(ativos[0] === 'pt-BR' && ativos[1] === 'es', `${rotulo}: idioma ativo da janela (${ativos})`);

    // ---------------- a. Truco: recusa no idioma de quem tentou ----------------
    const idTruco = await adicionarJanela(ana, 'truco', 140, 140, 720, 460);
    const idEnq = await adicionarJanela(ana, 'enquete', 900, 140, 360, 300);
    const idQuiz = await adicionarJanela(ana, 'quiz', 140, 700, 560, 460);
    await espera(500);
    await verTudo(ana, bia);
    const wTruco = { Ana: janela(ana.page, idTruco), Bia: janela(bia.page, idTruco) };
    const sentarAna = texto('pt-BR', 'mesa.cartas.sentar');
    const sentarBia = texto('es', 'mesa.cartas.sentar');
    await wTruco.Ana.locator('.mj-tr-pos-0').getByRole('button', { name: sentarAna }).click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === idTruco && m.state.seats[0]);
    await wTruco.Bia.locator('.mj-tr-pos-1').getByRole('button', { name: sentarBia }).click();
    await esperaMsg(ana.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === idTruco && m.state.seats[1]);
    await espera(200);
    await wTruco.Ana.getByRole('button', { name: texto('pt-BR', 'mesa.poquer.darAsCartas') }).click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === idTruco && m.state.hand);
    await espera(300);

    // Quem NAO esta na vez: a janela nao oferece "Jogar" (sem can.play); a
    // tentativa vai pelo mesmo canal que a janela usaria (act) e o servidor recusa.
    const vez = {};
    for (const p of pessoas) vez[p.nome] = (await ultimoEstado(p.page, idTruco))?.me?.can?.play === true;
    conferir(vez.Ana !== vez.Bia, `${rotulo}: exatamente uma na vez (${JSON.stringify(vez)})`);
    const fora = vez.Ana ? bia : ana;
    const botoesFora = await wTruco[fora.nome].locator('.mj-tr-carta button').count();
    conferir(botoesFora === 0, `${rotulo}: ${fora.nome} (fora da vez) nao tem botao de jogar (${botoesFora})`);
    await fora.page.evaluate((id) => {
      window.__ws.send(JSON.stringify({ type: 'mesa', op: 'act', id, action: { kind: 'play', index: 0, covered: false } }));
    }, idTruco);
    const negou = await esperaMsg(fora.page, (m) => m.type === 'mesa-denied', 4000).catch(() => null);
    conferir(!!negou, `${rotulo}: o servidor recusou a jogada de ${fora.nome}`);
    const recusa = texto(lingua[fora.nome], 'mesa.jogo.naoESuaVez');
    const viu = await ate(() => temAviso(fora.page, recusa), 3000);
    conferir(!!viu, `${rotulo}: recusa de ${fora.nome} em ${lingua[fora.nome]} "${recusa}" `
      + `(avisos ${JSON.stringify(await avisosDe(fora.page))}; mensagem ${JSON.stringify(negou)})`);
    await conferirSemErro(pessoas, `${rotulo}/truco`);

    // ---------------- b. Enquete: Sim/Nao no idioma de cada uma ----------------
    const wEnq = { Ana: janela(ana.page, idEnq), Bia: janela(bia.page, idEnq) };
    for (const p of pessoas) {
      const esperado = [texto(lingua[p.nome], 'mesa.enquete.sim'), texto(lingua[p.nome], 'mesa.enquete.nao')];
      await ate(async () => (await wEnq[p.nome].locator('.mj-enq-texto').count()) >= 2);
      const lidos = await wEnq[p.nome].locator('.mj-enq-texto').evaluateAll((els) => els.map((e) => e.textContent.trim()));
      conferir(JSON.stringify(lidos) === JSON.stringify(esperado),
        `${rotulo}: enquete de ${p.nome} mostra ${JSON.stringify(esperado)} (leu ${JSON.stringify(lidos)})`);
    }
    await conferirSemErro(pessoas, `${rotulo}/enquete`);

    // ---------------- c. Quiz: pergunta e alternativas na lingua de cada uma ----------------
    const banco = require('../../src/renderer/mesa-modules/quiz-perguntas');
    const wQuiz = { Ana: janela(ana.page, idQuiz), Bia: janela(bia.page, idQuiz) };
    await wQuiz.Ana.getByRole('button', { name: texto('pt-BR', 'quiz.comecar') }).click();
    await wQuiz.Ana.locator('.mj-quiz-alternativas .mj-quiz-opcao').first().waitFor();
    await wQuiz.Bia.locator('.mj-quiz-alternativas .mj-quiz-opcao').first().waitFor();
    await espera(300);
    for (const p of pessoas) {
      const view = await ultimoEstado(p.page, idQuiz);
      const q = view && view.question && banco.porId(view.question.id);
      conferir(!!q, `${rotulo}: ${p.nome} recebeu uma pergunta do banco (${JSON.stringify(view && view.question)})`);
      if (!q) continue;
      const alvo = lingua[p.nome] === 'es' ? 'es' : 'pt';
      const lido = (await wQuiz[p.nome].locator('.mj-quiz-pergunta').textContent()).trim();
      conferir(lido === q[alvo][0], `${rotulo}: pergunta de ${p.nome} em ${alvo} "${q[alvo][0]}" (leu "${lido}")`);
      const alts = await wQuiz[p.nome].locator('.mj-quiz-opcao .mj-quiz-opcao-texto')
        .evaluateAll((els) => els.map((e) => e.textContent.trim()));
      const esperadas = view.question.ordem.map((i) => q[alvo][1][i]);
      conferir(JSON.stringify(alts) === JSON.stringify(esperadas),
        `${rotulo}: alternativas de ${p.nome} em ${alvo} ${JSON.stringify(esperadas)} (leu ${JSON.stringify(alts)})`);
    }
    await conferirSemErro(pessoas, `${rotulo}/quiz`);

    // ---------------- d. Desenha: Bia acerta digitando a palavra em ESPANHOL ----------------
    const desenha = require('../../src/renderer/mesa-modules/desenha');
    const idDs = await adicionarJanela(ana, 'desenha', 900, 500, 720, 560);
    await espera(400);
    await verTudo(ana, bia);
    const wDs = { Ana: janela(ana.page, idDs), Bia: janela(bia.page, idDs) };
    await wDs.Ana.getByRole('button', { name: texto('pt-BR', 'mesa.desenha.entrarRodada') }).click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === idDs && m.state.players.length >= 1);
    await wDs.Bia.getByRole('button', { name: texto('es', 'mesa.desenha.entrarRodada') }).click();
    await esperaMsg(ana.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === idDs && m.state.players.length >= 2);
    await espera(200);
    await wDs.Ana.getByRole('button', { name: texto('pt-BR', 'mesa.desenha.comecar') }).click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === idDs && m.state.phase === 'choosing');
    await espera(200);
    // Escolhe de proposito uma palavra cuja forma em es difere da pt (senao nao provaria nada).
    const opcoesIds = (await ultimoEstado(ana.page, idDs)).options;
    let indice = opcoesIds.findIndex((id) => desenha.normalizar(desenha.palavraEm(id, 'es'))
      !== desenha.normalizar(desenha.palavraEm(id, 'pt-BR')));
    conferir(indice >= 0, `${rotulo}: ha opcao com forma es diferente da pt (${opcoesIds})`);
    if (indice < 0) indice = 0;
    const opcoesAna = await wDs.Ana.locator('.mj-ds-opcoes .mj-ds-opcao').evaluateAll((els) => els.map((e) => e.textContent.trim()));
    conferir(opcoesAna[indice] === desenha.palavraEm(opcoesIds[indice], 'pt-BR'),
      `${rotulo}: Ana ve a opcao em pt (${opcoesAna[indice]})`);
    await wDs.Ana.locator('.mj-ds-opcoes .mj-ds-opcao').nth(indice).click();
    await esperaMsg(bia.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === idDs && m.state.phase === 'drawing');
    await espera(300);
    const palavraId = (await ultimoEstado(ana.page, idDs)).word;
    const emEs = desenha.palavraEm(palavraId, 'es');
    const emPt = desenha.palavraEm(palavraId, 'pt-BR');
    const vistaAna = (await wDs.Ana.locator('.mj-ds-palavra').textContent()).trim();
    conferir(vistaAna === emPt, `${rotulo}: Ana ve a palavra em pt "${emPt}" (leu "${vistaAna}")`);
    await wDs.Bia.locator('.mj-ds-campo').fill(emEs);
    await wDs.Bia.locator('.mj-ds-palpite button').click();
    const acertou = await esperaMsg(ana.page, (m) => m.type === 'mesa' && m.op === 'state' && m.id === idDs
      && (m.state.players.find((q) => q.name === 'Bia') || {}).score > 0, 4000).catch(() => null);
    const estadoAna = await ultimoEstado(ana.page, idDs);
    conferir(!!acertou, `${rotulo}: o acerto "${emEs}" (es) da Bia foi aceito (estado da Ana: `
      + `${JSON.stringify(estadoAna).slice(0, 300)})`);
    // A rodada fecha com 2 pessoas; o aviso "a palavra era X" sai na lingua de cada uma.
    for (const p of pessoas) {
      const esperado = texto(lingua[p.nome], 'mesa.desenha.palavraEra', {
        palavra: desenha.palavraEm(palavraId, lingua[p.nome]),
        nome: p.nome === 'Ana' ? texto(lingua[p.nome], 'mesa.desenha.voce') : 'Ana',
      });
      const ok = await ate(() => temAviso(p.page, esperado), 3000);
      conferir(!!ok, `${rotulo}: aviso da palavra de ${p.nome} em ${lingua[p.nome]} "${esperado}" `
        + `(avisos ${JSON.stringify(await avisosDe(p.page))})`);
    }
    await conferirSemErro(pessoas, `${rotulo}/desenha`);
    await fecharPessoas(pessoas);
  } finally {
    await servidor.close();
  }
}

// ---------------------------------------------------------------------

const CENAS = {
  truco: cenaTruco,
  oito: cenaOito,
  domino: cenaDomino,
  stop: cenaStop,
  quiz: cenaQuiz,
  quadro: cenaQuadro,
  desenha: cenaDesenha,
  mista: cenaMista,
};

async function main() {
  const tipos = (pedidos.length ? pedidos : Object.keys(CENAS)).filter((t) => CENAS[t]);
  const browser = await chromium.launch();
  try {
    for (const tipo of tipos) {
      const antes = falhas.length;
      try {
        await CENAS[tipo](browser);
      } catch (e) {
        if (process.env.DEPURAR) console.error(e);
        falhas.push(`${tipo}: roteiro quebrou: ${e.message.split('\n')[0]}`);
      }
      console.log(`  ${tipo}: ${falhas.length - antes === 0 ? 'ok' : `${falhas.length - antes} falha(s)`}`);
    }
  } finally {
    await browser.close();
  }
  console.log(`${conferidos} conferencias, ${falhas.length} falha(s)`);
  for (const f of falhas) console.log(`  FALHOU ${f}`);
  if (!semPrints) console.log(`prints em ${path.relative(RAIZ, PRINTS)}`);
  process.exitCode = falhas.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
