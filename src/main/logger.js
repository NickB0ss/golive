/*
 * Log em arquivo do processo principal, pra dar pra investigar depois de
 * fechado o app (hoje: renderer travando/caindo, conexao de sinalizacao
 * caindo sem motivo aparente -- ver golive #12). Sem isso, o unico rastro
 * era o DevTools, que ninguem deixa aberto compartilhando tela.
 *
 * Um arquivo por sessao do app (nome com timestamp), mantendo so os
 * ultimos MAX_FILES -- e um app entre amigos, nao precisa de nada mais
 * sofisticado que isso.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_FILES = 8;

function logsDir() {
  return path.join(app.getPath('userData'), 'logs');
}

function rotateOldFiles(dir) {
  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.log'))
      .sort();
  } catch {
    return;
  }
  while (files.length >= MAX_FILES) {
    const oldest = files.shift();
    try {
      fs.unlinkSync(path.join(dir, oldest));
    } catch {
      // arquivo ja sumiu ou sem permissao -- nao vale travar o app por isto
    }
  }
}

/** Cria o logger da sessao atual. Devolve { path, log, error } -- `log` e
 * `error` gravam uma linha com timestamp no arquivo, e tambem ecoam no
 * console (visivel rodando com --enable-logging, ou no terminal em dev).
 * Nunca lanca: um log que falha nao pode derrubar o app. */
function setupLogger() {
  const dir = logsDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    rotateOldFiles(dir);
  } catch {
    // Sem pasta de logs, segue so ecoando no console.
  }

  const fileName = `golive-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  const filePath = path.join(dir, fileName);
  let stream;
  try {
    stream = fs.createWriteStream(filePath, { flags: 'a' });
  } catch {
    stream = null;
  }

  function write(level, args) {
    const line = `[${new Date().toISOString()}] [${level}] ${args.map(String).join(' ')}`;
    if (level === 'error') console.error(line);
    else console.log(line);
    try {
      stream?.write(line + '\n');
    } catch {
      // disco cheio, permissao, etc -- ja ecoou no console acima
    }
  }

  return {
    path: filePath,
    dir,
    log: (...args) => write('info', args),
    error: (...args) => write('error', args),
  };
}

module.exports = { setupLogger };
