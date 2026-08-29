'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readReceiverReport, lossPercent, jitterBufferMs } = require('./rxstats');

// RTCStatsReport e um Map-like com forEach -- um Array serve de duble.
const REPORT = [
  { type: 'inbound-rtp', kind: 'video', framesPerSecond: 58, frameWidth: 1920, frameHeight: 1080,
    packetsReceived: 10000, packetsLost: 25, freezeCount: 2, framesDecoded: 3400,
    jitterBufferDelay: 6.4, jitterBufferEmittedCount: 3400, decoderImplementation: 'ExternalDecoder' },
  { type: 'inbound-rtp', kind: 'audio', packetsReceived: 5000, packetsLost: 1 },
  { type: 'codec', mimeType: 'video/H264' },
  { type: 'outbound-rtp', kind: 'video', framesPerSecond: 12 },
];

test('le so o inbound-rtp de video', () => {
  const s = readReceiverReport(REPORT);
  assert.equal(s.fps, 58);
  assert.equal(s.width, 1920);
  assert.equal(s.framesDecoded, 3400);
  assert.equal(s.decoder, 'ExternalDecoder');
  assert.equal(s.codec, 'H264');
});

test('nao confunde audio nem outbound com o video recebido', () => {
  const s = readReceiverReport(REPORT);
  assert.equal(s.packetsReceived, 10000, 'o audio nao pode somar aqui');
});

test('perda em porcentagem do total oferecido', () => {
  const s = readReceiverReport(REPORT);
  // 25 perdidos de 10025 oferecidos
  assert.ok(Math.abs(lossPercent(s) - 0.2494) < 0.001);
});

test('perda e null quando nada chegou -- zero por cento seria mentira', () => {
  assert.equal(lossPercent(readReceiverReport([])), null);
});

test('buffer de jitter em ms por quadro emitido', () => {
  // 6.4s / 3400 quadros = ~1.88ms
  assert.ok(Math.abs(jitterBufferMs(readReceiverReport(REPORT)) - 1.882) < 0.01);
});

test('buffer e null sem quadro emitido, nao zero', () => {
  assert.equal(jitterBufferMs(readReceiverReport([])), null);
});

test('relatorio vazio nao lanca', () => {
  const s = readReceiverReport([]);
  assert.equal(s.fps, 0);
  assert.equal(s.freezeCount, 0);
});
