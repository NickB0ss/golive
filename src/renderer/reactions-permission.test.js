'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./i18n'); // registra GoLive.i18n (pt-BR por padrao) para t()
const {
  canReceiveScreenReaction,
  overlayUnavailableToast,
} = require('./reactions-permission');

test('reacao de camera fica livre e tela exige a permissao da dona', () => {
  assert.equal(canReceiveScreenReaction({ kind: 'camera' }), true);
  assert.equal(canReceiveScreenReaction({ kind: 'screen', allowed: true }), true);
  assert.equal(canReceiveScreenReaction({ kind: 'screen', allowed: false }), false);
});

test('reacao recebida para tela sem permissao e ignorada', () => {
  const recebida = canReceiveScreenReaction({ kind: 'screen', allowed: false });

  assert.equal(recebida, false);
});

test('aviso de overlay descreve as permissoes ativas para janela e monitor', () => {
  const combinacoes = [
    {
      opcoes: { annotations: true, reactions: false },
      janela: 'Compartilhando uma janela: os rabiscos aparecem no app, não na tela.',
      display: 'Não achei o monitor para os rabiscos; eles ficam só no app.',
    },
    {
      opcoes: { annotations: false, reactions: true },
      janela: 'Compartilhando uma janela: as reações aparecem no app, não na tela.',
      display: 'Não achei o monitor para as reações; elas ficam só no app.',
    },
    {
      opcoes: { annotations: true, reactions: true },
      janela: 'Compartilhando uma janela: rabiscos e reações aparecem no app, não na tela.',
      display: 'Não achei o monitor para rabiscos e reações; eles ficam só no app.',
    },
  ];

  for (const { opcoes, janela, display } of combinacoes) {
    assert.equal(overlayUnavailableToast({ reason: 'window', ...opcoes }), janela);
    assert.equal(overlayUnavailableToast({ reason: 'display', ...opcoes }), display);
  }
});
