'use strict';

/*
 * Bancada visual da Sala (redesign Sinal). Sobe o servidor de sinalizacao de verdade, abre index.html no Chromium
 * do Playwright com a ponte window.golive simulada, entra pelo formulario do Inicio e poe outras pessoas na sala
 * como clientes ws crus. As telas sao canvas.captureStream postos no palco pelo mesmo ui.grid.showTile que a
 * track do WebRTC usaria. Nao entra no npm test (precisa de navegador).
 *
 * Os tipos de sala sao exclusivos. Por padrao a bancada cria uma sala "Mesa" (so a Mesa, sem a vista Transmissao) e
 * grava em prints/sala. SINAL_SALA=transmissoes cria uma sala "so transmissoes" (so o palco) e grava em
 * prints/sala-transmissoes.
 *
 * Uso: PLAYWRIGHT_DIR=<playwright> [SINAL_SALA=transmissoes] node tools/sinal-prints/sala.js [LxA ...]
 */

/* global window, document, getComputedStyle, requestAnimationFrame */

const fs = require('node:fs');
const path = require('node:path');
const NodeWebSocket = require('ws');
const { createSignalingServer } = require('../../server/signaling-core');

const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'C:/Users/nicol/Desktop/portfolio-nubinho/node_modules/playwright');
const RAIZ = path.join(__dirname, '..', '..');
const PAGINA = `file://${path.join(RAIZ, 'src', 'renderer', 'index.html')}`;
// SINAL_TEMA=<preset> fotografa com outro tema (ex.: sinal-claro), numa pasta propria.
const TEMA = process.env.SINAL_TEMA || '';
const SO_TRANSMISSOES = process.env.SINAL_SALA === 'transmissoes';
const NOME_DA_PASTA = ['sala', SO_TRANSMISSOES ? 'transmissoes' : '', TEMA].filter(Boolean).join('-');
const SAIDA = path.join(RAIZ, 'docs', 'redesign-greenfield', 'prints', NOME_DA_PASTA);
const TAMANHOS = process.argv.slice(2).length
  ? process.argv.slice(2).map((t) => t.split('x').map(Number))
  : [[1440, 900], [1180, 760], [960, 600]];

const espera = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** Pessoa da sala falando o protocolo por um ws cru. */
async function pessoa(port, name) {
  const ws = new NodeWebSocket(`ws://127.0.0.1:${port}`);
  const caixa = [];
  ws.on('message', (raw) => caixa.push(JSON.parse(raw.toString())));
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const envia = (msg) => ws.send(JSON.stringify(msg));
  envia({ type: 'join', room: 'geral', name, clientId: `cli-${name}` });
  for (let i = 0; i < 100 && !caixa.some((m) => m.type === 'welcome'); i += 1) await espera(20);
  const id = caixa.find((m) => m.type === 'welcome').id;
  return { name, id, envia, fecha: () => ws.close() };
}

/** Ponte simulada: o app acha que esta no Windows, com rede Radmin, e entra como quem criou a sala. */
const PONTE = (tema) => {
  const enviar = WebSocket.prototype.send;
  WebSocket.prototype.send = function send(data) {
    if (typeof data === 'string' && data.includes('"type":"join"')) {
      const m = JSON.parse(data);
      m.ownerToken = 'banco-de-prova';
      return enviar.call(this, JSON.stringify(m));
    }
    window.__ws = this;
    return enviar.call(this, data);
  };
  window.golive = new Proxy({}, {
    get: (_, k) => {
      if (k === 'getNetworkAddress') return async () => ({ address: '26.114.8.201', kind: 'radmin' });
      if (k === 'getVersion') return async () => null;
      if (k === 'listSources') {
        // Fontes de mentira com miniatura desenhada aqui mesmo.
        const shot = (cor, texto) => {
          const c = document.createElement('canvas');
          c.width = 320;
          c.height = 180;
          const g = c.getContext('2d');
          g.fillStyle = cor;
          g.fillRect(0, 0, 320, 180);
          g.fillStyle = 'rgba(255,255,255,.8)';
          g.font = '22px sans-serif';
          g.fillText(texto, 16, 40);
          return c.toDataURL();
        };
        return async (tipos) => (tipos.includes('screen')
          ? [{ id: 's1', name: 'Tela 1', isScreen: true, height: 1080, thumbnail: shot('#26415c', 'Tela 1') },
            { id: 's2', name: 'Tela 2', isScreen: true, height: 1440, thumbnail: shot('#3b2a4a', 'Tela 2') }]
          : ['VALORANT', 'Discord', 'Google Chrome — Documentação do Radmin', 'Spotify', 'OBS 30.2'].map((n, i) => (
            { id: `w${i}`, name: n, isScreen: false, thumbnail: shot(['#1d3b2a', '#2a2a4a', '#4a3a1d', '#1d4a3a', '#3a1d1d'][i], n) })));
      }
      if (k === 'win') {
        return { platform: 'win32', minimize() {}, toggleMaximize() {}, close() {}, onMaximizeChange() {}, show() {} };
      }
      if (String(k).startsWith('on')) return () => {};
      return async () => null;
    },
  });
  if (!localStorage.getItem('golive')) {
    const cfg = { v: 1, name: 'Nick', clientId: 'cli-nick' };
    if (tema) cfg.theme = { preset: tema };
    localStorage.setItem('golive', JSON.stringify(cfg));
  }
};

/** Uma "tela" que se mexe, a 30 qps. */
const TELA_FALSA = ([rotulo, cor, w, h]) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  let t = 0;
  const pinta = () => {
    t += 1;
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#16324a');
    grad.addColorStop(1, cor);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.8)';
    g.fillRect((t * 7) % w, h * 0.55, w * 0.08, w * 0.08);
    g.font = `${Math.round(h / 9)}px sans-serif`;
    g.fillText(rotulo, w * 0.05, h * 0.2);
    requestAnimationFrame(pinta);
  };
  pinta();
  return c.captureStream(30);
};

async function mostrarTela(page, id, rotulo, cor, kind = 'screen', w = 1280, h = 720) {
  await page.evaluate(([fn, id2, rot, c, k, w2, h2]) => {
    const fake = new Function(`return (${fn})`)();
    window.GoLive.ui.grid.showTile(id2, rot, fake([rot, c, w2, h2]), { kind: k });
  }, [TELA_FALSA.toString(), id, rotulo, cor, kind, w, h]);
}

/** Um tile inteiro dentro da janela do navegador: no palco o primeiro; na Mesa, a primeira janela que cabe na vista. */
async function tileParaFotografar(page) {
  if (SO_TRANSMISSOES) return page.$('#grid .tile:not([hidden])');
  const tem = page.viewportSize();
  for (const tile of await page.$$('.mesa-win .tile')) {
    const c = await tile.boundingBox();
    if (c && c.x >= 0 && c.y >= 0 && c.x + c.width <= tem.width && c.y + c.height <= tem.height) return tile;
  }
  return null;
}

async function foto(page, nome, w, h) {
  await espera(250);
  await page.screenshot({ path: path.join(SAIDA, `${nome}-${w}x${h}.png`) });
}

/**
 * Menu da Mesa por cima da Conversa fixada: o botao direito abre "Adicionar janela" perto da coluna e o painel
 * cai sobre ela. O clique so chega se o item for o elemento no topo do ponto (elementFromPoint).
 */
async function menuDaMesaSobreAConversa(page, w, h, erros) {
  if ((await page.getAttribute('#app', 'data-conv')) !== 'pinned') await page.click('#btn-conv-toggle');
  await espera(300);
  const conv = await page.evaluate(() => {
    const r = document.getElementById('chat-panel').getBoundingClientRect();
    return { esq: r.left, dir: r.right, topo: r.top, base: r.bottom };
  });
  if (conv.dir - conv.esq < 100) {
    erros.push('menu da Mesa: a Conversa nao ficou fixada');
    return;
  }
  // Fundo vazio da Mesa, colado na coluna: o menu (e o painel ao lado) invadem a Conversa.
  // As janelas chegaram depois da Mesa aberta (que nao se reencaixa sozinha): 'Ver tudo' deixa margem livre.
  await page.click('[data-zoom="fit"]');
  await espera(700);
  // Sem janela por baixo do ponto (a Mesa nao se reencaixa sozinha quando as janelas chegam depois dela).
  const livre = await page.evaluate(([esq, y0, y1]) => {
    for (let dx = 40; dx < esq - 4; dx += 20) {
      for (let y = y0; y < y1; y += 10) {
        const el = document.elementFromPoint(esq - dx, y);
        if (el && !el.closest('.mesa-win, .mesa-dock, button, .mesa-map')) return { x: esq - dx, y };
      }
    }
    return null;
  }, [conv.esq, conv.topo + 50, conv.base - 120]);
  if (livre === null) {
    erros.push('menu da Mesa: nao achei fundo vazio colado na Conversa ');
    return;
  }
  await page.mouse.click(livre.x, livre.y, { button: 'right' });
  await espera(300);
  await page.hover('.mesa-menu-row[data-sub]', { timeout: 3000 });
  await espera(500);
  await foto(page, '22-mesa-menu-sobre-conversa', w, h);
  const teste = await page.evaluate(() => {
    const cs = document.getElementById('chat-panel').getBoundingClientRect();
    const itens = [...document.querySelectorAll('.mesa-menu:not([hidden]) button, .mesa-menu:not([hidden]) input')];
    const sobre = itens.map((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const dentro = x > cs.left && x < cs.right && y > cs.top && y < cs.bottom;
      const topo = document.elementFromPoint(x, y);
      return { dentro, ok: Boolean(topo && (topo === el || el.contains(topo) || topo.contains(el))),
        rotulo: (el.textContent || el.placeholder || '').trim().slice(0, 24) };
    }).filter((i) => i.dentro);
    return { sobre, painelNoBody: document.querySelector('.mesa-menu')?.parentElement === document.body };
  });
  console.log(`elementFromPoint ${w}x${h}: ${JSON.stringify(teste)}`);
  if (!teste.sobre.length) erros.push('menu da Mesa: nenhum item ficou sobre a Conversa (bancada sem prova)');
  for (const i of teste.sobre) if (!i.ok) erros.push(`menu da Mesa: "${i.rotulo}" sobre a Conversa nao recebe clique`);
  if (!teste.painelNoBody) erros.push('menu da Mesa: fora do body');
  await page.keyboard.press('Escape');
  await espera(200);
}

/**
 * Sala Mesa: sem item "Mesa" no barramento, sem alternar (atalho M), sem Modo teatro no menu da sala; o clique numa
 * fonte leva ate a janela dela e nunca ao palco; janela de tela nao fecha (sem x, Delete inerte, remove recusado).
 * Confere o DOM e fotografa.
 */
async function verificarSalaMesa(page, bia, w, h, erros) {
  const estado = () => page.evaluate(() => ({
    mesaAberta: document.body.classList.contains('mesa-open'),
    palco: getComputedStyle(document.getElementById('grid')).display !== 'none',
    itemMesa: Boolean(document.getElementById('view-mesa')),
    fontes: document.querySelectorAll('#bus-live .src').length,
    verJunto: document.querySelectorAll('#bus-live .src__add, #bus-live .src__drop').length,
    mundo: document.querySelector('.mesa-world')?.style.transform || '',
  }));
  const antes = await estado();
  if (antes.itemMesa) erros.push('sala Mesa: sobrou o item "Mesa" no barramento');
  if (antes.palco) erros.push('sala Mesa: o palco esta visivel');
  if (!antes.fontes) erros.push('sala Mesa: nenhuma fonte no barramento (bancada sem prova)');
  if (antes.verJunto) erros.push('sala Mesa: "Ver junto" ou o x de parar de assistir no barramento');
  await page.keyboard.press('m');
  await espera(200);
  if (!(await estado()).mesaAberta) erros.push('sala Mesa: a tecla M fechou a Mesa');
  await page.click('#btn-room-more');
  const teatroNoMenu = await page.evaluate(() => {
    const el = document.querySelector('#room-more [data-room-action="theater"]');
    return el && el.getClientRects().length > 0;
  });
  await foto(page, '06b-menu-sala-mesa', w, h);
  await page.keyboard.press('Escape');
  if (teatroNoMenu) erros.push('sala Mesa: o menu da sala mostra o Modo teatro');

  // Clique (e Ctrl+clique) numa fonte: a Mesa continua aberta e a vista anda ate a janela.
  const fontes = await page.$$('#bus-live .src');
  await fontes[0].click({ modifiers: ['Control'] });
  await espera(900);
  const depois = await estado();
  if (!depois.mesaAberta || depois.palco) erros.push('sala Mesa: clicar numa fonte tirou da Mesa');
  if (depois.mundo === antes.mundo) console.log('aviso: a vista nao andou (a janela ja estava centrada?)');
  await foto(page, '21b-fonte-centralizada', w, h);

  // Janela de tela/camera nao fecha: sem "x" visivel, Delete nao faz nada e o servidor recusa o `remove` (`media`).
  const janelaDaBia = await page.evaluate(() => {
    const alvo = [...document.querySelectorAll('.mesa-win.is-media')].find((el) => el.textContent.includes('Bia'));
    if (!alvo) return null;
    const botao = alvo.querySelector('[data-act="remove"]');
    return { id: alvo.dataset.id, botaoVisivel: Boolean(botao) && !botao.hidden && botao.getClientRects().length > 0 };
  });
  if (!janelaDaBia) {
    erros.push('sala Mesa: nao achei a janela da tela da Bia');
    return;
  }
  if (janelaDaBia.botaoVisivel) erros.push('sala Mesa: a janela de tela tem botao de fechar visivel');
  await page.evaluate((id) => {
    window.__recusas = [];
    window.__ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'mesa-denied') window.__recusas.push(m);
    });
    window.__ws.send(JSON.stringify({ type: 'mesa', op: 'remove', id }));
  }, janelaDaBia.id);
  await espera(600);
  const recusa = await page.evaluate(() => window.__recusas.find((m) => m.op === 'remove'));
  if (!recusa || recusa.reason !== 'media') {
    erros.push(`sala Mesa: remove da tela nao foi recusado com "media" (${JSON.stringify(recusa)})`);
  }
  await page.focus(`.mesa-win[data-id="${janelaDaBia.id}"]`).catch(() => {});
  await page.keyboard.press('Delete');
  await espera(300);
  if (!(await page.$(`.mesa-win[data-id="${janelaDaBia.id}"]`))) erros.push('sala Mesa: Delete tirou a janela de tela');
  // O clique na fonte segue levando a janela, que continua la.
  await page.click(`#bus-live .src[data-tile="${bia.id}"]`);
  await espera(400);
  const aviso = await page.evaluate(() => document.getElementById('toast-text')?.textContent || '');
  if (aviso.includes('não está na Mesa')) erros.push(`sala Mesa: aviso de janela ausente com a janela na Mesa (${aviso})`);
  await foto(page, '21c-tela-sem-fechar', w, h);
}

async function rodada(browser, port, [w, h]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const erros = [];
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  await page.addInitScript(PONTE, TEMA);
  await page.goto(PAGINA);
  await page.fill('#join-address', `127.0.0.1:${port}`);
  await page.press('#join-address', 'Enter');
  await page.waitForSelector('#room-view:not(.hidden)', { timeout: 8000 });
  await espera(400);
  // Sala Mesa: a Mesa abre sozinha no welcome, sem o palco no caminho.
  if (!SO_TRANSMISSOES && !(await page.$('.mesa'))) erros.push('sala Mesa: a Mesa nao abriu sozinha');
  await foto(page, '01-sozinho', w, h);

  const bia = await pessoa(port, 'Bia');
  const leo = await pessoa(port, 'Leo');
  const caio = await pessoa(port, 'Caio');
  await espera(300);
  bia.envia({ type: 'broadcast-state', live: true, annotate: true, reactions: true });
  leo.envia({ type: 'broadcast-state', live: true, reactions: false });
  caio.envia({ type: 'camera-state', on: true });
  await espera(300);
  await mostrarTela(page, bia.id, 'Bia', '#4B5A3A');
  await mostrarTela(page, leo.id, 'Leo', '#3B2A63');
  await mostrarTela(page, `cam-${caio.id}`, 'Caio', '#173C4F', 'camera', 640, 480);
  bia.envia({ type: 'chat', text: 'alguém vem de sage? tô cansada de ser a única que cura' });
  bia.envia({ type: 'chat', text: 'e liga o som, tá mudo' });
  leo.envia({ type: 'chat', text: 'bora mais uma depois dessa? quem perder abre o truco na Mesa 😂' });
  await espera(700);
  await foto(page, '02-ao-vivo', w, h);

  // HUD de um tile com o mouse em cima.
  const tile = await tileParaFotografar(page);
  if (tile) {
    const caixa = await tile.boundingBox();
    await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
    await foto(page, '03-hud', w, h);
  }

  leo.envia({ type: 'broadcast-state', live: true, paused: true });
  await espera(400);
  await foto(page, '04-pausada', w, h);

  await page.click('#btn-room-presence').catch((e) => erros.push(`presenca: ${e.message}`));
  await foto(page, '05-presenca', w, h);
  await page.keyboard.press('Escape');
  await page.click('#btn-room-more').catch((e) => erros.push(`menu da sala: ${e.message}`));
  await foto(page, '06-menu-sala', w, h);
  await page.keyboard.press('Escape');

  if (await page.isVisible('#btn-chat-emoji')) {
    await page.click('#btn-chat-emoji');
    await foto(page, '15-emoji', w, h);
    await page.keyboard.press('Escape');
  }

  if (SO_TRANSMISSOES) {
    if (await page.$('#view-mesa')) erros.push('sala so transmissoes: sobrou o item da Mesa no barramento');
  } else {
    await espera(800);
    await foto(page, '21-mesa', w, h);
    await menuDaMesaSobreAConversa(page, w, h, erros);
    await verificarSalaMesa(page, bia, w, h, erros);
  }

  // Auditoria de teclado: cada parada do Tab tem nome acessivel e foco visivel.
  await page.mouse.move(1, 1);
  await page.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    const parada = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const nome = el.getAttribute('aria-label') || el.textContent.trim().slice(0, 40) || el.getAttribute('title')
        || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent.trim()) || el.placeholder || '';
      // Foco pode ser indicado pelo proprio controle ou pela caixa em volta (:focus-within).
      const caixaDoCampo = el.parentElement && getComputedStyle(el.parentElement);
      const visivel = cs.boxShadow !== 'none' || (cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px')
        || (caixaDoCampo && caixaDoCampo.boxShadow !== 'none');
      const caixa = el.getBoundingClientRect();
      return { alvo: `${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].slice(0, 2).join('.')}`, nome, visivel,
        naTela: caixa.width > 0 && caixa.height > 0 };
    });
    if (!parada) continue;
    if (!parada.nome) erros.push(`teclado: sem nome acessivel em ${parada.alvo}`);
    if (!parada.visivel) erros.push(`teclado: foco invisivel em ${parada.alvo} (${parada.nome})`);
    if (!parada.naTela) erros.push(`teclado: foco em elemento fora da tela ${parada.alvo}`);
  }

  // Painel de comando.
  await page.keyboard.press('Control+k');
  await page.keyboard.type(SO_TRANSMISSOES ? 'ass' : 'ir at');
  await foto(page, '20-comando', w, h);
  await page.keyboard.press('Escape');

  // Configuracoes como folha sobre a sala.
  await page.click('#btn-room-settings');
  await espera(400);
  await foto(page, '16-config-perfil', w, h);
  await page.click('#settings-cat-appearance');
  await foto(page, '17-config-aparencia', w, h);
  await page.click('#settings-cat-voice');
  await foto(page, '18-config-sons', w, h);
  await page.click('#settings-cat-stats');
  await foto(page, '19-config-diagnostico', w, h);
  await page.keyboard.press('Escape');
  await espera(300);

  // O seletor de fonte (Transmitir), com as telas e depois as janelas.
  await page.click('#btn-toggle-share');
  await espera(600);
  await foto(page, '13-transmitir-telas', w, h);
  await page.click('#picker-tabs [data-tab="window"]');
  await page.click('#picker-grid .src-card');
  await foto(page, '14-transmitir-janelas', w, h);
  await page.keyboard.press('Escape');

  // Voce transmitindo e depois pausado (a UI recebe o estado pelo mesmo setToggleState que o app usa).
  await page.evaluate(() => {
    window.GoLive.ui.setToggleState('share', 'on');
    document.getElementById('btn-pause-share').classList.remove('hidden');
    document.getElementById('btn-swap-share').classList.remove('hidden');
  });
  await foto(page, '08-transmitindo', w, h);
  await page.evaluate(() => window.GoLive.ui.setToggleState('pause', 'on'));
  await foto(page, '09-transmitindo-pausado', w, h);
  await page.evaluate(() => {
    window.GoLive.ui.setToggleState('pause', 'off');
    window.GoLive.ui.setToggleState('share', 'off');
  });

  // Conversa espiando: as mensagens surgem sobre o programa.
  // Sem a Mesa (que fixa a Conversa ao testar o menu), a Conversa pode estar fechada: Espiar so existe fixada.
  if ((await page.getAttribute('#app', 'data-conv')) !== 'pinned') await page.click('#btn-conv-toggle');
  await espera(300);
  if (await page.isVisible('#btn-conv-peek')) await page.click('#btn-conv-peek');
  await espera(200);
  await foto(page, '10a-espiar-clique', w, h);
  const bolhas = await page.evaluate(() => document.querySelectorAll('#chat-peek .peek__msg').length);
  if (!bolhas) erros.push('espiar: o clique nao mostrou bolha nenhuma');
  bia.envia({ type: 'chat', text: 'olha o placar aí' });
  leo.envia({ type: 'chat', text: 'vou pegar água, já volto' });
  await espera(500);
  await foto(page, '10-conversa-espiando', w, h);
  await page.click('#btn-conv-toggle');
  // Sem historico: o clique em Espiar mostra so o aviso.
  await page.evaluate(() => window.GoLive.ui.chat.setHistory([]));
  await page.click('#btn-conv-peek');
  await espera(200);
  await foto(page, '10b-espiar-vazio', w, h);
  const aviso = await page.evaluate(() => document.querySelector('#chat-peek .peek__msg--aviso')?.textContent || '');
  if (!aviso.includes('Espiando: mensagens novas aparecem aqui.')) erros.push('espiar: sem o aviso quando nao ha mensagens');
  await page.click('#btn-conv-toggle');

  // Tela cheia e teatro.
  const alvo = await tileParaFotografar(page);
  if (alvo) {
    await alvo.dblclick();
    await espera(500);
    await foto(page, '11-tela-cheia', w, h);
    await page.keyboard.press('Escape');
    await alvo.dblclick().catch(() => {});
    await espera(300);
  }
  await page.keyboard.press('t');
  await espera(300);
  const teatro = await page.getAttribute('#app', 'data-theater');
  if (SO_TRANSMISSOES && teatro === null) erros.push('teatro: a tecla T nao ligou o Modo teatro no palco');
  if (!SO_TRANSMISSOES && teatro !== null) erros.push('teatro: a sala Mesa nao pode ter Modo teatro');
  await foto(page, '12-teatro', w, h);
  if (teatro !== null) await page.keyboard.press('t');

  for (const p of [bia, leo, caio]) p.fecha();
  await espera(600);
  await foto(page, '07-todos-sairam', w, h);
  await page.close();
  return erros;
}

(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const servidor = await createSignalingServer({
    port: 0, ownerToken: 'banco-de-prova', log: () => {}, mesa: !SO_TRANSMISSOES,
  });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const todos = [];
  try {
    for (const t of TAMANHOS) {
      const erros = await rodada(browser, servidor.port, t);
      todos.push(...erros.map((e) => `${t.join('x')}: ${e}`));
    }
  } finally {
    await browser.close();
    await servidor.close();
  }
  if (todos.length) {
    console.error(todos.join('\n'));
    process.exit(1);
  }
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
