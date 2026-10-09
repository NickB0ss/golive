'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateScenario: evaluateWith } = require('./evaluate');

const CLIENT_VERSION = '3.24.4';
const evaluateScenario = (cfg, raw, close) => evaluateWith(cfg, raw, close, { expectedClientVersion: CLIENT_VERSION });

const H264 = { mimeType: 'video/H264', payloadType: 108, sdpFmtpLine: 'packetization-mode=1' };
const H264_RX = { mimeType: 'video/H264', payloadType: 100, sdpFmtpLine: 'packetization-mode=1' };

function cfgFor(consumers, extra) {
  return { consumers, width: 640, height: 360, fps: 30, bitrateKbps: 1200, warmupMs: 0, durationMs: 5000, sampleMs: 500, codec: 'h264', listenIp: '127.0.0.1', ...extra };
}

function snapshot(at, consumerIds, packets, counts) {
  return {
    at,
    listen: { ip: '127.0.0.1', protocol: 'udp', tcp: false },
    counts,
    producer: { id: 'prod', codec: { mimeType: 'video/H264' }, stats: [{ type: 'inbound-rtp', packetCount: packets, byteCount: packets * 1000 }] },
    consumers: consumerIds.map((peerId) => ({ id: `c-${peerId}`, peerId, type: 'simple', stats: [{ type: 'outbound-rtp', packetCount: packets, byteCount: packets * 1000 }] })),
    workerResourceUsage: { ru_utime: at / 100, ru_stime: 0 },
  };
}

/** Resultado bruto "perfeito" de flow.runScenario para N consumidores (com fechamento no meio se N >= 2). */
function goodRaw(n, mutate) {
  const peers = Array.from({ length: n }, (_, i) => `peer${i}`);
  const steps = [];
  for (let i = 0; i < n; i += 1) {
    steps.push({ step: 'server-consume', index: i, paused: true }, { step: 'client-consume', index: i }, { step: 'server-resume', index: i });
  }
  const samples = [];
  const total = 11; // 0..5000 ms de 500 em 500
  const closeAt = n >= 2 ? 5 : null;
  for (let k = 0; k < total; k += 1) {
    samples.push({
      t: 1000 + k * 500,
      sender: { v: { framesEncoded: k * 15, framesSent: k * 15, packetsSent: k * 60, bytesSent: k * 60000, keyFramesEncoded: 1, nackCount: 0, pliCount: 0 }, streams: 1, ssrcs: [1], frameWidth: 640, frameHeight: 360, codec: H264, encoderImplementation: null, qualityLimitationReason: 'none' },
      consumers: peers.map((_, i) => {
        if (closeAt !== null && i === 1 && k > closeAt) return null;
        return { v: { framesReceived: k * 15, framesDecoded: k * 15, framesDropped: 0, packetsReceived: k * 60, packetsLost: 0, bytesReceived: k * 60000, keyFramesDecoded: 1, freezeCount: 0 }, frameWidth: 640, frameHeight: 360, codec: H264_RX, decoderImplementation: null, jitter: 0.001 };
      }),
    });
  }
  const live = n >= 2 ? [peers[0], ...peers.slice(2)] : peers;
  const raw = {
    steps,
    cleanupErrors: [],
    device: { handlerName: 'Chrome111', clientVersion: CLIENT_VERSION },
    clientIce: [
      { label: 'envio', state: 'succeeded', local: { address: '127.0.0.1', port: 42250, protocol: 'udp', candidateType: 'host' }, remote: { address: '127.0.0.1', port: 42010, protocol: 'udp', candidateType: 'host' } },
      ...Array.from({ length: n >= 2 ? n - 1 : n }, (_, i) => ({ label: `recepcao ${i}`, state: 'succeeded', local: { address: '127.0.0.1', port: 42251 + i, protocol: 'udp', candidateType: 'host' }, remote: { address: '127.0.0.1', port: 42020 + i, protocol: 'udp', candidateType: 'host' } })),
    ],
    candidates: Array.from({ length: n + 1 }, () => ({ ip: '127.0.0.1', port: 42000, protocol: 'udp', type: 'host' })),
    codec: { requested: 'video/H264', selected: { mimeType: 'video/H264' }, fellBack: false, reason: null },
    producer: { id: 'prod', produceEvents: 1, rtpSenders: 1, encodings: 1, rtpParametersCodec: { mimeType: 'video/H264', payloadType: 108 } },
    consumers: peers.map((peerId, i) => ({ index: i, peerId, rtpParametersCodec: { mimeType: 'video/H264' } })),
    samples,
    midClose: n >= 2 ? { requested: true, executed: true, index: 1, atSample: closeAt, tMs: 2500 } : { requested: false, executed: false },
    server: {
      start: snapshot(1000, peers, 0, { peers: n + 1, transports: n + 1, producers: 1, consumers: n }),
      afterMidClose: n >= 2 ? snapshot(3500, live, 300, { peers: n, transports: n, producers: 1, consumers: n - 1 }) : null,
      end: snapshot(6000, live, 600, { peers: live.length + 1, transports: live.length + 1, producers: 1, consumers: live.length }),
    },
  };
  if (mutate) mutate(raw);
  return raw;
}

const goodClose = () => ({
  shutdown: { workerPid: 99, died: false, diedError: null, subprocessClosed: true, timedOut: false, forcedKill: false, ports: [42000, 42001] },
  verify: { workerPid: 99, workerAlive: false, ports: [{ port: 42000, free: true }, { port: 42001, free: true }], allFree: true },
  clientRange: { min: 42200, max: 42399, busyBefore: [], verify: { workerPid: null, workerAlive: false, ports: [{ port: 42250, free: true }, { port: 42251, free: true }], allFree: true } },
});

const byId = (ev, id) => ev.checks.find((c) => c.id === id);

test('cenario perfeito com 4 consumidores: tudo passa, mid-close passa', () => {
  const ev = evaluateScenario(cfgFor(4), goodRaw(4), goodClose());
  assert.equal(ev.status, 'ok', JSON.stringify(ev.checks.filter((c) => c.status !== 'passed')));
  for (const c of ev.checks) assert.equal(c.status, 'passed', `${c.id}: ${c.detail}`);
  assert.equal(ev.midClose.closedIndex, 1);
  assert.equal(ev.midClose.survivors.length, 3);
  assert.equal(ev.forwarding.consumers.length, 3);
  assert.equal(ev.forwarding.consumers[0].ratio, 1);
  assert.equal(ev.codec.realSender.mimeType, 'video/H264');
});

test('com 1 consumidor o fechamento no meio e not-applicable (com motivo), nunca passed', () => {
  const ev = evaluateScenario(cfgFor(1), goodRaw(1), goodClose());
  const mid = byId(ev, 'mid-close');
  assert.equal(mid.status, 'not-applicable');
  assert.match(mid.detail, /2 ou mais/);
  assert.equal(ev.status, 'ok');
});

test('fechamento no meio nao executado com N>=2 reprova', () => {
  const ev = evaluateScenario(cfgFor(4), goodRaw(4, (r) => { r.midClose = { requested: true, executed: false }; }), goodClose());
  assert.equal(byId(ev, 'mid-close').status, 'failed');
  assert.equal(ev.status, 'failed');
});

test('sobrevivente que para de receber depois do fechamento reprova', () => {
  const raw = goodRaw(4, (r) => {
    for (let k = 6; k < r.samples.length; k += 1) {
      const frozen = r.samples[5].consumers[0].v;
      r.samples[k].consumers[0] = { ...r.samples[k].consumers[0], v: { ...frozen } };
    }
  });
  const ev = evaluateScenario(cfgFor(4), raw, goodClose());
  assert.equal(byId(ev, 'mid-close').status, 'failed');
  assert.match(byId(ev, 'mid-close').detail, /consumidor 0/);
});

test('servidor que nao liberou o consumer fechado reprova', () => {
  const raw = goodRaw(4, (r) => { r.server.afterMidClose.counts = { ...r.server.start.counts }; });
  const ev = evaluateScenario(cfgFor(4), raw, goodClose());
  assert.equal(byId(ev, 'mid-close').status, 'failed');
});

test('consumidor sem quadros reprova frames-flow', () => {
  const raw = goodRaw(2, (r) => { for (const s of r.samples) s.consumers[0].v.framesDecoded = 0; });
  const ev = evaluateScenario(cfgFor(2), raw, goodClose());
  assert.equal(byId(ev, 'frames-flow').status, 'failed');
});

test('codec: fallback explicito para VP8 vira warning; divergencia entre pontas reprova', () => {
  const vp8 = { mimeType: 'video/VP8', payloadType: 96 };
  const fell = goodRaw(1, (r) => {
    r.codec = { requested: 'video/H264', selected: { mimeType: 'video/VP8' }, fellBack: true, reason: 'H.264 ausente' };
    r.producer.rtpParametersCodec = vp8;
    r.server.end.producer.codec = vp8;
    r.consumers[0].rtpParametersCodec = vp8;
    for (const s of r.samples) { s.sender.codec = vp8; s.consumers[0].codec = vp8; }
  });
  const ev = evaluateScenario(cfgFor(1), fell, goodClose());
  assert.equal(byId(ev, 'codec').status, 'warning');
  assert.match(byId(ev, 'codec').detail, /fallback explicito/);
  assert.equal(ev.status, 'warning');

  const mismatch = goodRaw(1, (r) => { r.server.end.producer.codec = vp8; });
  assert.equal(byId(evaluateScenario(cfgFor(1), mismatch, goodClose()), 'codec').status, 'failed');

  const silent = goodRaw(1, (r) => {
    r.codec = { requested: 'video/H264', selected: { mimeType: 'video/VP8' }, fellBack: false, reason: null };
    r.producer.rtpParametersCodec = vp8; r.server.end.producer.codec = vp8; r.consumers[0].rtpParametersCodec = vp8;
    for (const s of r.samples) { s.sender.codec = vp8; s.consumers[0].codec = vp8; }
  });
  const ev2 = evaluateScenario(cfgFor(1), silent, goodClose());
  assert.equal(byId(ev2, 'codec').status, 'failed', 'troca para VP8 sem fallback registrado nao pode passar');
});

test('codec desconhecido (sem stats nem rtpParameters) reprova em vez de passar', () => {
  const raw = goodRaw(1, (r) => {
    r.producer.rtpParametersCodec = null; r.server.end.producer.codec = null; r.consumers[0].rtpParametersCodec = null;
    for (const s of r.samples) { s.sender.codec = null; s.consumers[0].codec = null; }
  });
  assert.equal(byId(evaluateScenario(cfgFor(1), raw, goodClose()), 'codec').status, 'failed');
});

test('encoder ausente nos stats vira nota de DESCONHECIDO, nunca software/hardware', () => {
  const ev = evaluateScenario(cfgFor(1), goodRaw(1), goodClose());
  assert.ok(ev.notes.some((n) => /DESCONHECIDO/.test(n)));
  assert.equal(ev.sender.encoderImplementation, null);
});

test('mais de um envio ou stream RTP reprova single-send', () => {
  const two = goodRaw(1, (r) => { r.producer.produceEvents = 2; });
  assert.equal(byId(evaluateScenario(cfgFor(1), two, goodClose()), 'single-send').status, 'failed');
  const sim = goodRaw(1, (r) => { for (const s of r.samples) s.sender.streams = 3; });
  assert.equal(byId(evaluateScenario(cfgFor(1), sim, goodClose()), 'single-send').status, 'failed');
});

test('consumer criado sem paused:true, ou resumido antes do consume do cliente, reprova', () => {
  const unpaused = goodRaw(1, (r) => { r.steps[0].paused = false; });
  assert.equal(byId(evaluateScenario(cfgFor(1), unpaused, goodClose()), 'consumers-paused-then-resumed').status, 'failed');
  const early = goodRaw(1, (r) => { r.steps = [r.steps[0], r.steps[2], r.steps[1]]; });
  assert.equal(byId(evaluateScenario(cfgFor(1), early, goodClose()), 'consumers-paused-then-resumed').status, 'failed');
  const fewer = goodRaw(2, (r) => { r.consumers.pop(); });
  assert.equal(byId(evaluateScenario(cfgFor(2), fewer, goodClose()), 'consumers-paused-then-resumed').status, 'failed');
});

test('candidato fora do loopback ou TCP reprova listen-loopback', () => {
  const lan = goodRaw(1, (r) => { r.candidates.push({ ip: '192.168.0.5', port: 1, protocol: 'udp' }); });
  assert.equal(byId(evaluateScenario(cfgFor(1), lan, goodClose()), 'listen-loopback').status, 'failed');
  const tcp = goodRaw(1, (r) => { r.candidates[0].protocol = 'tcp'; });
  assert.equal(byId(evaluateScenario(cfgFor(1), tcp, goodClose()), 'listen-loopback').status, 'failed');
  const none = goodRaw(1, (r) => { r.candidates = []; });
  assert.equal(byId(evaluateScenario(cfgFor(1), none, goodClose()), 'listen-loopback').status, 'failed');
});

test('encaminhamento: consumer recebendo menos que o producer, ou producer parado, reprova', () => {
  const half = goodRaw(1, (r) => { r.server.end.consumers[0].stats[0].packetCount = 300; });
  assert.equal(byId(evaluateScenario(cfgFor(1), half, goodClose()), 'server-forwarding').status, 'failed');
  const stalled = goodRaw(1, (r) => { r.server.end.producer.stats[0].packetCount = 0; });
  assert.equal(byId(evaluateScenario(cfgFor(1), stalled, goodClose()), 'server-forwarding').status, 'failed');
  const none = goodRaw(1, (r) => { r.server.end = null; });
  assert.equal(byId(evaluateScenario(cfgFor(1), none, goodClose()), 'server-forwarding').status, 'failed');
});

test('limpeza do servidor: cada defeito reprova server-cleanup', () => {
  const run = (fn) => {
    const close = goodClose();
    fn(close);
    return byId(evaluateScenario(cfgFor(1), goodRaw(1), close), 'server-cleanup');
  };
  assert.equal(run(() => {}).status, 'passed');
  assert.equal(run((c) => { c.shutdown.subprocessClosed = false; }).status, 'failed');
  assert.equal(run((c) => { c.shutdown.timedOut = true; c.shutdown.forcedKill = true; }).status, 'failed');
  assert.equal(run((c) => { c.shutdown.died = true; c.shutdown.diedError = 'x'; }).status, 'failed');
  assert.equal(run((c) => { c.verify.workerAlive = true; }).status, 'failed');
  assert.equal(run((c) => { c.verify.ports[0].free = false; }).status, 'failed');
  assert.equal(run((c) => { c.verify.ports = []; }).status, 'failed');
  const missing = byId(evaluateScenario(cfgFor(1), goodRaw(1), null), 'server-cleanup');
  assert.equal(missing.status, 'failed');
});

test('erro de execucao ou erro de limpeza do cliente reprovam o cenario', () => {
  const err = evaluateScenario(cfgFor(1), goodRaw(1, (r) => { r.error = 'produce excedeu 15000 ms'; }), goodClose());
  assert.equal(byId(err, 'run').status, 'failed');
  assert.equal(err.status, 'failed');
  const dirty = evaluateScenario(cfgFor(1), goodRaw(1, (r) => { r.cleanupErrors = ['x: falhou']; }), goodClose());
  assert.equal(byId(dirty, 'client-cleanup').status, 'failed');
});

test('resultado vazio (sem amostras) nunca passa', () => {
  const ev = evaluateScenario(cfgFor(1), { steps: [], samples: [], error: 'sem dados', cleanupErrors: [] }, goodClose());
  assert.equal(ev.status, 'failed');
  assert.equal(byId(ev, 'frames-flow').status, 'failed');
  assert.equal(byId(ev, 'codec').status, 'failed');
  assert.equal(byId(ev, 'single-send').status, 'failed');
});

test('par selecionado do cliente: remoto fora do loopback, socket fora da faixa ou par ausente reprovam', () => {
  const lan = goodRaw(1, (r) => { r.clientIce[0].remote.address = '192.168.0.5'; });
  assert.equal(byId(evaluateScenario(cfgFor(1), lan, goodClose()), 'client-ice-pair').status, 'failed');
  const fora = goodRaw(1, (r) => { r.clientIce[0].local.port = 50000; });
  const ev = evaluateScenario(cfgFor(1), fora, goodClose());
  assert.equal(byId(ev, 'client-ice-pair').status, 'failed');
  assert.match(byId(ev, 'client-ice-pair').detail, /fora da faixa/);
  const semPar = goodRaw(1, (r) => { r.clientIce = [{ label: 'envio', error: 'nenhum par' }]; });
  assert.equal(byId(evaluateScenario(cfgFor(1), semPar, goodClose()), 'client-ice-pair').status, 'failed');
  const faltando = goodRaw(4, (r) => { r.clientIce.pop(); });
  assert.equal(byId(evaluateScenario(cfgFor(4), faltando, goodClose()), 'client-ice-pair').status, 'failed');
});

test('porta da faixa do cliente ainda ocupada ao fim reprova; ocupada antes por terceiro e ignorada', () => {
  const vazou = goodClose();
  vazou.clientRange.verify.ports[0].free = false;
  const ev = evaluateScenario(cfgFor(1), goodRaw(1), vazou);
  assert.equal(byId(ev, 'client-udp-range').status, 'failed');
  assert.match(byId(ev, 'client-udp-range').detail, /42250/);
  const terceiro = goodClose();
  terceiro.clientRange.verify.ports[0].free = false;
  terceiro.clientRange.busyBefore = [42250];
  assert.equal(byId(evaluateScenario(cfgFor(1), goodRaw(1), terceiro), 'client-udp-range').status, 'passed');
  const sem = goodClose();
  delete sem.clientRange;
  assert.equal(byId(evaluateScenario(cfgFor(1), goodRaw(1), sem), 'client-udp-range').status, 'failed');
});

test('versao do mediasoup-client em execucao diferente do pacote (ou ausente) reprova', () => {
  const velha = goodRaw(1, (r) => { r.device.clientVersion = '3.24.3'; });
  const ev = evaluateScenario(cfgFor(1), velha, goodClose());
  assert.equal(byId(ev, 'client-version').status, 'failed');
  assert.match(byId(ev, 'client-version').detail, /npm run bundle/);
  assert.equal(byId(evaluateScenario(cfgFor(1), goodRaw(1, (r) => { r.device = {}; }), goodClose()), 'client-version').status, 'failed');
  assert.equal(byId(evaluateWith(cfgFor(1), goodRaw(1), goodClose(), {}), 'client-version').status, 'failed');
});

test('janela pos-fechamento comeca depois da amostra do fechamento e sobrevivente que congela reprova', () => {
  // frames so "andam" ate a amostra do fechamento (5): nada chega depois dela
  const parado = goodRaw(4, (r) => {
    const base = r.samples[5].consumers[0].v;
    for (let k = 6; k < r.samples.length; k += 1) r.samples[k].consumers[0] = { ...r.samples[k].consumers[0], v: { ...base } };
  });
  assert.equal(byId(evaluateScenario(cfgFor(4), parado, goodClose()), 'mid-close').status, 'failed');
  const congelou = goodRaw(4, (r) => { r.samples[r.samples.length - 1].consumers[2].v.freezeCount = 1; });
  const ev = evaluateScenario(cfgFor(4), congelou, goodClose());
  assert.equal(byId(ev, 'mid-close').status, 'failed');
  assert.match(byId(ev, 'mid-close').detail, /congelou/);
  const ok = evaluateScenario(cfgFor(4), goodRaw(4), goodClose());
  assert.equal(ok.midClose.survivors[0].afterClose.seconds, 2); // amostras 6..10 (4 intervalos de 0,5 s), nao 5..10 (2,5 s)
});
