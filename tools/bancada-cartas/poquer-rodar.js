'use strict';
/* global document, window */

/*
 * Roteiro da bancada do pôquer: abre `poquer.html` no Chromium do
 * Playwright, senta Ana, Bia e Caio, e joga uma mao inteira clicando como
 * uma pessoa faria (aumento pelo campo, all-in pelo atalho, pagar), com dois
 * all-ins de tamanhos diferentes -> pote principal e pote paralelo ate o
 * showdown. Confere o estado do "servidor", que nenhuma tela mostra carta
 * que nao devia, o relogio (tempo esgotado manda `timeout`) e tira os
 * prints em docs/prints/2026-09-25-cartas/poquer-*.png.
 *
 *   node tools/bancada-cartas/poquer-rodar.js
 *   node tools/bancada-cartas/poquer-rodar.js --sem-prints
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
const PAGINA = pathToFileURL(path.join(__dirname, 'poquer.html')).href;
const PRINTS = path.join(RAIZ, 'docs', 'prints', '2026-09-25-cartas');
const semPrints = process.argv.includes('--sem-prints');

const falhas = [];
let conferidos = 0;
function conferir(cond, msg) {
  conferidos++;
  if (!cond) falhas.push(msg);
}
const espera = (ms) => new Promise((r) => { setTimeout(r, ms); });
/** O milhar da interface usa espaco fino; para comparar, espaco comum. */
const semFino = (t) => String(t).split(String.fromCharCode(0x202f)).join(' ');

async function abrir(browser, params) {
  const page = await browser.newPage({ viewport: { width: 2300, height: 620 } });
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  await page.goto(`${PAGINA}?${new URLSearchParams(params || {})}`);
  await page.waitForSelector('body[data-pronto="1"]', { timeout: 5000 });
  const tela = (id) => page.locator(`[data-usuario="${id}"]`);
  const estado = () => page.evaluate(() => window.bancada.estado());
  return { page, tela, estado, erros };
}

async function print(page, nome, alvo) {
  if (semPrints) return;
  fs.mkdirSync(PRINTS, { recursive: true });
  const arq = path.join(PRINTS, `poquer-${nome}.png`);
  if (alvo) await alvo.screenshot({ path: arq });
  else await page.locator('#palco').screenshot({ path: arq });
}

/** Clica no botao (pelo texto que comeca com `texto`) dentro da tela. */
async function clicar(tela, texto) {
  await tela.locator('button', { hasText: texto }).filter({ visible: true }).first().click();
  await espera(40);
}

/** Nenhuma tela mostra carta que nao devia: so as proprias, as da mesa e,
 * no fim, as do showdown. Le o `aria-label` de cada carta desenhada. */
async function conferirSegredo(c, rotulo) {
  const s = await c.estado();
  const h = s.hand;
  for (const [id, i] of [['1', 0], ['2', 1], ['3', 2]]) {
    const seat = s.seats.indexOf(id);
    const ok = new Set(h ? h.board : []);
    if (h && seat >= 0 && h.holes[seat] && h.ids[seat] === id) for (const x of h.holes[seat]) ok.add(x);
    if (h && h.result) for (const k of h.result.shown) for (const x of h.holes[k]) ok.add(x);
    const nomes = await c.page.evaluate((cartas) => cartas, ok.size ? [...ok] : []);
    const vistas = await c.tela(id).locator('.mj-carta:not(.is-verso)').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    const permitidas = await c.page.evaluate((lista) => lista.map((x) => window.GoLive.mesaJanelasCartas.rotulo(x)), nomes);
    const vazou = vistas.filter((v) => !permitidas.includes(v));
    conferir(vazou.length === 0, `${rotulo}: tela ${i + 1} mostra carta alheia (${vazou.join(', ')})`);
    // E o texto inteiro da tela (rotulos inclusos) nao cita carta alheia.
    const texto = await c.tela(id).evaluate((el) => [el.textContent, ...[...el.querySelectorAll('[aria-label]')].map((n) => n.getAttribute('aria-label'))].join(' | '));
    const todas = await c.page.evaluate(() => window.GoLive.mesaBaralho.newDeck().map((x) => [x, window.GoLive.mesaJanelasCartas.rotulo(x)]));
    for (const [carta, nome] of todas) {
      if (!ok.has(carta) && texto.includes(nome)) conferir(false, `${rotulo}: tela ${i + 1} cita ${nome}`);
    }
  }
}

async function conferirGeral(c, rotulo) {
  const r = await c.page.evaluate(() => {
    const out = { vaza: [], semNome: 0 };
    for (const el of document.querySelectorAll('.conteudo')) {
      const mj = el.firstElementChild;
      if (mj.scrollWidth > mj.clientWidth + 1 || mj.scrollHeight > mj.clientHeight + 1) {
        out.vaza.push(`${mj.scrollWidth}x${mj.scrollHeight} > ${mj.clientWidth}x${mj.clientHeight}`);
      }
      for (const b of mj.querySelectorAll('button, input, select')) {
        if (b.offsetParent === null) continue;
        const nome = b.getAttribute('aria-label') || b.textContent.trim() || b.getAttribute('title');
        if (!nome) out.semNome++;
      }
      // Lugar fora da janela (cortado pela borda).
      const caixa = el.getBoundingClientRect();
      for (const l of mj.querySelectorAll('.mj-pq-lugar')) {
        const r = l.getBoundingClientRect();
        if (r.left < caixa.left - 1 || r.right > caixa.right + 1 || r.top < caixa.top - 1 || r.bottom > caixa.bottom + 1) out.vaza.push('lugar cortado');
      }
    }
    return out;
  });
  conferir(r.vaza.length === 0, `${rotulo}: conteudo sai da janela (${r.vaza.join('; ')})`);
  conferir(r.semNome === 0, `${rotulo}: ${r.semNome} controle(s) sem rotulo`);
}

async function maoCompleta(browser) {
  const c = await abrir(browser, {});
  const ana = c.tela('1');
  const bia = c.tela('2');
  const caio = c.tela('3');
  // Sentar: cada um no seu lugar (0, 3, 5), pelo botao "Sentar" do lugar.
  await ana.locator('.mj-pq-lugar').nth(0).getByRole('button', { name: 'Sentar' }).click();
  await bia.locator('.mj-pq-lugar').nth(3).getByRole('button', { name: 'Sentar' }).click();
  await caio.locator('.mj-pq-lugar').nth(5).getByRole('button', { name: 'Sentar' }).click();
  await espera(60);
  let s = await c.estado();
  conferir(s.seats[0] === '1' && s.seats[3] === '2' && s.seats[5] === '3', `sentar: ${JSON.stringify(s.seats)}`);
  // Fichas diferentes para ter all-ins de tamanhos diferentes.
  await c.page.evaluate(() => window.bancada.ajustar((e) => { e.stacks[3] = 300; e.stacks[5] = 120; return e; }));
  // Caio (menor) ganha o principal, Bia o paralelo, Ana perde.
  await c.page.evaluate(() => window.bancada.arrumar({ 5: 'Ah Ad', 3: 'Kh Kd', 0: 'Qs Jc' }, 'Ac 7d 2s Kc 9h'));
  await espera(40);
  await print(c.page, 'sentados');
  await clicar(ana, 'Dar as cartas');
  s = await c.estado();
  conferir(s.hand && s.button === 0 && s.hand.sbSeat === 3 && s.hand.bbSeat === 5, `botao e blinds: ${s.button} ${s.hand && s.hand.sbSeat} ${s.hand && s.hand.bbSeat}`);
  conferir(s.hand.toAct === 0, 'pre-flop: Ana fala primeiro');
  conferir(await ana.locator('.mj-pq-acoes').isVisible(), 'a barra de acoes aparece na vez de Ana');
  conferir(!(await bia.locator('.mj-pq-acoes').isVisible()), 'e nao aparece para Bia');
  await conferirSegredo(c, 'pre-flop');
  await conferirGeral(c, 'pre-flop');
  // Ana: aumentar para 60 pelo campo + Enter.
  const campo = ana.locator('input[type="number"]');
  await campo.fill('60');
  await espera(20);
  await print(c.page, 'preflop');
  await print(c.page, 'acoes', ana.locator('.janela'));
  await campo.press('Enter');
  await espera(60);
  s = await c.estado();
  conferir(s.hand.bets[0] === 60, `Ana aumentou para 60 (${s.hand.bets[0]})`);
  const anuncio = await bia.locator('.mj-pq-anuncio').textContent();
  conferir(anuncio.includes('Ana aumentou para 60'), `anuncio para Bia: "${anuncio}"`);
  await clicar(bia, 'Pagar 50');
  await clicar(caio, 'Pagar 40');
  s = await c.estado();
  conferir(s.hand.street === 'flop' && s.hand.toAct === 3, `flop, vez de Bia (${s.hand.street} ${s.hand.toAct})`);
  // Bia: all-in pelo atalho.
  await bia.getByRole('button', { name: 'All-in', exact: true }).click();
  await espera(20);
  const rot = await bia.locator('.mj-pq-botoes .mj-pri').textContent();
  conferir(/All-in 240/.test(semFino(rot)), `botao principal vira "All-in 240" (${rot})`);
  await bia.locator('.mj-pq-botoes .mj-pri').click();
  await espera(60);
  s = await c.estado();
  conferir(s.hand.status[3] === 'allin', 'Bia all-in');
  conferir(await caio.locator('.mj-pq-botoes button', { hasText: 'Pagar 60' }).isVisible(), 'Caio ve "Pagar 60" (all-in curto)');
  conferir(!(await caio.locator('.mj-pq-valores').isVisible()), 'Caio nao tem como aumentar');
  await conferirSegredo(c, 'flop');
  await print(c.page, 'flop-allin');
  await clicar(caio, 'Pagar 60');
  await clicar(ana, 'Pagar 240');
  await espera(60);
  s = await c.estado();
  const r = s.hand.result;
  conferir(!!r && !r.byFold, 'showdown');
  conferir(r && r.pots.length === 2 && r.pots[0].amount === 360 && r.pots[0].winners[0] === 5 && r.pots[1].amount === 360 && r.pots[1].winners[0] === 3,
    `potes: ${JSON.stringify(r && r.pots)}`);
  conferir(s.stacks[0] === 700 && s.stacks[3] === 360 && s.stacks[5] === 360, `fichas: ${s.stacks}`);
  const res = semFino(await ana.locator('.mj-pq-resultado').textContent());
  conferir(res.includes('Caio ganhou 360 com Trinca de ases (pote principal)') && res.includes('Bia ganhou 360 com Trinca de reis (pote paralelo 1)'), `texto do resultado: ${res}`);
  conferir((await ana.locator('.mj-pq-lugar').nth(5).locator('.mj-carta:not(.is-verso)').count()) === 2, 'no showdown Ana ve as cartas de Caio');
  const destaque = await ana.locator('.mj-pq-board .mj-carta.is-destaque').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).sort());
  conferir(JSON.stringify(destaque) === JSON.stringify(['nove de copas', 'rei de paus', 'ás de paus']), `mesa destaca so as cartas das maos vencedoras (${destaque})`);
  const est = await ana.locator('.mj-pq-lugar').nth(5).locator('.mj-pq-estado').textContent();
  conferir(est === 'Trinca', `o lugar de Caio diz o jogo (${est})`);
  await conferirSegredo(c, 'showdown');
  await conferirGeral(c, 'showdown');
  await print(c.page, 'showdown');
  await print(c.page, 'showdown-caio', caio.locator('.janela'));

  // Tempo: nova mao; o relogio passa dos 30 s e a janela da vez manda `timeout`.
  await clicar(bia, 'Dar as cartas');
  s = await c.estado();
  const vez = s.hand.toAct;
  await c.page.evaluate(() => window.bancada.avancar(31000));
  await espera(800);
  s = await c.estado();
  const log = await c.page.evaluate(() => window.bancada.log.filter((x) => x.kind === 'timeout' || x.negado));
  conferir(log.filter((x) => x.kind === 'timeout').length === 1, `um timeout aceito (${JSON.stringify(log)})`);
  conferir(s.hand.status[vez] === 'folded' || s.hand.toAct !== vez, 'quem estourou o tempo saiu da vez');
  await print(c.page, 'tempo');
  conferir(c.erros.length === 0, `erros na pagina: ${c.erros.join(' | ')}`);
  await c.page.close();
}

async function tamanhoMinimo(browser, tema) {
  const c = await abrir(browser, { tam: 'min', ...(tema ? { tema } : {}) });
  await c.tela('1').locator('.mj-pq-lugar').nth(0).getByRole('button', { name: 'Sentar' }).click();
  await c.tela('2').locator('.mj-pq-lugar').nth(2).getByRole('button', { name: 'Sentar' }).click();
  await c.tela('3').locator('.mj-pq-lugar').nth(6).getByRole('button', { name: 'Sentar' }).click();
  await espera(60);
  await clicar(c.tela('1'), 'Dar as cartas');
  await clicar(c.tela('1'), 'Pagar');
  await espera(60);
  await conferirGeral(c, `min${tema ? `/${tema}` : ''}`);
  await conferirSegredo(c, `min${tema ? `/${tema}` : ''}`);
  await print(c.page, `min${tema ? `-${tema === 'paper' ? 'papel' : tema}` : ''}`);
  conferir(c.erros.length === 0, `erros na pagina (min): ${c.erros.join(' | ')}`);
  await c.page.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await maoCompleta(browser);
    await tamanhoMinimo(browser);
    await tamanhoMinimo(browser, 'paper');
  } finally {
    await browser.close();
  }
  console.log(`${conferidos} conferências, ${falhas.length} falha(s)`);
  for (const f of falhas) console.log(`  FALHA: ${f}`);
  process.exitCode = falhas.length ? 1 : 0;
})();
