'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../i18n');
const registro = require('./index');
const truco = require('./truco');
const sons = require('./sons');

// Desenha ainda devolve texto no summary (vai em tarefa propria).
const COM_TEXTO = new Set(['desenha']);

test('todo titulo de modulo e a chave mesa.titulo.<tipo> e existe nos dicionarios', () => {
  for (const mod of registro.list()) {
    assert.equal(mod.title, `mesa.titulo.${mod.type}`, mod.type);
    assert.ok(i18n.existe(mod.title), `${mod.type}: falta ${mod.title}`);
  }
});

test('summary do estado inicial devolve chave existente e nunca texto', () => {
  for (const mod of registro.addable()) {
    if (COM_TEXTO.has(mod.type) || typeof mod.summary !== 'function') continue;
    const r = mod.summary(mod.init({ by: 'ana', random: () => 0 }));
    assert.equal(typeof r, 'object', mod.type);
    assert.ok(i18n.existe(r.chave), `${mod.type}: falta ${r.chave}`);
    assert.doesNotMatch(i18n.traduzirResumo(r), /^mesa\./, mod.type);
  }
});

test('truco: chave e valores do resumo, e o texto pt-BR de antes', () => {
  const r = truco.summary({ scores: [3, 1] });
  assert.deepEqual(r, { chave: 'mesa.resumo.truco', valores: { a: 3, b: 1 } });
  assert.equal(i18n.traduzirResumo(r), 'Truco 3 a 1');
});

test('sons: o resumo leva a chave do som, sem mapa de nomes no modulo', () => {
  const r = sons.summary({ last: { sound: 'buzina' } });
  assert.deepEqual(r, { chave: 'mesa.resumo.somUltimo', valores: { som: 'mesa.sons.som.buzina' } });
  assert.equal(i18n.traduzirResumo(r), 'Último som: Buzina');
  i18n.definirIdioma('en');
  assert.equal(i18n.traduzirResumo(r), 'Last sound: Horn');
  i18n.definirIdioma('pt-BR');
});

test('traduzirResumo: valor-codigo, lista aninhada e corte por max', () => {
  const r = {
    chave: 'mesa.resumo.enqueteEncerrada',
    valores: {
      linha: {
        chave: 'mesa.resumo.enqueteLinha',
        valores: {
          pergunta: 'Vamos?',
          opcoes: [
            { chave: 'mesa.resumo.enqueteOpcao', valores: { opcao: 'mesa.enquete.sim', n: 2 } },
            { chave: 'mesa.resumo.enqueteOpcao', valores: { opcao: 'mesa.enquete.nao', n: 0 } },
          ],
        },
      },
    },
  };
  assert.equal(i18n.traduzirResumo(r), 'Vamos? Sim 2 · Não 0 (encerrada)');
  r.valores.linha.max = 8;
  assert.equal(i18n.traduzirResumo(r), 'Vamos? … (encerrada)');
  assert.equal(i18n.traduzirResumo('texto antigo'), 'texto antigo');
  assert.equal(i18n.traduzirResumo(null), '');
});
