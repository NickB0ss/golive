'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setupLogger } = require('./logger');

/** Pasta de logs descartavel. `dir` e injetado pra que o teste rode sem
 * Electron (app.getPath('userData') nao existe fora dele) -- mesma receita
 * do updater.test.js. */
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'golive-log-'));
}

test('a linha chega no arquivo ANTES de setupLogger devolver o controle', () => {
  // Esta e a regressao que este arquivo existe pra impedir. Com
  // createWriteStream a escrita era bufferizada: num kill duro do processo
  // (o crash que a gente esta justamente tentando registrar) as ultimas
  // linhas morriam no buffer e o log terminava no meio de uma frase --
  // exatamente o que os logs de 2026-09-05 mostram.
  const dir = tmpDir();
  const logger = setupLogger({ dir, echo: false });

  logger.log('primeira');
  const conteudo = fs.readFileSync(logger.path, 'utf8');

  assert.match(conteudo, /primeira/);
  logger.close();
});

test('error tambem grava na hora, e marca o nivel', () => {
  const dir = tmpDir();
  const logger = setupLogger({ dir, echo: false });

  logger.error('renderer caiu:', 'reason=crashed');
  const linha = fs.readFileSync(logger.path, 'utf8').trim();

  assert.match(linha, /\[error\] renderer caiu: reason=crashed$/);
  logger.close();
});

test('mantem a ordem das linhas', () => {
  const dir = tmpDir();
  const logger = setupLogger({ dir, echo: false });

  logger.log('um');
  logger.error('dois');
  logger.log('tres');

  const linhas = fs.readFileSync(logger.path, 'utf8').trim().split('\n');
  assert.equal(linhas.length, 3);
  assert.match(linhas[0], /um$/);
  assert.match(linhas[1], /dois$/);
  assert.match(linhas[2], /tres$/);
  logger.close();
});

test('escrever depois de close nao lanca', () => {
  // O log e chamado de dentro de handlers de encerramento (before-quit,
  // window-all-closed): um deles pode chegar depois do close e nao pode
  // derrubar o app justo na saida.
  const dir = tmpDir();
  const logger = setupLogger({ dir, echo: false });
  logger.close();
  assert.doesNotThrow(() => logger.log('tarde demais'));
});

test('pasta que nao da pra criar nao derruba o logger', () => {
  // Sem arquivo o app segue rodando, so sem rastro em disco.
  const arquivo = path.join(tmpDir(), 'isto-e-um-arquivo');
  fs.writeFileSync(arquivo, 'x');
  const logger = setupLogger({ dir: path.join(arquivo, 'logs'), echo: false });

  assert.doesNotThrow(() => logger.log('sem disco'));
  logger.close();
});

test('rotaciona pra no maximo MAX_FILES logs na pasta', () => {
  const dir = tmpDir();
  for (const nome of ['golive-a.log', 'golive-b.log', 'golive-c.log']) {
    fs.writeFileSync(path.join(dir, nome), '');
  }
  const logger = setupLogger({ dir, echo: false, maxFiles: 3 });

  const logs = fs.readdirSync(dir).filter((f) => f.endsWith('.log'));
  assert.equal(logs.length, 3);
  assert.ok(logs.includes(path.basename(logger.path)));
  assert.ok(!logs.includes('golive-a.log')); // o mais antigo saiu
  logger.close();
});
