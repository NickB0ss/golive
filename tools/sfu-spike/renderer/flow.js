'use strict';

/*
 * Orquestracao do lado do cliente: Device -> transport de envio -> UM
 * producer -> N consumidores (transport de recepcao cada) -> medida ->
 * fechamento de um consumidor no meio -> limpeza. UMD e sem tocar em
 * WebRTC diretamente: tudo que e do navegador entra por `deps`, entao o
 * node:test roda a mesma sequencia com dublês.
 *
 * Ordem exigida do consumidor (docs do mediasoup): servidor cria o consumer
 * PAUSADO -> cliente chama transport.consume -> so entao o servidor retoma.
 *
 * deps: { rpc(method, params), createDevice(), track, attachVideo(track),
 *         sleep(ms), now() (ms monotonico), wall() (ms epoch), log(text) }
 */
(function (root) {
  const M = (root.SfuSpike && root.SfuSpike.metrics) || (typeof require === 'function' ? require('./metrics.js') : null);

  const STEP_TIMEOUT_MS = 15000;

  function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} excedeu ${ms} ms`)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function mimeOf(codec) {
    return String(codec?.mimeType || '').toLowerCase();
  }

  /**
   * Escolhe o codec do produce entre os que o Device E o router aceitam
   * (device.sendRtpCapabilities ja e a intersecao). H.264 e o preferido; se
   * nao houver, cai para VP8 de forma EXPLICITA e registra o motivo. O codec
   * REAL negociado e lido depois, do getStats e dos rtpParameters.
   */
  function pickCodec(codecs, preference) {
    const list = (Array.isArray(codecs) ? codecs : []).filter((c) => !/\/(rtx|red|ulpfec)$/i.test(c.mimeType || ''));
    const h264 = list.filter((c) => mimeOf(c) === 'video/h264');
    const vp8 = list.filter((c) => mimeOf(c) === 'video/vp8');
    const mode1 = h264.find((c) => String(c.parameters?.['packetization-mode']) === '1');
    const wantH264 = preference !== 'vp8';
    if (wantH264) {
      const chosen = mode1 || h264[0];
      if (chosen) return { codec: chosen, requested: 'video/H264', fellBack: false, reason: null };
      if (vp8[0]) return { codec: vp8[0], requested: 'video/H264', fellBack: true, reason: 'H.264 ausente na intersecao Device x router; usando VP8' };
    } else if (vp8[0]) {
      return { codec: vp8[0], requested: 'video/VP8', fellBack: false, reason: null };
    }
    throw new Error(`nenhum codec de video utilizavel (disponiveis: ${list.map((c) => c.mimeType).join(', ') || 'nenhum'})`);
  }

  function waitConnected(transport, label, timeoutMs = STEP_TIMEOUT_MS) {
    if (transport.connectionState === 'connected') return Promise.resolve();
    return withTimeout(new Promise((resolve, reject) => {
      const onState = (state) => {
        if (state === 'connected') { transport.off('connectionstatechange', onState); resolve(); }
        if (state === 'failed') { transport.off('connectionstatechange', onState); reject(new Error(`${label}: conexao falhou`)); }
      };
      transport.on('connectionstatechange', onState);
    }), timeoutMs, `${label} conectar`);
  }

  function transportOptions(info) {
    return { id: info.id, iceParameters: info.iceParameters, iceCandidates: info.iceCandidates, dtlsParameters: info.dtlsParameters };
  }

  function codecSummary(rtpParameters) {
    const c = rtpParameters?.codecs?.[0];
    return c ? { mimeType: c.mimeType, payloadType: c.payloadType, parameters: c.parameters || {} } : null;
  }

  function candidateIps(info) {
    return (info.iceCandidates || []).map((c) => ({ ip: c.ip, port: c.port, protocol: c.protocol, type: c.type }));
  }

  /**
   * Par de candidatos ICE SELECIONADO de um transport do cliente (transport.selectedCandidatePairId
   * do getStats): onde o Chromium abriu o socket local e com qual endereco remoto falou.
   */
  async function selectedPair(transport, label) {
    if (!transport || typeof transport.getStats !== 'function') return { label, error: 'transport sem getStats' };
    try {
      const report = await withTimeout(transport.getStats(), 5000, `${label}.getStats`);
      const byId = new Map();
      report.forEach((v, k) => byId.set(v.id ?? k, v));
      const all = [...byId.values()];
      const tr = all.find((x) => x.type === 'transport' && x.selectedCandidatePairId);
      const pair = (tr && byId.get(tr.selectedCandidatePairId)) || all.find((x) => x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded');
      if (!pair) return { label, error: 'nenhum par de candidatos selecionado no getStats' };
      const side = (c) => (c ? { address: c.address ?? c.ip ?? null, port: c.port ?? null, protocol: c.protocol ?? null, candidateType: c.candidateType ?? null } : null);
      return { label, state: pair.state ?? null, local: side(byId.get(pair.localCandidateId)), remote: side(byId.get(pair.remoteCandidateId)) };
    } catch (err) {
      return { label, error: String(err?.message || err) };
    }
  }

  async function sampleOnce(deps, producer, records) {
    const t = deps.now();
    const wall = deps.wall();
    const reads = await Promise.all([
      withTimeout(producer.getStats(), 5000, 'producer.getStats'),
      ...records.map((r) => (r.closed ? Promise.resolve(null) : withTimeout(r.consumer.getStats(), 5000, 'consumer.getStats'))),
    ]);
    const senderRead = M.readSender(reads[0]);
    const sample = {
      t,
      wall,
      sender: senderRead ? { v: M.pick(senderRead, M.SENDER_FIELDS, {}), streams: senderRead.streams, ssrcs: senderRead.ssrcs, frameWidth: senderRead.frameWidth, frameHeight: senderRead.frameHeight, codec: senderRead.codec, encoderImplementation: senderRead.encoderImplementation, qualityLimitationReason: senderRead.qualityLimitationReason } : null,
      consumers: records.map((r, i) => {
        const rx = reads[i + 1] ? M.readReceiver(reads[i + 1]) : null;
        if (!rx) return null;
        return { v: M.pick(rx, M.RECEIVER_FIELDS, {}), frameWidth: rx.frameWidth, frameHeight: rx.frameHeight, codec: rx.codec, decoderImplementation: rx.decoderImplementation, jitter: rx.jitter };
      }),
    };
    return sample;
  }

  /**
   * Roda o cenario inteiro. Devolve dados BRUTOS (passos, amostras, stats do
   * servidor); quem decide aprovado/reprovado e lib/evaluate.js.
   */
  async function runScenario(deps, cfg) {
    const { rpc } = deps;
    const steps = [];
    const step = (name, extra) => { steps.push({ t: deps.now(), step: name, ...extra }); };
    const cleanupErrors = [];
    const result = {
      steps,
      cleanupErrors,
      device: null,
      codec: null,
      producer: null,
      consumers: [],
      candidates: [],
      clientIce: [],
      samples: [],
      midClose: { requested: cfg.consumers >= 2, executed: false },
      server: { start: null, afterMidClose: null, end: null },
      timing: null,
    };

    const records = []; // um por consumidor: { index, peerId, recv, consumer, video, closed, info }
    let sendTransport = null;
    let producer = null;
    let producerPeerId = null;
    let produceEvents = 0;
    let rtpSenderCallbacks = 0;

    async function closeRecord(r, { reportErrors }) {
      if (r.closeStarted) return;
      r.closeStarted = true;
      const attempt = async (what, fn) => {
        try { await fn(); } catch (err) { if (reportErrors) cleanupErrors.push(`${what}: ${err?.message || err}`); }
      };
      await attempt(`consumidor ${r.index} video`, () => r.video?.stop());
      await attempt(`consumidor ${r.index} consumer.close`, () => r.consumer?.close());
      await attempt(`consumidor ${r.index} recvTransport.close`, () => r.recv?.close());
      await attempt(`consumidor ${r.index} leave`, () => rpc('leave', { peerId: r.peerId }));
      r.closed = true;
    }

    try {
      // 1) Device e capacidades do router
      const device = await deps.createDevice();
      const routerRtpCapabilities = await rpc('getRouterRtpCapabilities');
      await device.load({ routerRtpCapabilities });
      if (!device.canProduce('video')) throw new Error('o Device nao consegue produzir video com as capacidades do router');
      result.device = {
        handlerName: device.handlerName,
        // versao do mediasoup-client que realmente roda na pagina (a avaliacao compara com o pacote instalado)
        clientVersion: deps.clientVersion ?? null,
        routerCodecs: (routerRtpCapabilities.codecs || []).map((c) => c.mimeType),
        sendCodecs: (device.sendRtpCapabilities.codecs || []).map((c) => ({ mimeType: c.mimeType, parameters: c.parameters || {} })),
      };
      step('device-loaded', { handlerName: device.handlerName });

      // 2) Produtor: UM envio a SFU (um transport, um producer, uma codificacao)
      const joined = await rpc('join', { role: 'producer' });
      producerPeerId = joined.peerId;
      const sendInfo = await rpc('createTransport', { peerId: producerPeerId, direction: 'send' });
      result.candidates.push(...candidateIps(sendInfo));
      sendTransport = device.createSendTransport(transportOptions(sendInfo));
      sendTransport.on('connect', ({ dtlsParameters }, ok, fail) => {
        rpc('connectTransport', { peerId: producerPeerId, transportId: sendTransport.id, dtlsParameters }).then(() => ok(), fail);
      });
      sendTransport.on('produce', ({ kind, rtpParameters }, ok, fail) => {
        produceEvents += 1;
        step('produce-event', { n: produceEvents });
        rpc('produce', { peerId: producerPeerId, transportId: sendTransport.id, kind, rtpParameters }).then(({ id }) => ok({ id }), fail);
      });
      const picked = pickCodec(device.sendRtpCapabilities.codecs, cfg.codec);
      result.codec = { requested: picked.requested, selected: { mimeType: picked.codec.mimeType, parameters: picked.codec.parameters || {} }, fellBack: picked.fellBack, reason: picked.reason };
      producer = await withTimeout(sendTransport.produce({
        track: deps.track,
        codec: picked.codec,
        // Uma unica codificacao: sem simulcast nem SVC nesta entrega.
        encodings: [{ maxBitrate: cfg.bitrateKbps * 1000 }],
        codecOptions: { videoGoogleStartBitrate: Math.min(1000, cfg.bitrateKbps) },
        stopTracks: false,
        onRtpSender: () => { rtpSenderCallbacks += 1; },
      }), STEP_TIMEOUT_MS, 'produce');
      step('produced', { producerId: producer.id });
      await waitConnected(sendTransport, 'transport de envio');
      result.producer = {
        id: producer.id,
        produceEvents,
        rtpSenders: rtpSenderCallbacks,
        encodings: 1,
        rtpParametersCodec: codecSummary(producer.rtpParameters),
        sendTransportState: sendTransport.connectionState,
      };

      // 3) Consumidores: paused no servidor -> consume no cliente -> resume
      for (let i = 0; i < cfg.consumers; i += 1) {
        const { peerId } = await rpc('join', { role: 'consumer' });
        const rec = { index: i, peerId, recv: null, consumer: null, video: null, closed: false, closeStarted: false, info: null };
        records.push(rec);
        const recvInfo = await rpc('createTransport', { peerId, direction: 'recv' });
        result.candidates.push(...candidateIps(recvInfo));
        rec.recv = device.createRecvTransport(transportOptions(recvInfo));
        rec.recv.on('connect', ({ dtlsParameters }, ok, fail) => {
          rpc('connectTransport', { peerId, transportId: rec.recv.id, dtlsParameters }).then(() => ok(), fail);
        });
        const info = await rpc('consume', { peerId, transportId: rec.recv.id, producerId: producer.id, rtpCapabilities: device.recvRtpCapabilities });
        step('server-consume', { index: i, paused: info.paused, type: info.type });
        rec.consumer = await withTimeout(rec.recv.consume({ id: info.id, producerId: info.producerId, kind: info.kind, rtpParameters: info.rtpParameters }), STEP_TIMEOUT_MS, `consume ${i}`);
        step('client-consume', { index: i });
        await rpc('resumeConsumer', { peerId, consumerId: rec.consumer.id });
        step('server-resume', { index: i });
        await waitConnected(rec.recv, `transport de recepcao ${i}`);
        rec.video = deps.attachVideo(rec.consumer.track);
        rec.info = {
          consumerId: rec.consumer.id,
          peerId,
          type: info.type,
          createdPaused: info.paused === true,
          rtpParametersCodec: codecSummary(rec.consumer.rtpParameters),
          recvTransportState: rec.recv.connectionState,
        };
      }
      step('all-consumers-ready', { consumers: records.length });

      // 4) Aquecimento e medida
      await deps.sleep(cfg.warmupMs);
      result.server.start = await rpc('stats', { mark: 'start' });
      const t0 = deps.now();
      const midAt = cfg.durationMs / 2;
      let closeDone = false;
      result.samples.push(await sampleOnce(deps, producer, records));
      result.timing = { measureStartWall: deps.wall(), measureStart: t0 };
      while (deps.now() - t0 < cfg.durationMs) {
        await deps.sleep(cfg.sampleMs);
        if (!closeDone && cfg.consumers >= 2 && deps.now() - t0 >= midAt) {
          closeDone = true;
          const victim = records[1];
          const before = await sampleOnce(deps, producer, records);
          result.samples.push(before);
          const closeStart = deps.now();
          await closeRecord(victim, { reportErrors: true });
          step('mid-close', { index: victim.index });
          result.midClose = {
            requested: true, executed: true, index: victim.index, atSample: result.samples.length - 1,
            tMs: closeStart - t0,
          };
          result.server.afterMidClose = await rpc('stats', { mark: 'afterMidClose' });
        }
        result.samples.push(await sampleOnce(deps, producer, records));
      }
      result.clientIce.push(await selectedPair(sendTransport, 'envio'));
      for (const r of records) if (!r.closed) result.clientIce.push(await selectedPair(r.recv, `recepcao ${r.index}`));
      result.server.end = await rpc('stats', { mark: 'end' });
      result.timing.measureEndWall = deps.wall();
      result.timing.measureEnd = deps.now();
    } catch (err) {
      // O erro vai no resultado (o avaliador marca o cenario como falho); a limpeza roda no finally.
      result.error = String(err?.message || err);
      step('error', { message: result.error });
    } finally {
      result.consumers = records.map((r) => ({ ...(r.info || {}), index: r.index, peerId: r.peerId, closedMidTest: r.closed && result.midClose.index === r.index }));
      // Limpeza idempotente: cada passo e tentado e o erro registrado, nunca engolido.
      for (const r of records) await closeRecord(r, { reportErrors: true });
      const attempt = async (what, fn) => {
        try { await fn(); } catch (err) { cleanupErrors.push(`${what}: ${err?.message || err}`); }
      };
      if (producer) await attempt('producer.close', () => producer.close());
      if (sendTransport) await attempt('sendTransport.close', () => sendTransport.close());
      if (producerPeerId) await attempt('produtor leave', () => rpc('leave', { peerId: producerPeerId }));
      step('cleanup-done', { errors: cleanupErrors.length });
    }
    return result;
  }

  const api = { pickCodec, waitConnected, withTimeout, runScenario, STEP_TIMEOUT_MS };
  root.SfuSpike = root.SfuSpike || {};
  root.SfuSpike.flow = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
