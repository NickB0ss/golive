'use strict';

/*
 * Prints do prototipo estatico do Sinal (docs/redesign-greenfield).
 * Uso: PLAYWRIGHT_DIR=<pasta do playwright> node tools/sinal-prototipo/prints.js <saida> [pagina...]
 * Injeta o sprite de icones no lugar de <!--SPRITE--> e fotografa em tres tamanhos.
 */

/* global document -- o page.evaluate roda no navegador */

const fs = require('node:fs');
const path = require('node:path');

const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const RAIZ = path.join(__dirname, '..', '..');
const SPRITE = fs.readFileSync(path.join(RAIZ, 'src', 'renderer', 'sinal', 'icons.svg'), 'utf8');
const TAMANHOS = [[1440, 900], [1180, 760], [960, 600]];

async function main() {
  const saida = process.argv[2];
  const paginas = process.argv.slice(3);
  fs.mkdirSync(saida, { recursive: true });
  const navegador = await chromium.launch();
  for (const nome of paginas.length ? paginas : ['inicio', 'sala']) {
    const fonte = path.join(__dirname, `${nome}.html`);
    const montada = path.join(__dirname, `.${nome}.montada.html`);
    fs.writeFileSync(montada, fs.readFileSync(fonte, 'utf8').replace('<!--SPRITE-->', SPRITE));
    for (const [w, h] of TAMANHOS) {
      const pagina = await navegador.newPage({ viewport: { width: w, height: h } });
      const erros = [];
      pagina.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
      pagina.on('requestfailed', (r) => erros.push(`falhou: ${r.url()}`));
      await pagina.goto(`file://${montada}`);
      await pagina.evaluate(() => document.fonts.ready);
      const arquivo = path.join(saida, `${nome}-${w}x${h}.png`);
      await pagina.screenshot({ path: arquivo });
      console.log(arquivo, erros.length ? erros : 'ok');
      await pagina.close();
    }
    fs.unlinkSync(montada);
  }
  await navegador.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
