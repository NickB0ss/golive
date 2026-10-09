'use strict';

/*
 * Main Electron da bancada. NAO e o main do app: nao toma o lock de instancia
 * unica, nao sobe sinalizacao, descoberta, firewall, atualizador nem le o
 * perfil pessoal. Usa um perfil temporario descartavel e uma janela escondida.
 *
 * Fluxo: o launcher (run.js) grava o plano em JSON e chama
 *   electron main.js --bench-config=<json> --bench-report=<json> --bench-profile=<pasta>
 * Este processo valida tudo de novo, roda os cenarios na pagina (renderer/),
 * grava o relatorio e sai com 0 (ok), 1 (falha) ou 2 (timeout).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain, session, desktopCapturer, screen } = require('electron');

const { parseLaunchArgs } = require('./lib/launch');
const { validateConfig } = require('./lib/config');
const { applyBenchFlags } = require('./lib/flags');
const { bucketMetrics, summarizeCpu } = require('./lib/cpu');
const { buildReport, exitCodeFor } = require('./lib/report');
const { authorizeOwnedWindow, allowPermission } = require('./lib/capture-guard');
const { fitOwnedWindow } = require('./lib/owned-window');
const { pathToFileURL } = require('url');
const { runtimeInfo } = require('../../src/main/runtime-info');
const { replyOnce } = require('../../src/main/displaymedia');

const log = (...a) => console.log('[media-bench]', ...a);

const launch = parseLaunchArgs(process.argv, os.tmpdir());
if (!launch.ok) {
  console.error('[media-bench] argumentos internos invalidos:', launch.errors.join('; '));
  app.exit(3);
  return;
}

let plan;
try {
  plan = JSON.parse(fs.readFileSync(launch.configPath, 'utf8'));
  const problems = [];
  for (const s of plan.scenarios || []) {
    for (const e of validateConfig(s.config)) problems.push(`${s.key}: ${e}`);
  }
  if (!plan.scenarios?.length) problems.push('plano sem cenarios');
  if (problems.length) throw new Error(problems.join('; '));
} catch (err) {
  console.error('[media-bench] plano invalido:', err.message || err);
  app.exit(3);
  return;
}

// Perfil descartavel ANTES do ready: nada do perfil pessoal e tocado.
app.setPath('userData', launch.profileDir);
app.setPath('sessionData', path.join(launch.profileDir, 'session'));
const flags = applyBenchFlags(app.commandLine, { error: (...a) => console.error('[media-bench]', ...a) });

const usesOwnedWindow = plan.scenarios.some((s) => s.config.source === 'owned-window');
const state = {
  startedAt: new Date().toISOString(),
  results: [],
  cpu: [],
  fatal: null,
  timedOut: false,
  finished: false,
  armed: false,
  runtime: null,
};
let benchWin = null;
let ownedWin = null;
let ownedInfo = null; // tamanho efetivo da janela propria (gravado no relatorio)
let ownedReady = Promise.resolve();
let cpuTimer = null;
let globalTimer = null;
const benchFile = path.join(__dirname, 'renderer', 'index.html');
const benchUrl = pathToFileURL(benchFile).href;

const trustedSender = (event) => Boolean(benchWin) && !benchWin.isDestroyed()
  && event.sender === benchWin.webContents && isBenchFrame(event.senderFrame);

/** Frame principal da pagina da bancada (mesmo processo/rota e URL esperada). */
function isBenchFrame(frame) {
  if (!frame || !benchWin || benchWin.isDestroyed()) return false;
  const main = benchWin.webContents.mainFrame;
  return frame.processId === main.processId && frame.routingId === main.routingId
    && typeof frame.url === 'string' && frame.url.startsWith(benchUrl);
}

function writeReport(report) {
  try {
    fs.mkdirSync(path.dirname(launch.reportPath), { recursive: true });
    fs.writeFileSync(launch.reportPath, JSON.stringify(report, null, 2), 'utf8');
  } catch (err) {
    console.error('[media-bench] nao gravou o relatorio:', err.message || err);
    return false;
  }
  return true;
}

function finish({ timedOut = false, fatal = null } = {}) {
  if (state.finished) return;
  state.finished = true;
  clearInterval(cpuTimer);
  clearTimeout(globalTimer);
  state.timedOut = timedOut;
  state.fatal = fatal || state.fatal;
  const report = buildReport({
    startedAt: state.startedAt,
    finishedAt: new Date().toISOString(),
    label: plan.label,
    args: plan.args,
    planned: plan.scenarios.length,
    scenarios: state.results,
    timedOut: state.timedOut,
    fatal: state.fatal,
    runtime: state.runtime,
    flags,
    profile: { userData: 'temporario (removido ao fim)', singleInstanceLock: 'nao tomado' },
  });
  const wrote = writeReport(report);
  const code = wrote ? exitCodeFor(report) : 1;
  log(`fim: status=${report.status} cenarios=${state.results.length}/${plan.scenarios.length} saida=${code}`);
  for (const w of [ownedWin, benchWin]) {
    try { if (w && !w.isDestroyed()) w.destroy(); } catch { /* ja destruida */ }
  }
  app.exit(code);
}

async function collectRuntime() {
  let gpuInfo = null;
  try {
    gpuInfo = await Promise.race([
      app.getGPUInfo('basic'),
      new Promise((resolve) => { setTimeout(() => resolve({ erro: 'getGPUInfo nao respondeu em 5s' }), 5000); }),
    ]);
  } catch (err) {
    gpuInfo = { erro: String(err?.message || err) };
  }
  const cpus = os.cpus();
  return {
    ...runtimeInfo({ appVersion: app.getVersion(), packaged: app.isPackaged }),
    os: { release: os.release(), version: typeof os.version === 'function' ? os.version() : null, totalMemMB: Math.round(os.totalmem() / 1048576) },
    cpu: { model: cpus[0]?.model || null, logicalCores: cpus.length },
    gpuFeatureStatus: app.getGPUFeatureStatus(),
    gpuInfo,
  };
}

function createOwnedWindow() {
  // Tamanho/fps do PRIMEIRO cenario owned-window (a CLI aplica os mesmos a todos).
  const cfg = plan.scenarios.find((s) => s.config.source === 'owned-window').config;
  const display = screen.getPrimaryDisplay();
  ownedInfo = fitOwnedWindow(cfg, display.workAreaSize, display.scaleFactor);
  log(`janela de origem: ${ownedInfo.width}x${ownedInfo.height} DIP (escala ${ownedInfo.scaleFactor}), fps ${ownedInfo.fps}${ownedInfo.clamped ? ' [limitada a area de trabalho]' : ''}`);
  ownedWin = new BrowserWindow({
    width: ownedInfo.width, height: ownedInfo.height, useContentSize: true, frame: false, resizable: false,
    show: false, title: 'GoLive media-bench (origem)',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  ownedWin.setMenuBarVisibility(false);
  ownedWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ownedWin.webContents.on('will-navigate', (e) => e.preventDefault());
  ownedWin.on('closed', () => { ownedWin = null; });
  ownedReady = new Promise((resolve, reject) => {
    ownedWin.once('ready-to-show', () => { ownedWin.showInactive(); resolve(); });
    ownedWin.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`janela de origem: ${desc} (${code})`)));
  });
  ownedWin.loadFile(path.join(__dirname, 'renderer', 'source-window.html'), { query: { fps: String(ownedInfo.fps) } }).catch((err) => log('janela de origem:', err.message));
}

function installSessionPolicy() {
  const ses = session.defaultSession;
  // Camera, microfone, notificacoes, etc.: tudo recusado. O unico acesso a
  // midia da bancada e o getDisplayMedia abaixo, e so no modo owned-window
  // (o pedido de permissao precisa passar para ele ser chamado; ver allowPermission).
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const fromBench = Boolean(benchWin) && !benchWin.isDestroyed() && wc === benchWin.webContents
      && details?.isMainFrame !== false && String(details?.requestingUrl || '').startsWith(benchUrl);
    callback(allowPermission({ permission, mediaTypes: details?.mediaTypes, armed: state.armed && usesOwnedWindow, fromBench }));
  });
  ses.setPermissionCheckHandler(() => false);
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const reply = replyOnce(callback, log);
    authorizeOwnedWindow({
      request,
      isArmed: () => state.armed && usesOwnedWindow,
      isTrustedFrame: isBenchFrame,
      ownedSourceId: () => (ownedWin && !ownedWin.isDestroyed() ? ownedWin.getMediaSourceId() : null),
      listSources: () => desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }),
      consume: () => { state.armed = false; },
    }).then((streams) => {
      if (!streams) log('getDisplayMedia recusado');
      reply(streams);
    }).catch((err) => {
      log('getDisplayMedia falhou:', err?.message || err);
      reply(null);
    });
  }, { useSystemPicker: false });
}

function installIpc() {
  ipcMain.handle('bench:plan', async (event) => {
    if (!trustedSender(event)) throw new Error('remetente nao confiavel');
    await ownedReady;
    return { scenarios: plan.scenarios, ownedWindow: ownedInfo };
  });
  ipcMain.handle('bench:arm-capture', (event) => {
    if (!trustedSender(event)) throw new Error('remetente nao confiavel');
    if (!usesOwnedWindow) throw new Error('captura nao autorizada neste modo');
    state.armed = true;
  });
  ipcMain.handle('bench:scenario-start', (event, key) => {
    if (!trustedSender(event)) throw new Error('remetente nao confiavel');
    state.armed = false;
    log('cenario', key);
  });
  ipcMain.handle('bench:scenario-done', (event, result) => {
    if (!trustedSender(event)) throw new Error('remetente nao confiavel');
    state.armed = false;
    const t = result?.timing || {};
    result.cpu = Number.isFinite(t.measureStartWall) && Number.isFinite(t.measureEndWall)
      ? summarizeCpu(state.cpu, t.measureStartWall, t.measureEndWall) : null;
    state.results.push(result);
  });
  ipcMain.on('bench:log', (event, text) => {
    if (trustedSender(event)) log('pagina:', String(text).slice(0, 500));
  });
  ipcMain.handle('bench:finish', (event, fatal) => {
    if (!trustedSender(event)) throw new Error('remetente nao confiavel');
    setImmediate(() => finish({ fatal: fatal ? String(fatal).slice(0, 2000) : null }));
  });
}

process.on('uncaughtException', (err) => {
  console.error('[media-bench] excecao no main:', err?.stack || err);
  finish({ fatal: `excecao no main: ${err?.message || err}` });
});

app.whenReady().then(async () => {
  installSessionPolicy();
  installIpc();
  if (usesOwnedWindow) createOwnedWindow();
  state.runtime = await collectRuntime();

  benchWin = new BrowserWindow({
    width: 900, height: 600, show: plan.show === true, title: 'GoLive media-bench',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Sem isto a janela escondida estrangula timers e a cena perde quadros.
      backgroundThrottling: false,
    },
  });
  benchWin.setMenuBarVisibility(false);
  benchWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  benchWin.webContents.on('will-navigate', (e) => e.preventDefault());
  benchWin.webContents.on('render-process-gone', (_e, d) => finish({ fatal: `renderer da bancada caiu: ${d.reason}` }));
  benchWin.webContents.on('console-message', (e) => {
    if (e.level === 'error') log('console.error da pagina:', e.message);
  });

  cpuTimer = setInterval(() => {
    state.cpu.push({ t: Date.now(), ...bucketMetrics(app.getAppMetrics()) });
  }, 1000);
  globalTimer = setTimeout(() => finish({ timedOut: true, fatal: 'timeout do conjunto' }), plan.timeoutMs);

  await benchWin.loadFile(benchFile);
}).catch((err) => finish({ fatal: `inicializacao falhou: ${err?.message || err}` }));

app.on('window-all-closed', () => {
  if (!state.finished) finish({ fatal: 'janela da bancada fechou antes do fim' });
});
