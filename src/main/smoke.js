'use strict';

/*
 * Smoke de abertura (`--golive-smoke-test`): abre o Electron com a pagina REAL
 * (index.html + app.js + src/preload.js) numa janela escondida e perfil
 * temporario, espera o FIM do boot do renderer e sai com 0 (passou), 1 (falhou)
 * ou 2 (timeout). Roda ANTES do lock de instancia unica e de qualquer efeito de
 * src/main.js, entao pode rodar com o GoLive aberto sem tocar nele.
 *
 * O QUE VALIDA
 *   - o runtime sobe (Electron + Chromium) e a janela carrega a pagina real
 *     pela origem local de producao (http://localhost, src/main/origem.js);
 *   - todo <script> do index.html carrega (HTTP 200), na ordem, sem excecao;
 *   - o preload real roda sem erro e expoe `window.golive`;
 *   - app.js executa ate o fim (marcador `data-golive-pronto`, ver o fim de
 *     app.js) e a versao do app respondeu pelo IPC;
 *   - nenhum console.error, erro de script, falha de carga, queda ou travamento
 *     do renderer; avisos (console.warn) so aparecem separados;
 *   - o addon nativo carrega (`golive_audio.node`) SEM criar captura;
 *   - camera, microfone, tela e qualquer permissao pedidas no boot sao
 *     RECUSADAS e contam como falha (o boot nao deve capturar nada).
 *
 * O QUE NAO VALIDA
 *   - rede (sinalizacao, descoberta UDP, firewall), atualizador, tela de
 *     carregamento da abertura, atalhos globais, powerSaveBlocker, overlay,
 *     migracao de localStorage: nada disso e carregado aqui;
 *   - captura real, encoder, audio nativo em uso, sala com outras pessoas;
 *   - handlers de IPC alem dos tres do boot (i18n:get, app:version,
 *     network:address, esse ultimo respondendo "sem rede"). Detecta: todo
 *     `send`/`sendSync` (eventos `ipc-message`/`ipc-message-sync`) fora de
 *     BOOT_IPC e de IGNORED_BOOT_SEND (`power:keep-awake`, efeito colateral
 *     sem resposta) e todo `invoke` sem handler cuja rejeicao chega ao
 *     console; ambos viram `ipcSemHandler` e reprovam. Um `invoke` novo com
 *     `.catch` proprio na pagina NAO e visto (o Electron nao emite evento
 *     publico para `invoke`).
 *
 * Seguro por construcao: so aceita a flag, um timeout numerico e dois caminhos
 * opcionais (relatorio .json e perfil temporario). NAO existe --eval nem
 * carregamento de script externo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const FLAG = '--golive-smoke-test';
const PROFILE_PREFIX = 'golive-smoke-';
const DEFAULT_TIMEOUT_MS = 45000;
const TIMEOUT_RANGE = [5000, 300000];
const EXIT = { OK: 0, FAILED: 1, TIMEOUT: 2 };

/** IPC que o boot da pagina real usa; o smoke responde so a estes. */
const BOOT_IPC = ['i18n:get', 'app:version', 'network:address'];

/** `send` do boot que o smoke deliberadamente ignora (sem resposta, sem efeito aqui). */
const IGNORED_BOOT_SEND = ['power:keep-awake'];

/**
 * Switches que a producao liga no topo de src/main.js e que mudam como a GPU
 * abre (smoke.test.js confere que continuam la). Os `disable-*-throttling`
 * ficam a parte, logo abaixo, e tambem sao os de producao.
 */
const PRODUCTION_GPU_SWITCHES = ['force_high_performance_gpu', 'ignore-gpu-blocklist'];

/** Canal de `send`/`sendSync` do boot que o smoke nao conhece (ou null). */
function unknownBootChannel(channel) {
  const c = String(channel);
  return BOOT_IPC.includes(c) || IGNORED_BOOT_SEND.includes(c) ? null : c;
}

/** Modulos `window.GoLive.*` que precisam existir depois do boot. */
const REQUIRED_MODULES = [
  'config', 'qualitypolicy', 'txstats', 'rxstats', 'screenrelay', 'mesh', 'tree', 'succession',
  'encodediag', 'audioCapture', 'i18n',
];

/** Pares [antes, depois]: o primeiro <script> tem de vir antes do segundo. */
const ORDER_RULES = [
  ['i18n/pt-BR.js', 'i18n/index.js'],
  ['i18n/index.js', 'config.js'],
  ['txstats.js', 'rxstats.js'],
  ['qualitypolicy.js', 'app.js'],
  ['audio-capture.js', 'app.js'],
  ['screenrelay.js', 'app.js'],
  ['mesh.js', 'app.js'],
  ['../shared/succession.js', 'migration.js'],
];

/** Addon: funcoes/classe que o main exige (ver ipcMain.handle('audio:*')). */
const ADDON_EXPORTS = ['findDiscordRootPid', 'pidForWindowHandle', 'listProcessNames', 'listAudioRenderPids', 'LoopbackCapture'];

// Mensagens de diagnostico para QUEM RODA o smoke (log/relatorio em pt-BR, spec
// 2.4 de i18n): nao sao texto de tela do app, entao ficam num bloco de dados
// que a catraca de texto solto (tools/i18n/literais.js) nao varre.
// i18n: dados
const MSG = {
  timeoutFaixa: (min, max) => `--golive-smoke-timeout deve ficar entre ${min} e ${max} ms`,
  relatorioAbsoluto: '--golive-smoke-report deve ser um caminho absoluto terminado em .json',
  relatorioLocal: '--golive-smoke-report so pode apontar para a pasta temporaria ou uma pasta lab-out',
  perfilObrigatorio: 'rode pelo launcher (npm run smoke:app) ou passe --golive-smoke-profile=<pasta temporaria golive-smoke-*>: sem isso o perfil temporario sobraria em %TEMP%',
  perfilTemp: (prefixo) => `--golive-smoke-profile deve ficar na pasta temporaria e se chamar ${prefixo}*`,
  naoCarrega: (f) => `index.html nao carrega ${f}`,
  ordem: (a, b) => `${a} deve vir antes de ${b}`,
  timeout: (ms) => `timeout: o boot do renderer nao terminou em ${ms} ms`,
  semFimDoBoot: 'o renderer nao sinalizou o fim do boot (data-golive-pronto)',
  erroMain: (e) => `erro no processo principal: ${e}`,
  erroPreload: (e) => `erro de preload: ${e}`,
  falhaCarga: (e) => `falha de carga: ${e}`,
  queda: (e) => `queda: ${e}`,
  semResposta: 'o renderer ficou sem responder',
  scriptNaoCarregou: (status, src) => `script nao carregou (${status ?? 'sem resposta'}): ${src}`,
  ordemScripts: (e) => `ordem de scripts: ${e}`,
  moduloAusente: (m) => `modulo window.GoLive.${m} ausente depois do boot`,
  semApi: 'window.golive (preload) nao foi exposto',
  versao: (esperada, achada) => `rotulo de versao do app esperado v${esperada}, encontrado ${JSON.stringify(achada)}`,
  ipcNaoChamado: (c) => `o boot nao chamou o IPC ${c}`,
  ipcSemHandler: (c) => `IPC sem handler no smoke (${c}): o boot passou a depender de mais um servico`,
  tentouCapturar: (c) => `o boot tentou capturar/pedir permissao: ${c}`,
  redeBloqueada: (u) => `requisicao de rede bloqueada: ${u}`,
  addonPulado: (m) => `addon nativo nao verificado: ${m}`,
  addonFalhou: (e) => `addon nativo nao carregou: ${e}`,
  addonSemExport: (m) => `addon nativo sem export ${m}`,
  addonSoWindows: (plataforma) => `plataforma ${plataforma}: o addon so existe no Windows`,
  escopo: 'valida runtime + pagina real + preload + addon; NAO valida rede, updater, captura nem sala',
  naoGravou: (e) => `nao gravou o relatorio: ${e}`,
  excecao: (e) => `excecao nao tratada: ${e}`,
  naoLeuPagina: (e) => `nao leu o estado da pagina: ${e}`,
  resumo: (veredito, falhas, avisos) => `${veredito}: ${falhas} falha(s), ${avisos} aviso(s)`,
};
// Sonda executada NA pagina depois do boot: le o estado, nao altera nada.
const sondaDaPagina = (srcs, modulos) => `(() => {
  const entries = performance.getEntriesByType('resource');
  const status = (src) => {
    const abs = new URL(src, location.href).href;
    const e = entries.find((x) => x.name === abs);
    return e ? e.responseStatus : null;
  };
  return {
    scripts: ${JSON.stringify(srcs)}.map((src) => ({ src, status: status(src) })),
    missingModules: ${JSON.stringify(modulos)}.filter((m) => !(window.GoLive && window.GoLive[m])),
    hasGoliveApi: typeof window.golive === 'object' && window.golive !== null,
    versionLabel: (document.getElementById('app-version') || {}).textContent || null,
    title: document.title,
    lang: document.documentElement.lang,
  };
})()`;
// i18n: fim dos dados

// --- partes puras (testadas em smoke.test.js) -----------------------------

/** True se `file` fica dentro de `dir` (comparacao por caminho resolvido). */
function isInside(dir, file) {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Relatorio so em %TEMP% ou sob uma pasta `lab-out` (os dois destinos que o launcher usa). */
function reportLocationAllowed(file, tmpdir) {
  if (isInside(tmpdir, file)) return true;
  return path.resolve(file).split(path.sep).some((seg) => seg.toLowerCase() === 'lab-out');
}

function parseSmokeArgs(argv, tmpdir = os.tmpdir()) {
  const list = Array.isArray(argv) ? argv : [];
  const errors = [];
  const out = { enabled: list.includes(FLAG), timeoutMs: DEFAULT_TIMEOUT_MS, reportPath: null, profileDir: null, errors };
  const val = (name) => {
    const p = `--${name}=`;
    const hit = list.find((a) => typeof a === 'string' && a.startsWith(p));
    return hit === undefined ? null : hit.slice(p.length);
  };
  const t = val('golive-smoke-timeout');
  if (t !== null) {
    const n = /^\d+$/.test(t) ? Number(t) : NaN;
    if (!(n >= TIMEOUT_RANGE[0] && n <= TIMEOUT_RANGE[1])) {
      errors.push(MSG.timeoutFaixa(TIMEOUT_RANGE[0], TIMEOUT_RANGE[1]));
    } else out.timeoutMs = n;
  }
  const report = val('golive-smoke-report');
  if (report !== null) {
    if (!path.isAbsolute(report) || !report.toLowerCase().endsWith('.json')) {
      errors.push(MSG.relatorioAbsoluto);
    } else if (!reportLocationAllowed(report, tmpdir)) {
      errors.push(MSG.relatorioLocal);
    } else out.reportPath = report;
  }
  const profile = val('golive-smoke-profile');
  if (profile !== null) {
    if (!path.isAbsolute(profile) || !isInside(tmpdir, profile) || !path.basename(profile).startsWith(PROFILE_PREFIX)) {
      errors.push(MSG.perfilTemp(PROFILE_PREFIX));
    } else out.profileDir = profile;
  }
  return out;
}

/** Aceita as duas assinaturas de `console-message` (Electron >= 35 usa details). */
function classifyConsole(levelOuDetails, mensagemAntiga) {
  const details = levelOuDetails && typeof levelOuDetails === 'object' ? levelOuDetails : null;
  const level = details ? details.level : levelOuDetails;
  const message = String(details ? details.message : mensagemAntiga ?? '');
  let kind;
  if (typeof level === 'number') kind = level >= 3 ? 'error' : level === 2 ? 'warning' : 'info';
  else kind = level === 'error' ? 'error' : level === 'warning' || level === 'warn' ? 'warning' : 'info';
  return { kind, message, source: details?.sourceId || null, line: details?.lineNumber ?? null };
}

function listScriptSrcs(html) {
  return [...String(html).matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
}

/** Violacoes das regras de ordem sobre a lista de <script src>. */
function checkScriptOrder(srcs, rules = ORDER_RULES) {
  const problems = [];
  for (const [first, second] of rules) {
    const a = srcs.indexOf(first);
    const b = srcs.indexOf(second);
    if (a === -1) problems.push(MSG.naoCarrega(first));
    else if (b === -1) problems.push(MSG.naoCarrega(second));
    else if (a > b) problems.push(MSG.ordem(first, second));
  }
  return problems;
}

/**
 * Decide o resultado a partir dos fatos coletados. `failures` reprovam;
 * `warnings` so aparecem no relatorio.
 */
function evaluate(f) {
  const failures = [];
  const warnings = [];
  const add = (list, text) => { if (!list.includes(text)) list.push(text); };

  if (f.timedOut) add(failures, MSG.timeout(f.timeoutMs));
  else if (!f.bootReady) add(failures, MSG.semFimDoBoot);

  for (const e of f.mainErrors || []) add(failures, MSG.erroMain(e));
  for (const e of f.preloadErrors || []) add(failures, MSG.erroPreload(e));
  for (const e of f.loadFailures || []) add(failures, MSG.falhaCarga(e));
  for (const e of f.crashes || []) add(failures, MSG.queda(e));
  if (f.unresponsive) add(failures, MSG.semResposta);

  for (const c of f.console || []) {
    const where = c.source ? ` (${path.basename(String(c.source))}:${c.line ?? '?'})` : '';
    if (c.kind === 'error') add(failures, `console.error${where}: ${c.message}`);
    else if (c.kind === 'warning') add(warnings, `console.warn${where}: ${c.message}`);
  }

  for (const s of f.dom?.scripts || []) {
    if (s.status !== 200) add(failures, MSG.scriptNaoCarregou(s.status, s.src));
  }
  for (const p of f.orderProblems || []) add(failures, MSG.ordemScripts(p));
  for (const m of f.dom?.missingModules || []) add(failures, MSG.moduloAusente(m));
  if (f.dom && f.dom.hasGoliveApi === false) add(failures, MSG.semApi);
  if (f.dom && f.appVersion && f.dom.versionLabel !== `v${f.appVersion}`) {
    add(failures, MSG.versao(f.appVersion, f.dom.versionLabel));
  }

  for (const channel of BOOT_IPC) {
    if (!(f.ipcCalls?.[channel] > 0)) add(failures, MSG.ipcNaoChamado(channel));
  }
  for (const c of f.ipcSemHandler || []) add(failures, MSG.ipcSemHandler(c));
  for (const c of f.blockedCapture || []) add(failures, MSG.tentouCapturar(c));
  for (const u of f.blockedRequests || []) add(warnings, MSG.redeBloqueada(u));

  if (f.addon) {
    if (f.addon.skipped) add(warnings, MSG.addonPulado(f.addon.skipped));
    else if (!f.addon.loaded) add(failures, MSG.addonFalhou(f.addon.error));
    else for (const m of f.addon.missingExports || []) add(failures, MSG.addonSemExport(m));
  }

  return { ok: failures.length === 0, failures, warnings };
}

function exitCodeFor(result, timedOut) {
  if (timedOut) return EXIT.TIMEOUT;
  return result.ok ? EXIT.OK : EXIT.FAILED;
}

// --- execucao (precisa do Electron) ----------------------------------------

/**
 * @param {object} deps { electron, argv, rootDir }  rootDir = pasta `src`
 */
function run({ electron, argv, rootDir }) {
  const { app, BrowserWindow, ipcMain, session, net } = electron;
  const opts = parseSmokeArgs(argv);
  const say = (msg) => console.log(`[golive-smoke] ${msg}`);

  // Sem perfil entregue pelo launcher o smoke nem abre: quem apagaria a pasta
  // seria ele mesmo, e app.exit() nao deixa a limpeza rodar (medido: sobrava
  // golive-smoke-* em %TEMP% em toda execucao direta).
  if (!opts.profileDir) {
    for (const e of opts.errors) say(`FALHA ${e}`);
    say(`FALHA ${MSG.perfilObrigatorio}`);
    app.exit(EXIT.FAILED);
    return;
  }
  const profileDir = opts.profileDir;
  // Perfil descartavel ANTES do ready: nada do perfil pessoal e lido ou escrito.
  app.setPath('userData', profileDir);
  app.setPath('sessionData', path.join(profileDir, 'session'));

  const facts = {
    timeoutMs: opts.timeoutMs, timedOut: false, bootReady: false, appVersion: null,
    mainErrors: [], preloadErrors: [], loadFailures: [], crashes: [], unresponsive: false,
    console: [], ipcCalls: {}, ipcSemHandler: [], blockedCapture: [], blockedRequests: [],
    orderProblems: [], dom: null, addon: null,
  };
  for (const e of opts.errors) facts.mainErrors.push(e);

  // Mesmas flags de producao que importam pro boot: features do Chromium, as
  // duas de GPU do topo de src/main.js e as duas que evitam estrangular a
  // janela escondida.
  const { aplicarFlagsChromium } = require('./chromiumflags');
  const flags = aplicarFlagsChromium(app.commandLine, { error: (...a) => facts.mainErrors.push(a.join(' ')) });
  for (const name of PRODUCTION_GPU_SWITCHES) app.commandLine.appendSwitch(name);
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');

  let win = null;
  let finished = false;
  let timer = null;
  const startedAt = new Date().toISOString();

  function loadAddon() {
    if (process.platform !== 'win32') return { skipped: MSG.addonSoWindows(process.platform) };
    const file = path.join(rootDir, '..', 'build', 'Release', 'golive_audio.node');
    try {
      // Mesmo caminho do main.js; so require: NENHUMA captura e criada.
      const addon = require(file);
      const have = Object.keys(addon);
      return { loaded: true, exports: have, missingExports: ADDON_EXPORTS.filter((n) => !have.includes(n)) };
    } catch (err) {
      return { loaded: false, error: String(err?.message || err) };
    }
  }

  function writeReport(result, code) {
    const report = {
      schema: 'golive-smoke/1', startedAt, finishedAt: new Date().toISOString(), exitCode: code,
      ...result, timedOut: facts.timedOut, timeoutMs: facts.timeoutMs,
      runtime: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
        platform: process.platform, arch: process.arch, packaged: app.isPackaged, appVersion: facts.appVersion },
      chromiumFlagsValid: flags.valido,
      ipcCalls: facts.ipcCalls, dom: facts.dom, addon: facts.addon, orderProblems: facts.orderProblems,
      consoleCount: facts.console.length,
      scope: MSG.escopo,
    };
    if (opts.reportPath) {
      try {
        fs.mkdirSync(path.dirname(opts.reportPath), { recursive: true });
        fs.writeFileSync(opts.reportPath, JSON.stringify(report, null, 2), 'utf8');
      } catch (err) {
        say(MSG.naoGravou(err.message));
      }
    }
    return report;
  }

  function finish(timedOut) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    facts.timedOut = timedOut;
    const result = evaluate(facts);
    const code = exitCodeFor(result, timedOut);
    writeReport(result, code);
    say(MSG.resumo(result.ok ? 'PASSOU' : timedOut ? 'TIMEOUT' : 'FALHOU', result.failures.length, result.warnings.length));
    for (const f of result.failures) say(`  FALHA ${f}`);
    for (const w of result.warnings) say(`  aviso ${w}`);
    try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* ja destruida */ }
    // O launcher (scripts/smoke-app.js) cria e apaga a pasta do perfil.
    app.exit(code);
  }

  process.on('uncaughtException', (err) => {
    facts.mainErrors.push(MSG.excecao(err?.message || err));
    finish(false);
  });
  app.on('child-process-gone', (_e, d) => {
    if (d.reason !== 'clean-exit') facts.crashes.push(`processo ${d.type}: ${d.reason}`);
  });

  // IPC minimo do boot. Responder so ao que a pagina real pergunta ao abrir.
  const idiomaApp = require('./idioma');
  const countIpc = (channel) => { facts.ipcCalls[channel] = (facts.ipcCalls[channel] || 0) + 1; };
  ipcMain.on('i18n:get', (event) => {
    countIpc('i18n:get');
    const ativo = idiomaApp.resolverIdioma('auto', app.getPreferredSystemLanguages());
    event.returnValue = { preferencia: 'auto', ativo };
  });
  ipcMain.handle('app:version', () => { countIpc('app:version'); return app.getVersion(); });
  ipcMain.handle('network:address', () => { countIpc('network:address'); return null; });

  app.whenReady().then(async () => {
    facts.appVersion = app.getVersion();
    const ses = session.defaultSession;

    // Bloqueios: nada de captura, permissao ou rede externa no boot.
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      facts.blockedCapture.push(`permissao ${permission}`);
      callback(false);
    });
    ses.setPermissionCheckHandler(() => false);
    const { replyOnce } = require('./displaymedia');
    ses.setDisplayMediaRequestHandler((_request, callback) => {
      facts.blockedCapture.push('getDisplayMedia');
      replyOnce(callback, say)(null);
    }, { useSystemPicker: false });
    ses.webRequest.onBeforeRequest((details, callback) => {
      const ok = /^(http:\/\/localhost\/|devtools:|data:|blob:|file:|chrome-extension:)/i.test(details.url);
      if (!ok) facts.blockedRequests.push(details.url.slice(0, 200));
      callback({ cancel: !ok });
    });

    // Mesma origem de producao: a pagina real sai de http://localhost, servida
    // pelo proprio processo (sem socket).
    const origem = require('./origem');
    origem.instalarOrigemLocal({ protocol: ses.protocol, net, raiz: rootDirRenderer(), logger: { log() {}, error: (...a) => facts.mainErrors.push(a.join(' ')) } });

    facts.addon = loadAddon();

    win = new BrowserWindow({
      width: 1280, height: 800, show: false,
      webPreferences: { preload: path.join(rootDir, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e, url) => { if (!url.startsWith('http://localhost/')) e.preventDefault(); });
    wc.on('console-message', (...args) => facts.console.push(classifyConsole(args[1] ?? args[0], args[2])));
    wc.on('preload-error', (_e, preloadPath, error) => {
      facts.preloadErrors.push(`${path.basename(preloadPath)}: ${error?.message || error}`);
      finish(false); // sem preload o boot nao chega ao marcador: nao espera o prazo
    });
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (code !== -3) facts.loadFailures.push(`${isMainFrame ? 'pagina' : 'subframe'} ${url}: ${desc} (${code})`);
    });
    wc.on('render-process-gone', (_e, d) => {
      facts.crashes.push(`renderer: ${d.reason} (codigo ${d.exitCode})`);
      finish(false); // renderer morto: nao ha o que esperar nem sondar
    });
    wc.on('unresponsive', () => { facts.unresponsive = true; });

    // send/sendSync fora da lista conhecida (todos passam por estes eventos).
    const onSend = (_e, channel) => {
      const c = unknownBootChannel(channel);
      if (c) facts.ipcSemHandler.push(c);
    };
    wc.on('ipc-message', onSend);
    wc.on('ipc-message-sync', onSend);

    // invoke sem handler nasce como rejeicao dentro da pagina e cai no console
    // como erro; o nome do canal sai dessa mensagem.
    wc.on('console-message', (...args) => {
      const c = classifyConsole(args[1] ?? args[0], args[2]);
      const m = /No handler registered for '([^']+)'/.exec(c.message);
      if (m) facts.ipcSemHandler.push(m[1]);
    });

    timer = setTimeout(() => finish(true), opts.timeoutMs);
    try {
      await wc.loadURL('http://localhost/index.html');
    } catch (err) {
      facts.loadFailures.push(`loadURL: ${err?.message || err}`);
      finish(false);
      return;
    }
    await waitBoot(wc);
    if (finished) return;
    await collectDom(wc);
    finish(false);
  }).catch((err) => {
    facts.mainErrors.push(`inicializacao: ${err?.message || err}`);
    finish(false);
  });

  function rootDirRenderer() { return path.join(rootDir, 'renderer'); }

  async function waitBoot(wc) {
    const until = Date.now() + opts.timeoutMs;
    while (!finished && Date.now() < until) {
      try {
        if (await wc.executeJavaScript("document.documentElement.dataset.golivePronto === '1'")) {
          facts.bootReady = true;
          return;
        }
      } catch { /* pagina ainda navegando */ }
      if (facts.crashes.length || facts.preloadErrors.length) return;
      await new Promise((r) => { setTimeout(r, 100); });
    }
  }

  async function collectDom(wc) {
    try {
      const html = fs.readFileSync(path.join(rootDirRenderer(), 'index.html'), 'utf8');
      const srcs = listScriptSrcs(html);
      facts.orderProblems = checkScriptOrder(srcs);
      const required = REQUIRED_MODULES;
      facts.dom = await wc.executeJavaScript(sondaDaPagina(srcs, required));
    } catch (err) {
      facts.mainErrors.push(MSG.naoLeuPagina(err?.message || err));
    }
  }
}

module.exports = {
  FLAG, EXIT, BOOT_IPC, IGNORED_BOOT_SEND, PRODUCTION_GPU_SWITCHES, unknownBootChannel, reportLocationAllowed,
  REQUIRED_MODULES, ORDER_RULES, ADDON_EXPORTS, DEFAULT_TIMEOUT_MS,
  parseSmokeArgs, classifyConsole, listScriptSrcs, checkScriptOrder, evaluate, exitCodeFor, run,
};
