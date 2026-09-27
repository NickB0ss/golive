'use strict';
/* global window, document, location, getComputedStyle */

/*
 * Roteiro "caber" da bancada das janelas da Mesa. Abre cada tipo que a
 * bancada monta, nos tamanhos padrao, minimo e grande e nos temas padrao e
 * Papel, para achar rolagem, conteudo fora da caixa e controles cobertos.
 *
 *   node tools/bancada-janelas/caber.js             # todos os tipos
 *   node tools/bancada-janelas/caber.js roleta nota # so os tipos pedidos
 *
 * `tam=padrao` e intencional: a bancada atual cai no tamanho padrao para
 * valores desconhecidos; o contrato da bancada passara a reconhece-lo.
 * Usa o Playwright instalado em PLAYWRIGHT_DIR (ou no caminho padrao), sem
 * baixar navegador. Nao entra no npm test pois precisa do Chromium.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PW = process.env.PLAYWRIGHT_DIR || '/opt/node22/lib/node_modules/playwright';
const { chromium } = require(PW);
const registro = require('../../src/renderer/mesa-modules');

const RAIZ = path.resolve(__dirname, '..', '..');
const PAGINA = pathToFileURL(path.join(__dirname, 'index.html')).href;
const PRINTS = path.join(RAIZ, 'docs', 'prints', '2026-09-27-caber');
const TEMAS = ['padrao', 'papel'];
const CHEIOS = new Set(['roleta', 'poquer', 'blackjack', 'lista', 'enquete', 'stop', 'quiz', 'truco']);
const pedidos = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const falhas = [];
let conferidos = 0;

function conferir(cond, msg) {
  conferidos += 1;
  if (!cond) falhas.push(msg);
}

function tiposDoRegistro() {
  return registro.MODULE_NAMES.filter((tipo) => registro.get(tipo));
}

function conferirTeto(tipos) {
  for (const tipo of tipos) {
    const mod = registro.get(tipo);
    conferir(mod.size.w <= 1000, `${tipo}/teto: largura ${mod.size.w} passa de 1000`);
    // O `size` do registro ja e o externo (conteudo + barra), ver mesa-modules/index.js.
    conferir(mod.size.h <= 620, `${tipo}/teto: altura externa ${mod.size.h} passa de 620`);
  }
}

async function abrir(browser, tipo, tam, tema) {
  const page = await browser.newPage({ viewport: { width: 2200, height: 1300 } });
  const erros = [];
  page.on('pageerror', (erro) => erros.push(String(erro)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text());
  });
  const params = new URLSearchParams({ tipo, tam, ...(tema === 'papel' ? { tema: 'paper' } : {}) });
  await page.goto(`${PAGINA}?${params}`);
  await page.waitForSelector('body[data-pronto="1"]', { timeout: 5000 });
  return { page, erros };
}

function medirEAssinar() {
  function rotuloLocal(el) {
    const classes = [...el.classList].join('.');
    const texto = el.textContent ? ` "${el.textContent.trim().slice(0, 20)}"` : '';
    return `${el.tagName.toLowerCase()}.${classes}${texto}`;
  }

  function estaVisivel(el, raiz) {
    for (let atual = el; atual; atual = atual.parentElement) {
      const estilo = getComputedStyle(atual);
      if (estilo.display === 'none' || estilo.visibility === 'hidden' || Number(estilo.opacity) === 0) {
        return false;
      }
      if (atual === raiz) break;
    }
    const ret = el.getBoundingClientRect();
    return ret.width > 0 && ret.height > 0;
  }

  function assinaturaVisivel(raiz) {
    const assinatura = {};
    for (const el of raiz.querySelectorAll('*')) {
      if (!estaVisivel(el, raiz)) continue;
      const classes = [...el.classList].sort().join('.');
      const chave = `${el.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`;
      assinatura[chave] = (assinatura[chave] || 0) + 1;
    }
    return assinatura;
  }

  const corpo = window.bancada.conteudoEl('1');
  const caixa = corpo.getBoundingClientRect();
  const problemas = [];
  const tam = new URLSearchParams(location.search).get('tam');
  if (corpo.scrollHeight > corpo.clientHeight + 1) {
    problemas.push(`rola na altura (${corpo.scrollHeight}>${corpo.clientHeight})`);
  }
  if (corpo.scrollWidth > corpo.clientWidth + 1) {
    problemas.push(`rola na largura (${corpo.scrollWidth}>${corpo.clientWidth})`);
  }
  for (const el of corpo.querySelectorAll('*')) {
    const estilo = getComputedStyle(el);
    if (estilo.display === 'none' || estilo.visibility === 'hidden') continue;
    const ret = el.getBoundingClientRect();
    if (ret.width === 0 || ret.height === 0) continue;
    const fora = ret.left < caixa.left - 1 || ret.top < caixa.top - 1
      || ret.right > caixa.right + 1 || ret.bottom > caixa.bottom + 1;
    if (fora && !el.closest('[data-caber-rola]')) problemas.push(`fora da caixa: ${rotuloLocal(el)}`);
    const rola = /(auto|scroll)/.test(estilo.overflowY) && el.scrollHeight > el.clientHeight + 1;
    if (rola && tam === 'padrao') problemas.push(`rolagem escondida no padrao: ${rotuloLocal(el)}`);
  }
  for (const el of corpo.querySelectorAll('button, input, select, textarea, [role="button"]')) {
    const ret = el.getBoundingClientRect();
    if (ret.width === 0 || ret.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
    const alvo = document.elementFromPoint(ret.left + ret.width / 2, ret.top + ret.height / 2);
    if (!alvo || (alvo !== el && !el.contains(alvo))) {
      problemas.push(`coberto: ${rotuloLocal(el)} por ${alvo ? rotuloLocal(alvo) : 'nada'}`);
    }
  }
  return { problemas, assinatura: assinaturaVisivel(corpo) };
}

function montarCheio(tipo) {
  const mod = window.GoLive.mesaModules[tipo];
  const pessoas = ['Ana', 'Bia', 'Caio', 'Duda', 'Eli'].map((name, i) => ({ id: String(i + 1), name }));
  let semente = 17;
  const random = () => {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648;
  };
  let agora = 1700000000000;
  let estado = mod.init({ by: '1', from: '1', isLeader: true, peers: pessoas, now: agora, random });
  const agir = (de, acao) => {
    const ctx = { from: de, by: de, isLeader: de === '1', peers: pessoas, now: agora++, random };
    const valido = mod.validate(estado, acao, ctx);
    if (valido !== true) throw new Error(`${tipo}: acao recusada (${acao.kind || acao.type}): ${valido}`);
    const pronta = mod.prepare ? mod.prepare(estado, acao, ctx) : acao;
    estado = mod.reduce(estado, pronta, ctx);
  };
  const texto = (n) => `Item cheio ${String(n).padStart(2, '0')}`;

  if (tipo === 'roleta') {
    agir('1', { kind: 'setOptions', options: Array.from({ length: 8 }, (_, i) => `Opcao longa ${i + 1}`) });
  } else if (tipo === 'lista') {
    for (let i = 1; i <= 12; i += 1) agir('1', { kind: 'add', text: texto(i) });
  } else if (tipo === 'enquete') {
    agir('1', {
      kind: 'edit',
      question: 'Qual atividade fecha melhor a noite de jogos?',
      options: ['Pizza', 'Hamburguer', 'Sushi', 'Tacos', 'Cinema', 'Karaoke'],
    });
    pessoas.forEach((pessoa, i) => agir(pessoa.id, { kind: 'vote', option: i % 6 }));
  } else if (tipo === 'stop') {
    agir('1', { kind: 'categories', categories: ['Nome', 'Lugar', 'Comida', 'Filme', 'Cor', 'Objeto'] });
    agir('1', { kind: 'start' });
    pessoas.forEach((pessoa) => {
      agir(pessoa.id, { kind: 'answer', answers: Array.from({ length: 6 }, (_, i) => `A${pessoa.id}${i}`) });
    });
  } else if (tipo === 'quiz') {
    pessoas.slice(0, 4).forEach((pessoa, i) => agir(pessoa.id, { kind: 'answer', option: i }));
  } else if (tipo === 'poquer') {
    pessoas.forEach((pessoa, i) => agir(pessoa.id, { kind: 'sit', seat: i }));
    agir('1', { kind: 'deal' });
    for (let guard = 0; estado.hand && estado.hand.street === 'preflop' && guard < 12; guard += 1) {
      const de = estado.seats[estado.hand.toAct];
      const me = mod.view(estado, de, { peers: pessoas }).me;
      agir(de, { kind: me.canCheck ? 'check' : 'call' });
    }
  } else if (tipo === 'blackjack') {
    pessoas.forEach((pessoa, i) => agir(pessoa.id, { kind: 'sit', seat: i }));
    pessoas.forEach((pessoa) => agir(pessoa.id, { kind: 'bet', amount: 50 }));
  } else if (tipo === 'truco') {
    pessoas.slice(0, 4).forEach((pessoa, i) => agir(pessoa.id, { type: 'sit', seat: i }));
    agir('1', { type: 'deal' });
  } else {
    return null;
  }
  return estado;
}

function problemasDaAssinatura(grande, padrao) {
  const problemas = [];
  for (const [chave, noGrande] of Object.entries(grande)) {
    const noPadrao = padrao[chave] || 0;
    if (noPadrao < noGrande) {
      problemas.push(`some no padrao: ${chave} (${noGrande} no grande, ${noPadrao} no padrao)`);
    }
  }
  return problemas;
}

async function conferirEstado(ctx, tipo, tam, tema, estadoNome, estado, assinaturaGrande) {
  if (estado) await ctx.page.evaluate((valor) => window.bancada.impor(valor), estado);
  await ctx.page.waitForTimeout(60);
  await ctx.page.mouse.move(0, 0);
  const medida = await ctx.page.evaluate(medirEAssinar);
  const problemas = medida.problemas;
  if (tam === 'padrao' && assinaturaGrande) {
    problemas.push(...problemasDaAssinatura(assinaturaGrande, medida.assinatura));
  }
  conferir(problemas.length === 0, `${tipo}/${tam}/${tema}/${estadoNome}: ${problemas.join(' | ')}`);
  if (problemas.length) {
    fs.mkdirSync(PRINTS, { recursive: true });
    await ctx.page.screenshot({ path: path.join(PRINTS, `${tipo}-${tam}-${tema}.png`) });
  }
  return medida.assinatura;
}

async function conferirTamanho(browser, tipo, tam, tema, estadoNome, assinaturaGrande) {
  let ctx;
  try {
    ctx = await abrir(browser, tipo, tam, tema);
    const estado = estadoNome === 'cheio' ? await ctx.page.evaluate(montarCheio, tipo) : null;
    const assinatura = await conferirEstado(ctx, tipo, tam, tema, estadoNome, estado, assinaturaGrande);
    conferir(ctx.erros.length === 0, `${tipo}/${tam}/${tema}: erros na pagina: ${ctx.erros.join(' | ')}`);
    return assinatura;
  } catch (erro) {
    conferir(false, `${tipo}/${tam}/${tema}: roteiro quebrou: ${String(erro.message || erro).split('\n')[0]}`);
    return null;
  } finally {
    if (ctx) await ctx.page.close();
  }
}

async function main() {
  const todos = tiposDoRegistro();
  const tipos = pedidos.length ? pedidos.filter((tipo) => todos.includes(tipo)) : todos;
  const desconhecidos = pedidos.filter((tipo) => !todos.includes(tipo));
  for (const tipo of desconhecidos) conferir(false, `${tipo}: tipo ausente do registro`);
  conferirTeto(tipos);
  const browser = await chromium.launch();
  try {
    for (const tipo of tipos) {
      for (const tema of TEMAS) {
        for (const estadoNome of CHEIOS.has(tipo) ? ['inicial', 'cheio'] : ['inicial']) {
          const assinaturaGrande = await conferirTamanho(browser, tipo, 'grande', tema, estadoNome);
          await conferirTamanho(browser, tipo, 'padrao', tema, estadoNome, assinaturaGrande);
          await conferirTamanho(browser, tipo, 'min', tema, estadoNome);
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`${conferidos} conferencias, ${falhas.length} falha(s)`);
  for (const falha of falhas) console.log(`  FALHOU ${falha}`);
  if (falhas.length) console.log(`prints em ${path.relative(RAIZ, PRINTS)}`);
  process.exitCode = falhas.length ? 1 : 0;
}

if (require.main === module) {
  main().catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  });
}
