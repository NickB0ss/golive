'use strict';

/*
 * Dubles do mediasoup SO para os testes de orquestracao (nenhum codigo de
 * producao importa isto). Imitam o formato da API real: createWorker ->
 * worker.createRouter -> router.createWebRtcTransport -> transport.produce /
 * consume, eventos 'died' / 'subprocessclose' e close() sincrono.
 */

const { EventEmitter } = require('events');

let counter = 0;
const nextId = (prefix) => `${prefix}-${(counter += 1)}`;

class FakeProducer extends EventEmitter {
  constructor(options) {
    super();
    this.id = nextId('prod');
    this.kind = options.kind;
    this.rtpParameters = options.rtpParameters;
    this.closed = false;
  }

  close() {
    this.closed = true;
    this.emit('@close');
  }

  async getStats() {
    this.statsCalls = (this.statsCalls || 0) + 1; // contadores crescem a cada leitura
    return [{ type: 'inbound-rtp', packetCount: 100 * this.statsCalls, byteCount: 10000 * this.statsCalls }];
  }
}

class FakeConsumer extends EventEmitter {
  constructor(options) {
    super();
    this.id = nextId('cons');
    this.producerId = options.producerId;
    this.kind = 'video';
    this.paused = options.paused === true;
    this.producerPaused = false;
    this.type = 'simple';
    this.closed = false;
    this.options = options;
    this.rtpParameters = { codecs: [{ mimeType: 'video/H264', payloadType: 100 }] };
  }

  async resume() {
    this.paused = false;
  }

  close() {
    this.closed = true;
  }

  async getStats() {
    this.statsCalls = (this.statsCalls || 0) + 1;
    return [{ type: 'outbound-rtp', packetCount: 100 * this.statsCalls, byteCount: 10000 * this.statsCalls }, { type: 'inbound-rtp', packetCount: 100 * this.statsCalls, byteCount: 10000 * this.statsCalls }];
  }
}

class FakeTransport extends EventEmitter {
  constructor(options, router) {
    super();
    this.id = nextId('tr');
    this.options = options;
    this.router = router;
    this.closed = false;
    this.connected = false;
    this.iceState = 'new';
    this.dtlsState = 'new';
    this.iceSelectedTuple = undefined;
    this.iceParameters = { usernameFragment: 'u', password: 'p', iceLite: true };
    this.dtlsParameters = { role: 'auto', fingerprints: [{ algorithm: 'sha-256', value: 'AA' }] };
    const ip = options.listenInfos?.[0]?.ip || '127.0.0.1';
    this.iceCandidates = [{ foundation: 'f', priority: 1, ip, address: ip, protocol: 'udp', port: 40000 + counter, type: 'host' }];
    this.producers = [];
    this.consumers = [];
  }

  async connect({ dtlsParameters }) {
    if (!dtlsParameters) throw new TypeError('dtlsParameters ausente');
    this.connected = true;
  }

  async produce(options) {
    const delay = this.router.worker.behavior.produceDelayMs;
    if (delay) await new Promise((r) => { setTimeout(r, delay); });
    const p = new FakeProducer(options);
    this.producers.push(p);
    this.router.lastProducer = p;
    return p;
  }

  async consume(options) {
    const delay = this.router.worker.behavior.consumeDelayMs;
    if (delay) await new Promise((r) => { setTimeout(r, delay); });
    const c = new FakeConsumer(options);
    this.consumers.push(c);
    return c;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.producers) if (!p.closed) p.close();
    for (const c of this.consumers) if (!c.closed) c.close();
  }

  async getStats() {
    return [{ type: 'webrtc-transport', bytesReceived: 1, bytesSent: 1 }];
  }
}

class FakeRouter extends EventEmitter {
  constructor(mediaCodecs, worker) {
    super();
    this.worker = worker;
    this.rtpCapabilities = { codecs: mediaCodecs, headerExtensions: [] };
    this.transports = [];
    this.canConsumeResult = true;
    this.canConsumeCalls = [];
  }

  async createWebRtcTransport(options) {
    if (this.worker.transportDelayMs) await new Promise((r) => { setTimeout(r, this.worker.transportDelayMs); });
    const t = new FakeTransport(options, this);
    this.transports.push(t);
    return t;
  }

  canConsume(args) {
    this.canConsumeCalls.push(args);
    return this.canConsumeResult;
  }
}

class FakeWorker extends EventEmitter {
  constructor(settings, behavior) {
    super();
    this.settings = settings;
    this.behavior = behavior;
    this.pid = 4000 + counter;
    this.closed = false;
    this.died = false;
    this.subprocessClosed = false;
    this.closeCalls = 0;
    this.routers = [];
    this.transportDelayMs = behavior.transportDelayMs || 0;
  }

  async createRouter({ mediaCodecs }) {
    if (this.behavior.routerDelayMs) await new Promise((r) => { setTimeout(r, this.behavior.routerDelayMs); });
    const router = new FakeRouter(mediaCodecs, this);
    this.routers.push(router);
    return router;
  }

  async getResourceUsage() {
    return { ru_utime: 10, ru_stime: 5 };
  }

  close() {
    this.closeCalls += 1;
    if (this.closed) return;
    this.closed = true;
    if (!this.behavior.hangOnClose) {
      setImmediate(() => { this.subprocessClosed = true; this.emit('subprocessclose'); });
    }
  }

  /** Simula morte inesperada do processo. */
  die(message = 'worker morreu') {
    this.died = true;
    this.emit('died', new Error(message));
  }
}

/** Cria um "modulo mediasoup" falso; `behavior` ajusta atrasos e travamentos. */
function createFakeMediasoup(behavior = {}) {
  const workers = [];
  return {
    workers,
    version: 'fake',
    async createWorker(settings) {
      if (behavior.workerDelayMs) await new Promise((r) => { setTimeout(r, behavior.workerDelayMs); });
      if (behavior.createWorkerError) throw new Error(behavior.createWorkerError);
      const w = new FakeWorker(settings, behavior);
      workers.push(w);
      return w;
    },
  };
}

module.exports = { createFakeMediasoup, FakeWorker, FakeRouter, FakeTransport, FakeConsumer, FakeProducer };
