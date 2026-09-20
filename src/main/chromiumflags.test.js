'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { montarFlagsChromium, aplicarFlagsChromium } = require('./chromiumflags');

const ENABLE = 'WebRtcAllowH264Send,AllowWgcScreenCapturer,AllowWgcWindowCapturer,AllowWgcDesktopCapturer';
const DISABLE = 'WebRtcHideLocalIpsWithMdns';

test('monta os switches com os nomes de feature e maiusculas exatos', () => {
  assert.deepEqual(montarFlagsChromium(), {
    enableFeatures: ENABLE,
    disableFeatures: DISABLE,
    switches: [
      ['enable-features', ENABLE],
      ['disable-features', DISABLE],
    ],
  });
});

// appendSwitch e nao appendArgument: medido no Electron 44.4.3 (ver comentario
// em chromiumflags.js e scripts/probe-command-line-case.js) -- appendArgument
// nao chega ao getSwitchValue, entao as features sumiriam em silencio.
test('envia por appendSwitch e aceita somente as features intactas', () => {
  const enviados = [];
  const erros = [];
  const commandLine = {
    appendSwitch: (nome, valor) => enviados.push([nome, valor]),
    getSwitchValue: (nome) => (nome === 'enable-features' ? ENABLE : DISABLE),
  };

  const resultado = aplicarFlagsChromium(commandLine, { error: (mensagem) => erros.push(mensagem) });

  assert.deepEqual(enviados, [
    ['enable-features', ENABLE],
    ['disable-features', DISABLE],
  ]);
  assert.equal(resultado.valido, true);
  assert.deepEqual(erros, []);
});

test('registra erro quando o Electron altera as maiusculas de uma feature', () => {
  const erros = [];
  const commandLine = {
    appendSwitch: () => {},
    getSwitchValue: (nome) => (nome === 'enable-features' ? ENABLE.toLowerCase() : DISABLE),
  };

  const resultado = aplicarFlagsChromium(commandLine, { error: (mensagem) => erros.push(mensagem) });

  assert.equal(resultado.valido, false);
  assert.equal(erros.length, 1);
  assert.match(erros[0], /^command line enable-features incorreto:/);
});

test('registra erro quando a feature nao chega (appendArgument devolvia vazio)', () => {
  const erros = [];
  const commandLine = {
    appendSwitch: () => {},
    getSwitchValue: () => '',
  };

  const resultado = aplicarFlagsChromium(commandLine, { error: (mensagem) => erros.push(mensagem) });

  assert.equal(resultado.valido, false);
  assert.equal(erros.length, 2);
});
