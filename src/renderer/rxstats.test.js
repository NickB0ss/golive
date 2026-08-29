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

// ---------- receiveHealth ----------
const { receiveHealth } = require('./rxstats');

const RX = (over = {}) => ({
  framesDecoded: 0, packetsReceived: 0, packetsLost: 0, freezeCount: 0, decoder: '', ...over,
});

test('receiveHealth: sem prev devolve null -- uma amostra nao e uma taxa', () => {
  assert.equal(receiveHealth(RX({ framesDecoded: 100 }), null, 1000), null);
});

test('receiveHealth: nenhum quadro decodificado na janela devolve null', () => {
  const s = RX({ framesDecoded: 100 });
  assert.equal(receiveHealth(s, s, 1000), null);
});

test('receiveHealth: dtMs invalido devolve null', () => {
  const prev = RX({ framesDecoded: 100 });
  const cur = RX({ framesDecoded: 130 });
  assert.equal(receiveHealth(cur, prev, 0), null);
  assert.equal(receiveHealth(cur, prev, -5), null);
});

test('receiveHealth: travadas viram taxa por minuto', () => {
  const prev = RX({ framesDecoded: 100, freezeCount: 2 });
  const cur = RX({ framesDecoded: 130, freezeCount: 5 });
  // 3 travadas em 1s = 180/min
  assert.equal(receiveHealth(cur, prev, 1000).freezeRate, 180);
});

test('receiveHealth: perda e da JANELA, nao acumulada', () => {
  const prev = RX({ framesDecoded: 100, packetsReceived: 9000, packetsLost: 1000 });
  const cur = RX({ framesDecoded: 130, packetsReceived: 9990, packetsLost: 1010 });
  // janela: 10 perdidos de 1000 oferecidos = 1%
  assert.ok(Math.abs(receiveHealth(cur, prev, 1000).lossPct - 1) < 1e-9);
});

test('receiveHealth: contadores que andam pra tras nao viram numero negativo', () => {
  const prev = RX({ framesDecoded: 100, packetsLost: 50, freezeCount: 5 });
  const cur = RX({ framesDecoded: 130, packetsLost: 40, freezeCount: 3 });
  const h = receiveHealth(cur, prev, 1000);
  assert.ok(h.lossPct >= 0);
  assert.ok(h.freezeRate >= 0);
});

test('receiveHealth: decoder em software sinalizado', () => {
  const prev = RX({ framesDecoded: 100 });
  assert.equal(receiveHealth(RX({ framesDecoded: 130, decoder: 'FFmpegVideoDecoder' }), prev, 1000).softwareDecoder, true);
  assert.equal(receiveHealth(RX({ framesDecoded: 130, decoder: 'libvpx' }), prev, 1000).softwareDecoder, true);
  assert.equal(receiveHealth(RX({ framesDecoded: 130, decoder: 'DXVAVideoDecoder' }), prev, 1000).softwareDecoder, false);
  assert.equal(receiveHealth(RX({ framesDecoded: 130, decoder: '' }), prev, 1000).softwareDecoder, false);
});
