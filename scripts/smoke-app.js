#!/usr/bin/env node
'use strict';

/*
 * Launcher do smoke de abertura. Abre o GoLive com `--golive-smoke-test`:
 *   - sem --exe: o Electron local deste repositorio (`electron .`);
 *   - com --exe: um executavel empacotado, p.ex. dist/win-unpacked/"GoLive LAN.exe".
 * O app roda com perfil temporario e janela escondida, grava um relatorio JSON
 * e sai. Aqui o exit code e a leitura do relatorio sao conferidos de forma
 * independente: relatorio ausente, ilegivel ou incoerente com o codigo de saida
 * e FALHA, nunca "passou".
 *
 * Codigos: 0 passou, 1 falhou, 2 timeout, 3 uso invalido.
 * Ver src/main/smoke.js para o que o smoke valida (e o que nao valida).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXIT = { OK: 0, FAILED: 1, TIMEOUT: 2, USAGE: 3 };
const DEFAULT_TIMEOUT_MS = 45000;
const PROFILE_PREFIX = 'golive-smoke-';

const HELP = `Uso: node scripts/smoke-app.js [--exe=CAMINHO] [--timeout-ms=N] [--report=ARQUIVO.json]

  --exe=CAMINHO       executavel empacotado (p.ex. "dist/win-unpacked/GoLive LAN.exe");
                      sem isto usa o Electron local (electron .)
  --timeout-ms=N      limite do boot do renderer (5000..300000, padrao ${DEFAULT_TIMEOUT_MS})
  --report=ARQUIVO    onde gravar o relatorio, dentro de %TEMP% ou de uma pasta lab-out (padrao lab-out/smoke/)
  --help

Codigos de saida: 0 passou, 1 falhou, 2 timeout, 3 uso invalido.
Valida: runtime + pagina real + preload + addon + fim do boot do renderer.
NAO valida: rede, atualizador, captura, sala (veja src/main/smoke.js).`;

function parseArgs(argv) {
  const out = { help: false, exe: null, timeoutMs: DEFAULT_TIMEOUT_MS, report: null, errors: [] };
  for (const raw of argv) {
    const eq = raw.indexOf('=');
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const value = eq === -1 ? null : raw.slice(eq + 1);
    if (flag === '--help') out.help = true;
    else if (flag === '--exe' && value) out.exe = path.resolve(value);
    else if (flag === '--report' && value) {
      if (!value.toLowerCase().endsWith('.json')) out.errors.push('--report deve terminar em .json');
      else out.report = path.resolve(value);
    } else if (flag === '--timeout-ms' && value) {
      const n = /^\d+$/.test(value) ? Number(value) : NaN;
      if (!(n >= 5000 && n <= 300000)) out.errors.push('--timeout-ms deve ficar entre 5000 e 300000');
      else out.timeoutMs = n;
    } else out.errors.push(`argumento invalido: ${raw}`);
  }
  return out;
}

/**
 * Junta o que foi observado e decide o codigo. Pura.
 * @param {{report: object|null, exitCode: number|null, hardTimedOut: boolean}} o
 */
function interpretOutcome({ report, exitCode, hardTimedOut }) {
  if (hardTimedOut) return { code: EXIT.TIMEOUT, why: 'o app nao encerrou no prazo e foi finalizado' };
  if (!report || typeof report !== 'object') {
    return { code: EXIT.FAILED, why: `sem relatorio legivel (codigo de saida ${exitCode})` };
  }
  if (report.timedOut) return { code: EXIT.TIMEOUT, why: 'timeout do boot do renderer' };
  if (report.ok === true) {
    if (exitCode !== 0) return { code: EXIT.FAILED, why: `relatorio ok, mas o app saiu com ${exitCode}` };
    return { code: EXIT.OK, why: 'passou' };
  }
  return { code: EXIT.FAILED, why: 'o relatorio lista falhas' };
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else { try { child.kill('SIGKILL'); } catch { /* ja morreu */ } }
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(HELP); return EXIT.OK; }
  if (args.errors.length) {
    console.error(`Uso invalido:\n  - ${args.errors.join('\n  - ')}\n\n${HELP}`);
    return EXIT.USAGE;
  }

  let command;
  let commandArgs;
  let cwd;
  if (args.exe) {
    if (!fs.existsSync(args.exe)) {
      console.error(`executavel nao encontrado: ${args.exe}`);
      return EXIT.USAGE;
    }
    command = args.exe;
    commandArgs = [];
    cwd = path.dirname(args.exe);
  } else {
    try {
      command = require('electron'); // em Node devolve o caminho do executavel
    } catch (err) {
      console.error(`Electron nao encontrado (rode npm ci): ${err.message}`);
      return EXIT.FAILED;
    }
    commandArgs = [ROOT];
    cwd = ROOT;
  }

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = args.report || path.join(ROOT, 'lab-out', 'smoke', `smoke-${stamp}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  try { fs.rmSync(reportPath, { force: true }); } catch { /* sera sobrescrito */ }

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // senao o Electron roda como Node e ignora a janela
  const child = spawn(command, [
    ...commandArgs,
    '--golive-smoke-test',
    `--golive-smoke-timeout=${args.timeoutMs}`,
    `--golive-smoke-report=${reportPath}`,
    `--golive-smoke-profile=${profileDir}`,
  ], { cwd, env, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });

  let hardTimedOut = false;
  const hard = setTimeout(() => { hardTimedOut = true; killTree(child); }, args.timeoutMs + 20000);
  const onSignal = () => killTree(child);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const exitCode = await new Promise((resolve) => {
    child.once('error', (err) => { console.error(`falha ao abrir o app: ${err.message}`); resolve(null); });
    child.once('exit', (code) => resolve(code));
  });
  clearTimeout(hard);
  killTree(child); // nao deixa filho orfao do Chromium

  let report = null;
  try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch { /* sem relatorio */ }
  const outcome = interpretOutcome({ report, exitCode, hardTimedOut });

  try { fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (err) {
    console.error(`aviso: perfil temporario nao removido (${profileDir}): ${err.message}`);
  }
  console.log(`smoke-app: ${outcome.why} (codigo ${outcome.code})`);
  console.log(`relatorio: ${reportPath}`);
  return outcome.code;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((err) => {
    console.error(err?.stack || err);
    process.exitCode = EXIT.FAILED;
  });
}

module.exports = { parseArgs, interpretOutcome, EXIT };
