'use strict';

/*
 * Leitura e contas de getStats() da prova de conceito de SFU. Puro e UMD:
 * a pagina carrega como <script> e o node:test (e o avaliador do main) como
 * modulo. Regras (as mesmas da bancada de midia):
 *  - campo ausente = null, nunca zero inventado;
 *  - contador que anda para tras (reinicio) = janela null;
 *  - taxa = delta / delta de tempo entre duas amostras.
 */
(function (root) {
  function values(report) {
    if (!report) return [];
    if (typeof report.values === 'function') return Array.from(report.values());
    return Array.isArray(report) ? report : [];
  }

  function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  function sumField(list, name) {
    let total = 0;
    let seen = false;
    for (const item of list) {
      const v = num(item[name]);
      if (v !== null) { total += v; seen = true; }
    }
    return seen ? total : null;
  }

  function codecOf(report, stat) {
    if (!stat || !stat.codecId) return null;
    const c = values(report).find((s) => s.type === 'codec' && s.id === stat.codecId);
    if (!c) return null;
    return { mimeType: c.mimeType ?? null, payloadType: num(c.payloadType), sdpFmtpLine: c.sdpFmtpLine ?? null };
  }

  /** Estatisticas de envio de video (soma de todos os streams RTP; `streams` conta quantos). */
  function readSender(report) {
    const out = values(report).filter((s) => s.type === 'outbound-rtp' && (s.kind === 'video' || s.mediaType === 'video'));
    if (!out.length) return null;
    const first = out[0];
    return {
      streams: out.length,
      ssrcs: out.map((s) => s.ssrc),
      framesEncoded: sumField(out, 'framesEncoded'),
      framesSent: sumField(out, 'framesSent'),
      packetsSent: sumField(out, 'packetsSent'),
      bytesSent: sumField(out, 'bytesSent'),
      keyFramesEncoded: sumField(out, 'keyFramesEncoded'),
      nackCount: sumField(out, 'nackCount'),
      pliCount: sumField(out, 'pliCount'),
      frameWidth: num(first.frameWidth),
      frameHeight: num(first.frameHeight),
      qualityLimitationReason: first.qualityLimitationReason ?? null,
      encoderImplementation: first.encoderImplementation ?? null,
      codec: codecOf(report, first),
    };
  }

  function readReceiver(report) {
    const inb = values(report).filter((s) => s.type === 'inbound-rtp' && (s.kind === 'video' || s.mediaType === 'video'));
    if (!inb.length) return null;
    const first = inb[0];
    return {
      streams: inb.length,
      framesReceived: sumField(inb, 'framesReceived'),
      framesDecoded: sumField(inb, 'framesDecoded'),
      framesDropped: sumField(inb, 'framesDropped'),
      packetsReceived: sumField(inb, 'packetsReceived'),
      packetsLost: sumField(inb, 'packetsLost'),
      bytesReceived: sumField(inb, 'bytesReceived'),
      keyFramesDecoded: sumField(inb, 'keyFramesDecoded'),
      freezeCount: sumField(inb, 'freezeCount'),
      jitter: num(first.jitter),
      frameWidth: num(first.frameWidth),
      frameHeight: num(first.frameHeight),
      decoderImplementation: first.decoderImplementation ?? null,
      codec: codecOf(report, first),
    };
  }

  /** Delta de contador; null se faltar dado ou o contador regredir. */
  function counterDelta(a, b) {
    const x = num(a);
    const y = num(b);
    if (x === null || y === null || y < x) return null;
    return y - x;
  }

  /**
   * Janela entre duas amostras { t (ms), v: {campo: numero} }.
   * Devolve { seconds, deltas, perSec } so para os campos pedidos.
   */
  function windowBetween(s0, s1, fields) {
    if (!s0 || !s1 || !s0.v || !s1.v) return null;
    const seconds = (s1.t - s0.t) / 1000;
    if (!(seconds > 0)) return null;
    const deltas = {};
    const perSec = {};
    for (const f of fields) {
      const d = counterDelta(s0.v[f], s1.v[f]);
      deltas[f] = d;
      perSec[f] = d === null ? null : d / seconds;
    }
    return { seconds, deltas, perSec };
  }

  /** Subconjunto numerico do que a amostra guarda (menor para o relatorio). */
  const SENDER_FIELDS = ['framesEncoded', 'framesSent', 'packetsSent', 'bytesSent', 'keyFramesEncoded', 'nackCount', 'pliCount'];
  const RECEIVER_FIELDS = ['framesReceived', 'framesDecoded', 'framesDropped', 'packetsReceived', 'packetsLost', 'bytesReceived', 'keyFramesDecoded', 'freezeCount'];

  function pick(obj, fields, extra) {
    const v = {};
    for (const f of fields) v[f] = obj ? num(obj[f]) : null;
    return { ...v, ...extra };
  }

  const api = { values, readSender, readReceiver, counterDelta, windowBetween, pick, SENDER_FIELDS, RECEIVER_FIELDS };
  root.SfuSpike = root.SfuSpike || {};
  root.SfuSpike.metrics = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
