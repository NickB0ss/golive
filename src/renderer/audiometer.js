'use strict';

// P7 (auditoria 2026-09-18, anexo 5-produto.md): tres caminhos de audio
// diferentes (loopback do Electron, captura nativa por processo, lista de
// inclusao -- ver app.js, "Audio por processo") e nenhuma verificacao de
// que sai amostra. Este modulo e so a DECISAO (nivel + veredicto de
// silencio), puro e testavel sem AudioContext/AnalyserNode; quem le o
// hardware e app.js, mesma divisao de capturewatch.js/health.js.
(function (root) {
  const SILENCE_MS_DEFAULT = 20000;

  /** Le uma janela de amostras de dominio do tempo (o que
   * `AnalyserNode.getByteTimeDomainData` devolve: inteiros 0-255 centrados
   * em 128) e tira pico e RMS, normalizados em 0..1. Aceita qualquer
   * array-like (Uint8Array de verdade, ou um array puro nos testes). */
  function level(samples) {
    if (!samples || !samples.length) return { peak: 0, rms: 0 };
    let peak = 0;
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const dev = Math.abs(samples[i] - 128) / 128;
      if (dev > peak) peak = dev;
      sumSquares += dev * dev;
    }
    return { peak, rms: Math.sqrt(sumSquares / samples.length) };
  }

  /** `history`: lista cronologica de `{ atMs, peak }` -- uma entrada por
   * amostra que o AnalyserNode entregou. Empilhada SO enquanto o
   * AudioContext estava 'running': um contexto suspenso (janela
   * minimizada) devolve silencio falso, e o sound.js ja aprendeu isso na
   * 0.12.1 -- por isso a decisao aqui e SO sobre o relogio das entradas que
   * de fato chegaram, nunca sobre o relogio de parede. Quem chama
   * simplesmente nao empilha nada enquanto o contexto esta suspenso, e o
   * "tempo em silencio" para de andar sozinho.
   *
   * Silencio ABSOLUTO (pico === 0, nunca "quase zero") por `silenceMs`
   * seguidos -- qualquer amostra com som quebra a sequencia e reinicia a
   * contagem. Devolve true so quando a sequencia SILENCIOSA mais recente
   * cobre a janela inteira. */
  function silenceVerdict(history, nowMs, silenceMs = SILENCE_MS_DEFAULT) {
    if (!Array.isArray(history) || !history.length) return false;
    let since = null;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const h = history[i];
      if (!h || h.peak !== 0) break; // som (ou entrada invalida) quebra a sequencia
      since = h.atMs;
    }
    return since !== null && Number(nowMs) - since >= silenceMs;
  }

  const api = { SILENCE_MS_DEFAULT, level, silenceVerdict };

  root.GoLive = root.GoLive || {};
  root.GoLive.audiometer = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
