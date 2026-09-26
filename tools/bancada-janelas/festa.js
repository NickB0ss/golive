'use strict';
/* global document, window, getComputedStyle, OfflineAudioContext */

/*
 * Roteiro da bancada das janelas da Festa (jam, sons, link): o mesmo jeito de
 * rodar.js (Ana a esquerda, Bia a direita, a sala imitada por bancada.js),
 * com a pagina festa.html, que simula a ponte `window.golive` no que estas
 * janelas usam (abrir link no navegador).
 *
 *   node tools/bancada-janelas/festa.js            # conferencias + prints
 *   node tools/bancada-janelas/festa.js --sem-prints
 *   node tools/bancada-janelas/festa.js jam        # so esse tipo
 *
 * Prints em docs/prints/2026-09-25-festa/. Usa o Playwright do sistema
 * (PLAYWRIGHT_DIR), como rodar.js.
 */

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const PW = process.env.PLAYWRIGHT_DIR || '/opt/node22/lib/node_modules/playwright';
const { chromium } = require(PW);

const RAIZ = path.resolve(__dirname, '..', '..');
const PAGINA = pathToFileURL(path.join(__dirname, 'festa.html')).href;
const PRINTS = path.join(RAIZ, 'docs', 'prints', '2026-09-25-festa');

const args = process.argv.slice(2);
const semPrints = args.includes('--sem-prints');
const TIPOS_TODOS = ['jam', 'sons', 'link'];
const pedidos = args.filter((a) => !a.startsWith('--'));
const TAMANHOS = ['min', 'grande'];

const falhas = [];
let conferidos = 0;

function conferir(cond, msg) {
  conferidos++;
  if (!cond) falhas.push(msg);
}

const espera = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function abrir(browser, tipo, tam, extra) {
  const { tema, ...opts } = extra || {};
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 }, ...opts });
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  const q = new URLSearchParams({ tipo, tam, ...(tema ? { tema } : {}) });
  await page.goto(`${PAGINA}?${q}`);
  await page.waitForSelector('body[data-pronto="1"]', { timeout: 5000 });
  const ana = page.locator('[data-usuario="1"]');
  const bia = page.locator('[data-usuario="2"]');
  const estado = (id) => page.evaluate((u) => window.bancada.estado(u), id || '1');
  const act = (id, a) => page.evaluate(([u, x]) => window.bancada.act(u, x), [id, a]);
  return { page, ana, bia, estado, act, erros };
}

/** O mesmo de rodar.js: nada sai da janela, todo controle tem nome, so
 * transform/opacidade/cor animam. */
async function conferirGeral(ctx, rotulo) {
  const r = await ctx.page.evaluate(() => {
    const out = { vaza: [], semNome: 0, props: [] };
    for (const el of document.querySelectorAll('.conteudo')) {
      const mj = el.firstElementChild;
      if (!mj) continue;
      if (mj.scrollWidth > mj.clientWidth + 1 || mj.scrollHeight > mj.clientHeight + 1) {
        out.vaza.push(`${mj.scrollWidth}x${mj.scrollHeight} > ${mj.clientWidth}x${mj.clientHeight}`);
      }
      for (const b of mj.querySelectorAll('button, input, select, textarea')) {
        if (b.offsetParent === null) continue;
        const nome = b.getAttribute('aria-label') || b.textContent.trim() || b.getAttribute('title') || b.getAttribute('placeholder');
        if (!nome && !b.closest('label')) out.semNome++;
      }
      for (const n of mj.querySelectorAll('*')) {
        const tp = getComputedStyle(n).transitionProperty;
        for (const p of tp.split(',').map((x) => x.trim())) {
          if (!['all', 'transform', 'opacity', 'background-color', 'border-color', 'color', 'none', ''].includes(p)) out.props.push(p);
        }
      }
    }
    return out;
  });
  conferir(r.vaza.length === 0, `${rotulo}: conteudo sai da janela (${r.vaza.join('; ')})`);
  conferir(r.semNome === 0, `${rotulo}: ${r.semNome} controle(s) sem rotulo`);
  conferir(r.props.length === 0, `${rotulo}: transicao fora de transform/opacidade (${[...new Set(r.props)].join(', ')})`);
}

const JAM = 'https://spotify.link/AbCdEf12345';

// ---------- Roteiros por tipo ----------

const ROTEIROS = {
  async jam(c, tam) {
    const campo = c.ana.locator('input[aria-label="Link do Jam"]');
    // Link que nao e de Jam: recusado ali mesmo, sem ir para a sala.
    await campo.fill('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
    await campo.press('Enter');
    await espera(40);
    conferir(await c.ana.locator('.mj-aviso.is-on').isVisible(), `jam/${tam}: link de musica e recusado com motivo`);
    conferir((await c.estado('2')).link === null, `jam/${tam}: nada foi para a sala`);
    await campo.fill(`${JAM}?si=abc`);
    await c.ana.getByRole('button', { name: 'Pôr' }).click();
    await espera(50);
    let s = await c.estado('2');
    conferir(s.link === JAM && s.joined.join() === '1', `jam/${tam}: Ana cola o Jam e entra na lista (${JSON.stringify(s)})`);
    // Bia abre e marca "Entrei".
    await c.bia.getByRole('button', { name: 'Entrar no Jam' }).click();
    await espera(40);
    const abertos = await c.page.evaluate(() => window.linksAbertos);
    conferir(abertos.length === 1 && abertos[0][0] === 'jam' && abertos[0][1] === JAM, `jam/${tam}: Entrar abre o link pela ponte (${JSON.stringify(abertos)})`);
    await c.bia.locator('button', { hasText: 'Entrei' }).click();
    await espera(40);
    s = await c.estado('1');
    conferir(s.joined.join() === '1,2', `jam/${tam}: Bia marca que entrou`);
    conferir((await c.ana.locator('.mj-jam-lista li').count()) === 2, `jam/${tam}: Ana ve os dois na lista`);
    conferir((await c.bia.locator('button', { hasText: 'Saí' }).getAttribute('aria-pressed')) === 'true', `jam/${tam}: botao vira Sai`);
    await c.bia.locator('button', { hasText: 'Saí' }).click();
    await espera(40);
    conferir((await c.estado('1')).joined.join() === '1', `jam/${tam}: Bia sai da lista`);
    // Trocar e tirar.
    await c.bia.getByRole('button', { name: 'Tirar o Jam da janela' }).click();
    await espera(40);
    conferir((await c.estado('1')).link === null, `jam/${tam}: Tirar limpa a janela`);
    conferir(await c.ana.locator('input[aria-label="Link do Jam"]').isVisible(), `jam/${tam}: volta o campo`);
  },

  async sons(c, tam) {
    const tocados = () => c.page.evaluate(() => window.sonsTocados);
    await c.page.evaluate(() => { try { localStorage.removeItem('golive-mesa-sons'); } catch { /* sem */ } });
    // Retrato com um som de agora ha pouco: nao toca (so `act` novo toca).
    await c.page.evaluate(() => window.bancada.impor({ n: 3, last: { n: 3, sound: 'sino', at: Date.now(), by: '2' }, recent: {} }));
    await espera(60);
    conferir((await tocados()) === 0, `sons/${tam}: retrato nao toca som antigo`);
    await c.ana.getByRole('button', { name: 'Tocar Buzina para todos' }).click();
    await espera(80);
    let s = await c.estado('2');
    conferir(s.last && s.last.sound === 'buzina' && s.last.by === '1' && s.n === 4, `sons/${tam}: Ana toca a buzina (${JSON.stringify(s.last)})`);
    conferir((await tocados()) === 2, `sons/${tam}: tocou nos dois PCs (${await tocados()})`);
    // Espera de 3 s: os botoes de Ana desligam, os de Bia nao.
    const sino = c.ana.getByRole('button', { name: 'Tocar Sino para todos' });
    conferir((await sino.getAttribute('aria-disabled')) === 'true', `sons/${tam}: Ana espera 3 s`);
    conferir((await c.bia.getByRole('button', { name: 'Tocar Sino para todos' }).getAttribute('aria-disabled')) === null, `sons/${tam}: Bia nao espera`);
    conferir(await c.ana.locator('.mj-sons-espera.is-on').isVisible(), `sons/${tam}: barrinha da espera aparece`);
    await sino.focus();
    await sino.press('Enter');
    conferir(await c.ana.locator('.mj-aviso.is-on').isVisible(), `sons/${tam}: clique na espera mostra o motivo`);
    // Mesmo mandando direto (sem o botao), o servidor recusa.
    await c.act('1', { kind: 'play', sound: 'apito' });
    await espera(40);
    conferir((await c.page.evaluate(() => window.bancada.negados().length)) === 1, `sons/${tam}: o servidor recusa o segundo som em 3 s`);
    // Bia silencia e toca: so Ana ouve.
    const mudo = c.bia.getByRole('button', { name: 'Silenciar os sons neste PC' });
    await mudo.click();
    conferir((await c.bia.getByRole('button', { name: 'Ligar os sons neste PC' }).getAttribute('aria-pressed')) === 'true', `sons/${tam}: mudo fica marcado`);
    const salvo = await c.page.evaluate(() => localStorage.getItem('golive-mesa-sons'));
    conferir(/"muted":true/.test(salvo || ''), `sons/${tam}: mudo guardado neste PC (${salvo})`);
    await c.bia.getByRole('button', { name: 'Tocar Palmas para todos' }).click();
    await espera(80);
    conferir((await tocados()) === 3, `sons/${tam}: com Bia muda, so Ana ouve (${await tocados()})`);
    conferir((await c.ana.locator('.mj-sons-tocou').textContent()).includes('Bia tocou Palmas'), `sons/${tam}: rodape diz quem tocou`);
    // Depois de 3 s Ana toca de novo.
    await espera(3000);
    conferir((await sino.getAttribute('aria-disabled')) === null, `sons/${tam}: a espera acaba e o botao volta`);
    await sino.click();
    await espera(80);
    conferir((await c.estado('2')).last.sound === 'sino', `sons/${tam}: Ana toca o sino depois de 3 s`);
    await c.page.evaluate(() => { try { localStorage.removeItem('golive-mesa-sons'); } catch { /* sem */ } });
  },

  async link(c, tam) {
    const url = c.ana.locator('input[aria-label="Endereço (https://)"]');
    await url.fill('http://example.com/');
    await url.press('Enter');
    await espera(40);
    conferir(await c.ana.locator('.mj-aviso.is-on').isVisible(), `link/${tam}: http e recusado com motivo`);
    await url.fill('https://example.com/regras?v=2');
    await c.ana.locator('input[aria-label="Título do link (opcional)"]').fill('Regras do jogo');
    await c.ana.getByRole('button', { name: 'Pôr' }).click();
    await espera(50);
    const s = await c.estado('2');
    conferir(s.url === 'https://example.com/regras?v=2' && s.title === 'Regras do jogo' && s.host === 'example.com', `link/${tam}: Ana poe o link (${JSON.stringify(s)})`);
    conferir((await c.bia.locator('.mj-link-titulo').textContent()) === 'Regras do jogo', `link/${tam}: Bia ve o titulo`);
    // Abrir pergunta antes, com o dominio; Cancelar nao abre.
    await c.bia.getByRole('button', { name: 'Abrir no navegador' }).click();
    const perg = c.bia.locator('.mj-link-pergunta');
    conferir((await perg.textContent()) === 'Abrir example.com no seu navegador?', `link/${tam}: pergunta com o dominio`);
    await c.bia.locator('.mj-link-confirma').getByRole('button', { name: 'Cancelar' }).click();
    conferir((await c.page.evaluate(() => window.linksAbertos.length)) === 0, `link/${tam}: Cancelar nao abre`);
    // Esc tambem desiste.
    await c.bia.getByRole('button', { name: 'Abrir no navegador' }).click();
    await c.page.keyboard.press('Escape');
    conferir(!(await perg.isVisible()), `link/${tam}: Esc fecha a pergunta`);
    // Link trocado com a pergunta aberta: a pergunta some.
    await c.bia.getByRole('button', { name: 'Abrir no navegador' }).click();
    await c.act('1', { kind: 'set', url: 'https://outro.example.org/' });
    await espera(40);
    conferir(!(await perg.isVisible()), `link/${tam}: link novo fecha a pergunta aberta`);
    await c.bia.getByRole('button', { name: 'Abrir no navegador' }).click();
    await c.bia.locator('.mj-link-confirma').getByRole('button', { name: 'Abrir', exact: true }).click();
    await espera(40);
    const abertos = await c.page.evaluate(() => window.linksAbertos);
    conferir(abertos.length === 1 && abertos[0][0] === 'link' && abertos[0][1] === 'https://outro.example.org/', `link/${tam}: Abrir manda pela ponte (${JSON.stringify(abertos)})`);
    await c.bia.getByRole('button', { name: 'Tirar o link da janela' }).click();
    await espera(40);
    conferir((await c.estado('1')).url === null, `link/${tam}: Tirar limpa`);
  },
};

// Cenas dos prints: o estado mais cheio de cada tipo.
const CENAS = {
  jam: [
    { kind: 'set', url: JAM, de: '1' }, { kind: 'join', de: '2' }, { kind: 'join', de: '3' }, { kind: 'join', de: '4' },
  ],
  sons: [{ kind: 'play', sound: 'badumtss', de: '2' }],
  link: [{ kind: 'set', url: 'https://pt.wikipedia.org/wiki/Jogo_de_tabuleiro', title: 'Jogos de tabuleiro (Wikipédia)', de: '2' }],
};

async function montarCena(c, tipo) {
  for (const { de, ...a } of CENAS[tipo] || []) {
    await c.act(de, a);
    await espera(20);
  }
  await espera(200);
}

async function prints(browser, tipos) {
  fs.mkdirSync(PRINTS, { recursive: true });
  for (const tipo of tipos) {
    for (const tam of TAMANHOS) {
      for (const tema of ['marca', 'paper']) {
        const c = await abrir(browser, tipo, tam, { reducedMotion: 'reduce', tema: tema === 'marca' ? '' : tema });
        await montarCena(c, tipo);
        if (tipo === 'link') await c.bia.getByRole('button', { name: 'Abrir no navegador' }).click();
        await c.page.mouse.move(0, 0);
        await c.page.locator('#palco').screenshot({ path: path.join(PRINTS, `${tipo}-${tam}-${tema === 'paper' ? 'papel' : 'padrao'}.png`) });
        await c.page.close();
      }
    }
    // O estado vazio (sem Jam, sem link) tambem vai para o print.
    if (tipo !== 'sons') {
      const c = await abrir(browser, tipo, 'padrao', { reducedMotion: 'reduce' });
      await c.page.locator('#palco').screenshot({ path: path.join(PRINTS, `${tipo}-vazio-padrao.png`) });
      await c.page.close();
    }
  }
}

async function main() {
  const browser = await chromium.launch();
  const tipos = (pedidos.length ? pedidos : TIPOS_TODOS).filter((t) => ROTEIROS[t]);
  for (const tipo of tipos) {
    for (const tam of TAMANHOS) {
      const c = await abrir(browser, tipo, tam);
      try {
        await conferirGeral(c, `${tipo}/${tam} (inicio)`);
        await ROTEIROS[tipo](c, tam);
        await conferirGeral(c, `${tipo}/${tam} (fim)`);
      } catch (e) {
        falhas.push(`${tipo}/${tam}: roteiro quebrou: ${e.message.split('\n')[0]}`);
      }
      const erros = c.erros.filter((e) => !/ERR_FILE_NOT_FOUND/.test(e));
      conferir(erros.length === 0, `${tipo}/${tam}: erros na pagina: ${erros.join(' | ')}`);
      await c.page.close();
    }
  }
  // Cada som renderizado de verdade (OfflineAudioContext do Chromium): tem
  // som, nao estoura e acaba ate 1,5 s.
  if (tipos.includes('sons')) {
    const page = await browser.newPage();
    await page.goto(`${PAGINA}?tipo=sons&tam=padrao`);
    await page.waitForSelector('body[data-pronto="1"]', { timeout: 5000 });
    const medidas = await page.evaluate(async () => {
      const J = window.GoLive.mesaJanelas.sons;
      const out = {};
      for (const som of window.GoLive.mesaModules.sons.SOUNDS) {
        const taxa = 44100;
        const ac = new OfflineAudioContext(1, Math.ceil(taxa * 1.8), taxa);
        J.tocar(ac, J.partitura(som), 1);
        const buf = await ac.startRendering();
        const d = buf.getChannelData(0);
        let pico = 0;
        let soma = 0;
        let ultimo = 0;
        for (let i = 0; i < d.length; i++) {
          const a = Math.abs(d[i]);
          if (a > pico) pico = a;
          soma += d[i] * d[i];
          if (a > 0.001) ultimo = i;
        }
        out[som] = { pico: Number(pico.toFixed(3)), rms: Number(Math.sqrt(soma / d.length).toFixed(4)), fim: Number((ultimo / taxa).toFixed(3)) };
      }
      return out;
    });
    for (const [som, r] of Object.entries(medidas)) {
      conferir(r.rms > 0.005 && r.pico > 0.05, `sons/render: ${som} quase mudo (${JSON.stringify(r)})`);
      conferir(r.pico <= 1, `sons/render: ${som} estoura (${JSON.stringify(r)})`);
      conferir(r.fim <= 1.55, `sons/render: ${som} passa de 1,5 s (${JSON.stringify(r)})`);
    }
    console.log('sons (pico, rms, fim em s):', JSON.stringify(medidas));
    await page.close();
  }
  // Som que chega com mais de 2 s de atraso nao toca.
  if (tipos.includes('sons')) {
    const page = await browser.newPage();
    await page.goto(`${PAGINA}?tipo=sons&tam=padrao&atraso=2300`);
    await page.waitForSelector('body[data-pronto="1"]', { timeout: 5000 });
    await page.evaluate(() => window.bancada.act('1', { kind: 'play', sound: 'apito' }));
    await espera(2600);
    const r = await page.evaluate(() => ({ n: window.bancada.estado('2').n, tocados: window.sonsTocados }));
    conferir(r.n === 1 && r.tocados === 0, `sons/atraso: play de 2,3 s atras chega mas nao toca (${JSON.stringify(r)})`);
    await page.close();
  }
  if (!semPrints) await prints(browser, tipos);
  await browser.close();
  console.log(`${conferidos} conferencias, ${falhas.length} falha(s)`);
  for (const f of falhas) console.log(`  FALHOU ${f}`);
  if (!semPrints) console.log(`prints em ${path.relative(RAIZ, PRINTS)}`);
  process.exitCode = falhas.length ? 1 : 0;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
