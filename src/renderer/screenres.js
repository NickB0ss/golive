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

  function lowerHeight(height, maxHeight) {
    return SCREEN_HEIGHTS.find((step) => step < height && step <= maxHeight) || height;
  }

  function higherHeight(height, maxHeight) {
    const candidates = SCREEN_HEIGHTS.filter((step) => step > height && step <= maxHeight);
    return candidates.length ? candidates[candidates.length - 1] : height;
  }

  // ---------- Escada por congestao (plano 2026-10-25, v3) ----------
  // A BWE so mede a rede quando o encoder a usa. Com folga, ela fica parada
  // no valor que tinha (medido no spike de 2026-10-25) e quem decide subir e
  // a tentativa com recuo. Descer exige o encoder pressionando a BWE.
  const AQUECIMENTO_MS = 10000;
  const USO_PRESSAO = 0.85;
  const BWE_SUBINDO = 1.05;
  const PERDA_LIVRE = 0.02;
  // Perda numa janela, nao por tick: tela parada manda ~30-100 pacotes/s, e
  // um pacote perdido num tick so ja passaria de 2 %.
  const PERDA_JANELA_MS = 10000;
  const PERDA_MIN_PACOTES = 200;
  const RTT_INFLADO_MS = 150;
  const RTT_JANELA_MS = 60000;
  const RTT_BALDE_MS = 10000;
  const PROVA_PRESSAO_MS = 10000;
  const RECUO_INICIAL_MS = UP_HOLD_MS;
  const RECUO_MAX_MS = 120000;
  // Logo depois de uma tentativa (e da descida que a desfaz), a limitacao
  // 'bandwidth' do WebRTC e a propria tentativa sendo testada: a escada
  // resolve, e o peerquality nao deve somar um degrau de preset por cima.
  const CARENCIA_TENTATIVA_MS = 10000;
  // O tick e de 1 s (5 s com o app escondido). Mais que isso e linha que
  // faltou (stats nulas, renderer travado): um tick so nao vale por minutos.
  const DT_MAX_MS = 10000;
  // Quanto um tick so pode somar ao tempo limitando: com o tick de 5 s do app
  // escondido (o caso de quem transmite um jogo), uma amostra so nao derruba
  // o degrau; sao duas, 10 s, como na escada antiga.
  const LIMITE_POR_TICK_MS = DOWN_HOLD_MS / 2;
  // Ate quando o motivo da ultima troca ainda explica uma linha [diag] MUDOU.
  const MOTIVO_RECENTE_MS = 30000;

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const kbps = (bps) => Math.round(bps / 1000);
  const pct = (f) => Math.round(f * 100);

  function initialState(maxHeight, atMs = 0) {
    return {
      height: highestAllowedHeight(maxHeight),
      bweBps: null,
      aboveSinceMs: null,
      desdeMs: Number(atMs) || 0,
      ultimoMs: null,
      paradoDesdeMs: null,
      limiteMs: 0,
      folgaMs: 0,
      rttBaldes: [],
      perdaJanela: [],
      perda: null,
      tentativa: null,
      recuoMs: RECUO_INICIAL_MS,
      carenciaAteMs: null,
      motivo: null,
      ultimoMotivo: null,
      ultimoMotivoMs: null,
    };
  }

  /** Minimo de RTT por balde de 10 s, so os ultimos 60 s: uma troca de rota
   * no Radmin vira a base nova em ate um minuto, em vez de congestao eterna. */
  function registrarRtt(baldes, rttMs, atMs) {
    const vivos = (baldes || []).filter((b) => atMs - b.inicioMs < RTT_JANELA_MS);
    if (!(rttMs > 0)) return vivos;
    const ultimo = vivos[vivos.length - 1];
    if (ultimo && atMs - ultimo.inicioMs < RTT_BALDE_MS) {
      return [...vivos.slice(0, -1), { inicioMs: ultimo.inicioMs, min: Math.min(ultimo.min, rttMs) }];
    }
    return [...vivos, { inicioMs: atMs, min: rttMs }];
  }

  function rttBase(baldes, atMs) {
    const vivos = (baldes || []).filter((b) => atMs - b.inicioMs < RTT_JANELA_MS);
    return vivos.length ? Math.min(...vivos.map((b) => b.min)) : null;
  }

  function registrarPerda(janela, perdidos, enviados, atMs) {
    const vivos = (janela || []).filter((p) => atMs - p.atMs < PERDA_JANELA_MS);
    if (!(enviados > 0) || !(perdidos >= 0)) return vivos;
    return [...vivos, { atMs, perdidos, enviados }];
  }

  /** Perdidos sobre enviados na janela; null com poucos pacotes para medir. */
  function perdaDaJanela(janela) {
    const enviados = janela.reduce((s, p) => s + p.enviados, 0);
    if (enviados < PERDA_MIN_PACOTES) return null;
    return Math.min(1, janela.reduce((s, p) => s + p.perdidos, 0) / enviados);
  }

  /** A escada acabou de subir por tentativa, ou de desfazer uma (ver
   * CARENCIA_TENTATIVA_MS). */
  function emCarencia(state, atMs) {
    return state?.carenciaAteMs != null && Number(atMs) < state.carenciaAteMs;
  }

  /** Motivo da ultima troca, se ainda recente para explicar uma linha MUDOU. */
  function motivoRecente(state, atMs) {
    if (!state?.ultimoMotivo || state.ultimoMotivoMs == null) return null;
    return Number(atMs) - state.ultimoMotivoMs <= MOTIVO_RECENTE_MS ? state.ultimoMotivo : null;
  }

  /** Observacao de um sender a partir da linha do updateStats. `ativo` e
   * falso com a tela pausada (so no alvo direto) ou a demanda suspensa. */
  function observacao(row, { ativo }) {
    const fps = num(row?.fps);
    const mbps = num(row?.mbps);
    return {
      availableBps: num(row?.availableBps),
      realBps: mbps == null ? null : mbps * 1e6,
      perdidos: num(row?.lostDelta),
      enviados: num(row?.sentDelta),
      rttMs: num(row?.rttRtcp) ?? num(row?.rtt),
      limitacao: row?.limitation || null,
      enviando: Boolean(ativo) && fps != null && fps > 0,
    };
  }

  /** Uma amostra por sender. `motivo` sai preenchido so na amostra em que o
   * degrau mudou; `ultimoMotivo` fica para a linha [diag] (motivoRecente). */
  function next(state, obs, atMs, maxHeight) {
    const now = Number(atMs) || 0;
    const ceiling = highestAllowedHeight(maxHeight);
    if (!ceiling) return initialState(0, now);
    const prev = state || initialState(ceiling, now);
    const height = Math.min(prev.height || ceiling, ceiling);
    const dt = prev.ultimoMs == null ? 0 : Math.min(DT_MAX_MS, Math.max(0, now - prev.ultimoMs));
    const base = { ...prev, height, ultimoMs: now, motivo: null };

    // Sem amostra de BWE ou sem quadros saindo (pausa, demanda suspensa):
    // nada a medir, e nenhum relogio anda.
    const amostra = num(obs?.availableBps);
    if (!(amostra > 0) || !obs?.enviando) {
      return { ...base, aboveSinceMs: null, limiteMs: 0, paradoDesdeMs: prev.paradoDesdeMs ?? now };
    }

    // Voltou a enviar depois de um aquecimento inteiro parado: o GCC pode ter
    // de sondar de novo, e o aquecimento recomeca (estimado, nao medido).
    const desdeMs = prev.paradoDesdeMs != null && now - prev.paradoDesdeMs >= AQUECIMENTO_MS ? now : prev.desdeMs;
    const ativo = { ...base, desdeMs, paradoDesdeMs: null };

    // Aquecimento: o GCC ainda esta sondando. A BWE segue a amostra crua
    // (o teto do encoder acompanha a rampa) e nada e decidido.
    if (now - (desdeMs ?? now) < AQUECIMENTO_MS) return { ...ativo, aboveSinceMs: null, limiteMs: 0, bweBps: amostra };

    // Media por TEMPO, nao por amostra: com o app escondido o tick e de 5 s,
    // e alpha fixo por amostra faria a media andar 5x mais devagar.
    const alpha = 1 - Math.pow(1 - BWE_EWMA_ALPHA, Math.max(dt, 1000) / 1000);
    const bweBps = prev.bweBps == null ? amostra : prev.bweBps + alpha * (amostra - prev.bweBps);
    const real = num(obs.realBps);
    const uso = real == null ? null : real / amostra;
    const pressionando = uso != null && uso >= USO_PRESSAO;
    const folga = uso != null && !pressionando;
    const perdaJanela = registrarPerda(prev.perdaJanela, num(obs.perdidos), num(obs.enviados), now);
    const perda = perdaDaJanela(perdaJanela);
    const rtt = num(obs.rttMs);
    const baseRtt = rttBase(prev.rttBaldes, now);
    const rttInflado = rtt > 0 && baseRtt != null && rtt - baseRtt >= RTT_INFLADO_MS;
    const livre = !rttInflado && (perda == null || perda < PERDA_LIVRE) && obs.limitacao !== 'cpu';
    const limitando = height > 360 && pressionando && bweBps < BWE_BPS[height].down;

    let tentativa = prev.tentativa;
    let recuoMs = prev.recuoMs ?? RECUO_INICIAL_MS;
    // A tentativa so se prova com o encoder USANDO o degrau novo sem a BWE
    // limitar: pressionando a BWE, ou mandando ao menos o limiar de descida do
    // degrau (conteudo que cabe folgado nao pressiona). Tela parada nao prova.
    const usandoDegrau = pressionando || (real != null && real >= BWE_BPS[height].down);
    if (tentativa && usandoDegrau && !limitando) {
      const pressaoMs = tentativa.pressaoMs + dt;
      if (pressaoMs >= PROVA_PRESSAO_MS) {
        tentativa = null;
        recuoMs = RECUO_INICIAL_MS;
      } else {
        tentativa = { ...tentativa, pressaoMs };
      }
    }

    // Tempo limitando acumula e o tempo sem limitar desconta, em vez de zerar
    // a cada tick fora: o serrote normal do GCC nao segura a descida. Com uma
    // tentativa aberta, a BWE subindo (saindo do valor congelado) pausa a
    // conta: ela ainda esta descobrindo a banda do degrau novo.
    const subindo = tentativa != null && prev.bweBps != null && amostra > prev.bweBps * BWE_SUBINDO;
    const anterior = prev.limiteMs || 0;
    const limiteMs = !limitando ? Math.max(0, anterior - dt)
      : subindo ? anterior : anterior + Math.min(dt, LIMITE_POR_TICK_MS);
    const comum = {
      ...ativo,
      bweBps,
      rttBaldes: registrarRtt(prev.rttBaldes, rtt, now),
      perdaJanela,
      perda,
      tentativa,
      recuoMs,
      limiteMs,
    };

    if (limitando) {
      if (limiteMs < DOWN_HOLD_MS) return { ...comum, aboveSinceMs: null, folgaMs: 0 };
      const falhou = tentativa != null;
      const proximoRecuo = falhou ? Math.min(recuoMs * 2, RECUO_MAX_MS) : recuoMs;
      const motivo = `bwe ${kbps(bweBps)} kbps com o encoder usando ${pct(uso)}% dela`
        + (falhou ? `; tentativa falhou, proxima em ${proximoRecuo / 1000}s` : '');
      return {
        ...comum,
        height: lowerHeight(height, ceiling),
        aboveSinceMs: null,
        limiteMs: 0,
        folgaMs: 0,
        tentativa: null,
        recuoMs: proximoRecuo,
        carenciaAteMs: falhou ? now + CARENCIA_TENTATIVA_MS : comum.carenciaAteMs,
        motivo,
        ultimoMotivo: motivo,
        ultimoMotivoMs: now,
      };
    }

    const higher = higherHeight(height, ceiling);
    if (higher === height || !livre) {
      return { ...comum, aboveSinceMs: null, folgaMs: livre ? prev.folgaMs : 0 };
    }

    const comprovado = bweBps >= BWE_BPS[height].up;
    const aboveSinceMs = comprovado ? (prev.aboveSinceMs ?? now) : null;
    if (comprovado && now - aboveSinceMs >= UP_HOLD_MS) {
      const motivo = `bwe ${kbps(bweBps)} kbps`;
      return {
        ...comum,
        height: higher,
        aboveSinceMs: null,
        limiteMs: 0,
        folgaMs: 0,
        tentativa: null,
        recuoMs: RECUO_INICIAL_MS,
        motivo,
        ultimoMotivo: motivo,
        ultimoMotivoMs: now,
      };
    }

    // Folga acumula; tick com o encoder pressionando pausa (nao zera) a conta.
    // Com uma tentativa ainda sem prova, a proxima (empilhada) espera o dobro.
    const folgaMs = folga ? (prev.folgaMs || 0) + dt : (prev.folgaMs || 0);
    const espera = tentativa ? recuoMs * 2 : recuoMs;
    if (folgaMs >= espera) {
      const motivo = `tentativa: encoder usando ${pct(uso)}% da bwe, ${Math.round(folgaMs / 1000)}s de folga`;
      return {
        ...comum,
        height: higher,
        aboveSinceMs: null,
        limiteMs: 0,
        folgaMs: 0,
        tentativa: { desdeMs: now, pressaoMs: 0 },
        carenciaAteMs: now + CARENCIA_TENTATIVA_MS,
        motivo,
        ultimoMotivo: motivo,
        ultimoMotivoMs: now,
      };
    }
    return { ...comum, aboveSinceMs, folgaMs };
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
    observacao,
    emCarencia,
    motivoRecente,
    AQUECIMENTO_MS,
    USO_PRESSAO,
    BWE_SUBINDO,
    PERDA_LIVRE,
    PERDA_JANELA_MS,
    PERDA_MIN_PACOTES,
    RTT_INFLADO_MS,
    RTT_JANELA_MS,
    PROVA_PRESSAO_MS,
    RECUO_INICIAL_MS,
    RECUO_MAX_MS,
    CARENCIA_TENTATIVA_MS,
    DT_MAX_MS,
    LIMITE_POR_TICK_MS,
    MOTIVO_RECENTE_MS,
    bitrateCap,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.screenres = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
