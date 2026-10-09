#!/usr/bin/env node
'use strict';

/*
 * Prepara o worker do mediasoup (binario pre-compilado) sem depender do
 * postinstall automatico do npm: a instalacao recomendada usa
 * `npm ci --ignore-scripts`, entao o download e um passo EXPLICITO daqui.
 *
 * Usa o script oficial do proprio pacote (`npm-scripts.mjs postinstall`) com
 * cwd em node_modules/mediasoup, porque os caminhos dele sao relativos. Isso
 * baixa do GitHub Releases do mediasoup (rede). Se nao houver binario para a
 * plataforma, o proprio script oficial tenta compilar localmente (precisa de
 * Python e toolchain C++); isso nao da pra desligar por aqui, entao o limite
 * de tempo abaixo evita ficar preso. MEDIASOUP_WORKER_BIN aponta um binario
 * proprio e dispensa o download.
 *
 *   npm run prepare-worker [-- --force]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PKG_DIR = path.join(ROOT, 'node_modules', 'mediasoup');
const BIN_NAME = process.platform === 'win32' ? 'mediasoup-worker.exe' : 'mediasoup-worker';

function workerBinPath(env = process.env) {
  return env.MEDIASOUP_WORKER_BIN || path.join(PKG_DIR, 'worker', 'out', 'Release', BIN_NAME);
}

function workerReady(env = process.env) {
  try {
    return fs.statSync(workerBinPath(env)).size > 0;
  } catch {
    return false;
  }
}

function main(argv = process.argv.slice(2)) {
  const force = argv.includes('--force');
  if (!fs.existsSync(path.join(PKG_DIR, 'package.json'))) {
    console.error('mediasoup nao esta instalado. Rode, em tools/sfu-spike: npm ci --ignore-scripts');
    return 1;
  }
  if (!force && workerReady()) {
    console.log(`worker ja presente: ${workerBinPath()}`);
    return 0;
  }
  console.log('baixando o worker pre-compilado do mediasoup (rede: github.com/versatica/mediasoup/releases)...');
  const res = spawnSync(process.execPath, ['npm-scripts.mjs', 'postinstall'], {
    cwd: PKG_DIR, env: process.env, stdio: 'inherit', timeout: 10 * 60 * 1000, windowsHide: true,
  });
  if (res.error || res.status !== 0) {
    console.error(`o script oficial falhou: ${res.error ? res.error.message : `codigo ${res.status}`}`);
    return 1;
  }
  if (!workerReady()) {
    console.error(`worker NAO encontrado em ${workerBinPath()} depois do script oficial. Sem binario pre-compilado para esta plataforma: instale Python e a toolchain C++ para o build local do pacote, ou defina MEDIASOUP_WORKER_BIN.`);
    return 1;
  }
  console.log(`worker pronto: ${workerBinPath()}`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main, workerBinPath, workerReady };
