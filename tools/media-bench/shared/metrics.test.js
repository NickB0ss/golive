'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('./metrics');

// --- fixtures de getStats -------------------------------------------------

function senderReport(over = {}, { impl = 'OpenH264', withImpl = true } = {}) {
  return [
    { id: 'OT1', type: 'outbound-rtp', kind: 'video', ssrc: 1, codecId: 'C1', transportId: 'T1', mediaSourceId: 'S1',
      framesEncoded: 100, framesSent: 100, bytesSent: 1_000_000, totalEncodeTime: 0.5, frameWidth: 1280, frameHeight: 720,
      keyFramesEncoded: 1, nackCount: 0, pliCount: 0, ...(withImpl ? { encoderImplementation: impl, powerEfficientEncoder: false } : {}),
      ...over },
    { id: 'C1', type: 'codec', mimeType: 'video/H264' },
    { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
    { id: 'P1', type: 'candidate-pair', localCandidateId: 'L1', remoteCandidateId: 'RC1', currentRoundTripTime: 0.002 },
    { id: 'L1', type: 'local-candidate', candidateType: 'host', protocol: 'udp' },
    { id: 'RC1', type: 'remote-candidate', candidateType: 'host' },
  ];
}

function receiverReport(over = {}) {
  return [
    { id: 'IT1', type: 'inbound-rtp', kind: 'video', ssrc: 2, codecId: 'C2', transportId: 'T2',
      framesDecoded: 100, framesReceived: 100, framesDropped: 0, bytesReceived: 1_000_000, packetsReceived: 900, packetsLost: 0,
      freezeCount: 0, totalDecodeTime: 0.1, jitterBufferDelay: 2, jitterBufferEmittedCount: 100, jitter: 0.004,
      frameWidth: 1280, frameHeight: 720, decoderImplementation: 'ExternalDecoder', powerEfficientDecoder: true, ...over },
    { id: 'C2', type: 'codec', mimeType: 'video/H264' },
  ];
}

const S = (over, opts) => m.readSender(senderReport(over, opts));
const R = (over) => m.readReceiver(receiverReport(over));

// --- leitura -------------------------------------------------------------

test('readSender: campos de producao + extras; candidatos host provam ausencia de STUN', () => {
  const s = S();
  assert.equal(s.framesEncoded, 100);
  assert.equal(s.codec, 'H264');
  assert.equal(s.encoder, 'OpenH264');
  assert.equal(s.keyFramesEncoded, 1);
  assert.deepEqual(s.candidates, { local: 'host', remote: 'host', protocol: 'udp' });
  assert.equal(s.rtt, 2);
});

test('readSender: implementacao ausente (sem captura ativa) e null, nunca string vazia', () => {
  const s = S({}, { withImpl: false });
  assert.equal(s.encoder, null);
  assert.equal(s.powerEfficient, null);
});

test('readReceiver: tempo de decode, jitter em ms e powerEfficientDecoder', () => {
  const r = R();
  assert.equal(r.totalDecodeTime, 0.1);
  assert.equal(r.jitterMs, 4);
  assert.equal(r.powerEfficientDecoder, true);
  assert.equal(r.decoder, 'ExternalDecoder');
});

test('relatorio vazio ou ausente nao lanca e nao inventa zero', () => {
  assert.equal(m.readSender([]).fps, null);
  assert.equal(m.readReceiver(undefined).framesDecoded, null);
  assert.deepEqual(m.selectedCandidateTypes([]), { local: null, remote: null, protocol: null });
});

test('aceita Map/RTCStatsReport (forEach)', () => {
  const map = new Map(senderReport().map((s) => [s.id, s]));
  assert.equal(m.readSender(map).framesEncoded, 100);
});

// --- janelas -------------------------------------------------------------

test('senderWindow: fps, ms/quadro e Mbps de delta, nao de media desde o inicio', () => {
  const prev = S({ framesEncoded: 100, framesSent: 100, bytesSent: 1_000_000, totalEncodeTime: 0.5 });
  const cur = S({ framesEncoded: 160, framesSent: 158, bytesSent: 1_750_000, totalEncodeTime: 0.62 });
  const w = m.senderWindow(cur, prev, 1000);
  assert.equal(w.encodedFps, 60);
  assert.equal(w.sentFps, 58);
  assert.ok(Math.abs(w.msPerFrame - 2) < 1e-9); // 0,12 s / 60 quadros
  assert.ok(Math.abs(w.mbps - 6) < 1e-9);        // 750 kB em 1 s
});

test('senderWindow: contador que anda pra tras (reinicio) vira null, nunca zero', () => {
  const prev = S({ framesEncoded: 500, bytesSent: 9_000_000 });
  const cur = S({ framesEncoded: 20, bytesSent: 100_000 });
  assert.deepEqual(m.senderWindow(cur, prev, 1000), { encodedFps: null, sentFps: null, msPerFrame: null, mbps: null });
});

test('senderWindow: outro conjunto de RTP, dt invalido ou amostra ausente => null', () => {
  const a = S();
  const b = S({ id: 'OT9', ssrc: 9 });
  const nulo = { encodedFps: null, sentFps: null, msPerFrame: null, mbps: null };
  assert.deepEqual(m.senderWindow(b, a, 1000), nulo);
  assert.deepEqual(m.senderWindow(a, a, 0), nulo);
  assert.deepEqual(m.senderWindow(a, a, NaN), nulo);
  assert.deepEqual(m.senderWindow(a, null, 1000), nulo);
});

test('senderWindow: zero quadros novos da fps 0 mas ms/quadro null (nao divide por zero)', () => {
  const a = S();
  const w = m.senderWindow(S(), a, 1000);
  assert.equal(w.encodedFps, 0);
  assert.equal(w.msPerFrame, null);
});

test('receiverWindow: fps decodificado, ms de decode, buffer recente, congelamentos', () => {
  const prev = R({ framesDecoded: 100, totalDecodeTime: 0.1, bytesReceived: 1_000_000, jitterBufferDelay: 2, jitterBufferEmittedCount: 100,
    packetsReceived: 900, freezeCount: 0 });
  const cur = R({ framesDecoded: 130, totalDecodeTime: 0.13, bytesReceived: 1_375_000, jitterBufferDelay: 2.6, jitterBufferEmittedCount: 130,
    packetsReceived: 1000, freezeCount: 1 });
  const w = m.receiverWindow(cur, prev, 1000);
  assert.equal(w.decodedFps, 30);
  assert.ok(Math.abs(w.decodeMsPerFrame - 1) < 1e-9);
  assert.ok(Math.abs(w.bufferMs - 20) < 1e-9); // 0,6 s / 30 quadros
  assert.ok(Math.abs(w.mbps - 3) < 1e-9);
  assert.equal(w.freezes, 1);
  assert.equal(w.dropped, 0);
});

test('receiverWindow: regressao de contador => tudo null', () => {
  const prev = R({ framesDecoded: 400 });
  const cur = R({ framesDecoded: 10 });
  const w = m.receiverWindow(cur, prev, 1000);
  assert.ok(Object.values(w).every((v) => v === null));
});

// --- estatistica e resumo --------------------------------------------------

test('stat ignora null/NaN e serie vazia e null', () => {
  assert.deepEqual(m.stat([]), { n: 0, min: null, median: null, mean: null, p95: null, max: null });
  assert.deepEqual(m.stat([null, NaN, undefined]).n, 0);
  const s = m.stat([30, null, 10, 20, 40]);
  assert.equal(s.n, 4);
  assert.equal(s.median, 25);
  assert.equal(s.min, 10);
  assert.equal(s.max, 40);
  assert.equal(s.mean, 25);
});

function nodeOf(kind, role, label, reports, stepMs = 1000) {
  const read = kind === 'sender' ? m.readSender : m.readReceiver;
  return { kind, role, label, samples: reports.map((r, i) => ({ atMs: i * stepMs, sample: read(r) })) };
}

test('summarizeNode (sender): janelas, totais e implementacao', () => {
  const reports = [0, 1, 2, 3].map((i) => senderReport({
    framesEncoded: 100 + 30 * i, framesSent: 100 + 30 * i, bytesSent: 1_000_000 + 400_000 * i, totalEncodeTime: 0.5 + 0.06 * i,
  }));
  const n = m.summarizeNode(nodeOf('sender', 'origin-sender', 'o1', reports));
  assert.equal(n.windows, 3);
  assert.equal(n.fps.median, 30);
  assert.ok(Math.abs(n.msPerFrame.median - 2) < 1e-9);
  assert.equal(n.framesEncodedTotal, 90);
  assert.deepEqual(n.encoders, ['OpenH264']);
  assert.equal(n.codec, 'H264');
  assert.equal(n.width, 1280);
});

test('summarizeNode: uma amostra so nao tem janela, e nada vira zero', () => {
  const n = m.summarizeNode(nodeOf('sender', 'origin-sender', 'o1', [senderReport()]));
  assert.equal(n.windows, 0);
  assert.equal(n.fps.median, null);
  assert.equal(n.framesEncodedTotal, null);
});

test('summarizeNode: reinicio no meio descarta so a janela afetada', () => {
  const reports = [
    senderReport({ framesEncoded: 100, bytesSent: 1_000_000, totalEncodeTime: 0.5 }),
    senderReport({ framesEncoded: 130, bytesSent: 1_100_000, totalEncodeTime: 0.56 }),
    senderReport({ framesEncoded: 5, bytesSent: 10_000, totalEncodeTime: 0.01 }),
    senderReport({ framesEncoded: 35, bytesSent: 110_000, totalEncodeTime: 0.07 }),
  ];
  const n = m.summarizeNode(nodeOf('sender', 'origin-sender', 'o1', reports));
  assert.equal(n.fps.n, 2, 'a janela do reinicio nao entra');
  assert.equal(n.fps.median, 30);
  assert.equal(n.framesEncodedTotal, null, 'total com regressao e desconhecido, nao 0');
});

test('summarizeRoles agrupa por papel e soma Mbps so se todos tem dado', () => {
  const mk = (label, i) => m.summarizeNode(nodeOf('sender', 'origin-sender', label, [0, 1, 2].map((k) => senderReport({
    framesEncoded: 100 + 30 * k, framesSent: 100 + 30 * k, bytesSent: 1_000_000 + 500_000 * k * (i + 1), totalEncodeTime: 0.5 + 0.06 * k,
  }))));
  const roles = m.summarizeRoles([mk('a', 0), mk('b', 1)]);
  assert.equal(roles['origin-sender'].count, 2);
  assert.equal(roles['origin-sender'].fpsMedian, 30);
  assert.ok(Math.abs(roles['origin-sender'].mbpsMeanTotal - (4 + 8)) < 1e-9);
  assert.deepEqual(roles['origin-sender'].codecs, ['H264']);
});

// --- veredito -------------------------------------------------------------

test('evaluateScenario: viewer sem quadros reprova; sem encoder e so aviso', () => {
  const send = m.summarizeNode(nodeOf('sender', 'origin-sender', 'o1', [0, 1, 2].map((i) => senderReport({
    framesEncoded: 100 + 30 * i, bytesSent: 1_000_000 + 400_000 * i, totalEncodeTime: 0.5 + 0.06 * i,
  }, { withImpl: false }))));
  const mudo = m.summarizeNode(nodeOf('receiver', 'viewer-receiver', 'v1', [0, 1, 2].map(() => receiverReport())));
  const r = m.evaluateScenario([send, mudo], { codec: 'h264' });
  assert.deepEqual(r.problems, ['sem quadros decodificados em v1']);
  assert.ok(r.notes.some((n) => /desconhecidos/.test(n)));
});

test('evaluateScenario: codec diferente e candidato srflx viram aviso, sem reprovar', () => {
  const rep = [0, 1].map((i) => senderReport({ framesEncoded: 100 + 30 * i, bytesSent: 1_000_000 + 400_000 * i }));
  rep[1].find((s) => s.type === 'codec').mimeType = 'video/VP8';
  rep[1].find((s) => s.id === 'L1').candidateType = 'srflx';
  const n = m.summarizeNode(nodeOf('sender', 'origin-sender', 'o1', rep));
  const r = m.evaluateScenario([n], { codec: 'h264' });
  assert.deepEqual(r.problems, []);
  assert.ok(r.notes.some((x) => /codec negociado/.test(x)));
  assert.ok(r.notes.some((x) => /nao e host/.test(x)));
});

test('compareSource: igual dentro da tolerancia nao avisa; diferenca avisa (com motivo do limite)', () => {
  const cfg = { width: 1280, height: 720, fps: 30 };
  assert.deepEqual(m.compareSource(cfg, { width: 1281, height: 720, frameRate: 30 }, { clamped: false }), []);
  const n = m.compareSource(cfg, { width: 960, height: 540, frameRate: 60 }, { clamped: true });
  assert.equal(n.length, 2);
  assert.match(n[0], /960x540 difere da pedida 1280x720.*area de trabalho/);
  assert.match(n[1], /fps medido da fonte 60 difere do pedido 30/);
  assert.match(m.compareSource(cfg, {}, null)[0], /nao medida/);
});

test('totalDelta: primeira amostra sem o contador (recepcao ainda subindo) nao zera o total', () => {
  const s = (v) => ({ framesDecoded: v });
  // Medido em 08/10/2026 no relay com 4 viewers: [null, 8, 37, 68].
  assert.equal(m.totalDelta([s(null), s(8), s(37), s(68)], 'framesDecoded'), 60);
  assert.equal(m.totalDelta([s(10), s(40), s(null)], 'framesDecoded'), 30, 'ultima ausente usa a ultima medida');
  assert.equal(m.totalDelta([s(null), s(8)], 'framesDecoded'), null, 'um valor so nao mede intervalo');
  assert.equal(m.totalDelta([s(null), s(null)], 'framesDecoded'), null);
  assert.equal(m.totalDelta([s(50), s(10)], 'framesDecoded'), null, 'contador que regride continua invalido');
});
