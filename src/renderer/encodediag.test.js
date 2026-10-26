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
const CTX = {
  software: true, targetBitrate: 2_500_000, scaleDownBy: 1.5, resolutionHeight: 720, bweBps: 2_000_000,
  steps: { global: 2, peer: 0 },
};

test('encoder generico nao prova hardware; eficiencia e taxa ausentes nao inventam dados', () => {
  const s = line({ ...ROW, encoder: 'ExternalEncoder', powerEfficient: null, mbps: null },
    { ...CTX, software: false });
  assert.match(s, /enc=ExternalEncoder desconhecido/);
  assert.match(s, /efic=\?/);
  assert.match(s, /realKbps=\?/);
  assert.equal(require('./encodehealth').encoderType('NvCodecH264Encoder'), 'hardware');
  assert.equal(require('./encodehealth').encoderType('ExternalEncoder'), 'unknown');
});

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
  assert.match(s, /alvoKbps=2500 escala=1\.5 res=720 bwe=2000 realKbps=1800/);
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

test('line: encoder ausente fica desconhecido, com alvo e escala por peer', () => {
  const s = line(
    { ...ROW, encoder: '', powerEfficient: true },
    { software: false, targetBitrate: 2_500_000, scaleDownBy: 2, steps: {} }
  );
  assert.match(s, /enc=desconhecido desconhecido efic=sim/);
  assert.match(s, /alvoKbps=2500/);
  assert.match(s, /escala=2/);
});

// --- Log de 2026-09-05: "tela->gg" nao dizia se gg via a captura direta ou
// um repasse (F2) -- nem de QUEM era a tela repassada. Pra depurar a falha
// de negociacao de saida foi preciso cruzar 3 arquivos de log de 2 maquinas
// so pra descobrir que "screen" ali era, na verdade, "screen@4": um repasse.
// ctx.relayOf carrega esse sourceId (parseKind ja faz esse trabalho em
// app.js) -- ausente/null pro caso comum, captura direta.
test('line: sender direto nao ganha marca de repasse', () => {
  const s = line(ROW, CTX);
  assert.doesNotMatch(s, /repasse/);
});

test('line: repasse marca de quem e a tela original', () => {
  const s = line(ROW, { ...CTX, relayOf: '4' });
  assert.match(s, /tela->Nubanho \(repasse de #4\)/);
});

// --- Escada por congestao (plano 2026-10-25, Tarefa 3): o log de 18/10 nao
// dizia por que a BWE caiu nem por que o degrau mudou. Os campos novos vao
// no FIM da linha, para nao mexer no que os trechos acima conferem.
test('line: perda, rtt, uso e motivo no fim da linha', () => {
  const s = line(ROW, { ...CTX, changed: true, perda: 0.012, rttMs: 41.6, uso: 0.9, motivo: 'bwe 1500 kbps' });
  assert.match(s, /degraus=g2\/p0 perda=1\.2% rtt=42ms uso=90% motivo="bwe 1500 kbps"$/);
});

test('line: perda, rtt e uso ausentes viram ?, nunca NaN; sem MUDOU nao ha motivo', () => {
  const s = line(ROW, { ...CTX, perda: null, rttMs: undefined, uso: null, motivo: 'velho' });
  assert.match(s, /perda=\?% rtt=\?ms uso=\?%$/);
  assert.doesNotMatch(s, /NaN|motivo/);
});

test('signature ignora perda, rtt, uso e motivo', () => {
  assert.equal(signature(ROW, { ...CTX, perda: 0.5, rttMs: 900, uso: 1, motivo: 'x' }), signature(ROW, CTX));
});
