#!/usr/bin/env node
'use strict';

/*
 * Launcher da bancada (Node puro, nao Electron). Valida os argumentos, grava
 * o plano, abre o Electron com perfil temporario e espera o relatorio. Em
 * timeout ou sinal, mata a arvore de processos; no fim sempre apaga o perfil.
 *
 *   node tools/media-bench/run.js --help
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { parseArgv, buildPlan, HELP_TEXT } = require('./lib/config');
const { PROFILE_PREFIX } = require('./lib/launch');
const { EXIT, reportFileName, exitCodeFor, buildReport } = require('./lib/report');

const ROOT = path.resolve(__dirname, '..', '..');

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try { child.kill('SIGKILL'); } catch { /* ja morreu */ }
  }
}

function describeScenarios(plan) {
  return plan.scenarios.map((s) => {
    const c = s.config;
    return `${s.key.padEnd(24)} ${c.source} ${c.pipeline}/${c.hint || 'nohint'}/${c.topology} `
      + `${c.width}x${c.height}@${c.fps} viewers=${c.viewers} ${c.codec} ${c.bitrateKbps}kbps `
      + `aquece=${c.warmupMs}ms mede=${c.durationMs}ms`;
  }).join('\n');
}

function summaryLines(report) {
  const out = [`status: ${report.status}`];
  for (const s of report.scenarios) {
    const r = s.roles || {};
    const send = r['relay-sender'] || r['origin-sender'];
    const view = r['viewer-receiver'];
    const f = (v, d = 1) => (v == null ? '-' : v.toFixed(d));
    out.push(`${s.key.padEnd(24)} ${s.status.padEnd(5)} `
      + `enc ${f(send?.fpsMedian)} fps ${f(send?.msPerFrameMedian)} ms [${(send?.encoders || []).join(',') || '-'}] `
      + `view ${f(view?.fpsMedian)} fps cpu ${f(s.cpu?.totalMean)}${s.error ? ` ERRO: ${s.error}` : ''}`);
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
    console.error(`Uso invalido:\n  - ${errors.join('\n  - ')}\n\nVeja: node tools/media-bench/run.js --help`);
    return EXIT.USAGE;
  }
  if (parsed.options.list) {
    console.log(describeScenarios(plan));
    console.log(`\n${plan.scenarios.length} cenario(s); limite do conjunto: ${Math.round(plan.timeoutMs / 1000)} s`);
    return EXIT.OK;
  }

  let electronPath;
  try {
    electronPath = require('electron'); // em Node devolve o caminho do executavel
  } catch (err) {
    console.error(`Electron nao encontrado (rode npm ci): ${err.message}`);
    return EXIT.FAILED;
  }

  const outDir = path.resolve(plan.out || path.join(ROOT, 'lab-out', 'media-bench'));
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  const planFile = path.join(profileDir, 'plan.json');
  const reportPath = path.join(outDir, reportFileName(new Date(), plan.label));
  const wrote = { scenarios: plan.scenarios, timeoutMs: plan.timeoutMs, label: plan.label, show: plan.show, args: parsed.options };
  fs.writeFileSync(planFile, JSON.stringify(wrote), 'utf8');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // senao o Electron roda como Node e ignora a janela
  const startedAt = new Date().toISOString();
  console.log(`media-bench: ${plan.scenarios.length} cenario(s), limite ${Math.round(plan.timeoutMs / 1000)} s`);
  console.log(`relatorio: ${reportPath}`);

  const child = spawn(electronPath, [
    path.join(__dirname, 'main.js'),
    `--bench-config=${planFile}`,
    `--bench-report=${reportPath}`,
    `--bench-profile=${profileDir}`,
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
  killTree(child); // garante que filhos orfaos do Chromium nao sobrem

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
    // Cria um relatorio minimo pra falha nunca ficar sem rastro.
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

module.exports = { main, summaryLines, describeScenarios };
