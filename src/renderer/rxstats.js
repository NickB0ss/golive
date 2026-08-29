'use strict';

(function (root) {
  /** Le um relatorio de getStats de UMA conexao de ENTRADA e devolve os
   * campos que respondem a pergunta do espectador: "esta travando pra mim,
   * e a culpa e de quem?".
   *
   * Espelha readSenderReport (app.js), do outro lado do fio. Aqui vive num
   * modulo separado, e nao em app.js, porque app.js nao tem harness de
   * teste -- ver a restricao 4 do plano. */
  function readReceiverReport(report) {
    const sample = {
      fps: 0,
      width: 0,
      height: 0,
      packetsReceived: 0,
      packetsLost: 0,
      freezeCount: 0,
      framesDecoded: 0,
      // Acumulados desde o inicio da conexao: a RAZAO entre os dois e que
      // tem significado (segundos de buffer por quadro emitido).
      jitterBufferDelay: 0,
      jitterBufferEmittedCount: 0,
      decoder: '',
      codec: '',
    };

    report.forEach((stat) => {
      if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
        sample.fps = Math.max(sample.fps, stat.framesPerSecond || 0);
        sample.width = stat.frameWidth || sample.width;
        sample.height = stat.frameHeight || sample.height;
        sample.packetsReceived += stat.packetsReceived || 0;
        sample.packetsLost += stat.packetsLost || 0;
        sample.freezeCount += stat.freezeCount || 0;
        sample.framesDecoded += stat.framesDecoded || 0;
        sample.jitterBufferDelay += stat.jitterBufferDelay || 0;
        sample.jitterBufferEmittedCount += stat.jitterBufferEmittedCount || 0;
        if (stat.decoderImplementation) sample.decoder = stat.decoderImplementation;
      }
      if (stat.type === 'codec' && stat.mimeType?.startsWith('video/')) {
        sample.codec = stat.mimeType.split('/')[1];
      }
    });

    return sample;
  }

  /** Perda sobre o total OFERECIDO (recebidos + perdidos). null quando nada
   * chegou: dizer "0% de perda" pra uma conexao muda seria mentira. */
  function lossPercent(sample) {
    const offered = (sample?.packetsReceived || 0) + (sample?.packetsLost || 0);
    if (!offered) return null;
    return ((sample.packetsLost || 0) / offered) * 100;
  }

  /** Quanto tempo o quadro medio esperou no buffer, em ms. E a latencia que
   * o app pode reduzir sozinho -- ver jitterBufferTarget em mesh.js. */
  function jitterBufferMs(sample) {
    if (!sample?.jitterBufferEmittedCount) return null;
    return (sample.jitterBufferDelay / sample.jitterBufferEmittedCount) * 1000;
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

  const api = { readReceiverReport, lossPercent, jitterBufferMs, receiveHealth };

  root.GoLive = root.GoLive || {};
  root.GoLive.rxstats = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
