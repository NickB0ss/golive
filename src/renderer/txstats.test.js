'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
let tx;
try { tx = require('./txstats'); } catch (err) { if (err.code !== 'MODULE_NOT_FOUND') throw err; }

test('telemetria de envio existe como modulo puro', () => {
  assert.equal(typeof tx?.readSenderReport, 'function');
});
test('sender segue referencias RTP em vez de codec RTX e ICE de outra conexao', () => {
  const s = tx.readSenderReport([
    { id: 'out', type: 'outbound-rtp', kind: 'video', codecId: 'h264', transportId: 't',
      remoteId: 'remote', mediaSourceId: 'source', bytesSent: 0, framesEncoded: 0 },
    { id: 'h264', type: 'codec', mimeType: 'video/H264' },
    { id: 'rtx', type: 'codec', mimeType: 'video/rtx' },
    { id: 't', type: 'transport', selectedCandidatePairId: 'selected' },
    { id: 'selected', type: 'candidate-pair', currentRoundTripTime: 0, availableOutgoingBitrate: 0 },
    { id: 'other', type: 'candidate-pair', nominated: true, currentRoundTripTime: 3 },
    { id: 'remote', type: 'remote-inbound-rtp', kind: 'video', packetsLost: 0, fractionLost: 0 },
    { id: 'otherRemote', type: 'remote-inbound-rtp', kind: 'video', packetsLost: 50 },
    { id: 'source', type: 'media-source', kind: 'video', framesPerSecond: 60 },
    { id: 'otherSource', type: 'media-source', kind: 'video', framesPerSecond: 5 },
  ]);
  assert.equal(s.codec, 'H264');
  assert.equal(s.rtt, 0);
  assert.equal(s.availableBps, 0);
  assert.equal(s.captureFps, 60);
  assert.equal(s.packetsLostNet, 0);
  assert.equal(s.framesEncoded, 0);
  assert.equal(s.fps, null);
});
test('ausencia e fallback ambiguo ficam null; candidato unico oferece fallback defensivo', () => {
  const s = tx.readSenderReport([{ type: 'outbound-rtp', kind: 'video' },
    { type: 'codec', mimeType: 'video/H264' }, { type: 'codec', mimeType: 'video/VP8' },
    { type: 'candidate-pair', nominated: true, currentRoundTripTime: 1 },
    { type: 'candidate-pair', nominated: true, currentRoundTripTime: 2 }]);
  assert.equal(s.codec, null);
  assert.equal(s.rtt, null);
  assert.equal(s.bytesSent, null);
  assert.equal(tx.readSenderReport([{ type: 'candidate-pair', nominated: true,
    currentRoundTripTime: 0.02 }]).rtt, 20);
});
test('taxas usam janela recente e invalidam reset, ausencia e zero frames', () => {
  const prev = { bytesSent: 1000, framesEncoded: 100, totalEncodeTime: 1 };
  assert.deepEqual(tx.deriveRates({ bytesSent: 126000, framesEncoded: 150, totalEncodeTime: 1.1 }, prev, 1000),
    { mbps: 1, msPerFrame: 2.0000000000000018 });
  assert.deepEqual(tx.deriveRates({ bytesSent: 0, framesEncoded: 0, totalEncodeTime: 0 }, prev, 1000),
    { mbps: null, msPerFrame: null });
  assert.deepEqual(tx.deriveRates(prev, prev, 1000), { mbps: 0, msPerFrame: null });
  assert.deepEqual(tx.deriveRates({}, prev, 1000), { mbps: null, msPerFrame: null });
  assert.deepEqual(tx.deriveRates(prev, prev, Infinity), { mbps: null, msPerFrame: null });
});

test('fallback prefere par explicitamente selecionado e referencia quebrada nao empresta ICE alheio', () => {
  const pairs = [{ id: 'old', type: 'candidate-pair', nominated: true, currentRoundTripTime: 1 },
    { id: 'chosen', type: 'candidate-pair', selected: true, currentRoundTripTime: 0.05 }];
  assert.equal(tx.readSenderReport(pairs).rtt, 50);
  assert.equal(tx.readSenderReport([{ type: 'outbound-rtp', kind: 'video', transportId: 'missing' },
    ...pairs]).rtt, null);
});
test('tracker isola kind completo, PC, troca de RTP e relogio por conexao', () => {
  const tracker = tx.createTracker();
  const pc = {}, nextPc = {};
  const a = { bytesSent: 1000, framesEncoded: 100, totalEncodeTime: 1, rtpIds: 'a' };
  const b = { bytesSent: 126000, framesEncoded: 150, totalEncodeTime: 1.1, rtpIds: 'a' };
  assert.equal(tracker.rates('p:screen@a', pc, a, 1000).mbps, null);
  assert.equal(tracker.rates('p:screen@b', pc, b, 2000).mbps, null);
  assert.equal(tracker.rates('p:screen@a', pc, b, 2000).mbps, 1);
  assert.equal(tracker.rates('p:screen@a', nextPc, b, 3000).mbps, null);
  assert.equal(tracker.rates('p:screen@a', pc, { ...b, rtpIds: 'new' }, 4000).mbps, null);
  tracker.clear();
  assert.equal(tracker.rates('p:screen@a', pc, b, 5000).mbps, null);
});
