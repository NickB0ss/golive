'use strict';

(function (root) {
  const SCREEN_HEIGHTS = [1080, 720, 540, 360];
  const MIN_SCREEN_BITRATE_BPS = 800_000;
  const BWE_EWMA_ALPHA = 0.25;
  const DOWN_HOLD_MS = 5000;
  const UP_HOLD_MS = 15000;

  // Os limiares de descida ficam abaixo do bitrate normal de cada degrau;
  // a subida pede cerca de 25% de folga. Cinco segundos filtram uma
  // oscilacao curta do GCC, e quinze para subir evitam ping-pong depois de
  // recuperar de perda. 360p e o piso: abaixo dele so baixar fps preserva o
  // H.264 hardware do Chromium 128.
  const BWE_BPS = {
    1080: { down: 4_500_000, up: Infinity },
    720: { down: 1_800_000, up: 7_500_000 },
    540: { down: 1_100_000, up: 3_200_000 },
    360: { down: 0, up: 1_900_000 },
  };

  function outputDimension(dimension, scaleDownBy) {
    // Chromium 128, third_party/webrtc/media/engine/webrtc_video_engine.cc
    // ScaleDownResolution (l. 108-117) entrega inteiro de dim / scale. Aqui
    // usamos truncamento explicito para nunca aceitar uma dimensao impar por
    // arredondamento; H.264 hardware recusa impar e altura <= 359.
    return Math.trunc(dimension / scaleDownBy);
  }

  function acceptable(width, height) {
    return width >= 2 && height >= 360 && width % 2 === 0 && height % 2 === 0;
  }

  /** Devolve o fator que produz exatamente targetHeight, ou null quando a
   * divisao produz quadro que o H.264 hardware nao aceita. */
  function scaleDownByForHeight(captureWidth, captureHeight, targetHeight) {
    const width = Number(captureWidth);
    const height = Number(captureHeight);
    const target = Number(targetHeight);
    if (!(width > 0) || !(height >= 360) || !SCREEN_HEIGHTS.includes(target) || target > height) return null;
    const scaleDownBy = height / target;
    const outWidth = outputDimension(width, scaleDownBy);
    const outHeight = outputDimension(height, scaleDownBy);
    return outHeight === target && acceptable(outWidth, outHeight) ? scaleDownBy : null;
  }

  /** O degrau e um teto, nao uma altura obrigatoria: se ele ja cobre a
   * captura, preserva a resolucao nativa. Quando o alvo nao fecha par, sobe
   * somente dentro do teto do preset; sem opcao segura, P1 ainda garante que
   * o sender receba bitrate/fps em vez de ficar sem encoding. */
  function nearestAcceptableScale(captureWidth, captureHeight, targetHeight, maxHeight, minScaleDownBy) {
    const width = Number(captureWidth);
    const capHeight = Number(captureHeight);
    const requested = Number(targetHeight);
    const ceiling = highestAllowedHeight(Number(maxHeight) || SCREEN_HEIGHTS[0]) || SCREEN_HEIGHTS[SCREEN_HEIGHTS.length - 1];
    if (requested >= capHeight && acceptable(width, capHeight)) return { height: capHeight, scaleDownBy: 1 };
    const candidates = SCREEN_HEIGHTS
      .filter((height) => height >= requested && height <= Math.min(ceiling, capHeight))
      .sort((a, b) => a - b);
    for (const height of candidates) {
      const scaleDownBy = height >= capHeight ? 1 : scaleDownByForHeight(width, capHeight, height);
      if (scaleDownBy != null) {
        const outWidth = outputDimension(width, scaleDownBy);
        const outHeight = outputDimension(capHeight, scaleDownBy);
        if (acceptable(outWidth, outHeight)) return { height: outHeight, scaleDownBy };
      }
    }
    // Nenhum degrau exato fecha par (ex.: ultrawide limitada a 1920x804: 720,
    // 540 e 360 dao largura impar). Divisao inteira preserva a paridade que
    // a divisao fracionaria quebra: 1920x804 / 2 = 960x402. Fica com a maior
    // saida que cabe no alvo; se nenhuma cabe, a menor aceitavel acima dele.
    const minScale = Number(minScaleDownBy) || 1;
    const inteiras = [2, 4]
      .filter((s) => s >= minScale && acceptable(outputDimension(width, s), outputDimension(capHeight, s)))
      .map((s) => ({ height: outputDimension(capHeight, s), scaleDownBy: s }));
    const cabem = inteiras.filter((o) => o.height <= requested);
    if (cabem.length) return cabem[0];
    if (inteiras.length) return inteiras[inteiras.length - 1];
    const fallbackScale = minScale;
    return {
      height: outputDimension(capHeight, fallbackScale),
      scaleDownBy: fallbackScale,
      fallback: true,
    };
  }

  function highestAllowedHeight(maxHeight) {
    return SCREEN_HEIGHTS.find((height) => height <= Number(maxHeight)) || null;
  }

  function initialState(maxHeight) {
    return {
      height: highestAllowedHeight(maxHeight),
      bweBps: null,
      belowSinceMs: null,
      aboveSinceMs: null,
    };
  }

  function lowerHeight(height, maxHeight) {
    return SCREEN_HEIGHTS.find((step) => step < height && step <= maxHeight) || height;
  }

  function higherHeight(height, maxHeight) {
    const candidates = SCREEN_HEIGHTS.filter((step) => step > height && step <= maxHeight);
    return candidates.length ? candidates[candidates.length - 1] : height;
  }

  /** Uma amostra de BWE por sender. Sem BWE a escolha atual fica intacta:
   * nesse intervalo o maxBitrate continua no preset e o GCC segue mandando. */
  function next(state, availableBps, atMs, maxHeight) {
    const ceiling = highestAllowedHeight(maxHeight);
    if (!ceiling) return initialState(0);
    const prev = state || initialState(ceiling);
    let height = Math.min(prev.height || ceiling, ceiling);
    const sample = Number(availableBps);
    if (!(sample > 0) || !Number.isFinite(sample)) {
      return { ...prev, height, belowSinceMs: null, aboveSinceMs: null };
    }

    const bweBps = prev.bweBps == null ? sample : prev.bweBps + BWE_EWMA_ALPHA * (sample - prev.bweBps);
    const now = Number(atMs) || 0;
    const threshold = BWE_BPS[height];
    if (height > 360 && bweBps < threshold.down) {
      const belowSinceMs = prev.belowSinceMs ?? now;
      if (now - belowSinceMs >= DOWN_HOLD_MS) {
        height = lowerHeight(height, ceiling);
        return { height, bweBps, belowSinceMs: null, aboveSinceMs: null };
      }
      return { height, bweBps, belowSinceMs, aboveSinceMs: null };
    }

    const higher = higherHeight(height, ceiling);
    if (higher !== height && bweBps >= BWE_BPS[height].up) {
      const aboveSinceMs = prev.aboveSinceMs ?? now;
      if (now - aboveSinceMs >= UP_HOLD_MS) {
        height = higher;
        return { height, bweBps, belowSinceMs: null, aboveSinceMs: null };
      }
      return { height, bweBps, belowSinceMs: null, aboveSinceMs };
    }
    return { height, bweBps, belowSinceMs: null, aboveSinceMs: null };
  }

  // K > 1 deixa o GCC continuar sondando acima da estimativa. Sem essa
  // folga, maxBitrate == BWE impede a propria BWE de descobrir mais banda.
  function bitrateCap(presetBitrate, bweBps) {
    const preset = Number(presetBitrate) || MIN_SCREEN_BITRATE_BPS;
    const bwe = Number(bweBps);
    if (!(bwe > 0) || !Number.isFinite(bwe)) return preset;
    return Math.min(preset, Math.max(MIN_SCREEN_BITRATE_BPS, 1.2 * bwe));
  }

  const api = {
    SCREEN_HEIGHTS,
    MIN_SCREEN_BITRATE_BPS,
    BWE_EWMA_ALPHA,
    DOWN_HOLD_MS,
    UP_HOLD_MS,
    BWE_BPS,
    outputDimension,
    scaleDownByForHeight,
    nearestAcceptableScale,
    initialState,
    next,
    bitrateCap,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.screenres = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
