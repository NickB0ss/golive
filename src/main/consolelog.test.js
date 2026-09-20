'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizarConsoleMessage } = require('./consolelog');

test('preserva os quatro niveis numericos da assinatura antiga', () => {
  const casos = [
    [0, 'log', 'log'],
    [1, 'info', 'log'],
    [2, 'warn', 'error'],
    [3, 'error', 'error'],
  ];

  for (const [entrada, origem, nivel] of casos) {
    assert.deepEqual(
      normalizarConsoleMessage({}, entrada, 'renderer antigo'),
      { nivel, mensagem: 'renderer antigo', origem: `renderer:${origem}` },
    );
  }
});

test('preserva os niveis string da assinatura details do Electron 35', () => {
  const casos = [
    ['warning', 'error'],
    ['error', 'error'],
    ['info', 'log'],
    ['log', 'log'],
  ];

  for (const [level, nivel] of casos) {
    assert.deepEqual(
      normalizarConsoleMessage({}, { level, message: 'renderer novo', sourceId: 'app.js' }),
      { nivel, mensagem: 'renderer novo', origem: `renderer:${level}` },
    );
  }
});
