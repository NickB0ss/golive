'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('./warnings');

function aviso(severidade, titulo, detalhe = titulo) {
  return { severidade, titulo, detalhe, dispensavel: true };
}

test('lista avisos por severidade e preserva a chegada dentro dela', () => {
  const registry = create();
  registry.set('info-primeiro', aviso('info', 'Info primeiro'));
  registry.set('atencao-primeiro', aviso('atencao', 'Atencao primeiro'));
  registry.set('grave-primeiro', aviso('grave', 'Grave primeiro'));
  registry.set('atencao-segundo', aviso('atencao', 'Atencao segundo'));

  assert.deepEqual(registry.list().map((item) => item.id), [
    'grave-primeiro', 'atencao-primeiro', 'atencao-segundo', 'info-primeiro',
  ]);
});

test('summary conta os avisos visiveis e usa o rotulo do mais grave', () => {
  const registry = create();
  registry.set('info', aviso('info', 'Info'));
  registry.set('grave', { ...aviso('grave', 'Firewall'), rotuloCurto: 'Firewall' });

  assert.deepEqual(registry.summary(), { total: 2, pior: 'grave', rotuloCurto: 'Firewall' });
});

test('dispensar esconde apenas o aviso com a mesma assinatura', () => {
  const registry = create();
  registry.set('encoder', aviso('atencao', 'Encoder em software', 'Reduza a qualidade.'));
  registry.set('som', aviso('atencao', 'Silencio', 'Nao sai audio.'));

  registry.dismiss('encoder');

  assert.deepEqual(registry.list().map((item) => item.id), ['som']);
});

test('aviso dispensado volta quando seu conteudo muda', () => {
  const registry = create();
  registry.set('endereco', aviso('atencao', 'Endereco local', 'Use a mesma rede local.'));
  registry.dismiss('endereco');
  registry.set('endereco', aviso('atencao', 'Endereco local', 'Use a rede Radmin VPN.'));

  assert.deepEqual(registry.list().map((item) => item.id), ['endereco']);
});

test('set com null remove o aviso e atualiza a contagem', () => {
  const registry = create();
  registry.set('captura', aviso('grave', 'Falha na captura'));
  registry.set('som', aviso('atencao', 'Silencio'));
  registry.set('captura', null);

  assert.deepEqual(registry.list().map((item) => item.id), ['som']);
  assert.deepEqual(registry.summary(), { total: 1, pior: 'atencao', rotuloCurto: null });
});
