'use strict';

// Bancada da midia da Mesa (docs/2026-09-24-midia-na-mesa.md).
//
//   xvfb-run -a npx electron tools/midia/main.js        (Linux sem tela)
//   npx electron tools/midia/main.js                    (PC com tela)
//
// Sobe o servidor de sinalizacao REAL (porta aleatoria em 127.0.0.1), um
// YouTube/Twitch/i.ytimg FALSO (tools/midia/falso.js, via
// --host-resolver-rules) e duas janelas, "PC A" e "PC B", abertas pela
// origem local http://localhost (como o app, sem porta). Cada janela entra
// na sala, acerta o relogio pela mensagem `time` e monta os conteudos REAIS
// de src/renderer/mesa-janelas/. O roteiro abaixo da play, pausa, pula,
// empurra a deriva de um dos players e mede a correcao; testa o radio, o ao
// vivo, a regra de um video por PC, o clique no logo e o sandbox.
// Imprime um relatorio JSON e sai com 0 (tudo passou) ou 1.
//
// Com GOLIVE_MIDIA_REAL=1 NAO mapeia os dominios: usa o YouTube e a Twitch
// de verdade (precisa de internet; os ganchos de deriva do falso ficam de
// fora e o roteiro so mede sincronia, pausa e salto).

const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const falso = require('./falso');
const { createSignalingServer } = require('../../server/signaling-core');
const { linkParaNavegador } = require('../../src/main/linksexternos');

const REAL = process.env.GOLIVE_MIDIA_REAL === '1';
const RAIZ = path.join(__dirname, '..', '..', 'src', 'renderer');
const VIDEO = REAL ? (process.env.SPIKE_VIDEO || 'M7lc1UVf-VE') : 'M7lc1UVf-VE';
const SCRIPTS = [
  'mesa-modules/midialinks.js', 'mesa-modules/youtube.js', 'mesa-modules/radio.js', 'mesa-modules/aovivo.js',
  // ytplayer.js, mesa-sync-media.js e mesa-midia.js NAO: os conteudos os
  // carregam sob demanda, como no app (a Vista so poe mesa-janelas/<tipo>.js).
  'mesa-modules/index.js',
  'mesa-janelas/youtube.js', 'mesa-janelas/radio.js', 'mesa-janelas/aovivo.js',
];

if (typeof process.getuid === 'function' && process.getuid() === 0) app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const espera = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function ate(fn, ms, passo = 100) {
  const fim = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > fim) return null;
    await espera(passo);
  }
}

function paginaHtml() {
  const index = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const csp = index.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>bancada midia</title>
<link rel="stylesheet" href="style.css" /><link rel="stylesheet" href="mesa-janelas.css" />
<style>
body{overflow:auto;background:var(--bg)}
#mesa{display:flex;flex-wrap:wrap;gap:12px;padding:12px}
.caixa{background:var(--s2);border:1px solid var(--line);border-radius:10px;padding:6px}
.caixa h2{font-size:11px;margin:0 0 4px;color:var(--tx2)}
.conteudo{position:relative;width:480px;height:270px}
.caixa-radio .conteudo{width:360px;height:480px}
</style></head><body><div id="mesa"></div>
${SCRIPTS.map((s) => `<script src="${s}"></script>`).join('\n')}
<script src="bancada-pagina.js"></script></body></html>`;
}

function instalarOrigem() {
  const tipos = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' };
  session.defaultSession.protocol.handle('http', (req) => {
    const u = new URL(req.url);
    if (u.origin !== 'http://localhost') return new Response('fora', { status: 404 });
    const p = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    if (p === 'bancada.html') return new Response(paginaHtml(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    const arq = p === 'bancada-pagina.js' ? path.join(__dirname, p) : path.join(RAIZ, p);
    if (p.includes('..') || !tipos[path.extname(arq)] || !fs.existsSync(arq)) return new Response('404', { status: 404 });
    return new Response(fs.readFileSync(arq), { headers: { 'Content-Type': tipos[path.extname(arq)] } });
  });
}

function abrirPc(nome, porta, x, aberturas) {
  const win = new BrowserWindow({ x, y: 0, width: 1300, height: 900, title: nome, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  // A mesma decisao do main.js do app, gravando em vez de abrir o navegador.
  win.webContents.setWindowOpenHandler((details) => {
    aberturas.push({ pc: nome, url: details.url, referrer: details.referrer && details.referrer.url, disposition: details.disposition, abreNoNavegador: linkParaNavegador(details) });
    return { action: 'deny' };
  });
  win.webContents.on('console-message', (e) => {
    const msg = e.message || '';
    if (/error|Refused|CSP/i.test(msg)) console.log(`[${nome}] ${msg}`);
  });
  win.loadURL(`http://localhost/bancada.html?nome=${encodeURIComponent(nome)}&ws=${porta}`);
  const js = (code, gesto = false) => win.webContents.executeJavaScript(code, gesto);
  const frames = () => win.webContents.mainFrame.framesInSubtree.filter((f) => f !== win.webContents.mainFrame);
  /** O iframe do player falso que esta com o video `vid`. */
  async function frameDo(vid) {
    for (const f of frames()) {
      if (f.origin !== 'https://www.youtube-nocookie.com') continue;
      try {
        if ((await f.executeJavaScript('window.__vid && window.__vid()')) === vid) return f;
      } catch {
        // frame sumindo
      }
    }
    return null;
  }
  return { nome, win, js, frames, frameDo };
}

function resumo(v) {
  if (!v.length) return null;
  const abs = v.map(Math.abs).sort((a, b) => a - b);
  const q = (p) => abs[Math.min(abs.length - 1, Math.floor(p * abs.length))];
  return { n: v.length, max: +abs[abs.length - 1].toFixed(3), p95: +q(0.95).toFixed(3), mediana: +q(0.5).toFixed(3), ultimo: +Math.abs(v[v.length - 1]).toFixed(3) };
}

async function amostrar(pcs, id, segundos, passoMs = 100) {
  const erros = pcs.map(() => []);
  const entre = [];
  const traco = [];
  const t0 = Date.now();
  while (Date.now() - t0 < segundos * 1000) {
    const ms = await Promise.all(pcs.map((pc) => pc.js(`bancada.medir(${JSON.stringify(id)})`)));
    ms.forEach((m, i) => { if (m && m.pos !== null) erros[i].push(m.alvo - m.pos); });
    if (ms.every((m) => m && m.pos !== null)) entre.push(ms[0].pos - ms[1].pos);
    if (ms[1]) traco.push([Date.now() - t0, ms[1].pos !== null ? +(ms[1].alvo - ms[1].pos).toFixed(3) : null, ms[1].rate]);
    await espera(passoMs);
  }
  return { porPc: Object.fromEntries(pcs.map((pc, i) => [pc.nome, resumo(erros[i])])), entrePcs: resumo(entre), traco };
}

async function comandosDoFalso(frame) {
  if (!frame) return [];
  return frame.executeJavaScript('window.__log.cmds.slice()');
}

async function main() {
  const rel = { quando: new Date().toISOString(), electron: process.versions.electron, chrome: process.versions.chrome, modo: REAL ? 'youtube real' : 'youtube falso', checks: [] };
  const check = (nome, ok, detalhe) => {
    rel.checks.push({ nome, ok: !!ok, detalhe });
    console.log(`${ok ? 'ok  ' : 'FALHOU'} ${nome}${detalhe !== undefined ? ` -- ${JSON.stringify(detalhe)}` : ''}`);
  };
  let fake = null;
  if (!REAL) fake = await falso.iniciar(PORTA_FALSO);
  const sinal = await createSignalingServer({ port: 0, log: () => {} });
  instalarOrigem();
  const aberturas = [];
  const A = abrirPc('PC A', sinal.port, 0, aberturas);
  await espera(300);
  const B = abrirPc('PC B', sinal.port, 640, aberturas);
  const pcs = [A, B];
  check('os dois PCs entraram e acertaram o relogio', await ate(async () => (await A.js('bancada.pronto()')) && B.js('bancada.pronto()'), 10000));
  rel.relogio = { A: await A.js('bancada.relogio()'), B: await B.js('bancada.relogio()') };

  // ---------- YouTube: carregar, seguir, pausar, pular ----------
  await A.js('bancada.add("youtube", 100, 100, 640, 360)');
  const ytId = await ate(async () => (await A.js('bancada.ids("youtube")'))[0] && (await B.js('bancada.ids("youtube")'))[0], 5000);
  check('janela youtube apareceu nos dois', ytId);
  const idJs = JSON.stringify(ytId);
  const tLoad = Date.now();
  await A.js(`bancada.preencher(${idJs}, '.mjm-input', 'https://youtu.be/${VIDEO}?t=5')`);
  const emSincronia = (pc) => ate(async () => {
    const m = await pc.js(`bancada.medir(${idJs})`);
    return m && m.estado === 'playing' && m.pos !== null && Math.abs(m.alvo - m.pos) < 0.3 ? Date.now() - tLoad : null;
  }, 20000);
  const [sA, sB] = await Promise.all([emSincronia(A), emSincronia(B)]);
  check('load em A: os dois tocando dentro de 0,3 s do alvo', sA && sB, { msA: sA, msB: sB });
  rel.estavel = await amostrar(pcs, ytId, 5);
  check('5 s tocando: erro de cada PC abaixo de 0,3 s', rel.estavel.porPc['PC A'].max < 0.3 && rel.estavel.porPc['PC B'].max < 0.3, rel.estavel.porPc);
  delete rel.estavel.traco;

  // Pausa pelo botao do B
  const tPausa = Date.now();
  await B.js(`bancada.clicar(${idJs}, '.mjm-bar .mjm-icon')`);
  const pausouA = await ate(async () => ((await A.js(`bancada.medir(${idJs})`)).estado === 'paused' ? Date.now() - tPausa : null), 5000);
  await espera(1200);
  const [pA, pB] = await Promise.all([A.js(`bancada.medir(${idJs})`), B.js(`bancada.medir(${idJs})`)]);
  check('pausa no B: A pausa e os dois param na mesma posicao', pausouA && Math.abs(pA.pos - pB.pos) < 0.3 && Math.abs(pA.pos - pA.alvo) < 0.3, { msAtePausarA: pausouA, posA: pA.pos, posB: pB.pos, alvo: pA.alvo });

  // Play pelo A, salto pelo B
  await A.js(`bancada.clicar(${idJs}, '.mjm-bar .mjm-icon')`);
  await ate(async () => (await B.js(`bancada.medir(${idJs})`)).estado === 'playing', 5000);
  const tSalto = Date.now();
  await B.js(`bancada.act(${idJs}, { kind: 'seek', pos: 120 })`);
  const saltou = await ate(async () => {
    const ms = await Promise.all(pcs.map((pc) => pc.js(`bancada.medir(${idJs})`)));
    return ms.every((m) => m.pos > 119 && Math.abs(m.alvo - m.pos) < 0.3) ? Date.now() - tSalto : null;
  }, 5000);
  check('salto para 2:00 no B: os dois chegam', saltou, { ms: saltou });

  if (!REAL) {
    // ---------- Deriva: o video do B anda 3% mais rapido ----------
    const fB = await B.frameDo(VIDEO);
    await fB.executeJavaScript('window.__log.cmds.length = 0; window.__skew = 1.03');
    const deriva = await amostrar(pcs, ytId, 25);
    const cmdsDeriva = await comandosDoFalso(fB);
    await fB.executeJavaScript('window.__skew = 1');
    rel.deriva3pc = {
      ...deriva,
      velocidades: cmdsDeriva.filter((c) => c[1] === 'setPlaybackRate').map((c) => c[2][0]),
      saltos: cmdsDeriva.filter((c) => c[1] === 'seekTo').length,
    };
    check('deriva de 3% no B: segura abaixo de ~0,45 s so com velocidade', deriva.porPc['PC B'].max < 0.45 && rel.deriva3pc.saltos === 0, { erroB: deriva.porPc['PC B'], velocidades: rel.deriva3pc.velocidades.length, saltos: rel.deriva3pc.saltos });
    rel.deriva3pc.traco = deriva.traco.filter((_, i) => i % 5 === 0);

    // ---------- Soluco de 4 s (o player do B volta sozinho) ----------
    await espera(3000);
    await fB.executeJavaScript('window.__log.cmds.length = 0; window.__jump(-4)');
    const tJ = Date.now();
    // Primeiro o conteudo tem de ver o pulo (o proximo infoDelivery), depois corrigir.
    const viu = await ate(async () => {
      const m = await B.js(`bancada.medir(${idJs})`);
      return m.pos !== null && m.alvo - m.pos > 3 ? Date.now() - tJ : null;
    }, 3000, 20);
    const voltou = await ate(async () => {
      const m = await B.js(`bancada.medir(${idJs})`);
      return m.pos !== null && Math.abs(m.alvo - m.pos) < 0.3 ? Date.now() - tJ : null;
    }, 5000, 20);
    await espera(1500);
    const cmdsJ = await comandosDoFalso(fB);
    rel.salto4s = { msAteVer: viu, msAteCorrigir: voltou, seeks: cmdsJ.filter((c) => c[1] === 'seekTo').length };
    check('B 4 s atrasado: corrige com 1 salto', viu !== null && voltou && rel.salto4s.seeks === 1, rel.salto4s);

    // ---------- 1 s de atraso: velocidade ate cruzar ----------
    await espera(2000);
    await fB.executeJavaScript('window.__log.cmds.length = 0; window.__jump(-1)');
    const um = await amostrar([A, B], ytId, 26, 200);
    const cmdsUm = await comandosDoFalso(fB);
    rel.atraso1s = {
      erroB: um.porPc['PC B'],
      velocidades: cmdsUm.filter((c) => c[1] === 'setPlaybackRate').map((c) => c[2][0]),
      saltos: cmdsUm.filter((c) => c[1] === 'seekTo').length,
      // Do momento em que o conteudo viu o atraso (> 0,5 s) ate o erro cair abaixo de 0,05 s.
      msAteCruzar: (() => {
        const i = um.traco.findIndex((t) => t[1] !== null && t[1] > 0.5);
        const j = i < 0 ? -1 : um.traco.findIndex((t, k) => k > i && t[1] !== null && t[1] < 0.05);
        return j < 0 ? null : um.traco[j][0] - um.traco[i][0];
      })(),
    };
    check('B 1 s atrasado: 1,05 ate cruzar e volta a 1, sem salto', rel.atraso1s.saltos === 0 && rel.atraso1s.velocidades.join(',') === '1.05,1' && rel.atraso1s.erroB.ultimo < 0.3, rel.atraso1s);

    // ---------- Player que arredonda a velocidade ----------
    await fB.executeJavaScript('window.__log.cmds.length = 0; window.__strictRates = true; window.__jump(-1)');
    await espera(5000);
    const cmdsS = await comandosDoFalso(fB);
    const mS = await B.js(`bancada.medir(${idJs})`);
    rel.velocidadeRecusada = { comandos: cmdsS.map((c) => c[1] + (c[2].length ? `(${c[2][0]})` : '')), erroFinal: +(mS.alvo - mS.pos).toFixed(3) };
    check('player que ignora 1,05: cai para salto', cmdsS.some((c) => c[1] === 'seekTo') && Math.abs(mS.alvo - mS.pos) < 0.3, rel.velocidadeRecusada);
    await fB.executeJavaScript('window.__strictRates = false');
  }

  // ---------- Um video com imagem por PC ----------
  await A.js('bancada.add("youtube", 800, 100, 640, 360)');
  const yt2 = await ate(async () => (await A.js('bancada.ids("youtube")'))[1], 5000);
  const yt2Js = JSON.stringify(yt2);
  await A.js(`bancada.act(${yt2Js}, { kind: 'load', videoId: 'dQw4w9WgXcQ' })`);
  await espera(800);
  const esperaA = await A.js(`bancada.medir(${yt2Js})`);
  check('segundo YouTube entra em espera (capa, sem player)', esperaA.ativo === false && esperaA.visivel.capa && esperaA.pronto === false, esperaA);
  await A.js(`bancada.clicar(${yt2Js}, '.mjm-cover .mjm-btn')`);
  const trocou = await ate(async () => {
    const [m1, m2] = await Promise.all([A.js(`bancada.medir(${idJs})`), A.js(`bancada.medir(${yt2Js})`)]);
    return m2.ativo && m2.estado === 'playing' && !m1.ativo && m1.visivel.capa ? { m1, m2 } : null;
  }, 8000);
  check('"Tocar este" passa a vez: o outro vai para a capa', trocou);
  const frames1 = A.frames().filter((f) => f.origin === 'https://www.youtube-nocookie.com').length;
  check('so um iframe do YouTube no PC A', frames1 === 1, { iframes: frames1 });

  // ---------- Clique no logo do player ----------
  const fLogo = await A.frameDo(REAL ? null : 'dQw4w9WgXcQ');
  if (fLogo) {
    await fLogo.executeJavaScript('document.getElementById("logo").click()', true);
    await ate(() => aberturas.length > 0, 3000);
    check('logo do YouTube: a janela nova vira openExternal com o referrer do player', aberturas[0] && aberturas[0].abreNoNavegador === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', aberturas[0]);
  }

  // Tirar o ativo da mesa: o que estava em espera volta sozinho.
  await A.js(`bancada.tirar(${yt2Js})`);
  const volta = await ate(async () => {
    const m = await A.js(`bancada.medir(${idJs})`);
    return m && m.ativo && m.estado === 'playing' && Math.abs(m.alvo - m.pos) < 0.3 ? m : null;
  }, 8000);
  check('tirar o ativo: o que estava em espera volta, ja no ponto da sala', volta, volta && { pos: volta.pos, alvo: volta.alvo });

  // ---------- Radio ----------
  await A.js('bancada.add("radio", 100, 600, 360, 480)');
  const rId = await ate(async () => (await A.js('bancada.ids("radio")'))[0] && (await B.js('bancada.ids("radio")'))[0], 5000);
  const rJs = JSON.stringify(rId);
  const faixa = REAL ? [VIDEO, VIDEO, VIDEO] : ['curtoAAAAAA', 'bloqueado00', 'curtoBBBBBB'];
  const tRadio = Date.now();
  await A.js(`bancada.preencher(${rJs}, '.mjm-input', 'https://music.youtube.com/watch?v=${faixa[0]}')`);
  await espera(300);
  await B.js(`bancada.preencher(${rJs}, '.mjm-input', 'https://youtu.be/${faixa[1]}')`);
  await espera(300);
  await A.js(`bancada.preencher(${rJs}, '.mjm-input', '${faixa[2]}')`);
  const linha = [];
  let ultimo = null;
  let votou = false;
  const fimRadio = Date.now() + 40000;
  while (Date.now() < fimRadio) {
    const st = await A.js(`bancada.estado(${rJs})`);
    const atual = st.current ? `${st.current.videoId}${st.current.title ? ' "' + st.current.title + '"' : ''}` : 'nada';
    if (atual !== ultimo) {
      linha.push([Date.now() - tRadio, atual, st.failed.map((f) => f.videoId).join(',')]);
      ultimo = atual;
    }
    if (!REAL && st.current && st.current.videoId === 'curtoBBBBBB' && !votou) {
      votou = true;
      await B.js(`bancada.clicar(${rJs}, '.mjm-radio-now .mjm-btn:not([hidden]):not(.mjm-icon)')`);
    }
    if (!st.current && linha.length > 2) break;
    await espera(200);
  }
  rel.radio = { linhaDoTempo: linha, capa: await A.js(`bancada.capaCarregou(${rJs})`), acoesVistasPorA: await A.js('bancada.acoes("radio")') };
  if (!REAL) {
    const vistos = linha.map((l) => l[1]);
    check('radio: toca a 1a, preenche o titulo, pula a bloqueada (150) e marca, toca a 3a', vistos.some((v) => v.startsWith('curtoAAAAAA "Vídeo falso')) && vistos.some((v) => v.startsWith('curtoBBBBBB')) && linha.some((l) => l[2].includes('bloqueado00')), linha);
    check('radio: capa de i.ytimg.com carrega com a CSP do app', rel.radio.capa && rel.radio.capa.largura === 1, rel.radio.capa);
  }

  // ---------- Ao vivo ----------
  await A.js('bancada.add("aovivo", 800, 600, 640, 360)');
  const lId = await ate(async () => (await A.js('bancada.ids("aovivo")'))[0], 5000);
  const lJs = JSON.stringify(lId);
  await A.js(`bancada.preencher(${lJs}, '.mjm-input', 'https://www.twitch.tv/Gaules')`);
  await espera(500);
  await A.js(`bancada.clicar(${lJs}, '.mjm-cover .mjm-btn')`);
  const tw = await ate(async () => {
    const f = A.frames().find((x) => x.origin === 'https://player.twitch.tv');
    if (!f) return null;
    try {
      const d = await f.executeJavaScript('({ ok: document.body.dataset.ok, canal: document.body.dataset.canal, url: location.href })');
      return d.ok ? { f, d } : null;
    } catch {
      return null;
    }
  }, 8000);
  if (!REAL) {
    check('ao vivo: player da Twitch com parent=localhost aceito', tw && tw.d.ok === 'true' && tw.d.canal === 'gaules', tw && tw.d);
    const antes = aberturas.length;
    await tw.f.executeJavaScript('document.getElementById("logo").click()', true);
    await ate(() => aberturas.length > antes, 3000);
    check('logo da Twitch: vira openExternal', aberturas[antes] && aberturas[antes].abreNoNavegador === 'https://www.twitch.tv/gaules', aberturas[antes]);
  }

  if (!REAL) {
    // ---------- Sandbox: o que cada atributo muda ----------
    rel.sandbox = [];
    for (const [sb, vid] of [
      ['allow-scripts allow-same-origin allow-popups', 'caixaAreia1'],
      ['allow-scripts allow-popups', 'caixaAreia2'],
      ['allow-scripts allow-same-origin', 'caixaAreia3'],
    ]) {
      const r = await A.js(`bancada.sandboxTeste(${JSON.stringify(sb)}, '${vid}')`);
      const f = await A.frameDo(vid);
      const antes = aberturas.length;
      let erroClique = null;
      if (f) {
        try {
          await f.executeJavaScript('document.getElementById("logo").click()', true);
        } catch (e) {
          erroClique = String(e.message || e);
        }
      }
      await espera(800);
      rel.sandbox.push({ sandbox: sb, origemDasMensagens: r.origens, frameAchado: !!f, cliqueChegouAoMain: aberturas.length > antes, erroClique });
    }
    const [s1, s2, s3] = rel.sandbox;
    check('sandbox: com allow-same-origin a origem e a do YouTube; sem, "null"', s1.origemDasMensagens.includes('https://www.youtube-nocookie.com') && s2.origemDasMensagens.every((o) => o === 'null'), rel.sandbox.map((s) => s.origemDasMensagens));
    check('sandbox: sem allow-popups o clique no logo nem chega ao main', s1.cliqueChegouAoMain && !s3.cliqueChegouAoMain, rel.sandbox.map((s) => s.cliqueChegouAoMain));

    // ---------- Referer que o YouTube recebe ----------
    const embeds = fake.log.filter((l) => l.host === 'www.youtube-nocookie.com');
    rel.referers = [...new Set(embeds.map((l) => l.referer))];
    check('embed pedido com Referer http://localhost/', rel.referers.length === 1 && rel.referers[0] === 'http://localhost/', rel.referers);
    const fAny = await A.frameDo('curtoBBBBBB') || await A.frameDo(VIDEO) || await A.frameDo('dQw4w9WgXcQ');
    if (fAny) rel.dentroDoEmbed = await fAny.executeJavaScript('({ referrer: window.__log.referrer, ancestor: window.__log.ancestor, origensListening: [...new Set(window.__log.origensListening)] })');

    // ---------- Sem internet: o player nunca responde ----------
    await B.js('bancada.add("youtube", 1500, 100, 640, 360)');
    const semId = await ate(async () => (await B.js('bancada.ids("youtube")')).find((i) => i !== ytId && i !== yt2), 5000);
    const semJs = JSON.stringify(semId);
    await B.js(`bancada.act(${semJs}, { kind: 'load', videoId: 'semrede0000' })`);
    await espera(500);
    await B.js(`bancada.clicar(${semJs}, '.mjm-cover .mjm-btn')`);
    const semRede = await ate(async () => {
      const m = await B.js(`bancada.medir(${semJs})`);
      return m && m.erro ? m : null;
    }, 20000, 250);
    check('player que nao responde: a janela diz "Sem internet" no lugar do player', semRede && /Sem internet/.test(semRede.visivel.msg), semRede && { erro: semRede.erro, msg: semRede.visivel.msg });
  }

  rel.aberturas = aberturas;
  rel.recusas = { A: await A.js('bancada.recusas()'), B: await B.js('bancada.recusas()') };
  const saida = path.join(os.tmpdir(), `golive-midia-${Date.now()}.json`);
  fs.writeFileSync(saida, JSON.stringify(rel, null, 2));
  const falhas = rel.checks.filter((c) => !c.ok);
  console.log(`\n${rel.checks.length - falhas.length}/${rel.checks.length} ok. Relatorio: ${saida}`);
  if (fake) fake.close();
  await sinal.close();
  app.exit(falhas.length ? 1 : 0);
}

// A regra do resolvedor tem de entrar antes do `ready`, entao a porta do
// falso e escolhida aqui (derivada do pid) e nao pelo sistema.
const PORTA_FALSO = 20000 + (process.pid % 20000);
if (!REAL) {
  // So os hosts do falso vao para ele. Sem proxy: o do container recusaria.
  app.commandLine.appendSwitch('host-resolver-rules', falso.HOSTS.map((h) => `MAP ${h} 127.0.0.1:${PORTA_FALSO}`).join(', '));
  app.commandLine.appendSwitch('no-proxy-server');
}

app.on('certificate-error', (event, _wc, url, _err, _cert, cb) => {
  const host = new URL(url).hostname;
  if (!REAL && falso.HOSTS.includes(host)) {
    event.preventDefault();
    cb(true);
  } else {
    cb(false);
  }
});

app.whenReady().then(main).catch((err) => {
  console.error('bancada falhou:', err);
  app.exit(1);
});
