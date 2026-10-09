#!/usr/bin/env node
'use strict';

/*
 * Launcher da prova de conceito de SFU (Node puro, nao Electron). Valida os
 * argumentos e os pre-requisitos, grava o plano, abre o Electron com perfil
 * temporario e espera o relatorio. Em timeout ou sinal mata a arvore de
 * processos; no fim sempre apaga o perfil (quem apaga e este launcher).
 *
 *   node tools/sfu-spike/run.js --help
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { parseArgv, buildPlan, HELP_TEXT } = require('./lib/config');
const { PROFILE_PREFIX } = require('./lib/launch');
const { EXIT, reportFileName, exitCodeFor, buildReport } = require('./lib/report');
const { workerReady, workerBinPath } = require('./scripts/prepare');
const { OUT: BUNDLE_PATH } = require('./scripts/bundle');

const ROOT = path.resolve(__dirname, '..', '..');

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try { child.kill('SIGKILL'); } catch { /* ja morreu */ }
  }
}

/** Lista o que falta para rodar; vazio = pronto. Nada disso e contado como cenario passado. */
function missingPrerequisites(io = {}) {
  const exists = io.exists || ((p) => fs.existsSync(p));
  const missing = [];
  if (!exists(path.join(__dirname, 'node_modules', 'mediasoup', 'package.json'))) {
    missing.push('mediasoup nao instalado: em tools/sfu-spike rode `npm ci --ignore-scripts`');
  }
  if (!(io.workerReady || workerReady)()) {
    missing.push(`worker do mediasoup ausente (${workerBinPath()}): rode \`npm run prepare-worker\` em tools/sfu-spike (baixa o binario oficial; precisa de rede)`);
  }
  if (!exists(BUNDLE_PATH)) {
    missing.push('bundle do mediasoup-client ausente: rode `npm run bundle` em tools/sfu-spike');
  }
  return missing;
}

function describeScenarios(plan) {
  return plan.scenarios.map((s) => {
    const c = s.config;
    return `${s.key.padEnd(20)} ${c.width}x${c.height}@${c.fps} consumidores=${c.consumers} codec=${c.codec} ${c.bitrateKbps}kbps `
      + `aquece=${c.warmupMs}ms mede=${c.durationMs}ms listen=${c.listenIp}`;
  }).join('\n');
}

function summaryLines(report) {
  const out = [`status: ${report.status} (${report.completed}/${report.planned} cenarios)`];
  if (report.midCloseCovered === false) out.push('aviso: nenhum cenario exerceu o fechamento de um consumidor no meio (midCloseCovered=false); use --consumers com um valor >= 2');
  const f = (v, d = 1) => (v == null ? '-' : Number(v).toFixed(d));
  for (const s of report.scenarios) {
    const codec = s.codec?.realSender?.mimeType || s.codec?.producerRtpParameters?.mimeType || '-';
    const fps = (s.consumers || []).map((c) => f(c.window?.fps)).join('/');
    out.push(`${s.key.padEnd(20)} ${s.status.padEnd(7)} codec ${codec} consumidores fps [${fps}] cpuWorker ${f(s.forwarding?.workerCpuPercentOfOneCore)}%`);
    for (const c of s.checks) {
      if (c.status !== 'passed') out.push(`    ${c.status}: ${c.id}: ${c.detail}`);
    }
  }
  if (report.fatal) out.push(`fatal: ${report.fatal}`);
  return out;
}

async function main(argv) {
  const parsed = parseArgv(argv);
  if (parsed.options.help) {
    console.log(HELP_TEXT);
    return EXIT.OK;
  }
  const plan = buildPlan(parsed.options);
  const errors = [...parsed.errors, ...plan.errors];
  if (errors.length) {
    console.error(`Uso invalido:\n  - ${errors.join('\n  - ')}\n\nVeja: node tools/sfu-spike/run.js --help`);
    return EXIT.USAGE;
  }
  if (parsed.options.list) {
    console.log(describeScenarios(plan));
    console.log(`\n${plan.scenarios.length} cenario(s); limite do conjunto: ${Math.round(plan.timeoutMs / 1000)} s`);
    return EXIT.OK;
  }

  const missing = missingPrerequisites();
  if (missing.length) {
    console.error(`Pre-requisitos ausentes (nenhum cenario foi executado):\n  - ${missing.join('\n  - ')}`);
    return EXIT.PREREQ;
  }

  let electronPath;
  try {
    electronPath = require('electron'); // em Node devolve o caminho do executavel
  } catch (err) {
    console.error(`Electron nao encontrado (rode npm ci na raiz): ${err.message}`);
    return EXIT.PREREQ;
  }

  const outDir = path.resolve(plan.out || path.join(ROOT, 'lab-out', 'sfu-spike'));
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  const planFile = path.join(profileDir, 'plan.json');
  const reportPath = path.join(outDir, reportFileName(new Date(), plan.label));
  fs.writeFileSync(planFile, JSON.stringify({ scenarios: plan.scenarios, timeoutMs: plan.timeoutMs, label: plan.label, show: plan.show, args: parsed.options }), 'utf8');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // senao o Electron roda como Node e ignora a janela
  const startedAt = new Date().toISOString();
  console.log(`sfu-spike: ${plan.scenarios.length} cenario(s), limite ${Math.round(plan.timeoutMs / 1000)} s`);
  console.log(`relatorio: ${reportPath}`);

  const child = spawn(electronPath, [
    path.join(__dirname, 'main.js'),
    `--spike-config=${planFile}`,
    `--spike-report=${reportPath}`,
    `--spike-profile=${profileDir}`,
  ], { cwd: ROOT, env, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: !plan.show });

  let hardTimedOut = false;
  // Folga sobre o limite interno: o main deve se encerrar sozinho primeiro.
  const hardTimer = setTimeout(() => { hardTimedOut = true; killTree(child); }, plan.timeoutMs + 20000);
  const onSignal = () => { killTree(child); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const exitCode = await new Promise((resolve) => {
    child.once('error', (err) => { console.error(`falha ao abrir o Electron: ${err.message}`); resolve(null); });
    child.once('exit', (code) => resolve(code));
  });
  clearTimeout(hardTimer);
  // Nao ha killTree aqui: com o Electron ja encerrado (exitCode definido) ele nao faria nada. Quem garante que
  // o worker nao sobra e o main (close + verifyClosed por cenario); o launcher so mata a arvore em timeout/sinal.

  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch { /* sem relatorio: o main nao chegou a gravar */ }
  let code;
  if (report) {
    code = exitCodeFor(report);
    if (code === EXIT.OK && exitCode !== 0) {
      console.error(`Electron saiu com ${exitCode} apesar do relatorio ok: tratado como falha`);
      code = EXIT.FAILED;
    }
  } else {
    report = buildReport({
      startedAt, finishedAt: new Date().toISOString(), label: plan.label, args: parsed.options,
      planned: plan.scenarios.length, scenarios: [], timedOut: hardTimedOut,
      fatal: hardTimedOut ? 'timeout do launcher (Electron morto)' : `Electron saiu sem relatorio (codigo ${exitCode})`,
    });
    try {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    } catch (err) {
      console.error(`nao gravou o relatorio de falha: ${err.message}`);
    }
    code = exitCodeFor(report);
  }

  try {
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (err) {
    console.error(`aviso: perfil temporario nao removido (${profileDir}): ${err.message}`);
  }
  console.log(summaryLines(report).join('\n'));
  return code;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((err) => {
    console.error(err?.stack || err);
    process.exitCode = EXIT.FAILED;
  });
}

module.exports = { main, missingPrerequisites, describeScenarios, summaryLines };
