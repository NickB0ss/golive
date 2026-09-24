'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../mesa-modules/cronometro');
require('./comum');
const janela = require('./cronometro');

const T0 = 1_000_000;

function correndo(duration, desde) {
  let s = m.init();
  s = m.reduce(s, { kind: 'set', mode: 'down', duration });
  return m.reduce(s, { kind: 'start', at: desde });
}

test('registra o conteudo do cronometro', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.cronometro, janela);
});

test('mostrador: usa a hora do servidor e o remaining do modulo', () => {
  const s = correndo(5 * 60 * 1000, T0);
  assert.deepEqual(janela.mostrador(m, s, T0), { texto: '05:00', fim: false, frac: 0 });
  const d = janela.mostrador(m, s, T0 + 61_500);
  assert.equal(d.texto, '03:59'); // regressivo arredonda para cima
  assert.ok(Math.abs(d.frac - 61_500 / 300_000) < 1e-9);
  assert.deepEqual(janela.mostrador(m, s, T0 + 10 * 60 * 1000), { texto: '00:00', fim: true, frac: 1 });
});

test('mostrador no progressivo nao tem barra', () => {
  let s = m.reduce(m.init(), { kind: 'set', mode: 'up' });
  s = m.reduce(s, { kind: 'start', at: T0 });
  const d = janela.mostrador(m, s, T0 + 3_725_000);
  assert.equal(d.texto, '1:02:05');
  assert.equal(d.frac, null);
  assert.equal(d.fim, false);
});

test('principal: Iniciar, Pausar, Continuar e Recomecar', () => {
  const parado = m.init();
  assert.equal(janela.principal(m, parado, T0).rotulo, 'Iniciar');
  const s = correndo(60_000, T0);
  assert.deepEqual(janela.principal(m, s, T0 + 1000).acoes, [{ kind: 'pause' }]);
  const pausado = m.reduce(s, { kind: 'pause', at: T0 + 10_000 });
  assert.equal(janela.principal(m, pausado, T0 + 20_000).rotulo, 'Continuar');
  // Esgotado e ainda "correndo" no estado: zera e poe para correr de novo.
  const p = janela.principal(m, s, T0 + 120_000);
  assert.equal(p.rotulo, 'Recomeçar');
  assert.deepEqual(p.acoes, [{ kind: 'reset' }, { kind: 'start' }]);
  // Cada passo e aceito pelo modulo na ordem.
  assert.equal(m.validate(s, p.acoes[0]), true);
  assert.equal(m.validate(m.reduce(s, p.acoes[0]), p.acoes[1]), true);
});

test('rotuloDuracao', () => {
  assert.equal(janela.rotuloDuracao(300_000), '5 min');
  assert.equal(janela.rotuloDuracao(5_400_000), '1 h 30 min');
  assert.equal(janela.rotuloDuracao(45_000), '45 s');
  assert.equal(janela.rotuloDuracao(0), '0 s');
  assert.equal(janela.rotuloDuracao(3_600_000), '1 h');
});

test('anuncio muda com o estado, nao com o segundo', () => {
  assert.equal(janela.anuncio(m, m.init(), T0), 'Parado em 5 min');
  const s = correndo(60_000, T0);
  assert.equal(janela.anuncio(m, s, T0), 'Correndo, faltam 1 min');
  assert.equal(janela.anuncio(m, s, T0 + 60_000), 'Tempo esgotado');
});

test('as duracoes prontas passam no validate do modulo', () => {
  for (const min of janela.PRESETS) {
    assert.equal(m.validate(m.init(), { kind: 'set', mode: 'down', duration: min * 60_000 }), true);
  }
});
