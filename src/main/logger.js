/*
 * Log em arquivo do processo principal, pra dar pra investigar depois de
 * fechado o app (hoje: renderer travando/caindo, conexao de sinalizacao
 * caindo sem motivo aparente -- ver golive #12). Sem isso, o unico rastro
 * era o DevTools, que ninguem deixa aberto compartilhando tela.
 *
 * Um arquivo por sessao do app (nome com timestamp), mantendo so os
 * ultimos MAX_FILES -- e um app entre amigos, nao precisa de nada mais
 * sofisticado que isso.
 *
 * ESCRITA SINCRONA, de proposito. A versao anterior usava
 * fs.createWriteStream, que bufferiza: num kill duro do processo -- que e
 * EXATAMENTE o evento que este log existe pra registrar -- as ultimas
 * linhas morriam no buffer. Nos logs de 2026-09-05 duas maquinas somem no
 * meio de uma linha de diag e voltam num arquivo novo minutos depois, sem
 * uma unica linha de encerramento: o crash apagou o proprio rastro. Um fd
 * aberto + writeSync custa uma syscall por linha (a carga real e ~3
 * linhas/s, com 3 senders) e nao perde nada.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_FILES = 8;

function logsDir() {
  return path.join(app.getPath('userData'), 'logs');
}

function rotateOldFiles(dir, maxFiles) {
  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.log'))
      .sort();
  } catch {
    return;
  }
  while (files.length >= maxFiles) {
    const oldest = files.shift();
    try {
      fs.unlinkSync(path.join(dir, oldest));
    } catch {
      // arquivo ja sumiu ou sem permissao -- nao vale travar o app por isto
    }
  }
}

/** Cria o logger da sessao atual. Devolve { path, dir, log, error, close }
 * -- `log` e `error` gravam uma linha com timestamp no arquivo NA HORA, e
 * tambem ecoam no console (visivel rodando com --enable-logging, ou no
 * terminal em dev). Nunca lanca: um log que falha nao pode derrubar o app.
 *
 * `opts` existe pros testes (dir injetado roda sem Electron, echo:false
 * cala o console) -- em producao a chamada e sem argumento nenhum. */
function setupLogger(opts = {}) {
  const dir = opts.dir || logsDir();
  const maxFiles = opts.maxFiles ?? MAX_FILES;
  const echo = opts.echo !== false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    rotateOldFiles(dir, maxFiles);
  } catch {
    // Sem pasta de logs, segue so ecoando no console.
  }

  const fileName = `golive-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  const filePath = path.join(dir, fileName);
  // 'a' (append) e nao 'w': se por algum motivo o nome colidir, some ao
  // arquivo em vez de zerar o que ja estava la.
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'a');
  } catch {
    fd = null; // sem arquivo: o app roda igual, so sem rastro em disco
  }

  function write(level, args) {
    const line = `[${new Date().toISOString()}] [${level}] ${args.map(String).join(' ')}`;
    if (echo) {
      if (level === 'error') console.error(line);
      else console.log(line);
    }
    if (fd === null) return;
    try {
      fs.writeSync(fd, line + '\n');
    } catch {
      // disco cheio, fd ja fechado, permissao -- ja ecoou no console acima
    }
  }

  /** So pros testes e pro encerramento limpo. Depois disto o logger vira
   * no-op de arquivo (o console segue) -- um handler de saida que chegue
   * atrasado nao pode lancar. */
  function close() {
    if (fd === null) return;
    const aberto = fd;
    fd = null;
    try {
      fs.closeSync(aberto);
    } catch {
      // ja fechado
    }
  }

  return {
    path: filePath,
    dir,
    log: (...args) => write('info', args),
    error: (...args) => write('error', args),
    close,
  };
}

module.exports = { setupLogger, MAX_FILES };
