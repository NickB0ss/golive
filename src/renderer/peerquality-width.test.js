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

// Camera: sem presets, o teto vira scaleResolutionDownBy no sender daquele
// espectador (potencia de 2, nunca abaixo da largura pedida) e o bitrate cai
// com a area.
const { cameraEncodingFor, CAMERA_MIN_BPS } = require('./peerquality');
const { scaleFactorFor, DEFAULTS } = require('./config');

test('camera: janela pequena na Mesa escala o encode daquele espectador', () => {
  const q = { ...DEFAULTS.camera }; // 1280x720, 2 Mbps
  assert.deepEqual(cameraEncodingFor(q, 1280, 640, scaleFactorFor), { scaleDownBy: 2, bitrate: 500_000 });
  assert.deepEqual(cameraEncodingFor(q, 1280, 320, scaleFactorFor), { scaleDownBy: 4, bitrate: CAMERA_MIN_BPS });
  // 700 px de janela: 1280/2 = 640 nao cobre, entao fica inteira.
  assert.deepEqual(cameraEncodingFor(q, 1280, 700, scaleFactorFor), { scaleDownBy: 1, bitrate: 2_000_000 });
});

test('camera: sem largura (Transmissao, versao antiga, relay) nada muda', () => {
  const q = { ...DEFAULTS.camera };
  for (const w of [null, undefined, 'lixo', 0, 4000]) {
    assert.deepEqual(cameraEncodingFor(q, 1280, w, scaleFactorFor), { scaleDownBy: 1, bitrate: 2_000_000 }, String(w));
  }
  // Captura sem largura conhecida: usa a do config.
  assert.deepEqual(cameraEncodingFor(q, 0, 640, scaleFactorFor), { scaleDownBy: 2, bitrate: 500_000 });
  // Sem a funcao de escala: nunca inventa um fator.
  assert.deepEqual(cameraEncodingFor(q, 1280, 320, null), { scaleDownBy: 1, bitrate: 2_000_000 });
});

test('camera: o piso do bitrate nunca passa do bitrate de hoje', () => {
  assert.deepEqual(cameraEncodingFor({ width: 640, bitrate: 100_000 }, 640, 160, scaleFactorFor), { scaleDownBy: 4, bitrate: 100_000 });
});
