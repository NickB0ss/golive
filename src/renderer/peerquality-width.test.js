'use strict';

// Teto de qualidade pelo tamanho da janela na Mesa de quem assiste (spec
// 2026-09-24, secao 5).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { capForWidth, normViewWidth } = require('./peerquality');
const { QUALITY_PRESETS } = require('./config');

test('janela pequena desce a resolucao sem mexer no fps', () => {
  assert.equal(capForWidth('1080p60', 400, QUALITY_PRESETS), '720p60');
  assert.equal(capForWidth('1080p30', 1280, QUALITY_PRESETS), '720p30');
  assert.equal(capForWidth('720p60', 300, QUALITY_PRESETS), '720p60', 'ja no piso de resolucao');
});

test('janela grande (ou sem largura) nao limita nada', () => {
  assert.equal(capForWidth('1080p60', 1281, QUALITY_PRESETS), '1080p60');
  assert.equal(capForWidth('1080p60', 4000, QUALITY_PRESETS), '1080p60');
  assert.equal(capForWidth('1080p60', null, QUALITY_PRESETS), '1080p60');
  assert.equal(capForWidth('1080p60', 'lixo', QUALITY_PRESETS), '1080p60');
  assert.equal(capForWidth('desconhecido', 400, QUALITY_PRESETS), 'desconhecido');
});

test('o teto nunca sobe acima do preset de hoje', () => {
  assert.equal(capForWidth('720p30', 1920, QUALITY_PRESETS), '720p30');
});

test('largura anunciada: inteiro de 1 a 16384, o resto e null', () => {
  assert.equal(normViewWidth(640.4), 640);
  assert.equal(normViewWidth(0), null);
  assert.equal(normViewWidth(99999), null);
  assert.equal(normViewWidth('640'), null);
  assert.equal(normViewWidth(undefined), null);
});
