'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizar, acoesDisponiveis, filtrar } = require('./comando');

test('normalizar tira acento e caixa', () => {
  assert.equal(normalizar('  Câmera LIGADA '), 'camera ligada');
});

test('fora da sala: entrar em cada sala, criar, procurar e configuracoes', () => {
  const ids = acoesDisponiveis({ lugar: 'lobby', salas: [{ indice: 0, nome: 'Churras' }] }).map((a) => a.rotulo);
  assert.deepEqual(ids, ['Entrar em Churras', 'Criar sala', 'Procurar salas de novo', 'Configurações']);
});

test('na sala sem transmitir: assistir as fontes e transmitir', () => {
  const acoes = acoesDisponiveis({
    lugar: 'room',
    fontes: [{ tileId: 'p1', nome: 'Ana', assistindo: false }, { tileId: 'cam-p2', nome: 'Bia', assistindo: true }],
  });
  const rotulos = acoes.map((a) => a.rotulo);
  assert.ok(rotulos.includes('Assistir Ana'));
  assert.ok(rotulos.includes('Ver Ana junto'));
  assert.ok(rotulos.includes('Parar de assistir Bia'));
  assert.ok(!rotulos.some((r) => r === 'Ver Bia junto'), 'camera nao tem "ver junto"');
  assert.ok(rotulos.includes('Transmitir tela'));
  assert.ok(!rotulos.includes('Parar de transmitir'));
  assert.equal(acoes.find((a) => a.rotulo === 'Assistir Ana').alvo, 'p1');
});

test('transmitindo: pausar ou retomar, trocar e parar; nada de transmitir de novo', () => {
  const pausado = acoesDisponiveis({ lugar: 'room', transmitindo: true, pausado: true }).map((a) => a.rotulo);
  assert.ok(pausado.includes('Retomar a transmissão'));
  assert.ok(pausado.includes('Trocar fonte'));
  assert.ok(pausado.includes('Parar de transmitir'));
  assert.ok(!pausado.includes('Transmitir tela'));
});

test('sala Mesa: sem alternar vista, sem Modo teatro, e as fontes so levam a janela', () => {
  const acoes = acoesDisponiveis({
    lugar: 'room',
    soMesa: true,
    fontes: [{ tileId: 'p1', nome: 'Ana', assistindo: false }, { tileId: 'cam-p2', nome: 'Bia', assistindo: true }],
  });
  const ids = acoes.map((a) => a.id);
  const rotulos = acoes.map((a) => a.rotulo);
  assert.ok(!ids.includes('mesa'));
  assert.ok(!ids.includes('teatro'));
  assert.ok(!ids.includes('ver-junto'));
  assert.ok(!ids.includes('parar-assistir'));
  assert.ok(!rotulos.some((r) => /palco|Assistir/.test(r)));
  assert.ok(rotulos.includes('Ir até Ana'));
  assert.ok(rotulos.includes('Ir até Bia'));
  assert.equal(acoes.find((a) => a.rotulo === 'Ir até Ana').alvo, 'p1');
  assert.ok(rotulos.includes('Pôr na Mesa…'));
});

test('filtrar ignora acento e poe comeco de palavra primeiro', () => {
  const acoes = [{ rotulo: 'Abrir a conversa' }, { rotulo: 'Ligar câmera' }, { rotulo: 'Configurações' }];
  assert.deepEqual(filtrar(acoes, 'camera').map((a) => a.rotulo), ['Ligar câmera']);
  assert.deepEqual(filtrar(acoes, 'con').map((a) => a.rotulo), ['Configurações', 'Abrir a conversa']);
  assert.equal(filtrar(acoes, '').length, 3);
  assert.equal(filtrar(acoes, 'xyz').length, 0);
});

test('sala so transmissoes: sem os comandos da Mesa, com Modo teatro', () => {
  const sem = acoesDisponiveis({ lugar: 'room', semMesa: true }).map((a) => a.id);
  assert.ok(!sem.includes('mesa'));
  assert.ok(!sem.includes('por-na-mesa'));
  assert.ok(sem.includes('teatro'));
  assert.ok(sem.includes('conversa'));
});
