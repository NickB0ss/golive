'use strict';

/*
 * Main Electron da prova de conceito de SFU. NAO e o main do app: nao toma o
 * lock de instancia unica, nao sobe sinalizacao, descoberta, firewall nem
 * atualizador, nao le o perfil pessoal e nao captura tela. Perfil temporario,
 * janela escondida, sem permissoes.
 *
 * A SFU (mediasoup) roda AQUI, no processo principal, e a pagina fala com ela
 * so por IPC (`spike:rpc`), aceito apenas do frame principal da bancada.
 * Nenhum servidor HTTP/WebSocket e aberto. Rede, em dois lados:
 *  - SFU: o worker escuta SO em 127.0.0.1/UDP (listenInfos com portRange propria);
 *  - cliente: o Chromium abre sockets UDP efemeros em 0.0.0.0 (comportamento do
 *    WebRTC, fora do controle do mediasoup; nao existe politica que o faca ligar so
 *    no loopback). Eles sao confinados a uma faixa propria com
 *    webContents.setWebRTCUDPPortRange; o par ICE selecionado e registrado e a faixa
 *    e verificada livre ao fim. Nao ha promessa de "nenhuma porta fora do loopback".
 * As portas da SFU e a faixa do cliente sao verificadas ao fim de cada cenario.
 *
 *   electron main.js --spike-config=<json> --spike-report=<json> --spike-profile=<pasta>
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain, session } = require('electron');

const { parseLaunchArgs } = require('./lib/launch');
const { validateConfig } = require('./lib/config');
const { createTrust } = require('./lib/trust');
const { LocalSfu } = require('./lib/sfu');
const { toErrorPayload } = require('./lib/errors');
const { verifyClosed, verifyClientRange, busyPorts, SFU_PORT_RANGE, CLIENT_PORT_RANGE } = require('./lib/ports');
const { evaluateScenario } = require('./lib/evaluate');
const { buildReport, exitCodeFor } = require('./lib/report');
// Reaproveitado da bancada de midia (somente leitura): flags de producao e CPU do Electron.
const { applyBenchFlags } = require('../media-bench/lib/flags');
const { bucketMetrics, summarizeCpu } = require('../media-bench/lib/cpu');
const { runtimeInfo } = require('../../src/main/runtime-info');
const { workerBinPath } = require('./scripts/prepare');

const SNAPSHOT_MARKS = ['start', 'afterMidClose', 'end'];
const log = (...a) => console.log('[sfu-spike]', ...a);

const launch = parseLaunchArgs(process.argv, os.tmpdir());
if (!launch.ok) {
  console.error('[sfu-spike] argumentos internos invalidos:', launch.errors.join('; '));
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
  console.error('[sfu-spike] plano invalido:', err.message || err);
  app.exit(3);
  return;
}

// Perfil descartavel ANTES do ready: nada do perfil pessoal e tocado.
app.setPath('userData', launch.profileDir);
app.setPath('sessionData', path.join(launch.profileDir, 'session'));
const flags = applyBenchFlags(app.commandLine, { error: (...a) => console.error('[sfu-spike]', ...a) });

const state = {
  startedAt: new Date().toISOString(),
  results: [],
  cpu: [],
  fatal: null,
  timedOut: false,
  finished: false,
  runtime: null,
  current: null, // { key, scenario, sfu, owner, snapshots, clientBusyBefore }
  nextIndex: 0,
};
let win = null;
let cpuTimer = null;
let globalTimer = null;
const pageFile = path.join(__dirname, 'renderer', 'index.html');
const pageUrl = pathToFileURL(pageFile).href;
const trust = createTrust({ getWebContents: () => (win && !win.isDestroyed() ? win.webContents : null), urlPrefix: pageUrl });

function versions() {
  const out = { mediasoup: null, mediasoupClient: null, workerBin: null, workerBytes: null };
  try { out.mediasoup = require('mediasoup').version; } catch (err) { out.mediasoup = `indisponivel: ${err.message}`; }
  try {
    out.mediasoupClient = JSON.parse(fs.readFileSync(path.join(__dirname, 'node_modules', 'mediasoup-client', 'package.json'), 'utf8')).version;
  } catch (err) { out.mediasoupClient = `indisponivel: ${err.message}`; }
  try {
    const bin = workerBinPath();
    out.workerBin = bin;
    out.workerBytes = fs.statSync(bin).size;
  } catch { /* sem worker: o cenario falha com diagnostico proprio */ }
  return out;
}

function writeReport(report) {
  try {
    fs.mkdirSync(path.dirname(launch.reportPath), { recursive: true });
    fs.writeFileSync(launch.reportPath, JSON.stringify(report, null, 2), 'utf8');
  } catch (err) {
    console.error('[sfu-spike] nao gravou o relatorio:', err.message || err);
    return false;
  }
  return true;
}

/** Fecha a SFU do cenario em curso (se houver) e devolve { shutdown, verify, events }. */
async function closeCurrent({ checkClient = false } = {}) {
  const cur = state.current;
  if (!cur) return null;
  state.current = null;
  let shutdown;
  try {
    shutdown = await cur.sfu.close();
  } catch (err) {
    shutdown = { workerPid: null, died: false, subprocessClosed: false, timedOut: true, forcedKill: false, ports: [], error: String(err?.message || err) };
  }
  const verify = await verifyClosed({ pid: shutdown.workerPid, ports: shutdown.ports, host: cur.sfu.listenIp });
  const out = { shutdown, verify, events: cur.sfu.events };
  // Os transports do cliente ja foram fechados pela pagina antes do scenario-done.
  if (checkClient) out.clientRange = await verifyClientRange(CLIENT_PORT_RANGE, { busyBefore: cur.clientBusyBefore || [] });
  return out;
}

async function finish({ timedOut = false, fatal = null } = {}) {
  if (state.finished) return;
  state.finished = true;
  clearInterval(cpuTimer);
  clearTimeout(globalTimer);
  state.timedOut = timedOut;
  state.fatal = fatal || state.fatal;
  // Cenario interrompido: ainda fecha a SFU e registra o fechamento no relatorio.
  let aborted = null;
  try {
    aborted = await closeCurrent();
  } catch (err) {
    state.fatal = `${state.fatal || ''} | erro ao fechar a SFU: ${err?.message || err}`;
  }
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
    versions: versions(),
    flags,
    clientUdpPortRange: CLIENT_PORT_RANGE,
    profile: { userData: 'temporario (removido ao fim)', singleInstanceLock: 'nao tomado' },
  });
  if (aborted) report.abortedScenarioCleanup = aborted;
  const wrote = writeReport(report);
  const code = wrote ? exitCodeFor(report) : 1;
  log(`fim: status=${report.status} cenarios=${state.results.length}/${plan.scenarios.length} saida=${code}`);
  try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* ja destruida */ }
  app.exit(code);
}

function collectRuntime() {
  const cpus = os.cpus();
  return {
    ...runtimeInfo({ appVersion: app.getVersion(), packaged: app.isPackaged }),
    os: { release: os.release(), version: typeof os.version === 'function' ? os.version() : null, totalMemMB: Math.round(os.totalmem() / 1048576) },
    cpu: { model: cpus[0]?.model || null, logicalCores: cpus.length },
  };
}

function installSessionPolicy() {
  const ses = session.defaultSession;
  // A bancada nao usa camera, microfone nem captura: tudo recusado.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDisplayMediaRequestHandler((_request, callback) => callback(null), { useSystemPicker: false });
}

function assertTrusted(event) {
  if (!trust.isTrusted(event)) throw new Error('remetente nao confiavel');
}

function installIpc() {
  ipcMain.handle('spike:plan', (event) => {
    assertTrusted(event);
    return { scenarios: plan.scenarios };
  });

  ipcMain.handle('spike:scenario-start', async (event, key) => {
    assertTrusted(event);
    if (state.current) throw new Error('ja ha um cenario em curso');
    const scenario = plan.scenarios[state.nextIndex];
    if (!scenario || scenario.key !== key) throw new Error(`cenario fora de ordem: ${String(key)}`);
    state.nextIndex += 1;
    log('cenario', key);
    const sfu = new LocalSfu({ listenIp: scenario.config.listenIp, portRange: SFU_PORT_RANGE, logLevel: 'warn' });
    const clientBusyBefore = await busyPorts(CLIENT_PORT_RANGE); // portas de terceiros na faixa do cliente
    state.current = { key, scenario, sfu, owner: trust.ownerOf(event), snapshots: {}, clientBusyBefore };
    await sfu.start(); // se falhar, o proprio start() desfaz o worker; o erro chega a pagina e ao relatorio
  });

  // Unico canal para a SFU. O "dono" vem do webContents, nao da pagina.
  ipcMain.handle('spike:rpc', async (event, method, params) => {
    assertTrusted(event);
    const cur = state.current;
    if (!cur) return { ok: false, error: { code: 'NO_SCENARIO', message: 'nenhum cenario ativo' } };
    try {
      if (method === 'stats') {
        // O snapshot do servidor e tirado AQUI, pelo main; a pagina so escolhe o momento (marca) e
        // o relatorio usa a copia do main, nao o que a pagina devolver em scenario-done.
        const snap = await cur.sfu.stats();
        const mark = params && typeof params.mark === 'string' ? params.mark : '';
        if (SNAPSHOT_MARKS.includes(mark)) cur.snapshots[mark] = snap;
        return { ok: true, result: snap };
      }
      const result = await cur.sfu.request(method, params, { owner: cur.owner });
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: toErrorPayload(err) };
    }
  });

  ipcMain.handle('spike:scenario-done', async (event, payload) => {
    assertTrusted(event);
    const cur = state.current;
    if (!cur || !payload || payload.key !== cur.key) throw new Error('scenario-done sem cenario correspondente');
    const raw = payload.result && typeof payload.result === 'object' ? payload.result : { error: 'resultado ausente', samples: [], steps: [] };
    const closed = await closeCurrent({ checkClient: true });
    const t = raw.timing || {};
    const cpu = Number.isFinite(t.measureStartWall) && Number.isFinite(t.measureEndWall) ? summarizeCpu(state.cpu, t.measureStartWall, t.measureEndWall) : null;
    const server = { start: cur.snapshots.start || null, afterMidClose: cur.snapshots.afterMidClose || null, end: cur.snapshots.end || null };
    const evaluation = evaluateScenario(cur.scenario.config, { ...raw, server }, closed, { expectedClientVersion: versions().mediasoupClient });
    state.results.push({
      key: cur.key,
      id: cur.scenario.id,
      label: cur.scenario.label,
      config: cur.scenario.config,
      ...evaluation,
      electronCpu: cpu, // so processos do Electron (cliente); o worker da SFU esta em `forwarding.workerCpu*`
      cleanup: closed,
      raw: {
        steps: raw.steps, device: raw.device, codec: raw.codec, producer: raw.producer, consumers: raw.consumers,
        candidates: raw.candidates, midClose: raw.midClose, server, clientIce: raw.clientIce, samples: raw.samples,
        cleanupErrors: raw.cleanupErrors, error: raw.error || null, scene: raw.scene || null,
      },
    });
  });

  ipcMain.on('spike:log', (event, text) => {
    if (trust.isTrusted(event)) log('pagina:', String(text).slice(0, 500));
  });

  ipcMain.handle('spike:finish', (event, fatal) => {
    assertTrusted(event);
    setImmediate(() => { void finish({ fatal: fatal ? String(fatal).slice(0, 2000) : null }); });
  });
}

process.on('uncaughtException', (err) => {
  console.error('[sfu-spike] excecao no main:', err?.stack || err);
  void finish({ fatal: `excecao no main: ${err?.message || err}` });
});

app.whenReady().then(async () => {
  installSessionPolicy();
  installIpc();
  state.runtime = collectRuntime();

  win = new BrowserWindow({
    width: 900, height: 600, show: plan.show === true, title: 'GoLive sfu-spike',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  // Confina os sockets UDP do WebRTC do cliente (Chromium liga em 0.0.0.0) a uma faixa propria, verificavel.
  win.webContents.setWebRTCUDPPortRange(CLIENT_PORT_RANGE);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('render-process-gone', (_e, d) => { void finish({ fatal: `renderer da bancada caiu: ${d.reason}` }); });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') log('console.error da pagina:', e.message);
  });

  cpuTimer = setInterval(() => {
    state.cpu.push({ t: Date.now(), ...bucketMetrics(app.getAppMetrics()) });
  }, 1000);
  globalTimer = setTimeout(() => { void finish({ timedOut: true, fatal: 'timeout do conjunto' }); }, plan.timeoutMs);

  await win.loadFile(pageFile);
}).catch((err) => finish({ fatal: `inicializacao falhou: ${err?.message || err}` }));

app.on('window-all-closed', () => {
  if (!state.finished) void finish({ fatal: 'janela da bancada fechou antes do fim' });
});
