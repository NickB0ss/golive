// src/main/menu.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { removerMenuPadrao } = require('./menu');

test('app empacotado: remove o menu padrao (sem Ctrl+R nem Ctrl+Shift+I)', () => {
  const chamadas = [];
  const Menu = { setApplicationMenu: (menu) => chamadas.push(menu) };
  assert.equal(removerMenuPadrao(Menu, true), true);
  assert.deepEqual(chamadas, [null]);
});

test('em desenvolvimento (npm start): mantem o menu, que e o caminho do DevTools', () => {
  const chamadas = [];
  const Menu = { setApplicationMenu: (menu) => chamadas.push(menu) };
  assert.equal(removerMenuPadrao(Menu, false), false);
  assert.deepEqual(chamadas, []);
});

// main.js nao e importavel pelo node:test; sem esta checagem tirar a chamada
// de la passaria batido. O comportamento real tem sonda propria (Electron).
test('main.js remove o menu padrao antes de criar a janela principal', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const remocao = fonte.indexOf('removerMenuPadrao(Menu, app.isPackaged)');
  const criacao = fonte.indexOf('win = new BrowserWindow(');
  assert.ok(remocao > 0, 'main.js nao chama removerMenuPadrao');
  assert.ok(criacao > 0);
  assert.ok(remocao < criacao, 'o menu tem que sair antes de createWindow criar a janela');
});
