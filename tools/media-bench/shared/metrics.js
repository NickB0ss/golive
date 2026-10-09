'use strict';

/*
 * Metricas da bancada: leitura de getStats e contas de janela, PURAS (sem
 * RTCPeerConnection). Reaproveita txstats/rxstats de producao -- o que o
 * app mede e o que a bancada mede -- e so acrescenta o que a producao nao
 * le (tempo de decode, quadros descartados, jitter, tipo de candidato).
 *
 * Regras que os testes seguram:
 *   - campo ausente e null, nunca 0;
 *   - contador que anda pra tras (reinicio de conexao) NAO vira taxa: a
 *     janela inteira vira null;
 *   - RTT de transporte (`rttMs`) NAO e latencia ponta a ponta;
 *   - numero de senders NAO e contagem medida de sessoes de encoder de
 *     hardware (o Chromium nao expoe isso).
 */
(function (root) {
  const tx = typeof module !== 'undefined' ? module.require('../../../src/renderer/txstats') : root.GoLive.txstats;
  const rx = typeof module !== 'undefined' ? module.require('../../../src/renderer/rxstats') : root.GoLive.rxstats;

  const num = tx.numeric;

  function toArray(report) {
    if (Array.isArray(report)) return report.slice();
    const out = [];
    report?.forEach?.((s) => out.push(s));
    return out;
  }

  const isVideo = (s) => (s.kind || s.mediaType) === 'video';

  /** Tipos de candidato do par escolhido: prova de que nao houve STUN/TURN. */
  function selectedCandidateTypes(report) {
    const stats = toArray(report);
    const transport = stats.find((s) => s.type === 'transport' && s.selectedCandidatePairId != null);
    const pair = transport
      ? stats.find((s) => s.id === transport.selectedCandidatePairId)
      : stats.find((s) => s.type === 'candidate-pair' && (s.selected === true || (s.nominated && s.state === 'succeeded')));
    const local = pair ? stats.find((s) => s.id === pair.localCandidateId) : null;
    const remote = pair ? stats.find((s) => s.id === pair.remoteCandidateId) : null;
    return {
      local: local?.candidateType ?? null,
      remote: remote?.candidateType ?? null,
      protocol: local?.protocol ?? null,
    };
  }

  /** Amostra de um RTCPeerConnection que ENVIA video. */
  function readSender(report) {
    const base = tx.readSenderReport(report);
    const rtp = toArray(report).filter((s) => s.type === 'outbound-rtp' && isVideo(s) && !s.isRemote);
    return {
      ...base,
      keyFramesEncoded: tx.aggregate(rtp, 'keyFramesEncoded'),
      nackCount: tx.aggregate(rtp, 'nackCount'),
      pliCount: tx.aggregate(rtp, 'pliCount'),
      candidates: selectedCandidateTypes(report),
    };
  }

  /** Amostra de um RTCPeerConnection que RECEBE video. */
  function readReceiver(report) {
    const base = rx.readReceiverReport(report);
    const rtp = toArray(report).filter((s) => s.type === 'inbound-rtp' && isVideo(s));
    const eficiente = rtp.map((s) => s.powerEfficientDecoder);
    const jitter = tx.aggregate(rtp, 'jitter', 'max');
    return {
      ...base,
      totalDecodeTime: tx.aggregate(rtp, 'totalDecodeTime'),
      framesDropped: tx.aggregate(rtp, 'framesDropped'),
      keyFramesDecoded: tx.aggregate(rtp, 'keyFramesDecoded'),
      pliCount: tx.aggregate(rtp, 'pliCount'),
      jitterMs: jitter == null ? null : jitter * 1000,
      powerEfficientDecoder: eficiente.length && eficiente.every((v) => typeof v === 'boolean')
        ? eficiente.every(Boolean) : null,
      candidates: selectedCandidateTypes(report),
    };
  }

  const validDt = (dtMs) => Number.isFinite(dtMs) && dtMs > 0;

  /** true quando algum contador andou pra tras entre duas amostras. */
  function regressed(cur, prev, fields) {
    return fields.some((k) => num(cur?.[k]) != null && num(prev?.[k]) != null && cur[k] < prev[k]);
  }

  const NULL_SENDER = { encodedFps: null, sentFps: null, msPerFrame: null, mbps: null };
  const NULL_RECEIVER = {
    decodedFps: null, decodeMsPerFrame: null, bufferMs: null, mbps: null, freezes: null, dropped: null, lossPct: null,
  };

  /** Taxas de UMA janela entre duas amostras de sender. Reinicio => tudo null. */
  function senderWindow(cur, prev, dtMs) {
    if (!cur || !prev || !validDt(dtMs) || cur.rtpIds !== prev.rtpIds) return { ...NULL_SENDER };
    if (regressed(cur, prev, ['bytesSent', 'framesEncoded', 'framesSent', 'totalEncodeTime'])) return { ...NULL_SENDER };
    const rates = tx.deriveRates(cur, prev, dtMs);
    const enc = tx.delta(cur, prev, 'framesEncoded');
    const sent = tx.delta(cur, prev, 'framesSent');
    return {
      encodedFps: enc == null ? null : enc * 1000 / dtMs,
      sentFps: sent == null ? null : sent * 1000 / dtMs,
      msPerFrame: rates.msPerFrame,
      mbps: rates.mbps,
    };
  }

  /** Taxas de UMA janela entre duas amostras de receiver. */
  function receiverWindow(cur, prev, dtMs) {
    if (!cur || !prev || !validDt(dtMs) || cur.rtpIds !== prev.rtpIds) return { ...NULL_RECEIVER };
    if (regressed(cur, prev, ['bytesReceived', 'framesDecoded', 'totalDecodeTime', 'framesDropped', 'freezeCount'])) {
      return { ...NULL_RECEIVER };
    }
    const dec = tx.delta(cur, prev, 'framesDecoded');
    const time = tx.delta(cur, prev, 'totalDecodeTime');
    const bytes = tx.delta(cur, prev, 'bytesReceived');
    const health = rx.receiveHealth(cur, prev, dtMs);
    return {
      decodedFps: dec == null ? null : dec * 1000 / dtMs,
      decodeMsPerFrame: dec > 0 && time != null ? time * 1000 / dec : null,
      bufferMs: rx.jitterBufferMs(cur, prev),
      mbps: bytes == null ? null : bytes * 8 / dtMs / 1000,
      freezes: tx.delta(cur, prev, 'freezeCount'),
      dropped: tx.delta(cur, prev, 'framesDropped'),
      lossPct: health ? health.lossPct : null,
    };
  }

  /** Estatistica de uma serie ignorando null/NaN. Serie vazia => tudo null. */
  function stat(values) {
    const v = (values || []).filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return { n: 0, min: null, median: null, mean: null, p95: null, max: null };
    const mid = (v.length - 1) / 2;
    const median = (v[Math.floor(mid)] + v[Math.ceil(mid)]) / 2;
    const p95 = v[Math.min(v.length - 1, Math.ceil(0.95 * v.length) - 1)];
    return { n: v.length, min: v[0], median, mean: v.reduce((a, b) => a + b, 0) / v.length, p95, max: v[v.length - 1] };
  }

  const uniq = (list) => [...new Set(list.filter((x) => x != null && x !== ''))];
  const lastNonNull = (list) => {
    for (let i = list.length - 1; i >= 0; i--) if (list[i] != null) return list[i];
    return null;
  };

  /** Diferenca ultimo-primeiro de um contador; null se faltou ou regrediu. */
  function totalDelta(samples, field) {
    // Primeira e ultima MEDIDAS: a recepcao pode ainda nao ter o contador na
    // primeira amostra (relay com varios viewers sobe mais devagar), e isso
    // nao e ausencia de quadros. Um valor so nao mede intervalo.
    const values = samples.map((s) => num(s?.[field])).filter((v) => v != null);
    if (values.length < 2) return null;
    const a = values[0];
    const b = values[values.length - 1];
    return b < a ? null : b - a;
  }

  /**
   * Resume um no (um sender ou um receiver) a partir das amostras brutas
   * `[{ atMs, sample }]`. Com menos de 2 amostras nao ha janela.
   */
  function summarizeNode(node) {
    const pts = node.samples || [];
    const samples = pts.map((p) => p.sample);
    const win = [];
    for (let i = 1; i < pts.length; i++) {
      const dt = pts[i].atMs - pts[i - 1].atMs;
      win.push(node.kind === 'sender'
        ? senderWindow(pts[i].sample, pts[i - 1].sample, dt)
        : receiverWindow(pts[i].sample, pts[i - 1].sample, dt));
    }
    const col = (k) => win.map((w) => w[k]);
    const out = {
      role: node.role, label: node.label, kind: node.kind,
      samples: pts.length, windows: win.length,
      width: lastNonNull(samples.map((s) => s.width)),
      height: lastNonNull(samples.map((s) => s.height)),
      codec: lastNonNull(samples.map((s) => s.codec)),
      candidates: lastNonNull(samples.map((s) => s.candidates)),
    };
    if (node.kind === 'sender') {
      return {
        ...out,
        fps: stat(col('encodedFps')), sentFps: stat(col('sentFps')),
        msPerFrame: stat(col('msPerFrame')), mbps: stat(col('mbps')),
        // Latencia de ida e volta do TRANSPORTE; nao e atraso do video.
        rttMs: stat(samples.map((s) => s.rtt)),
        encoders: uniq(samples.map((s) => s.encoder)),
        powerEfficientEncoder: lastNonNull(samples.map((s) => s.powerEfficient)),
        limitations: uniq(samples.map((s) => s.limitation)),
        framesEncodedTotal: totalDelta(samples, 'framesEncoded'),
        keyFramesEncodedTotal: totalDelta(samples, 'keyFramesEncoded'),
        pliTotal: totalDelta(samples, 'pliCount'),
        nackTotal: totalDelta(samples, 'nackCount'),
      };
    }
    return {
      ...out,
      fps: stat(col('decodedFps')), decodeMsPerFrame: stat(col('decodeMsPerFrame')),
      bufferMs: stat(col('bufferMs')), mbps: stat(col('mbps')), lossPct: stat(col('lossPct')),
      jitterMs: stat(samples.map((s) => s.jitterMs)),
      decoders: uniq(samples.map((s) => s.decoder)),
      powerEfficientDecoder: lastNonNull(samples.map((s) => s.powerEfficientDecoder)),
      framesDecodedTotal: totalDelta(samples, 'framesDecoded'),
      framesDroppedTotal: totalDelta(samples, 'framesDropped'),
      freezeTotal: totalDelta(samples, 'freezeCount'),
    };
  }

  const sumOrNull = (list) => (list.length && list.every((x) => x != null) ? list.reduce((a, b) => a + b, 0) : null);

  /** Agrupa os resumos de no por papel. */
  function summarizeRoles(nodeSummaries) {
    const roles = {};
    for (const n of nodeSummaries) (roles[n.role] ||= []).push(n);
    const out = {};
    for (const [role, list] of Object.entries(roles)) {
      const fps = stat(list.map((n) => n.fps.median));
      out[role] = {
        count: list.length,
        fpsMedian: fps.median,
        fpsMin: fps.min,
        msPerFrameMedian: stat(list.map((n) => (n.msPerFrame || n.decodeMsPerFrame).median)).median,
        mbpsMeanTotal: sumOrNull(list.map((n) => n.mbps.mean)),
        encoders: uniq(list.flatMap((n) => n.encoders || [])),
        decoders: uniq(list.flatMap((n) => n.decoders || [])),
        codecs: uniq(list.map((n) => n.codec)),
        resolutions: uniq(list.map((n) => (n.width != null && n.height != null ? `${n.width}x${n.height}` : null))),
        bufferMsMedian: list[0].bufferMs ? stat(list.map((n) => n.bufferMs.median)).median : null,
      };
    }
    return out;
  }

  /**
   * Problemas objetivos de um cenario. `problems` reprovam o cenario;
   * `notes` so avisam (a medicao continua valida).
   */
  function evaluateScenario(nodes, config) {
    const problems = [];
    const notes = [];
    for (const n of nodes) {
      if (n.kind === 'receiver' && n.role === 'viewer-receiver' && !(n.framesDecodedTotal > 0)) {
        problems.push(`sem quadros decodificados em ${n.label}`);
      }
      if (n.kind === 'sender' && !(n.framesEncodedTotal > 0)) {
        problems.push(`sem quadros codificados em ${n.label}`);
      }
      if (n.codec && config.codec && !n.codec.toLowerCase().includes(config.codec.toLowerCase())) {
        notes.push(`${n.label}: codec negociado ${n.codec} (pedido ${config.codec})`);
      }
      const c = n.candidates;
      if (c && (c.local === 'srflx' || c.local === 'relay' || c.remote === 'srflx' || c.remote === 'relay')) {
        notes.push(`${n.label}: par de candidatos nao e host (${c.local}/${c.remote})`);
      }
    }
    const senders = nodes.filter((n) => n.kind === 'sender');
    if (senders.length && senders.every((n) => !(n.encoders && n.encoders.length))) {
      // Medido no Electron 44: sem captura ativa o Chromium omite
      // encoderImplementation/decoderImplementation/powerEfficient* do getStats
      // (a cena sintetica nao captura nada). Nao e "software": e desconhecido.
      notes.push('encoder/decoder desconhecidos: getStats nao expoe a implementacao sem captura ativa (use source=owned-window)');
    }
    return { problems, notes };
  }

  /**
   * Confere a fonte MEDIDA (track.getSettings()) contra o cenario pedido.
   * So faz sentido na janela propria (a cena sintetica e exata por construcao).
   * Devolve avisos; tolerancia de 2 px (arredondamento DIP x escala) e 1 fps.
   */
  function compareSource(config, measured, ownedWindow) {
    const notes = [];
    if (!measured || measured.width == null || measured.height == null) {
      notes.push('resolucao da fonte nao medida: track.getSettings() nao informou width/height');
    } else if (Math.abs(measured.width - config.width) > 2 || Math.abs(measured.height - config.height) > 2) {
      let why = '';
      if (ownedWindow?.clamped) why = ' (janela limitada a area de trabalho do monitor)';
      notes.push(`resolucao medida da fonte ${measured.width}x${measured.height} difere da pedida ${config.width}x${config.height}${why}`);
    }
    if (measured && Number.isFinite(measured.frameRate) && Math.abs(measured.frameRate - config.fps) > 1) {
      notes.push(`fps medido da fonte ${measured.frameRate} difere do pedido ${config.fps}`);
    }
    return notes;
  }

  const api = {
    compareSource, toArray, selectedCandidateTypes, readSender, readReceiver, senderWindow, receiverWindow,
    stat, summarizeNode, summarizeRoles, evaluateScenario, totalDelta,
  };
  root.MediaBench = root.MediaBench || {};
  root.MediaBench.metrics = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
