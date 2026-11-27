// src/main/main-auditoria.test.js
'use strict';
/*
 * Travas ESTATICAS sobre src/main.js (auditoria 2026-11-25). O main nao e
 * importavel pelo node:test (precisa do Electron), entao a logica testavel
 * mora em modulos (prazo.js, menu.js, limpezajanela.js, overlayslot.js, cada um
 * com teste proprio). Estes testes so garantem que o main.js continua LIGADO a
 * eles -- o comportamento real foi conferido com sondas no Electron.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

/** Corpo do handler/funcao que comeca em `inicio`, ate o proximo marcador de nivel zero. */
function trecho(inicio, fim) {
  const a = fonte.indexOf(inicio);
  assert.ok(a >= 0, `nao achei ${inicio}`);
  const b = fonte.indexOf(fim, a + inicio.length);
  assert.ok(b > a, `nao achei ${fim} depois de ${inicio}`);
  return fonte.slice(a, b);
}

test('M-01: nenhum fechamento do servidor embutido espera sem prazo', () => {
  const chamadas = fonte.match(/await closeEmbeddedServer\(/g) || [];
  assert.equal(chamadas.length, 0, 'use closeEmbeddedServerComPrazo');
  for (const inicio of ["app.on('window-all-closed'", "ipcMain.handle('room:host'",
    "ipcMain.handle('room:unhost'", "ipcMain.handle('room:abort-host'"]) {
    const corpo = trecho(inicio, '\n});');
    assert.match(corpo, /closeEmbeddedServerComPrazo\(/, inicio);
  }
});

test('M-08: room:host confere se o servidor que criou ainda e o atual depois de cada await', () => {
  const corpo = trecho("ipcMain.handle('room:host'", "ipcMain.handle('room:unhost'");
  assert.doesNotMatch(corpo, /embeddedServer\.port/, 'embeddedServer pode ter virado null depois de um await');
  const guardas = corpo.match(/if \(embeddedServer !== server\) return \{ ok: false, cancelled: true/g) || [];
  assert.equal(guardas.length, 2);
});

test('M-02: a pagina que recarrega ou cai dispara a limpeza do estado guardado no main', () => {
  assert.match(fonte, /on\('did-start-navigation'[\s\S]{0,200}limparEstadoDaPagina\(\)/);
  const gone = trecho("on('render-process-gone'", '});');
  assert.match(gone, /limparEstadoDaPagina\(\)/);
  assert.match(fonte, /capturaDonos\.set\(capture, sender\)/);
});

test('M-09: o overlay e aberto pelo slot, que isola um pedido do outro', () => {
  const corpo = trecho("ipcMain.handle('overlay:start'", "ipcMain.handle('overlay:stop'");
  assert.match(corpo, /overlaySlot\.abrir\(/);
  assert.doesNotMatch(corpo, /destroyOverlayWindow\(/);
});
