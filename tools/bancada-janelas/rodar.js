'use strict';
/* global document, window, getComputedStyle */

/*
 * Roteiro da bancada das janelas: abre `index.html` no Chromium do
 * Playwright, clica e digita nos conteudos como uma pessoa faria (Ana a
 * esquerda, Bia a direita), confere o estado das duas copias e tira os
 * prints de cada tipo no tamanho minimo e grande, no tema padrao e no Papel.
 *
 *   node tools/bancada-janelas/rodar.js            # conferencias + prints
 *   node tools/bancada-janelas/rodar.js --sem-prints
 *   node tools/bancada-janelas/rodar.js placar lista   # so esses tipos
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
const PAGINA = pathToFileURL(path.join(__dirname, 'index.html')).href;
const PRINTS = path.join(RAIZ, 'docs', 'prints', '2026-09-24-janelas');

const args = process.argv.slice(2);
const semPrints = args.includes('--sem-prints');
const TIPOS_TODOS = ['placar', 'cronometro', 'sorteio', 'enquete', 'dados', 'roleta', 'lista', 'nota', 'velha', 'lig4', 'damas', 'xadrez'];
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

/** Conferencias que valem para todo tipo e tamanho: nada sai da janela,
 * todo botao tem nome, nada anima fora de transform/opacidade. */
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
        const rot = b.id && document.querySelector(`label[for="${b.id}"]`);
        if (!nome && !rot && !b.closest('label')) out.semNome++;
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

// ---------- Roteiros por tipo ----------

const ROTEIROS = {
  async placar(c, tam) {
    const mais = c.ana.locator('.mj-time').first().locator('.mj-pm button').nth(1);
    await mais.click();
    await mais.click();
    await c.bia.locator('.mj-time').nth(1).locator('.mj-pm button').nth(1).click();
    await espera(50);
    let s = await c.estado('2');
    conferir(s.teams[0].score === 2 && s.teams[1].score === 1, `placar/${tam}: +1 pelos dois lados (${JSON.stringify(s.teams)})`);
    // -1 no zero: desligado, e o clique mostra o motivo perto.
    await c.act('1', { kind: 'reset' });
    await espera(30);
    const menos = c.ana.locator('.mj-time').first().locator('.mj-pm button').first();
    conferir((await menos.getAttribute('aria-disabled')) === 'true', `placar/${tam}: -1 no zero fica desligado`);
    // O Playwright trata aria-disabled como desligado; a pessoa no teclado
    // ainda chega nele e aperta Enter.
    await menos.focus();
    await menos.press('Enter');
    conferir(await c.ana.locator('.mj-time').first().locator('.mj-aviso.is-on').isVisible(), `placar/${tam}: o motivo aparece perto do botao`);
    conferir(await menos.evaluate((b) => document.activeElement === b), `placar/${tam}: o foco fica no botao desligado`);
    // Nome: quem digita nao perde o texto quando chega versao nova.
    const nome = c.ana.locator('.mj-nome').first();
    await nome.click();
    await nome.fill('Os Bons');
    await c.act('2', { kind: 'rename', team: 0, name: 'Da Bia' });
    await espera(40);
    conferir((await nome.inputValue()) === 'Os Bons', `placar/${tam}: nome em edicao nao foi sobrescrito`);
    await nome.press('Enter');
    await espera(40);
    s = await c.estado('2');
    conferir(s.teams[0].name === 'Os Bons', `placar/${tam}: Enter confirma o nome (${s.teams[0].name})`);
    conferir((await c.bia.locator('.mj-nome').first().inputValue()) === 'Os Bons', `placar/${tam}: Bia ve o nome novo`);
    // Esc volta ao da sala.
    await nome.click();
    await nome.fill('Rascunho');
    await nome.press('Escape');
    conferir((await nome.inputValue()) === 'Os Bons', `placar/${tam}: Esc desiste da edicao`);
    // Serie: melhor de 3, dois pontos fecham, +1 desliga.
    if (tam !== 'min') {
      await c.ana.locator('select[aria-label="Série"]').selectOption('3');
      await espera(30);
      await mais.click();
      await mais.click();
      await espera(40);
      conferir((await c.bia.locator('.mj-placar-rodape').textContent()).includes('venceu'), `placar/${tam}: vencedor anunciado`);
    }
  },

  async nota(c, tam) {
    const area = c.ana.locator('textarea');
    await area.click();
    await area.pressSequentially('Levar refri', { delay: 20 });
    const antes = await c.page.evaluate(() => window.bancada.log.length);
    conferir(antes === 0, `nota/${tam}: nao manda a cada tecla (${antes} envios)`);
    // Bia salva no meio: o texto de Ana fica.
    await c.act('2', { kind: 'set', text: 'Texto da Bia' });
    await espera(60);
    conferir((await area.inputValue()) === 'Levar refri', `nota/${tam}: o texto em digitacao nao foi apagado`);
    await espera(1100);
    const s = await c.estado('2');
    conferir(s.text === 'Levar refri' && s.by === '1', `nota/${tam}: salvou depois da pausa (${JSON.stringify(s)})`);
    conferir((await c.bia.locator('textarea').inputValue()) === 'Levar refri', `nota/${tam}: Bia recebe o texto`);
    // Sair do campo salva na hora.
    await area.press('End');
    await area.pressSequentially(' e gelo');
    await area.evaluate((a) => a.blur());
    await espera(60);
    conferir((await c.estado('2')).text === 'Levar refri e gelo', `nota/${tam}: sair do campo salva`);
    if (tam !== 'min') conferir((await c.ana.locator('.mj-nota-conta').textContent()).includes('1 000'), `nota/${tam}: contador de 1 000`);
  },

  async cronometro(c, tam) {
    const play = c.ana.locator('.mj-cron-play');
    const rodando = () => c.page.evaluate(() => window.bancada.tela('1')._laco.rodando);
    await espera(50);
    conferir(!(await rodando()), `cronometro/${tam}: parado nao tem laco`);
    await play.click();
    await espera(1300);
    const s = await c.estado('2');
    conferir(s.running === true, `cronometro/${tam}: Iniciar poe para correr`);
    conferir(await rodando(), `cronometro/${tam}: correndo tem laco`);
    const t = await c.bia.locator('.mj-cron-tempo').textContent();
    conferir(t === '04:59' || t === '04:58', `cronometro/${tam}: Bia ve o tempo andar pela hora do servidor (${t})`);
    await c.bia.locator('.mj-cron-play').click();
    await espera(80);
    conferir((await c.estado('1')).running === false, `cronometro/${tam}: Bia pausa`);
    conferir(!(await rodando()), `cronometro/${tam}: pausado o laco para`);
    conferir((await play.textContent()).includes('Continuar'), `cronometro/${tam}: botao vira Continuar`);
    // Esgotar: 1 s, o laco para no 00:00.
    await c.act('1', { kind: 'set', mode: 'down', duration: 1000 });
    await espera(30);
    await play.click();
    await espera(1400);
    conferir((await c.ana.locator('.mj-cron-tempo').textContent()) === '00:00', `cronometro/${tam}: chega a 00:00`);
    conferir(!(await rodando()), `cronometro/${tam}: esgotado o laco para`);
    conferir((await play.textContent()).includes('Recomeçar'), `cronometro/${tam}: botao vira Recomecar`);
    // Destruir: laco solto e el vazio.
    await c.act('1', { kind: 'reset' });
    await c.act('1', { kind: 'start' });
    await espera(80);
    const sobra = await c.page.evaluate(() => window.bancada.destruir('1'));
    await espera(50);
    conferir(sobra === 0 && !(await rodando()), `cronometro/${tam}: destroy limpa o el e para o laco`);
  },

  async sorteio(c, tam) {
    const campo = c.ana.locator('input[placeholder="Adicionar nome"]');
    await campo.fill('Zé');
    await campo.press('Enter');
    await espera(40);
    let s = await c.estado('2');
    conferir(s.entries.length === 5 && s.entries[4].name === 'Zé', `sorteio/${tam}: nome digitado entra`);
    conferir((await c.ana.getByRole('button', { name: 'Pôr a sala toda' }).getAttribute('aria-disabled')) === 'true', `sorteio/${tam}: "Pôr a sala toda" desliga com todos na lista`);
    await c.ana.locator('.mj-pri').click();
    await espera(400);
    s = await c.estado('2');
    conferir(Array.isArray(s.teams) && s.teams.length === 2, `sorteio/${tam}: sorteou dois times`);
    const cores = await c.bia.locator('.mj-sort-time li.is-pessoa').count();
    conferir(cores === 4, `sorteio/${tam}: as quatro pessoas aparecem na cor delas (${cores})`);
    const iguais = await c.page.evaluate(() => JSON.stringify(window.bancada.estado('1').teams) === JSON.stringify(window.bancada.estado('2').teams));
    conferir(iguais, `sorteio/${tam}: os dois veem os mesmos times`);
    // Tirar pelo teclado: o foco vai para o proximo nome.
    const x = c.ana.locator('.mj-chip button').first();
    await x.focus();
    await x.press('Enter');
    await espera(50);
    s = await c.estado('1');
    conferir(s.entries.length === 4, `sorteio/${tam}: tirar nome`);
    conferir(await c.page.evaluate(() => document.activeElement && document.activeElement.closest('.mj-chip') !== null), `sorteio/${tam}: o foco fica na lista depois de tirar`);
  },

  async enquete(c, tam) {
    conferir(await c.bia.locator('.mj-enq-espera').isVisible(), `enquete/${tam}: Bia espera a pergunta`);
    await c.ana.locator('input[aria-label="Pergunta"]').fill('Pizza ou hambúrguer?');
    const ops = c.ana.locator('.mj-enq-ed input');
    await ops.nth(0).fill('Pizza');
    await ops.nth(1).fill('Hambúrguer');
    await c.ana.getByRole('button', { name: 'Publicar' }).click();
    await espera(50);
    let s = await c.estado('2');
    conferir(s.question === 'Pizza ou hambúrguer?', `enquete/${tam}: publicou`);
    await c.bia.locator('.mj-enq-opcao').nth(1).click();
    await espera(50);
    s = await c.estado('1');
    conferir(s.votes.length === 1 && s.votes[0].by === '2' && s.votes[0].option === 1, `enquete/${tam}: Bia votou`);
    conferir((await c.ana.locator('.mj-enq-conta').nth(1).textContent()) === '1', `enquete/${tam}: Ana ve a contagem`);
    if (tam !== 'min') conferir((await c.ana.locator('.mj-enq-quem .mj-dot').count()) === 1, `enquete/${tam}: bolinha de quem votou`);
    conferir((await c.bia.locator('.mj-enq-opcao').nth(1).getAttribute('aria-pressed')) === 'true', `enquete/${tam}: o voto de Bia fica marcado para ela`);
    await c.bia.locator('.mj-enq-opcao').nth(1).click();
    await espera(50);
    conferir((await c.estado('1')).votes.length === 0, `enquete/${tam}: clicar de novo tira o voto`);
    conferir(await c.bia.locator('.mj-enq-gestao').isHidden(), `enquete/${tam}: Bia nao ve Encerrar/Zerar`);
    await c.ana.getByRole('button', { name: 'Encerrar' }).click();
    await espera(50);
    conferir((await c.estado('2')).closed === true, `enquete/${tam}: Ana encerra`);
    conferir((await c.bia.locator('.mj-enq-opcao').first().getAttribute('aria-disabled')) === 'true', `enquete/${tam}: encerrada, votar desliga`);
  },

  async dados(c, tam) {
    await c.ana.locator('.mj-pri').click();
    await espera(40);
    conferir(await c.bia.locator('.mj-dado.is-rola').count() > 0, `dados/${tam}: a jogada nova anima`);
    await espera(600);
    const s = await c.estado('2');
    conferir(s.history.length === 1 && s.history[0].values.length === 2, `dados/${tam}: rolou 2d6`);
    const m = await c.page.evaluate(() => window.GoLive.mesaModules.dados.describe(window.bancada.estado('2').history[0]));
    conferir((await c.bia.locator('.mj-dados-res').textContent()) === m, `dados/${tam}: mostra o describe (${m})`);
    await c.bia.getByRole('button', { name: 'Jogar a moeda' }).click();
    await espera(600);
    conferir((await c.ana.locator('.mj-dados-res').textContent()).startsWith('Moeda: '), `dados/${tam}: moeda`);
  },

  async roleta(c, tam) {
    // Sem opcoes o painel ja vem aberto.
    const campo = c.ana.locator('input[placeholder="Nova opção"]');
    for (const t of ['Pizza', 'Sushi', 'Tacos']) {
      await campo.fill(t);
      await campo.press('Enter');
      await espera(30);
    }
    let s = await c.estado('2');
    conferir(s.options.length === 3, `roleta/${tam}: tres opcoes`);
    if (tam === 'min') await c.ana.locator('.mj-rol-alternar').click();
    await c.ana.locator('.mj-pri').click();
    await espera(100);
    conferir((await c.bia.locator('.mj-rol-saida').textContent()) === 'Girando…', `roleta/${tam}: gira nos dois`);
    await espera(4400);
    s = await c.estado('2');
    const esperado = `Deu ${s.options[s.spin.index]}`;
    conferir((await c.bia.locator('.mj-rol-saida').textContent()) === esperado, `roleta/${tam}: para e anuncia (${esperado})`);
    conferir((await c.bia.locator('.mj-rol-saida').getAttribute('aria-live')) === 'polite', `roleta/${tam}: resultado em aria-live`);
    const ang = await c.page.evaluate(() => {
      const st = window.bancada.estado('2');
      return [window.GoLive.mesaModules.roleta.spinAngle(st.spin, st.options.length), document.querySelectorAll('.mj-rol-disco')[1].style.transform];
    });
    conferir(ang[1] === `rotate(${ang[0]}deg)`, `roleta/${tam}: disco parou no spinAngle (${ang.join(' / ')})`);
  },

  async lista(c, tam) {
    const campo = c.ana.locator('input[placeholder="Novo item"]');
    for (const t of ['Refri', 'Salgadinho', 'Gelo']) {
      await campo.fill(t);
      await campo.press('Enter');
      await espera(30);
    }
    // A caixa so marca quando o eco da sala chega: click, nao check().
    await c.bia.locator('.mj-caixa').nth(1).click();
    await espera(40);
    let s = await c.estado('1');
    conferir(s.items[1].done === true, `lista/${tam}: Bia marcou`);
    conferir(await c.ana.locator('.mj-caixa').nth(1).isChecked(), `lista/${tam}: Ana ve marcado`);
    // Alt+Baixo leva o primeiro para baixo e o foco vai junto.
    const primeira = c.ana.locator('.mj-caixa').first();
    await primeira.focus();
    await primeira.press('Alt+ArrowDown');
    await espera(50);
    s = await c.estado('2');
    conferir(s.items.map((i) => i.text).join(',') === 'Salgadinho,Refri,Gelo', `lista/${tam}: Alt+Baixo reordena (${s.items.map((i) => i.text)})`);
    const focoTexto = await c.page.evaluate(() => document.activeElement.closest('.mj-item')?.querySelector('.mj-item-texto')?.textContent);
    conferir(focoTexto === 'Refri', `lista/${tam}: o foco acompanha o item (${focoTexto})`);
    // Editar pelo lapis; versao nova de outra pessoa nao apaga o campo.
    await c.ana.locator('.mj-item').nth(2).hover();
    await c.ana.locator('.mj-item').nth(2).getByRole('button', { name: /^Editar/ }).click();
    const ed = c.ana.locator('.mj-item-campo');
    await ed.fill('Gelo (2 sacos)');
    await c.act('2', { kind: 'move', id: 3, to: 0 });
    await espera(50);
    conferir(await ed.isVisible() && (await ed.inputValue()) === 'Gelo (2 sacos)', `lista/${tam}: edicao sobrevive a reordenacao de outra pessoa`);
    await ed.press('Enter');
    await espera(50);
    s = await c.estado('2');
    conferir(s.items.some((i) => i.text === 'Gelo (2 sacos)'), `lista/${tam}: edicao confirmada`);
    await c.ana.getByRole('button', { name: 'Apagar marcados' }).click();
    await espera(50);
    conferir((await c.estado('2')).items.length === 2, `lista/${tam}: apagar marcados`);
  },
};

// ---------- Jogos ----------

async function sentarOsDois(c) {
  await c.ana.getByRole('button', { name: /^Sentar/ }).first().click();
  await espera(40);
  await c.bia.getByRole('button', { name: /^Sentar/ }).first().click();
  await espera(40);
  const s = await c.estado('1');
  conferir(s.seats[0] === '1' && s.seats[1] === '2', `${c.tipo}: Ana e Bia sentaram (${JSON.stringify(s.seats)})`);
}

/** Conta `pointerdown` que escapam do conteudo para a caixa da janela. */
async function vigiarSubida(c) {
  await c.page.evaluate(() => {
    window.__subiu = 0;
    for (const j of document.querySelectorAll('.janela')) j.addEventListener('pointerdown', () => { window.__subiu++; });
  });
}

async function arrastarCasa(c, quem, de, para) {
  const a = await quem.locator(`.mj-casa[data-l="${de[0]}"][data-c="${de[1]}"]`).boundingBox();
  const b = await quem.locator(`.mj-casa[data-l="${para[0]}"][data-c="${para[1]}"]`).boundingBox();
  await c.page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await c.page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await c.page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * i) / 6, a.y + a.height / 2 + ((b.y - a.y) * i) / 6);
    await espera(16);
  }
  await c.page.mouse.up();
  await espera(60);
}

Object.assign(ROTEIROS, {
  async velha(c, tam) {
    c.tipo = `velha/${tam}`;
    conferir((await c.ana.locator('.mj-jogo-status').textContent()).startsWith('Cadeiras livres'), `velha/${tam}: comeca com cadeiras livres`);
    await sentarOsDois(c);
    // Bia fora da vez: a casa esta desligada e o clique diz por que.
    const casaBia = c.bia.locator('.mj-velha-casa').nth(0);
    conferir((await casaBia.getAttribute('aria-disabled')) === 'true', `velha/${tam}: fora da vez a casa desliga`);
    // Ana joga pelo teclado: setas ate o meio, Enter.
    const primeira = c.ana.locator('.mj-velha-casa').first();
    await primeira.focus();
    await c.page.keyboard.press('ArrowRight');
    await c.page.keyboard.press('ArrowDown');
    await c.page.keyboard.press('Enter');
    await espera(50);
    let s = await c.estado('2');
    conferir(s.board[4] === 'X', `velha/${tam}: setas + Enter jogam no meio (${s.board})`);
    conferir(await c.page.evaluate(() => document.activeElement?.dataset?.casa === '4'), `velha/${tam}: o foco fica na casa`);
    conferir((await c.bia.locator('.mj-jogo-status').textContent()) === 'Sua vez', `velha/${tam}: vez passa para Bia`);
    for (const [quem, i] of [[c.bia, 0], [c.ana, 2], [c.bia, 1], [c.ana, 6]]) {
      await quem.locator('.mj-velha-casa').nth(i).click();
      await espera(40);
    }
    s = await c.estado('1');
    conferir(s.result && s.result.winner === 0, `velha/${tam}: Ana fecha a diagonal`);
    conferir((await c.bia.locator('.mj-jogo-status').textContent()) === 'Ana venceu', `velha/${tam}: Bia ve quem venceu`);
    conferir((await c.ana.locator('.mj-velha-casa.is-linha').count()) === 3, `velha/${tam}: a linha vencedora aparece`);
    await c.bia.getByRole('button', { name: 'Nova partida' }).click();
    await espera(40);
    conferir((await c.estado('1')).board === '.........', `velha/${tam}: nova partida`);
  },

  async lig4(c, tam) {
    c.tipo = `lig4/${tam}`;
    await sentarOsDois(c);
    const col = c.ana.locator('.mj-lig4-col').first();
    await col.focus();
    for (let i = 0; i < 3; i++) await c.page.keyboard.press('ArrowRight');
    await c.page.keyboard.press('Enter');
    await espera(50);
    const s = await c.estado('2');
    conferir(s.board[5][3] === 'V', `lig4/${tam}: a peca cai no fundo da coluna 4`);
    conferir((await c.bia.locator('.mj-lig4-col').nth(3).getAttribute('aria-label')) === 'Coluna 4: 5 casas livres', `lig4/${tam}: rotulo da coluna`);
    await c.bia.locator('.mj-lig4-col').nth(3).click();
    await espera(50);
    conferir((await c.estado('1')).board[4][3] === 'A', `lig4/${tam}: Bia empilha`);
  },

  async damas(c, tam) {
    c.tipo = `damas/${tam}`;
    await sentarOsDois(c);
    await vigiarSubida(c);
    conferir(await c.bia.locator('.mj-grade8.is-virado').count() === 1, `damas/${tam}: Bia (escuras) ve o tabuleiro virado`);
    // Clique: escolher a pedra, destinos marcados, clicar no destino.
    await c.ana.locator('.mj-casa[data-l="5"][data-c="2"]').click();
    conferir((await c.ana.locator('.mj-casa.is-destino').count()) === 2, `damas/${tam}: dois destinos marcados`);
    await c.ana.locator('.mj-casa[data-l="4"][data-c="3"]').click();
    await espera(50);
    let s = await c.estado('2');
    conferir(s.board[4][3] === 'c' && s.board[5][2] === '.', `damas/${tam}: lance por clique`);
    // Arrastar (Bia): a peca anda por dentro e nada sobe para a janela.
    await arrastarCasa(c, c.bia, [2, 5], [3, 4]);
    s = await c.estado('1');
    conferir(s.board[3][4] === 'e', `damas/${tam}: lance por arrastar`);
    conferir((await c.page.evaluate(() => window.__subiu)) === 0, `damas/${tam}: arrastar nao sobe para a janela`);
    // Captura obrigatoria: so a pedra que captura mexe.
    conferir((await c.ana.locator('.mj-casa.is-mexe').count()) === 1, `damas/${tam}: so a pedra que captura fica marcada`);
    // Teclado: Enter na pedra, setas ate o destino, Enter.
    const origem = c.ana.locator('.mj-casa[data-l="4"][data-c="3"]');
    await origem.focus();
    await c.page.keyboard.press('Enter');
    await c.page.keyboard.press('ArrowUp');
    await c.page.keyboard.press('ArrowUp');
    await c.page.keyboard.press('ArrowRight');
    await c.page.keyboard.press('ArrowRight');
    await c.page.keyboard.press('Enter');
    await espera(50);
    s = await c.estado('2');
    conferir(s.board[2][5] === 'c' && s.board[3][4] === '.', `damas/${tam}: captura pelo teclado`);
    // Desistir pede confirmacao.
    const desistir = c.bia.getByRole('button', { name: 'Desistir' });
    await desistir.click();
    conferir(!(await c.estado('1')).result, `damas/${tam}: o primeiro toque em Desistir so pergunta`);
    await desistir.click();
    await espera(50);
    conferir((await c.estado('1')).result?.reason === 'abandono', `damas/${tam}: o segundo toque desiste`);
    conferir((await c.ana.locator('.mj-jogo-status').textContent()) === 'Bia desistiu; você venceu', `damas/${tam}: situacao do fim`);
  },

  async xadrez(c, tam) {
    c.tipo = `xadrez/${tam}`;
    await sentarOsDois(c);
    await vigiarSubida(c);
    // e2-e4 arrastando.
    await arrastarCasa(c, c.ana, [6, 4], [4, 4]);
    let s = await c.estado('2');
    conferir(s.fen.startsWith('rnbqkbnr/pppppppp/8/8/4P3'), `xadrez/${tam}: e4 por arrastar (${s.fen})`);
    conferir((await c.page.evaluate(() => window.__subiu)) === 0, `xadrez/${tam}: arrastar nao sobe para a janela`);
    // e7-e5 por clique (Bia, tabuleiro virado).
    await c.bia.locator('.mj-casa[data-l="1"][data-c="4"]').click();
    conferir((await c.bia.locator('.mj-casa.is-destino').count()) === 2, `xadrez/${tam}: o peao mostra dois destinos`);
    await c.bia.locator('.mj-casa[data-l="3"][data-c="4"]').click();
    await espera(50);
    s = await c.estado('1');
    conferir(s.san[s.san.length - 1] === 'e5', `xadrez/${tam}: e5 por clique`);
    // Promocao: posicao imposta, peao em a7.
    await c.page.evaluate(() => {
      const m = window.GoLive.mesaModules.xadrez;
      const st = window.bancada.estado('1');
      const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
      window.bancada.impor({ ...st, fen, seen: [m.positionMark(fen)], san: [], turn: 0, check: false, result: null, last: null });
    });
    await c.ana.locator('.mj-casa[data-l="1"][data-c="0"]').click();
    await c.ana.locator('.mj-casa[data-l="0"][data-c="0"]').click();
    conferir(await c.ana.locator('.mj-xadrez-promo').isVisible(), `xadrez/${tam}: a escolha da promocao aparece`);
    conferir(await c.page.evaluate(() => document.activeElement?.closest('.mj-xadrez-promo') !== null), `xadrez/${tam}: o foco vai para a escolha`);
    await c.ana.locator('.mj-xadrez-promo').getByRole('button', { name: /Cavalo/ }).click();
    await espera(50);
    s = await c.estado('2');
    conferir(s.fen.startsWith('N7/'), `xadrez/${tam}: promoveu a cavalo (${s.fen})`);
  },
});

// ---------- Cenas para os prints ----------

const CENAS = {
  placar: [
    { kind: 'rename', team: 0, name: 'Azul' }, { kind: 'bestOf', n: 5 },
    { kind: 'score', team: 0, delta: 1 }, { kind: 'score', team: 0, delta: 1 }, { kind: 'score', team: 1, delta: 1 },
  ],
  cronometro: [{ kind: 'label', text: 'Pausa' }, { kind: 'set', mode: 'down', duration: 10 * 60 * 1000 }],
  sorteio: [{ kind: 'add', name: 'Zé do vizinho' }, { kind: 'add', name: 'Lu' }, { kind: 'draw' }],
  enquete: [
    { kind: 'edit', question: 'Pizza ou hambúrguer hoje?', options: ['Pizza', 'Hambúrguer', 'Tanto faz'] },
    { kind: 'vote', option: 0, de: '1' }, { kind: 'vote', option: 0, de: '2' }, { kind: 'vote', option: 1, de: '3' }, { kind: 'vote', option: 0, de: '4' },
  ],
  dados: [{ kind: 'roll', de: '2' }, { kind: 'coin' }, { kind: 'roll', de: '2' }],
  roleta: [{ kind: 'setOptions', options: ['Pizza', 'Hambúrguer', 'Sushi', 'Tacos', 'Churrasco'] }, { kind: 'spin', de: '2' }],
  lista: [
    { kind: 'title', text: 'Quem traz o quê' },
    { kind: 'add', text: 'Refri (Bia)' }, { kind: 'add', text: 'Salgadinho' }, { kind: 'add', text: 'Controle extra' }, { kind: 'add', text: 'Extensão pro notebook' },
    { kind: 'check', id: 1, done: true },
  ],
  nota: [{ kind: 'set', text: 'Sábado 21h: campeonato de Rocket.\nLevar controle extra e o cabo HDMI.\nA Bia traz o refri.', de: '2' }],
};

async function montarCena(c, tipo) {
  for (const a of CENAS[tipo] || []) {
    const { de, ...acao } = a;
    await c.act(de || '1', acao);
    await espera(20);
  }
  // Cronometro "correndo": inicia agora, o print sai com o tempo andando.
  if (tipo === 'cronometro') await c.act('1', { kind: 'start' });
  if (CENAS_EXTRA[tipo]) await CENAS_EXTRA[tipo](c);
  await espera(tipo === 'roleta' ? 4600 : 700);
}

const SENTAR = [{ kind: 'sit', seat: 0, de: '1' }, { kind: 'sit', seat: 1, de: '2' }];
Object.assign(CENAS, {
  velha: [...SENTAR, ...[['1', 4], ['2', 0], ['1', 2], ['2', 6]].map(([de, cell]) => ({ kind: 'move', cell, de }))],
  lig4: [...SENTAR, ...[['1', 3], ['2', 3], ['1', 2], ['2', 4], ['1', 4], ['2', 2], ['1', 3]].map(([de, col]) => ({ kind: 'move', col, de }))],
  damas: [...SENTAR, { kind: 'move', path: [[5, 2], [4, 3]], de: '1' }, { kind: 'move', path: [[2, 5], [3, 4]], de: '2' }],
  xadrez: [...SENTAR, ...[['1', 'e2', 'e4'], ['2', 'e7', 'e5'], ['1', 'g1', 'f3'], ['2', 'b8', 'c6']].map(([de, from, to]) => ({ kind: 'move', from, to, de }))],
});

// Nos tabuleiros, Ana escolhe uma peca: os destinos aparecem no print.
const CENAS_EXTRA = {
  async damas(c) { await c.ana.locator('.mj-casa.is-mexe').first().click(); },
  async xadrez(c) { await c.ana.locator('.mj-casa[data-l="7"][data-c="5"]').click(); },
};

async function prints(browser, tipos) {
  fs.mkdirSync(PRINTS, { recursive: true });
  for (const tipo of tipos) {
    for (const tam of TAMANHOS) {
      for (const tema of ['marca', 'paper']) {
        const c = await abrir(browser, tipo, tam, { reducedMotion: 'reduce', tema: tema === 'marca' ? '' : tema });
        await montarCena(c, tipo);
        await c.page.mouse.move(0, 0);
        await c.page.locator('#palco').screenshot({ path: path.join(PRINTS, `${tipo}-${tam}-${tema === 'paper' ? 'papel' : 'padrao'}.png`) });
        await c.page.close();
      }
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
  // Menos movimento: a roleta para no lugar sem animar.
  if (tipos.includes('roleta')) {
    const c = await abrir(browser, 'roleta', 'padrao', { reducedMotion: 'reduce' });
    await c.act('1', { kind: 'setOptions', options: ['A', 'B'] });
    await espera(30);
    await c.act('2', { kind: 'spin' });
    await espera(80);
    const t = await c.ana.locator('.mj-rol-saida').textContent();
    conferir(t.startsWith('Deu '), `roleta/menos movimento: resultado na hora (${t})`);
    await c.page.close();
  }
  if (!semPrints) await prints(browser, tipos);
  await browser.close();
  console.log(`${conferidos} conferencias, ${falhas.length} falha(s)`);
  for (const f of falhas) console.log(`  FALHOU ${f}`);
  if (!semPrints) console.log(`prints em ${path.relative(RAIZ, PRINTS)}`);
  process.exitCode = falhas.length ? 1 : 0;
}

module.exports = { ROTEIROS, CENAS, CENAS_EXTRA, abrir, conferir, espera };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
