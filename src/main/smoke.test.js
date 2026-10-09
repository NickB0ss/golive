'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const smoke = require('./smoke');

const tmp = os.tmpdir();

test('parseSmokeArgs: sem a flag nao habilita; com a flag usa o timeout padrao', () => {
  assert.equal(smoke.parseSmokeArgs(['electron', '.']).enabled, false);
  const a = smoke.parseSmokeArgs(['x', smoke.FLAG]);
  assert.equal(a.enabled, true);
  assert.equal(a.timeoutMs, smoke.DEFAULT_TIMEOUT_MS);
  assert.deepEqual(a.errors, []);
});

test('parseSmokeArgs: timeout, relatorio e perfil sao validados', () => {
  const profile = path.join(tmp, 'golive-smoke-abc');
  const ok = smoke.parseSmokeArgs([
    smoke.FLAG, '--golive-smoke-timeout=20000',
    `--golive-smoke-report=${path.join(tmp, 'r.json')}`, `--golive-smoke-profile=${profile}`,
  ]);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.timeoutMs, 20000);
  assert.equal(ok.profileDir, profile);

  for (const bad of [
    '--golive-smoke-timeout=10', '--golive-smoke-timeout=abc', '--golive-smoke-timeout=999999999',
    '--golive-smoke-report=relativo.json', `--golive-smoke-report=${path.join(tmp, 'r.txt')}`,
    `--golive-smoke-profile=${path.join(tmp, 'outro')}`, `--golive-smoke-profile=${os.homedir()}`, `--golive-smoke-profile=${tmp}`,
  ]) {
    assert.ok(smoke.parseSmokeArgs([smoke.FLAG, bad]).errors.length, bad);
  }
});

test('parseSmokeArgs: nao existe caminho para script/eval arbitrario', () => {
  const src = fs.readFileSync(path.join(__dirname, 'smoke.js'), 'utf8');
  assert.ok(!/--eval|--golive-smoke-script|--golive-smoke-exec/.test(src.replace(/\/\*[\s\S]*?\*\//, '')));
  const r = smoke.parseSmokeArgs([smoke.FLAG, '--eval=process.exit(0)', '--golive-smoke-script=x.js']);
  assert.equal(r.enabled, true);
  assert.deepEqual(Object.keys(r).sort(), ['enabled', 'errors', 'profileDir', 'reportPath', 'timeoutMs']);
});

test('classifyConsole: details (Electron >= 35) e assinatura antiga; warning separado de error', () => {
  assert.equal(smoke.classifyConsole({ level: 'error', message: 'x', sourceId: 'http://localhost/app.js', lineNumber: 7 }).kind, 'error');
  assert.equal(smoke.classifyConsole({ level: 'warning', message: 'x' }).kind, 'warning');
  assert.equal(smoke.classifyConsole({ level: 'info', message: 'x' }).kind, 'info');
  assert.equal(smoke.classifyConsole(3, 'boom').kind, 'error');
  assert.equal(smoke.classifyConsole(2, 'aviso').kind, 'warning');
  assert.equal(smoke.classifyConsole(1, 'oi').kind, 'info');
  const c = smoke.classifyConsole({ level: 'error', message: 'm', sourceId: 'http://localhost/app.js', lineNumber: 7 });
  assert.equal(c.line, 7);
});

test('listScriptSrcs e checkScriptOrder sobre o index.html REAL', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const srcs = smoke.listScriptSrcs(html);
  assert.ok(srcs.length > 50);
  assert.equal(srcs.at(-1), 'app.js');
  assert.deepEqual(smoke.checkScriptOrder(srcs), []);
});

test('checkScriptOrder acusa ordem trocada e script ausente', () => {
  assert.deepEqual(smoke.checkScriptOrder(['a.js', 'b.js'], [['a.js', 'b.js']]), []);
  assert.match(smoke.checkScriptOrder(['b.js', 'a.js'], [['a.js', 'b.js']])[0], /a\.js deve vir antes de b\.js/);
  assert.match(smoke.checkScriptOrder(['a.js'], [['a.js', 'b.js']])[0], /nao carrega b\.js/);
  assert.match(smoke.checkScriptOrder(['b.js'], [['a.js', 'b.js']])[0], /nao carrega a\.js/);
});

test('ORDER_RULES e REQUIRED_MODULES cobrem os modulos novos desta serie', () => {
  const flat = smoke.ORDER_RULES.flat();
  for (const f of ['txstats.js', 'rxstats.js', 'qualitypolicy.js', 'audio-capture.js', '../shared/succession.js']) {
    assert.ok(flat.includes(f), f);
  }
  for (const m of ['txstats', 'qualitypolicy', 'audioCapture', 'succession']) assert.ok(smoke.REQUIRED_MODULES.includes(m), m);
});

function good() {
  return {
    timeoutMs: 1000, timedOut: false, bootReady: true, appVersion: '1.2.3',
    mainErrors: [], preloadErrors: [], loadFailures: [], crashes: [], unresponsive: false,
    console: [], ipcCalls: { 'i18n:get': 1, 'app:version': 1, 'network:address': 1 },
    ipcSemHandler: [], blockedCapture: [], blockedRequests: [], orderProblems: [],
    dom: { scripts: [{ src: 'a.js', status: 200 }], missingModules: [], hasGoliveApi: true, versionLabel: 'v1.2.3' },
    addon: { loaded: true, missingExports: [] },
  };
}

test('evaluate: caso limpo passa; aviso de console e rede nao reprovam', () => {
  const f = good();
  f.console = [{ kind: 'warning', message: 'deprecated' }, { kind: 'info', message: 'ok' }];
  f.blockedRequests = ['https://exemplo.com/x'];
  const r = smoke.evaluate(f);
  assert.equal(r.ok, true, r.failures.join());
  assert.equal(r.warnings.length, 2);
});

test('evaluate: cada tipo de defeito reprova, com mensagem propria', () => {
  const casos = {
    consoleError: [(f) => f.console.push({ kind: 'error', message: 'Uncaught X', source: 'http://localhost/app.js', line: 9 }), /console\.error \(app\.js:9\)/],
    preload: [(f) => f.preloadErrors.push('preload.js: boom'), /erro de preload/],
    carga: [(f) => f.loadFailures.push('pagina x'), /falha de carga/],
    queda: [(f) => f.crashes.push('renderer: crashed'), /queda/],
    travado: [(f) => { f.unresponsive = true; }, /sem responder/],
    semFim: [(f) => { f.bootReady = false; }, /nao sinalizou o fim do boot/],
    timeout: [(f) => { f.timedOut = true; f.bootReady = false; }, /timeout/],
    script404: [(f) => f.dom.scripts.push({ src: 'b.js', status: 404 }), /script nao carregou \(404\): b\.js/],
    scriptSemResposta: [(f) => f.dom.scripts.push({ src: 'c.js', status: null }), /sem resposta/],
    ordem: [(f) => f.orderProblems.push('x antes de y'), /ordem de scripts/],
    modulo: [(f) => f.dom.missingModules.push('txstats'), /GoLive\.txstats ausente/],
    semApi: [(f) => { f.dom.hasGoliveApi = false; }, /window\.golive/],
    versao: [(f) => { f.dom.versionLabel = null; }, /rotulo de versao/],
    ipcNaoChamado: [(f) => { delete f.ipcCalls['app:version']; }, /nao chamou o IPC app:version/],
    ipcSemHandler: [(f) => f.ipcSemHandler.push('room:x'), /IPC sem handler/],
    captura: [(f) => f.blockedCapture.push('getDisplayMedia'), /tentou capturar/],
    addon: [(f) => { f.addon = { loaded: false, error: 'nao achou' }; }, /addon nativo nao carregou: nao achou/],
    addonExport: [(f) => { f.addon.missingExports = ['LoopbackCapture']; }, /sem export LoopbackCapture/],
    main: [(f) => f.mainErrors.push('excecao'), /processo principal/],
  };
  for (const [nome, [mutate, re]] of Object.entries(casos)) {
    const f = good();
    mutate(f);
    const r = smoke.evaluate(f);
    assert.equal(r.ok, false, nome);
    assert.ok(r.failures.some((x) => re.test(x)), `${nome}: ${r.failures.join(' | ')}`);
  }
});

test('evaluate: addon pulado (nao Windows) vira aviso, nao aprovacao silenciosa', () => {
  const f = good();
  f.addon = { skipped: 'plataforma linux' };
  const r = smoke.evaluate(f);
  assert.equal(r.ok, true);
  assert.match(r.warnings.join(), /addon nativo nao verificado/);
});

test('exitCodeFor: 0 passou, 1 falhou, 2 timeout', () => {
  assert.equal(smoke.exitCodeFor({ ok: true }, false), 0);
  assert.equal(smoke.exitCodeFor({ ok: false }, false), 1);
  assert.equal(smoke.exitCodeFor({ ok: false }, true), 2);
});

test('src/main.js: o ramo do smoke vem ANTES do lock e dos efeitos colaterais', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const smokeAt = main.indexOf('smoke.FLAG');
  assert.ok(smokeAt > 0);
  for (const efeito of ['requestSingleInstanceLock', 'commandLine.appendSwitch', 'setupLogger()', 'ipcMain.handle(', 'app.whenReady']) {
    assert.ok(main.indexOf(efeito) > smokeAt, `${efeito} deve vir depois do ramo do smoke`);
  }
});

test('o index.html real tem os ids lidos pelo smoke', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /id="app-version"/);
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  assert.match(app, /dataset\.golivePronto = '1'/);
});

test('parseSmokeArgs: relatorio so em %TEMP% ou sob lab-out (nem arquivo novo em outro lugar)', () => {
  const fora = path.join(path.parse(tmp).root, 'Users', 'alguem', 'AppData', 'config.json');
  const argRel = (f) => `--golive-smoke-report=${f}`;
  const comRelatorio = (f) => smoke.parseSmokeArgs([smoke.FLAG, argRel(f)], tmp);
  // fora do permitido: recusa, mesmo que o arquivo ainda nao exista
  assert.ok(comRelatorio(fora).errors.length);
  // dentro de %TEMP% e sob lab-out: aceita
  assert.deepEqual(comRelatorio(path.join(tmp, 'x', 'r.json')).errors, []);
  const lab = path.join(path.parse(tmp).root, 'repo', 'lab-out', 'smoke', 'r.json');
  assert.deepEqual(comRelatorio(lab).errors, []);
  assert.equal(smoke.reportLocationAllowed(fora, tmp), false);
});

test('unknownBootChannel: so os canais do boot e o send ignorado passam', () => {
  for (const c of smoke.BOOT_IPC) assert.equal(smoke.unknownBootChannel(c), null);
  for (const c of smoke.IGNORED_BOOT_SEND) assert.equal(smoke.unknownBootChannel(c), null);
  assert.equal(smoke.unknownBootChannel('room:join'), 'room:join');
  assert.deepEqual(smoke.IGNORED_BOOT_SEND, ['power:keep-awake']);
});

test('as flags de GPU de producao do smoke continuam no topo de src/main.js', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  for (const name of smoke.PRODUCTION_GPU_SWITCHES) {
    assert.ok(main.includes(`app.commandLine.appendSwitch('${name}')`), name);
  }
});
