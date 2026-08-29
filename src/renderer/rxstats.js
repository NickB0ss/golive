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

  const api = { readReceiverReport, lossPercent, jitterBufferMs };

  root.GoLive = root.GoLive || {};
  root.GoLive.rxstats = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
