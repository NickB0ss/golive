'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./metrics');

const rep = (list) => new Map(list.map((e, i) => [e.id || `s${i}`, e]));

test('readSender soma streams, le o codec e deixa ausente como null', () => {
  const r = M.readSender(rep([
    { id: 'o', type: 'outbound-rtp', kind: 'video', codecId: 'c', framesEncoded: 10, packetsSent: 5, ssrc: 1 },
    { id: 'c', type: 'codec', mimeType: 'video/H264', payloadType: 108, sdpFmtpLine: 'x' },
  ]));
  assert.equal(r.streams, 1);
  assert.equal(r.framesEncoded, 10);
  assert.equal(r.bytesSent, null);
  assert.equal(r.encoderImplementation, null);
  assert.deepEqual(r.codec, { mimeType: 'video/H264', payloadType: 108, sdpFmtpLine: 'x' });
  assert.equal(M.readSender(rep([{ type: 'inbound-rtp', kind: 'video' }])), null);
  assert.equal(M.readSender(null), null);
});

test('readSender com 3 streams (simulcast) conta 3, para o teste de envio unico', () => {
  const r = M.readSender(rep([1, 2, 3].map((n) => ({ id: `o${n}`, type: 'outbound-rtp', kind: 'video', ssrc: n, framesEncoded: 1 }))));
  assert.equal(r.streams, 3);
  assert.equal(r.framesEncoded, 3);
});

test('readReceiver le decode, perdas e codec; audio e ignorado', () => {
  const r = M.readReceiver(rep([
    { id: 'i', type: 'inbound-rtp', kind: 'video', codecId: 'c', framesDecoded: 7, packetsLost: 0, jitter: 0.002 },
    { id: 'a', type: 'inbound-rtp', kind: 'audio', framesDecoded: 999 },
    { id: 'c', type: 'codec', mimeType: 'video/VP8', payloadType: 96 },
  ]));
  assert.equal(r.framesDecoded, 7);
  assert.equal(r.packetsLost, 0);
  assert.equal(r.codec.mimeType, 'video/VP8');
});

test('counterDelta: regressao ou dado ausente = null, nunca zero inventado', () => {
  assert.equal(M.counterDelta(5, 9), 4);
  assert.equal(M.counterDelta(5, 5), 0);
  assert.equal(M.counterDelta(9, 5), null);
  assert.equal(M.counterDelta(null, 5), null);
  assert.equal(M.counterDelta(5, undefined), null);
  assert.equal(M.counterDelta(5, NaN), null);
});

test('windowBetween calcula taxa por segundo e propaga null', () => {
  const w = M.windowBetween({ t: 0, v: { a: 0, b: 10 } }, { t: 2000, v: { a: 60, b: 4 } }, ['a', 'b']);
  assert.equal(w.seconds, 2);
  assert.equal(w.perSec.a, 30);
  assert.equal(w.deltas.b, null);
  assert.equal(w.perSec.b, null);
  assert.equal(M.windowBetween({ t: 5, v: {} }, { t: 5, v: {} }, ['a']), null);
  assert.equal(M.windowBetween(null, { t: 5, v: {} }, ['a']), null);
});
