'use strict';

/*
 * Roda a sequencia REAL do cliente (flow.js) contra a SFU REAL (lib/sfu.js)
 * com dubles do mediasoup e do mediasoup-client, relogio virtual e IPC
 * simulado por chamada direta. Prova a ordem, o isolamento por dono, o
 * fechamento no meio e a limpeza sem abrir Electron nem rede.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const flow = require('./flow');
const { LocalSfu } = require('../lib/sfu');
const { createFakeMediasoup } = require('../lib/fake-mediasoup');
const { evaluateScenario } = require('../lib/evaluate');

const OWNER = 'wc:1';

function report(entries) {
  return new Map(entries.map((e, i) => [e.id || `s${i}`, e]));
}

/** Relogio virtual: sleep() so avanca o tempo. Contadores de stats dependem dele. */
function makeClock() {
  const clock = { t: 0 };
  clock.now = () => clock.t;
  clock.sleep = async (ms) => { clock.t += ms; };
  return clock;
}

function makeClientFakes(clock, { sendCodecs, failConsume } = {}) {
  const created = { sendTransports: [], recvTransports: [], consumers: [], senderCallbacks: 0 };

  class ClientProducer {
    constructor(id, rtpParameters, codec) {
      this.id = id; this.rtpParameters = rtpParameters; this.codec = codec; this.closed = false;
    }
    async getStats() {
      const sec = clock.t / 1000;
      return report([
        { id: 'o1', type: 'outbound-rtp', kind: 'video', ssrc: 1, codecId: 'c1', framesEncoded: Math.floor(sec * 30), framesSent: Math.floor(sec * 30), packetsSent: Math.floor(sec * 120), bytesSent: Math.floor(sec * 150000), frameWidth: 640, frameHeight: 360, qualityLimitationReason: 'none' },
        { id: 'c1', type: 'codec', mimeType: this.codec.mimeType, payloadType: 108, sdpFmtpLine: 'packetization-mode=1' },
      ]);
    }
    close() { this.closed = true; }
  }

  class ClientConsumer {
    constructor(info) {
      this.id = info.id; this.rtpParameters = info.rtpParameters; this.track = { kind: 'video' }; this.closed = false; this.closedAt = null;
    }
    async getStats() {
      const sec = (this.closed ? this.closedAt : clock.t) / 1000;
      return report([
        { id: 'i1', type: 'inbound-rtp', kind: 'video', codecId: 'c2', framesReceived: Math.floor(sec * 30), framesDecoded: Math.floor(sec * 30), framesDropped: 0, packetsReceived: Math.floor(sec * 120), packetsLost: 0, bytesReceived: Math.floor(sec * 150000), keyFramesDecoded: 1, freezeCount: 0, frameWidth: 640, frameHeight: 360, jitter: 0.001 },
        { id: 'c2', type: 'codec', mimeType: this.rtpParameters.codecs[0].mimeType, payloadType: 100 },
      ]);
    }
    close() { this.closed = true; this.closedAt = clock.t; }
  }

  class ClientTransport extends EventEmitter {
    constructor(opts, kind) {
      super();
      this.id = opts.id; this.kind = kind; this.connectionState = 'new'; this.closed = false; this._connected = false;
    }
    async getStats() {
      return report([
        { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
        { id: 'P1', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'L1', remoteCandidateId: 'R1' },
        { id: 'L1', type: 'local-candidate', address: '127.0.0.1', port: 42200, protocol: 'udp', candidateType: 'host' },
        { id: 'R1', type: 'remote-candidate', address: '127.0.0.1', port: 42010, protocol: 'udp', candidateType: 'host' },
      ]);
    }
    _connect() {
      if (this._connected) return Promise.resolve();
      this._connected = true;
      return new Promise((resolve, reject) => {
        this.emit('connect', { dtlsParameters: { role: 'client', fingerprints: [{ algorithm: 'sha-256', value: 'AA' }] } }, resolve, reject);
      }).then(() => { this.connectionState = 'connected'; this.emit('connectionstatechange', 'connected'); });
    }
    async produce({ codec, onRtpSender, encodings }) {
      assert.equal(encodings.length, 1, 'uma unica codificacao (sem simulcast)');
      assert.equal(encodings[0].scalabilityMode, undefined);
      created.senderCallbacks += 1;
      onRtpSender?.({});
      await this._connect();
      const rtpParameters = { codecs: [{ mimeType: codec.mimeType, payloadType: 108, clockRate: 90000 }], encodings: [{ ssrc: 1 }] };
      const { id } = await new Promise((resolve, reject) => {
        this.emit('produce', { kind: 'video', rtpParameters, appData: {} }, resolve, reject);
      });
      return new ClientProducer(id, rtpParameters, codec);
    }
    async consume(info) {
      if (failConsume) throw new Error('consume do cliente falhou');
      await this._connect();
      const c = new ClientConsumer(info);
      created.consumers.push(c);
      return c;
    }
    close() { this.closed = true; }
  }

  const device = {
    handlerName: 'Chrome111',
    loaded: false,
    sendRtpCapabilities: { codecs: sendCodecs || [{ mimeType: 'video/VP8', parameters: {} }, { mimeType: 'video/rtx', parameters: {} }, { mimeType: 'video/H264', parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f' } }] },
    recvRtpCapabilities: { codecs: [{ mimeType: 'video/H264' }], headerExtensions: [] },
    async load({ routerRtpCapabilities }) { assert.ok(routerRtpCapabilities.codecs.length); this.loaded = true; },
    canProduce: () => true,
    createSendTransport(opts) { const t = new ClientTransport(opts, 'send'); created.sendTransports.push(t); return t; },
    createRecvTransport(opts) { const t = new ClientTransport(opts, 'recv'); created.recvTransports.push(t); return t; },
  };
  return { device, created };
}

async function harness({ consumers, behavior, sfuOptions, clientOptions, rpcWrap }) {
  const ms = createFakeMediasoup(behavior);
  const sfu = new LocalSfu({ mediasoup: ms, closeTimeoutMs: 80, ...sfuOptions });
  await sfu.start();
  const clock = makeClock();
  const fakes = makeClientFakes(clock, clientOptions);
  const calls = [];
  let rpc = async (method, params) => {
    calls.push(method);
    return sfu.request(method, params, { owner: OWNER });
  };
  if (rpcWrap) rpc = rpcWrap(rpc);
  const videos = [];
  const deps = {
    rpc,
    createDevice: async () => fakes.device,
    track: { kind: 'video' },
    attachVideo: () => { const v = { stopped: false, stop() { v.stopped = true; } }; videos.push(v); return v; },
    clientVersion: '3.24.4',
    sleep: clock.sleep, now: clock.now, wall: () => 1_000_000 + clock.t, log: () => {},
  };
  const cfg = { consumers, width: 640, height: 360, fps: 30, bitrateKbps: 1200, warmupMs: 1000, durationMs: 4000, sampleMs: 500, codec: 'h264', listenIp: '127.0.0.1' };
  return { sfu, ms, fakes, deps, cfg, calls, videos };
}

test('pickCodec: H.264 preferido, ignora rtx, fallback VP8 explicito, VP8 so se pedido', () => {
  const caps = [{ mimeType: 'video/VP8' }, { mimeType: 'video/rtx' }, { mimeType: 'video/H264', parameters: { 'packetization-mode': 0 } }, { mimeType: 'video/H264', parameters: { 'packetization-mode': 1 } }];
  const a = flow.pickCodec(caps, 'h264');
  assert.equal(a.codec.parameters['packetization-mode'], 1);
  assert.equal(a.fellBack, false);
  const b = flow.pickCodec([{ mimeType: 'video/VP8' }], 'h264');
  assert.equal(b.codec.mimeType, 'video/VP8');
  assert.equal(b.fellBack, true);
  assert.match(b.reason, /H\.264 ausente/);
  const c = flow.pickCodec(caps, 'vp8');
  assert.equal(c.codec.mimeType, 'video/VP8');
  assert.equal(c.fellBack, false);
  assert.throws(() => flow.pickCodec([{ mimeType: 'video/rtx' }], 'h264'), /nenhum codec/);
  assert.throws(() => flow.pickCodec([{ mimeType: 'video/H264' }], 'vp8'), /nenhum codec/);
  assert.throws(() => flow.pickCodec(undefined, 'h264'), /nenhum codec/);
});

test('4 consumidores: ordem paused->consume->resume, um envio, fechamento no meio e limpeza total', async () => {
  const h = await harness({ consumers: 4 });
  const r = await flow.runScenario(h.deps, h.cfg);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.cleanupErrors, []);

  // um unico envio a SFU
  assert.equal(r.producer.produceEvents, 1);
  assert.equal(r.producer.rtpSenders, 1);
  assert.equal(h.fakes.created.sendTransports.length, 1);
  assert.equal(h.calls.filter((m) => m === 'produce').length, 1);

  // H.264 escolhido (nao o primeiro da lista, que era VP8)
  assert.equal(r.codec.selected.mimeType, 'video/H264');
  assert.equal(r.codec.fellBack, false);

  // ordem por consumidor
  for (let i = 0; i < 4; i += 1) {
    const idx = (name) => r.steps.findIndex((s) => s.step === name && s.index === i);
    assert.ok(idx('server-consume') < idx('client-consume') && idx('client-consume') < idx('server-resume'));
    assert.equal(r.steps[idx('server-consume')].paused, true);
  }

  // nada de simulcast: consumers sao 'simple'
  assert.ok(r.consumers.every((c) => c.type === 'simple'));

  // fechamento no meio: o consumidor 1; os outros continuam
  assert.equal(r.midClose.executed, true);
  assert.equal(r.midClose.index, 1);
  assert.equal(r.consumers[1].closedMidTest, true);
  assert.equal(r.server.start.counts.consumers, 4);
  assert.equal(r.server.afterMidClose.counts.consumers, 3);
  assert.equal(r.server.end.counts.consumers, 3);
  assert.equal(h.fakes.created.consumers[1].closed, true);
  assert.equal(h.fakes.created.consumers[0].closed, true, 'a limpeza final fecha os demais');

  // limpeza: nada sobra no servidor nem no cliente
  const stats = await h.sfu.stats();
  assert.deepEqual(stats.counts, { peers: 0, transports: 0, producers: 0, consumers: 0 });
  assert.ok(h.videos.every((v) => v.stopped));
  assert.ok(h.fakes.created.recvTransports.every((t) => t.closed));
  assert.ok(h.fakes.created.sendTransports.every((t) => t.closed));

  // avaliador: o conjunto inteiro fecha como ok
  const sd = await h.sfu.close();
  const clientRange = { min: 42200, max: 42399, busyBefore: [], verify: { ports: [{ port: 42200, free: true }], allFree: true } };
  const ev = evaluateScenario(h.cfg, r, { shutdown: sd, verify: { workerPid: sd.workerPid, workerAlive: false, ports: sd.ports.map((port) => ({ port, free: true })), allFree: true }, clientRange }, { expectedClientVersion: '3.24.4' });
  assert.equal(r.device.clientVersion, '3.24.4');
  assert.equal(r.clientIce.length, 4); // envio + 3 consumidores vivos (o segundo foi fechado no meio)
  assert.ok(r.clientIce.every((x) => x.remote.address === '127.0.0.1'));
  assert.equal(ev.status, 'ok', JSON.stringify(ev.checks.filter((c) => c.status !== 'passed')));
});

test('1 consumidor: sem fechamento no meio e cenario completo', async () => {
  const h = await harness({ consumers: 1 });
  const r = await flow.runScenario(h.deps, h.cfg);
  assert.equal(r.error, undefined);
  assert.equal(r.midClose.executed, false);
  assert.equal(r.consumers.length, 1);
  assert.equal(r.consumers[0].closedMidTest, false);
  const stats = await h.sfu.stats();
  assert.equal(stats.counts.peers, 0);
  await h.sfu.close();
});

test('fallback para VP8 fica registrado quando o Device nao oferece H.264', async () => {
  const h = await harness({ consumers: 1, clientOptions: { sendCodecs: [{ mimeType: 'video/VP8', parameters: {} }] } });
  const r = await flow.runScenario(h.deps, h.cfg);
  assert.equal(r.codec.fellBack, true);
  assert.equal(r.codec.selected.mimeType, 'video/VP8');
  await h.sfu.close();
});

test('falha no meio (consume do cliente) devolve error, nao lanca, e limpa tudo', async () => {
  const h = await harness({ consumers: 2, clientOptions: { failConsume: true } });
  const r = await flow.runScenario(h.deps, h.cfg);
  assert.match(r.error, /consume do cliente falhou/);
  assert.deepEqual(r.cleanupErrors, []);
  assert.deepEqual((await h.sfu.stats()).counts, { peers: 0, transports: 0, producers: 0, consumers: 0 });
  assert.ok(h.fakes.created.sendTransports.every((t) => t.closed));
  assert.ok(r.steps.some((s) => s.step === 'cleanup-done'));
  await h.sfu.close();
});

test('SFU recusando o consume (CANNOT_CONSUME) vira erro do cenario com o codigo na mensagem', async () => {
  const h = await harness({ consumers: 1 });
  h.ms.workers[0].routers[0].canConsumeResult = false;
  const r = await flow.runScenario(h.deps, h.cfg);
  assert.match(r.error, /nao consegue consumir/);
  assert.deepEqual((await h.sfu.stats()).counts.peers, 0);
  await h.sfu.close();
});

test('erro de limpeza e REGISTRADO (nao engolido): leave que falha aparece em cleanupErrors', async () => {
  const h = await harness({
    consumers: 1,
    rpcWrap: (rpc) => async (method, params) => {
      if (method === 'leave') throw new Error('leave quebrou');
      return rpc(method, params);
    },
  });
  const r = await flow.runScenario(h.deps, h.cfg);
  assert.ok(r.cleanupErrors.length >= 2);
  assert.ok(r.cleanupErrors.every((e) => /leave quebrou/.test(e)));
  const ev = evaluateScenario(h.cfg, r, null);
  assert.equal(ev.checks.find((c) => c.id === 'client-cleanup').status, 'failed');
  await h.sfu.close();
});

test('withTimeout rejeita com o rotulo', async () => {
  await assert.rejects(flow.withTimeout(new Promise(() => {}), 10, 'passo x'), /passo x excedeu 10 ms/);
  assert.equal(await flow.withTimeout(Promise.resolve(3), 50, 'ok'), 3);
});

test('waitConnected resolve ao conectar e rejeita em failed', async () => {
  const t = new EventEmitter();
  t.connectionState = 'connecting';
  const ok = flow.waitConnected(t, 'tx', 200);
  t.emit('connectionstatechange', 'connected');
  await ok;
  const t2 = new EventEmitter();
  t2.connectionState = 'connecting';
  const bad = flow.waitConnected(t2, 'tx2', 200);
  t2.emit('connectionstatechange', 'failed');
  await assert.rejects(bad, /conexao falhou/);
  const t3 = new EventEmitter();
  t3.connectionState = 'new';
  await assert.rejects(flow.waitConnected(t3, 'tx3', 15), /excedeu/);
});
