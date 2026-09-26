'use strict';
/* global document, window */

/*
 * Roteiro da bancada do Blackjack: abre `blackjack.html` no Chromium do
 * Playwright com Ana, Bia e Caio lado a lado, joga rodadas pela interface
 * (sentar, apostar pelas fichas e pelo campo, seguro, dividir, dobrar,
 * parar, prazo estourando) como uma pessoa faria, confere o estado do
 * servidor e o que cada um ve, e tira os prints em
 * docs/prints/2026-09-25-cartas/blackjack-*.png.
 *
 *   node tools/bancada-cartas/rodar-blackjack.js
 *   node tools/bancada-cartas/rodar-blackjack.js --sem-prints
 *
 * Usa o Playwright instalado no sistema (PLAYWRIGHT_DIR, padrao
 * /opt/node22/lib/node_modules/playwright) e os navegadores que ja estao
 * la; nao roda `playwright install`. Nao e teste do `npm test` porque
 * precisa de navegador.
 */

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const PW = process.env.PLAYWRIGHT_DIR || '/opt/node22/lib/node_modules/playwright';
const { chromium } = require(PW);

const RAIZ = path.resolve(__dirname, '..', '..');
const PAGINA = pathToFileURL(path.join(__dirname, 'blackjack.html')).href;
const PRINTS = path.join(RAIZ, 'docs', 'prints', '2026-09-25-cartas');
const semPrints = process.argv.includes('--sem-prints');

const falhas = [];
let conferidos = 0;
function conferir(cond, msg) {
  conferidos++;
  if (!cond) falhas.push(msg);
}
const espera = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function abrir(browser, q) {
  const page = await browser.newPage({ viewport: { width: 2200, height: 720 } });
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  await page.goto(`${PAGINA}?${new URLSearchParams(q || {})}`);
  await page.waitForSelector('body[data-pronto="1"]', { timeout: 5000 });
  const p = (id) => page.locator(`[data-usuario="${id}"]`);
  const srv = () => page.evaluate(() => window.bancada.servidor());
  const view = (id) => page.evaluate((u) => window.bancada.view(u), id);
  const act = (id, a) => page.evaluate(([u, x]) => window.bancada.act(u, x), [id, a]);
  const botao = (id, nome) => p(id).getByRole('button', { name: nome, exact: true });
  return { page, p, srv, view, act, botao, erros };
}

async function print(c, nome) {
  if (semPrints) return;
  fs.mkdirSync(PRINTS, { recursive: true });
  await espera(60);
  await c.page.locator('body').screenshot({ path: path.join(PRINTS, `blackjack-${nome}.png`) });
}

/** Nada sai da janela e todo controle visivel tem nome. */
async function conferirGeral(c, rotulo) {
  const r = await c.page.evaluate(() => {
    const out = { vaza: [], semNome: 0 };
    for (const el of document.querySelectorAll('.conteudo')) {
      const mj = el.firstElementChild;
      if (!mj) continue;
      if (mj.scrollWidth > mj.clientWidth + 1 || mj.scrollHeight > mj.clientHeight + 1) {
        out.vaza.push(`${mj.scrollWidth}x${mj.scrollHeight} > ${mj.clientWidth}x${mj.clientHeight}`);
      }
      for (const b of mj.querySelectorAll('button, input')) {
        if (b.offsetParent === null) continue;
        const nome = b.getAttribute('aria-label') || b.textContent.trim() || b.getAttribute('title');
        const rot = b.id && document.querySelector(`label[for="${b.id}"]`);
        if (!nome && !rot) out.semNome++;
      }
    }
    return out;
  });
  conferir(r.vaza.length === 0, `${rotulo}: conteudo sai da janela (${r.vaza.join('; ')})`);
  conferir(r.semNome === 0, `${rotulo}: ${r.semNome} controle(s) sem rotulo`);
}

/** A carta fechada nao aparece em lugar nenhum de quem nao pode ver. */
async function conferirSegredo(c, rotulo) {
  const s = await c.srv();
  if (s.dealer.revealed || s.dealer.cards.length < 2) return;
  const fechada = s.dealer.cards[1];
  const visiveis = new Set([s.dealer.cards[0], ...s.hands.flatMap((h) => h.cards)]);
  for (const id of ['1', '2', '3']) {
    const v = await c.view(id);
    const json = JSON.stringify(v);
    conferir(!/"shoe"\s*:\s*\[/.test(json), `${rotulo}: sapato na view de ${id}`);
    if (!visiveis.has(fechada)) conferir(!json.includes(`"${fechada}"`), `${rotulo}: a fechada ${fechada} vazou na view de ${id}`);
  }
  const rotulos = await c.page.evaluate(() => [...document.querySelectorAll('.mj-bj-banca [aria-label]')].map((n) => n.getAttribute('aria-label')).join(' | '));
  conferir(rotulos.includes('carta virada'), `${rotulo}: a banca mostra a carta virada (${rotulos})`);
}

async function rodadaCompleta(c, tamRotulo, comPrints) {
  const { botao, p, page } = c;
  // Sentar pela interface.
  await botao('1', 'Sentar no lugar 1').click();
  await espera(40);
  await botao('2', 'Sentar no lugar 2').click();
  await espera(40);
  await botao('3', 'Sentar no lugar 4').click();
  await espera(60);
  let s = await c.srv();
  conferir(s.seats[0] === '1' && s.seats[1] === '2' && s.seats[3] === '3', `${tamRotulo}: sentaram (${JSON.stringify(s.seats)})`);
  conferir(s.chips[0] === 1000, `${tamRotulo}: 1 000 fichas ao sentar`);

  // Ana 8 8 (divide), Bia 5 6 (dobra), Caio T 9; banca As e 7h (18 macio).
  // Depois: divisao da Ana 3c e 9s; dobra da Ana Kh; dobra da Bia Qd.
  await page.evaluate(() => window.bancada.empilhar(['8s', '5h', 'Td', 'As', '8d', '6c', '9c', '7h', '3c', '9s', 'Kh', 'Qd']));

  // Apostas: Ana pelas fichas, Bia pelo campo (Enter), Caio depois.
  await botao('1', 'Somar 100 à aposta').click();
  await botao('1', 'Apostar').click();
  const campoBia = p('2').getByLabel('Valor da aposta');
  await campoBia.fill('50');
  await campoBia.press('Enter');
  await espera(80);
  s = await c.srv();
  conferir(s.bets[0] === 100 && s.bets[1] === 50, `${tamRotulo}: apostas pela interface (${JSON.stringify(s.bets)})`);
  conferir(await p('3').locator('.mj-bj-prazo').isVisible(), `${tamRotulo}: prazo das apostas aparece`);
  if (comPrints) await print(c, 'apostas');
  await botao('3', 'Somar 25 à aposta').click();
  await botao('3', 'Somar 25 à aposta').click();
  await botao('3', 'Apostar').click();
  await espera(80);
  s = await c.srv();
  conferir(s.phase === 'insurance', `${tamRotulo}: as aberto oferece seguro (${s.phase})`);
  await conferirSegredo(c, `${tamRotulo}/seguro`);
  conferir(await botao('1', 'Seguro de 50').isVisible(), `${tamRotulo}: botao de seguro com o valor`);
  conferir(!(await botao('1', 'Pedir').isVisible()), `${tamRotulo}: sem Pedir no seguro`);
  if (comPrints) await print(c, 'seguro');
  await botao('1', 'Seguro de 50').click();
  await botao('2', 'Sem seguro').click();
  await botao('3', 'Sem seguro').click();
  await espera(80);
  s = await c.srv();
  conferir(s.phase === 'play' && s.turn === 0, `${tamRotulo}: sem blackjack da banca, vez da Ana`);
  conferir(s.insuranceNet[0] === -50, `${tamRotulo}: seguro perdido`);
  await conferirSegredo(c, `${tamRotulo}/vez`);
  for (const nome of ['Pedir', 'Parar', 'Dobrar', 'Dividir']) conferir(await botao('1', nome).isVisible(), `${tamRotulo}: Ana ve ${nome}`);
  conferir(!(await botao('2', 'Pedir').isVisible()), `${tamRotulo}: Bia nao ve Pedir fora da vez`);

  await botao('1', 'Dividir').click();
  await espera(80);
  s = await c.srv();
  conferir(s.hands.filter((h) => h.seat === 0).length === 2, `${tamRotulo}: Ana dividiu`);
  conferir(await p('1').locator('.mj-bj-mao').count() >= 2, `${tamRotulo}: duas maos na tela`);
  conferir(!(await botao('1', 'Dividir').isVisible()), `${tamRotulo}: 8+3 nao divide`);
  if (comPrints) await print(c, 'dividir');
  await botao('1', 'Dobrar').click();
  await espera(60);
  // Teclado: a Ana para a segunda mao com Enter no botao focado.
  const parar = botao('1', 'Parar');
  await parar.focus();
  await parar.press('Enter');
  await espera(80);
  s = await c.srv();
  conferir(s.hands[s.turn] && s.hands[s.turn].seat === 1, `${tamRotulo}: vez da Bia depois das maos da Ana`);
  conferir(await page.evaluate(() => {
    const a = document.activeElement;
    return !!a && !!a.closest('[data-usuario="1"]');
  }), `${tamRotulo}: o foco da Ana fica dentro da janela quando os botoes somem`);
  const dobrarBia = botao('2', 'Dobrar');
  await dobrarBia.focus();
  await page.keyboard.press('Space');
  await espera(80);
  if (comPrints) await print(c, 'vez');
  await botao('3', 'Parar').click();
  await espera(100);
  s = await c.srv();
  conferir(s.phase === 'bets' && s.dealer.revealed, `${tamRotulo}: rodada paga`);
  const ana = s.hands.filter((h) => h.seat === 0).map((h) => h.result);
  conferir(JSON.stringify(ana) === '["win","lose"]', `${tamRotulo}: maos da Ana ${JSON.stringify(ana)}`);
  conferir(s.chips[0] === 1050 && s.chips[1] === 1100 && s.chips[3] === 1050, `${tamRotulo}: fichas depois (${JSON.stringify(s.chips)})`);
  const res = await p('1').locator('.mj-bj-res').allTextContents();
  conferir(res.includes('Ganhou 200') && res.includes('Perdeu 100'), `${tamRotulo}: resultado de cada mao na tela (${res.join(', ')})`);
  const falado = await p('2').locator('[role="status"][aria-live]').first().textContent();
  conferir(/Banca: 18 macio/.test(falado) && /Ganhou 100/.test(falado), `${tamRotulo}: anuncio curto do resultado (${falado})`);
  if (comPrints) await print(c, 'resultado');
  await conferirGeral(c, tamRotulo);
}

async function prazos(c) {
  const { page } = c;
  await c.act('1', { kind: 'bet', amount: 10 });
  await espera(60);
  let s = await c.srv();
  const r0 = s.round;
  await page.evaluate(() => window.bancada.pular(21000));
  await espera(2400);
  s = await c.srv();
  conferir(s.round === r0 + 1, `prazo: 20 s depois da primeira aposta as cartas saem (rodada ${s.round})`);
  conferir(s.hands.length === 1 && s.hands[0].seat === 0, 'prazo: quem nao apostou fica fora');
  for (let i = 0; i < 3 && s.phase !== 'bets'; i += 1) {
    await page.evaluate(() => window.bancada.pular(31000));
    await espera(2400);
    s = await c.srv();
  }
  conferir(s.phase === 'bets', `prazo: 30 s sem decidir, a mao para (${s.phase})`);
  const avisos = await page.locator('.mj-aviso.is-on').count();
  conferir(avisos === 0, `prazo: timeout repetido nao vira aviso (${avisos})`);
  const outros = (await page.evaluate(() => window.bancada.negados())).filter((n) => n.detail && !/prazo|tempo/i.test(n.detail));
  conferir(outros.length === 0, `prazo: recusas inesperadas ${JSON.stringify(outros)}`);
}

async function recompra(c) {
  const { page, botao } = c;
  await page.evaluate(() => {
    const s = window.bancada.servidor();
    s.chips[1] = 0;
  });
  // Qualquer entrega nova atualiza as telas: a Ana senta e sai de novo.
  await c.act('1', { kind: 'leave' });
  await espera(60);
  conferir(await botao('2', 'Recompra').isVisible(), 'recompra: aparece com zero fichas');
  await botao('2', 'Recompra').click();
  await espera(60);
  conferir((await c.srv()).chips[1] === 1000, 'recompra: volta a 1 000');
  conferir(await botao('1', 'Sentar no lugar 1').isVisible(), 'levantar: o lugar fica livre');
}

(async () => {
  const browser = await chromium.launch();
  try {
    let c = await abrir(browser, {});
    await rodadaCompleta(c, 'padrao', true);
    await prazos(c);
    await recompra(c);
    conferir(c.erros.length === 0, `erros no console: ${c.erros.join(' | ')}`);
    await c.page.close();

    c = await abrir(browser, { tam: 'min' });
    await rodadaCompleta(c, 'min', false);
    if (!semPrints) {
      await c.page.setViewportSize({ width: 1400, height: 420 });
      await print(c, 'min');
    }
    conferir(c.erros.length === 0, `min: erros no console: ${c.erros.join(' | ')}`);
    await c.page.close();

    c = await abrir(browser, { tema: 'paper', tam: 'grande' });
    await c.page.setViewportSize({ width: 3000, height: 720 });
    await rodadaCompleta(c, 'grande/papel', false);
    await print(c, 'papel-grande');
    conferir(c.erros.length === 0, `papel: erros no console: ${c.erros.join(' | ')}`);
    await c.page.close();
  } finally {
    await browser.close();
  }
  console.log(`${conferidos} conferencias, ${falhas.length} falha(s)`);
  for (const f of falhas) console.log(`  FALHA: ${f}`);
  process.exitCode = falhas.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
