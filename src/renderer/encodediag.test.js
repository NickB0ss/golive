'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { signature, shouldLog, line, HEARTBEAT_MS } = require('./encodediag');

const ROW = {
  name: 'Nubanho',
  encoder: 'OpenH264',
  powerEfficient: false,
  limitation: '',
  captureFps: 60,
  width: 1280,
  height: 720,
  fps: 24,
  mbps: 1.8,
  msPerFrame: 41.3,
};
const CTX = { software: true, targetBitrate: 2_500_000, steps: { global: 2, peer: 0 } };

test('signature ignora numeros, reage a campos categoricos', () => {
  const base = signature(ROW, CTX);
  assert.equal(signature({ ...ROW, fps: 59, mbps: 9.9, msPerFrame: 4 }, CTX), base); // numeros nao contam
  assert.notEqual(signature({ ...ROW, encoder: 'NvCodecH264Encoder' }, { ...CTX, software: false }), base);
  assert.notEqual(signature(ROW, { ...CTX, steps: { global: 1, peer: 0 } }), base);
  assert.notEqual(signature({ ...ROW, limitation: 'cpu' }, CTX), base);
});

test('shouldLog: primeira vez sempre', () => {
  assert.equal(shouldLog(null, 'x', 1000), true);
});

test('shouldLog: mesma assinatura dentro do heartbeat = nao', () => {
  assert.equal(shouldLog({ sig: 'x', atMs: 0 }, 'x', HEARTBEAT_MS - 1), false);
});

test('shouldLog: mesma assinatura, heartbeat vencido = sim', () => {
  assert.equal(shouldLog({ sig: 'x', atMs: 0 }, 'x', HEARTBEAT_MS), true);
});

test('shouldLog: assinatura mudou = sim, na hora', () => {
  assert.equal(shouldLog({ sig: 'x', atMs: 0 }, 'y', 10), true);
});

test('line: NVENC caiu pra OpenH264 aparece legivel', () => {
  const s = line(ROW, { ...CTX, changed: true });
  assert.match(s, /^\[diag\] MUDOU tela->Nubanho/);
  assert.match(s, /enc=OpenH264 SOFTWARE\(CPU\)/);
  assert.match(s, /efic=nao/);
  assert.match(s, /cap=60fps out=1280x720@24fps/);
  assert.match(s, /limite=nenhum/);
  assert.match(s, /alvoKbps=2500 realKbps=1800/);
  assert.match(s, /msFrame=41\.3/);
  assert.match(s, /degraus=g2\/p0/);
});

test('line: hardware sem msPerFrame nem changed', () => {
  const s = line(
    { ...ROW, encoder: 'NvCodecH264Encoder', powerEfficient: true, msPerFrame: null, fps: 60 },
    { software: false, targetBitrate: 12_000_000, steps: {} }
  );
  assert.match(s, /enc=NvCodecH264Encoder hardware efic=sim/);
  assert.match(s, /msFrame=-/);
  assert.match(s, /degraus=g0\/p0/);
  assert.doesNotMatch(s, /MUDOU/);
});
