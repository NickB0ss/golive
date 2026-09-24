'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { errosNaoTratados, achar, regraUdp, resumo } = require('./verificar');

const linha = (texto, t = 1000) => ({ t, texto });

test('erros nao tratados do renderer e do main sao pegos; ruido permitido nao', () => {
  const linhas = [
    linha('[signaling] conexao aberta'),
    linha('Uncaught TypeError: x is not a function'),
    linha('[2026-09-23T23:42:41Z] [error] unhandledRejection no main: TypeError: boom'),
    linha('uncaughtException no main: Error: Object has been destroyed'),
    linha('[assistir] erro esperado'),
  ];
  assert.deepEqual(errosNaoTratados(linhas).map((l) => l.texto.slice(0, 20)), [
    'Uncaught TypeError: ',
    '[2026-09-23T23:42:41',
    'uncaughtException no',
  ]);
  assert.equal(errosNaoTratados(linhas, [/Object has been destroyed/, /boom/, /x is not/]).length, 0);
});

test('achar respeita o instante de inicio', () => {
  const linhas = [linha('[rota] a', 100), linha('[rota] b', 200), linha('outra', 300)];
  assert.deepEqual(achar(linhas, /\[rota\]/).map((l) => l.texto), ['[rota] a', '[rota] b']);
  assert.deepEqual(achar(linhas, /\[rota\]/, { desde: 150 }).map((l) => l.texto), ['[rota] b']);
});

test('regra de UDP em todas as interfaces, poupando o DNS: corte total, perda parcial e remocao simetrica', () => {
  const base = ['INPUT', '-p', 'udp', '-m', 'multiport', '!', '--ports', '53'];
  assert.deepEqual(regraUdp('-I'), ['-I', ...base, '-j', 'DROP']);
  assert.ok(!regraUdp('-I').includes('lo'), 'so no loopback a midia escapava pelo par srflx');
  assert.deepEqual(regraUdp('-D', { perda: 0.02 }), [
    '-D', ...base, '-m', 'statistic', '--mode', 'random', '--probability', '0.02', '-j', 'DROP',
  ]);
  assert.throws(() => regraUdp('-A'), /acao invalida/);
  assert.throws(() => regraUdp('-I', { perda: 1 }), /perda fora/);
  assert.throws(() => regraUdp('-I', { perda: 0 }), /perda fora/);
});

test('resumo lista cada cenario e conta as falhas', () => {
  const texto = resumo([
    { nome: 'sala-basica', ok: true, ms: 41000 },
    { nome: 'queda-curta', ok: false, ms: 52000, erro: 'nao reiniciou o ICE' },
  ]);
  assert.match(texto, /^ok {3}sala-basica \(41s\)$/m);
  assert.match(texto, /^FALHOU queda-curta \(52s\)\n {7}nao reiniciou o ICE$/m);
  assert.match(texto, /1 de 2 cenario\(s\) falharam$/);
  assert.match(resumo([{ nome: 'a', ok: true, ms: 1 }]), /1 cenario\(s\) ok$/);
});
