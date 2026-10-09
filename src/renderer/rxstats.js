'use strict';

(function (root) {
  const tx = typeof module !== 'undefined' ? module.require('./txstats') : root.GoLive.txstats;
  /** Le um relatorio de getStats de UMA conexao de ENTRADA e devolve os
   * campos que respondem a pergunta do espectador: "esta travando pra mim,
   * e a culpa e de quem?".
   *
   * Complementa txstats.js do outro lado do fio; ausencia de campo e null. */
  function readReceiverReport(report) {
    const stats = [];
    report?.forEach((s) => stats.push(s));
    const rtp = stats.filter((s) => s.type === 'inbound-rtp' && (s.kind || s.mediaType) === 'video');
    const codec = tx.referenced(stats, rtp, 'codecId', (s) => s.type === 'codec' && tx.primaryCodec(s));
    const sample = { fps: tx.aggregate(rtp, 'framesPerSecond', 'max'),
      width: tx.aggregate(rtp, 'frameWidth', 'max'), height: tx.aggregate(rtp, 'frameHeight', 'max'),
      codec: codec?.mimeType.split('/')[1] || null,
      decoder: rtp.find((s) => s.decoderImplementation)?.decoderImplementation || null,
      rtpIds: rtp.map((s) => s.id || s.ssrc || '').sort().join('|'),
    };
    for (const field of ['packetsReceived', 'packetsLost', 'bytesReceived', 'framesReceived',
      'freezeCount', 'framesDecoded', 'jitterBufferDelay', 'jitterBufferEmittedCount']) {
      sample[field] = tx.aggregate(rtp, field);
    }
    return sample;
  }

  /** Perda sobre o total OFERECIDO (recebidos + perdidos). null quando nada
   * chegou: dizer "0% de perda" pra uma conexao muda seria mentira. */
  function lossPercent(sample) {
    if (tx.numeric(sample?.packetsLost) == null || tx.numeric(sample?.packetsReceived) == null) return null;
    const lost = Math.max(0, sample?.packetsLost || 0);
    const offered = (sample?.packetsReceived || 0) + lost;
    if (!offered) return null;
    return (lost / offered) * 100;
  }

  /** Espera recente no buffer, em ms, entre amostras da mesma entrada.
   * Nao mede latencia ponta-a-ponta e nao usa media desde o inicio. */
  function jitterBufferMs(sample, prev) {
    if (!prev || sample?.rtpIds !== prev.rtpIds) return null;
    const delay = tx.delta(sample, prev, 'jitterBufferDelay');
    const emitted = tx.delta(sample, prev, 'jitterBufferEmittedCount');
    return delay != null && emitted > 0 ? delay * 1000 / emitted : null;
  }

  // Nomes de decoder de software que o Chromium reporta em
  // decoderImplementation. Hardware costuma ser "DXVA...", "D3D11...",
  // "VideoToolbox", "MediaCodec..." -- a lista de software e mais curta e
  // mais estavel, entao o teste e por inclusao dela.
  const SOFTWARE_DECODERS = ['ffmpeg', 'libvpx', 'dav1d', 'openh264', 'vpxvideodecoder', 'dav1dvideodecoder'];

  function isSoftwareDecoder(impl) {
    const s = String(impl || '').toLowerCase();
    return SOFTWARE_DECODERS.some((n) => s.includes(n));
  }

  /** Deriva a SAUDE DE RECEPCAO da janela entre duas amostras da mesma
   * conexao de entrada. `cur`/`prev` sao retornos de readReceiverReport;
   * `dtMs` o intervalo entre eles.
   *
   * null quando prev e ausente ou nenhum quadro foi decodificado na janela:
   * ausencia nao e diagnostico -- mesmo criterio do autoquality e do
   * tree.js. Os contadores da spec do WebRTC podem andar pra tras (reordem,
   * duplicata), entao todo delta e preso em >= 0. */
  function receiveHealth(cur, prev, dtMs) {
    if (!cur || !prev || !(Number(dtMs) > 0)) return null;
    if (cur.rtpIds !== prev.rtpIds) return null;
    if (tx.delta(cur, prev, 'framesDecoded') == null
      || tx.delta(cur, prev, 'packetsReceived') == null
      || tx.numeric(cur.packetsLost) == null || tx.numeric(prev.packetsLost) == null
      || tx.numeric(cur.freezeCount) == null || tx.numeric(prev.freezeCount) == null) return null;
    const framesDelta = (cur.framesDecoded || 0) - (prev.framesDecoded || 0);
    if (framesDelta <= 0) return null;

    const lostDelta = Math.max(0, (cur.packetsLost || 0) - (prev.packetsLost || 0));
    const recvDelta = Math.max(0, (cur.packetsReceived || 0) - (prev.packetsReceived || 0));
    const offered = lostDelta + recvDelta;
    const lossPct = offered ? (lostDelta / offered) * 100 : 0;

    const freezeDelta = Math.max(0, (cur.freezeCount || 0) - (prev.freezeCount || 0));
    const freezeRate = (freezeDelta / dtMs) * 60000;

    return { lossPct, freezeRate, softwareDecoder: isSoftwareDecoder(cur.decoder) };
  }

  function createTracker() {
    let connections = new WeakMap();
    return {
      measure(key, pc, sample, atMs) {
        if (!pc) return { health: null, bufferMs: null };
        let kinds = connections.get(pc);
        if (!kinds) connections.set(pc, kinds = new Map());
        const prev = kinds.get(key);
        kinds.set(key, { sample, atMs });
        const dt = atMs - prev?.atMs;
        return { health: receiveHealth(sample, prev?.sample, dt),
          bufferMs: dt > 0 ? jitterBufferMs(sample, prev?.sample) : null };
      },
      clear() { connections = new WeakMap(); },
    };
  }
  const api = { readReceiverReport, lossPercent, jitterBufferMs, receiveHealth, createTracker };

  root.GoLive = root.GoLive || {};
  root.GoLive.rxstats = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
