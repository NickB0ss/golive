'use strict';

/*
 * SFU local de prova de conceito sobre o mediasoup. Um worker, um router, so
 * WebRTC/UDP em loopback. NAO e o transporte do app e nao e iniciada por ele.
 *
 *   const sfu = await createLocalSfu({ listenIp: '127.0.0.1' });
 *   await sfu.request('join', { role: 'producer' }, { owner });
 *   ...
 *   await sfu.close();
 *
 * Modelo de sessao: `join` devolve um `peerId` imprevisivel e o amarra ao
 * `owner` do chamador (no Electron, o id do webContents confiavel). Todo id de
 * transport/consumer so e resolvido DENTRO do mapa do peer que o criou, e o
 * peer so e acessado pelo owner que fez `join`. Id arbitrario, de outro peer
 * ou de outro owner, vira FORBIDDEN, nunca chega ao mediasoup.
 *
 * O encaminhamento e feito pelo router do mediasoup sem decodificar nem
 * recodificar: o worker nao tem encoder. (Isso e arquitetura, nao medicao de
 * CPU; o relatorio traz o tempo de CPU do worker como dado, sem prometer nada.)
 */

const crypto = require('crypto');
const { SfuError } = require('./errors');
const V = require('./validate');

const ALLOWED_LISTEN_IPS = ['127.0.0.1', '::1'];

/** Codecs de video do router: H.264 primeiro, VP8 como alternativa explicita. */
const DEFAULT_MEDIA_CODECS = [
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
      'x-google-start-bitrate': 1000,
    },
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1000 },
  },
];

const METHODS = ['getRouterRtpCapabilities', 'join', 'createTransport', 'connectTransport', 'produce', 'consume', 'resumeConsumer', 'leave', 'stats'];
const MAX_PEERS = 16;
const MAX_EVENTS = 300;

function withTimeout(promise, ms, code, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new SfuError(code, message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Copia JSON pura (stats do mediasoup podem trazer BigInt/undefined). */
function plain(value) {
  return JSON.parse(JSON.stringify(value ?? null, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
}

function validateListenIp(listenIp) {
  if (!ALLOWED_LISTEN_IPS.includes(listenIp)) {
    throw new SfuError('BAD_LISTEN_IP', `listenIp deve ser ${ALLOWED_LISTEN_IPS.join(' ou ')} (recebido: ${String(listenIp)}); a prova de conceito nunca escuta fora do loopback`);
  }
  return listenIp;
}

function validatePortRange(range) {
  if (range === undefined || range === null) return null;
  const ok = (n) => Number.isInteger(n) && n >= 1024 && n <= 65535;
  if (!range || !ok(range.min) || !ok(range.max) || range.min > range.max) {
    throw new SfuError('BAD_PORT_RANGE', 'portRange deve ser { min, max } com 1024 <= min <= max <= 65535');
  }
  return { min: range.min, max: range.max };
}

class LocalSfu {
  constructor(options = {}) {
    this.listenIp = validateListenIp(options.listenIp ?? '127.0.0.1');
    // Injetavel para teste: o padrao carrega o pacote real so quando precisa.
    this.mediasoup = options.mediasoup || null;
    this.mediaCodecs = options.mediaCodecs || DEFAULT_MEDIA_CODECS;
    // Faixa de portas UDP dos transports (listenInfos[].portRange; rtcMinPort/rtcMaxPort sao obsoletos no 3.28).
    this.portRange = validatePortRange(options.portRange);
    this.workerBin = options.workerBin;
    this.logLevel = options.logLevel || 'warn';
    this.closeTimeoutMs = options.closeTimeoutMs ?? 5000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10000;
    this.startTimeoutMs = options.startTimeoutMs ?? 15000;
    this.killProcess = options.killProcess || ((pid) => process.kill(pid, 'SIGKILL'));

    this.state = 'new'; // new | starting | running | closing | closed | died
    this.worker = null;
    this.router = null;
    this.peers = new Map();
    this.producer = null; // so um produtor na sala (prova de conceito)
    this.producerPending = false; // reserva do produce em andamento (antes do await)
    this.producerPeerId = null;
    this.events = [];
    this.ports = new Set();
    this.workerPid = null;
    this.workerDied = null;
    this.closeRequested = false;
    this.shutdownResult = null;
    this._startPromise = null;
    this._closePromise = null;
    this._shutdownPromise = null;
    this._subprocessClosed = null;
  }

  _event(type, extra) {
    if (this.events.length < MAX_EVENTS) this.events.push({ t: Date.now(), type, ...extra });
  }

  /** Cria worker e router. Se close() chegar no meio, o que ja nasceu e desfeito. */
  start() {
    if (!this._startPromise) this._startPromise = this._start();
    return this._startPromise;
  }

  async _start() {
    if (this.state !== 'new') throw new SfuError('BAD_STATE', `start() em estado ${this.state}`);
    this.state = 'starting';
    const ms = this.mediasoup || require('mediasoup');
    this.mediasoup = ms;
    const settings = { logLevel: this.logLevel, logTags: [] };
    if (this.workerBin) settings.workerBin = this.workerBin;

    try {
      // O worker so e "adotado" depois do await; se o timeout vencer antes, o
      // createWorker tardio e fechado assim que resolver (ver abaixo).
      const creating = ms.createWorker(settings);
      let timedOut = false;
      creating.then((late) => {
        if (timedOut) { try { late.close(); } catch { /* ja fechado */ } }
      }, () => {});
      let worker;
      try {
        worker = await withTimeout(creating, this.startTimeoutMs, 'START_TIMEOUT', 'worker do mediasoup nao subiu a tempo');
      } catch (err) {
        timedOut = true;
        throw err;
      }
      this._adopt(worker);
      if (this.closeRequested) throw new SfuError('CLOSED', 'SFU fechada durante a inicializacao');
      this.router = await withTimeout(worker.createRouter({ mediaCodecs: this.mediaCodecs }), this.requestTimeoutMs, 'START_TIMEOUT', 'router nao criado a tempo');
      if (this.closeRequested) throw new SfuError('CLOSED', 'SFU fechada durante a inicializacao');
    } catch (err) {
      this.closeRequested = true;
      await this._shutdown();
      throw err;
    }
    this.state = 'running';
    this._event('started', { workerPid: this.workerPid });
    return this;
  }

  /** Guarda o worker e observa 'died' / 'subprocessclose'. */
  _adopt(worker) {
    this.worker = worker;
    this.workerPid = worker.pid ?? null;
    this._subprocessClosed = new Promise((resolve) => {
      worker.once('subprocessclose', () => { this._event('subprocessclose'); resolve(true); });
    });
    worker.on('died', (err) => {
      this.workerDied = String(err?.message || err);
      this._event('worker-died', { error: this.workerDied });
      if (this.state === 'running') this.state = 'died';
    });
  }

  _assertRunning() {
    if (this.state === 'died') throw new SfuError('WORKER_DIED', `worker do mediasoup morreu: ${this.workerDied}`);
    if (this.state !== 'running') throw new SfuError('NOT_RUNNING', `SFU em estado ${this.state}`);
  }

  _peer(params, ctx) {
    const peerId = V.idParam(params.peerId, 'peerId');
    const peer = this.peers.get(peerId);
    // Mesma resposta para peer inexistente e de outro dono: nao confirma que o id existe.
    if (!peer || peer.owner !== ctx.owner) throw new SfuError('FORBIDDEN', 'peer desconhecido para este chamador');
    return peer;
  }

  /**
   * Ponto unico de entrada (o IPC chama so isto). `ctx.owner` vem do main
   * (identidade do webContents), nunca da pagina.
   */
  async request(method, params, ctx = {}) {
    if (typeof method !== 'string' || !METHODS.includes(method)) throw new SfuError('METHOD_NOT_FOUND', `metodo desconhecido: ${String(method).slice(0, 64)}`);
    if (typeof ctx.owner !== 'string' || !ctx.owner) throw new SfuError('FORBIDDEN', 'chamada sem dono');
    const p = params === undefined ? {} : params;
    V.objectParam(p, 'params');
    V.checkSize(p);
    this._assertRunning();
    return withTimeout(this[`_m_${method}`](p, ctx), this.requestTimeoutMs, 'TIMEOUT', `${method} excedeu ${this.requestTimeoutMs} ms`);
  }

  async _m_getRouterRtpCapabilities() {
    return plain(this.router.rtpCapabilities);
  }

  async _m_join(p, ctx) {
    const role = V.oneOf(p.role, ['producer', 'consumer'], 'role');
    if (this.peers.size >= MAX_PEERS) throw new SfuError('LIMIT', 'limite de peers da prova de conceito');
    if (role === 'producer' && [...this.peers.values()].some((x) => x.role === 'producer' && !x.closed)) {
      throw new SfuError('LIMIT', 'a prova de conceito aceita um unico produtor');
    }
    const peerId = crypto.randomUUID();
    this.peers.set(peerId, {
      id: peerId, owner: ctx.owner, role, closed: false,
      transport: null, direction: null, connected: false, producer: null, consumer: null, pending: null,
    });
    this._event('join', { peerId, role });
    return { peerId };
  }

  async _m_createTransport(p, ctx) {
    const peer = this._peer(p, ctx);
    const direction = V.oneOf(p.direction, ['send', 'recv'], 'direction');
    if (peer.closed) throw new SfuError('BAD_STATE', 'peer ja saiu');
    if (peer.transport || peer.pending === 'transport') throw new SfuError('BAD_STATE', 'peer ja tem transport (ou esta criando um)');
    // Produtor so envia, consumidor so recebe: papel e direcao precisam bater.
    if ((peer.role === 'producer') !== (direction === 'send')) throw new SfuError('BAD_STATE', `peer ${peer.role} nao pode criar transport ${direction}`);
    peer.pending = 'transport'; // reserva antes do await: createTransport concorrente nao passa
    let transport;
    try {
      transport = await this.router.createWebRtcTransport({
        // Somente loopback, UDP. Nada de announcedAddress/0.0.0.0/TCP.
        listenInfos: [{ protocol: 'udp', ip: this.listenIp, ...(this.portRange ? { portRange: this.portRange } : {}) }],
        enableUdp: true,
        enableTcp: false,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 3_000_000,
        appData: { peerId: peer.id, direction },
      });
    } finally {
      peer.pending = null;
    }
    for (const c of transport.iceCandidates) this.ports.add(c.port);
    if (peer.closed || this.closeRequested) { // fechou enquanto o transport nascia
      transport.close();
      throw new SfuError('CLOSED', 'peer ou SFU fechou durante createTransport');
    }
    peer.transport = transport;
    peer.direction = direction;
    transport.on('routerclose', () => { peer.transport = null; });
    this._event('transport', { peerId: peer.id, direction, transportId: transport.id });
    return {
      id: transport.id,
      iceParameters: plain(transport.iceParameters),
      iceCandidates: plain(transport.iceCandidates),
      dtlsParameters: plain(transport.dtlsParameters),
    };
  }

  _transportOf(peer, transportId) {
    V.idParam(transportId, 'transportId');
    if (!peer.transport || peer.transport.id !== transportId) throw new SfuError('FORBIDDEN', 'transport nao pertence a este peer');
    return peer.transport;
  }

  async _m_connectTransport(p, ctx) {
    const peer = this._peer(p, ctx);
    const transport = this._transportOf(peer, p.transportId);
    const dtlsParameters = V.dtlsParametersParam(p.dtlsParameters, 'dtlsParameters');
    if (peer.connected) throw new SfuError('BAD_STATE', 'transport ja conectado');
    peer.connected = true; // marca antes do await: connect duplicado concorrente nao passa
    try {
      await transport.connect({ dtlsParameters });
    } catch (err) {
      peer.connected = false;
      throw err;
    }
    return {};
  }

  async _m_produce(p, ctx) {
    const peer = this._peer(p, ctx);
    if (peer.role !== 'producer') throw new SfuError('BAD_STATE', 'so o produtor produz');
    const transport = this._transportOf(peer, p.transportId);
    if (peer.direction !== 'send') throw new SfuError('BAD_STATE', 'produce exige transport de envio');
    if (!peer.connected) throw new SfuError('BAD_STATE', 'transport de envio ainda nao conectado');
    V.oneOf(p.kind, ['video'], 'kind');
    const rtpParameters = V.rtpParametersParam(p.rtpParameters, 'rtpParameters');
    if (peer.producer || this.producer || this.producerPending) throw new SfuError('BAD_STATE', 'a prova de conceito aceita um unico envio (producer)');
    if (rtpParameters.encodings !== undefined && rtpParameters.encodings.length > 1) throw new SfuError('BAD_REQUEST', 'camada unica: simulcast/SVC (mais de uma codificacao) nao e aceito');
    this.producerPending = true; // reserva antes do await: produce concorrente nao passa
    let producer;
    try {
      producer = await transport.produce({ kind: 'video', rtpParameters, appData: { peerId: peer.id } });
    } finally {
      this.producerPending = false;
    }
    if (peer.closed || this.closeRequested) {
      producer.close();
      throw new SfuError('CLOSED', 'peer ou SFU fechou durante produce');
    }
    peer.producer = producer;
    this.producer = producer;
    this.producerPeerId = peer.id;
    producer.on('transportclose', () => { this._event('producer-transportclose', { producerId: producer.id }); });
    this._event('produce', { peerId: peer.id, producerId: producer.id, codec: producer.rtpParameters.codecs[0]?.mimeType });
    return { id: producer.id };
  }

  async _m_consume(p, ctx) {
    const peer = this._peer(p, ctx);
    if (peer.role !== 'consumer') throw new SfuError('BAD_STATE', 'so o consumidor consome');
    const transport = this._transportOf(peer, p.transportId);
    if (peer.direction !== 'recv') throw new SfuError('BAD_STATE', 'consume exige transport de recepcao');
    const producerId = V.idParam(p.producerId, 'producerId');
    // Nao exige DTLS conectado: o consume() do cliente e que dispara o connect.
    if (!this.producer || this.producer.closed || this.producer.id !== producerId) throw new SfuError('NO_PRODUCER', 'producer inexistente (ou nao e o da sala)');
    const rtpCapabilities = V.rtpCapabilitiesParam(p.rtpCapabilities, 'rtpCapabilities');
    if (peer.consumer || peer.pending === 'consume') throw new SfuError('BAD_STATE', 'peer ja consome o producer (ou esta criando o consumer)');
    if (!this.router.canConsume({ producerId, rtpCapabilities })) throw new SfuError('CANNOT_CONSUME', 'o dispositivo nao consegue consumir este producer (codecs incompativeis)');
    // paused:true: so encaminha apos o cliente confirmar que montou o consumer.
    peer.pending = 'consume'; // reserva antes do await: consume concorrente nao passa
    let consumer;
    try {
      consumer = await transport.consume({ producerId, rtpCapabilities, paused: true, appData: { peerId: peer.id } });
    } finally {
      peer.pending = null;
    }
    if (peer.closed || this.closeRequested) {
      consumer.close();
      throw new SfuError('CLOSED', 'peer ou SFU fechou durante consume');
    }
    peer.consumer = consumer;
    consumer.on('producerclose', () => { this._event('consumer-producerclose', { consumerId: consumer.id }); });
    consumer.on('transportclose', () => { this._event('consumer-transportclose', { consumerId: consumer.id }); });
    this._event('consume', { peerId: peer.id, consumerId: consumer.id, paused: consumer.paused, type: consumer.type });
    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: plain(consumer.rtpParameters),
      type: consumer.type,
      paused: consumer.paused,
      producerPaused: consumer.producerPaused,
    };
  }

  async _m_resumeConsumer(p, ctx) {
    const peer = this._peer(p, ctx);
    const consumerId = V.idParam(p.consumerId, 'consumerId');
    if (!peer.consumer || peer.consumer.id !== consumerId || peer.consumer.closed) throw new SfuError('FORBIDDEN', 'consumer nao pertence a este peer');
    await peer.consumer.resume();
    this._event('resume', { peerId: peer.id, consumerId });
    return { paused: peer.consumer.paused };
  }

  /** Fecha os recursos de um peer. Idempotente (segunda chamada nao falha). */
  async _m_leave(p, ctx) {
    const peer = this._peer(p, ctx);
    const already = peer.closed;
    this._closePeer(peer);
    return { left: true, already };
  }

  _closePeer(peer) {
    if (peer.closed) return;
    peer.closed = true;
    // Ordem: consumer/producer antes do transport; close() do mediasoup e sincrono.
    for (const key of ['consumer', 'producer']) {
      try { peer[key]?.close(); } catch (err) { this._event('close-error', { what: key, error: String(err?.message || err) }); }
      peer[key] = null;
    }
    try { peer.transport?.close(); } catch (err) { this._event('close-error', { what: 'transport', error: String(err?.message || err) }); }
    peer.transport = null;
    if (this.producerPeerId === peer.id) {
      this.producer = null;
      this.producerPeerId = null;
    }
    this._event('leave', { peerId: peer.id });
  }

  async _m_stats() {
    return this.stats();
  }

  /** Foto do servidor: contagens, stats RTP do producer/consumers/transports e CPU do worker. */
  async stats() {
    if (this.state === 'died') throw new SfuError('WORKER_DIED', `worker do mediasoup morreu: ${this.workerDied}`);
    if (this.state !== 'running') throw new SfuError('NOT_RUNNING', `SFU em estado ${this.state}`);
    const live = [...this.peers.values()].filter((x) => !x.closed);
    const out = {
      at: Date.now(),
      listen: { ip: this.listenIp, protocol: 'udp', tcp: false },
      workerPid: this.workerPid,
      counts: {
        peers: live.length,
        transports: live.filter((x) => x.transport).length,
        producers: live.filter((x) => x.producer).length,
        consumers: live.filter((x) => x.consumer).length,
      },
      producer: null,
      consumers: [],
      transports: [],
      workerResourceUsage: null,
    };
    if (this.producer && !this.producer.closed) {
      out.producer = {
        id: this.producer.id,
        codec: plain(this.producer.rtpParameters.codecs[0] ?? null),
        stats: plain(await this.producer.getStats()),
      };
    }
    for (const peer of live) {
      if (peer.consumer && !peer.consumer.closed) {
        out.consumers.push({
          id: peer.consumer.id,
          peerId: peer.id,
          type: peer.consumer.type,
          paused: peer.consumer.paused,
          codec: plain(peer.consumer.rtpParameters.codecs[0] ?? null),
          stats: plain(await peer.consumer.getStats()),
        });
      }
      if (peer.transport && !peer.transport.closed) {
        out.transports.push({
          id: peer.transport.id,
          peerId: peer.id,
          direction: peer.direction,
          iceState: peer.transport.iceState,
          dtlsState: peer.transport.dtlsState,
          iceSelectedTuple: plain(peer.transport.iceSelectedTuple ?? null),
          stats: plain(await peer.transport.getStats()),
        });
      }
    }
    try {
      out.workerResourceUsage = plain(await this.worker.getResourceUsage());
    } catch (err) {
      out.workerResourceUsage = { error: String(err?.message || err) };
    }
    return out;
  }

  /** Fecha tudo. Idempotente: todas as chamadas recebem o mesmo relatorio. */
  close() {
    if (!this._closePromise) {
      this.closeRequested = true;
      this._closePromise = this._close();
    }
    return this._closePromise;
  }

  async _close() {
    if (this.state === 'starting') {
      // O proprio _start desfaz o que criou ao ver closeRequested; so espera.
      try { await this._startPromise; } catch { /* esperado: CLOSED */ }
      if (this.shutdownResult) return this.shutdownResult;
    }
    return this._shutdown();
  }

  async _shutdown() {
    if (this.shutdownResult) return this.shutdownResult;
    if (!this._shutdownPromise) this._shutdownPromise = this._doShutdown();
    return this._shutdownPromise;
  }

  async _doShutdown() {
    const wasDied = this.state === 'died' || this.workerDied !== null;
    this.state = 'closing';
    for (const peer of this.peers.values()) this._closePeer(peer);
    const result = {
      workerPid: this.workerPid,
      died: wasDied,
      diedError: this.workerDied,
      subprocessClosed: this.worker ? Boolean(this.worker.subprocessClosed) : null,
      timedOut: false,
      forcedKill: false,
      ports: [...this.ports].sort((a, b) => a - b),
    };
    if (this.worker) {
      try { this.worker.close(); } catch (err) { this._event('close-error', { what: 'worker', error: String(err?.message || err) }); }
      if (!result.subprocessClosed) {
        let timer;
        const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), this.closeTimeoutMs); });
        result.subprocessClosed = await Promise.race([this._subprocessClosed, timeout]);
        clearTimeout(timer);
        if (!result.subprocessClosed) {
          result.timedOut = true;
          if (this.workerPid) {
            try { this.killProcess(this.workerPid); result.forcedKill = true; } catch { /* ja morreu */ }
          }
        }
      }
    }
    this.state = 'closed';
    this.shutdownResult = result;
    return result;
  }
}

/** API publica: cria, sobe e devolve { request, stats, close } (e o objeto completo em `.sfu`). */
async function createLocalSfu(options = {}) {
  const sfu = new LocalSfu(options);
  await sfu.start();
  return {
    sfu,
    request: (method, params, ctx) => sfu.request(method, params, ctx),
    stats: () => sfu.stats(),
    close: () => sfu.close(),
  };
}

module.exports = { LocalSfu, validatePortRange, createLocalSfu, validateListenIp, ALLOWED_LISTEN_IPS, DEFAULT_MEDIA_CODECS, METHODS };
