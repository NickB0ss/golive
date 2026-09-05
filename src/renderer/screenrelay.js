'use strict';

/*
 * Relay de captura de tela: faz o encoder de HARDWARE aceitar os quadros.
 *
 * O PROBLEMA (medido em 2026-09-05, RTX 3060, Electron 32 / Chromium 128):
 * uma track de `getDisplayMedia` com `contentHint = 'motion'` derruba o
 * encoder de hardware. O Chromium TENTA o MediaFoundation, ele falha
 * (`Media.VideoEncoder.WebRTC.HW.Status` = 16, zero quadros codificados) e
 * o WebRTC cai no OpenH264 em silencio -- sem erro, sem aviso, so `enc=`
 * mudando no [diag] pra quem soubesse olhar. Foi o que rodou por meses.
 *
 * Nao e o hint sozinho nem a captura sozinha: e a COMBINACAO. Medido:
 *
 *     captura direta + 'motion'  -> OpenH264 (software)     12,3-13,2 ms/quadro
 *     captura direta + 'detail'  -> MediaFoundation (HW)      8,8-9,0 ms/quadro
 *     captura direta + sem hint  -> MediaFoundation (HW)      8,4-8,7 ms/quadro
 *     CANVAS         + 'motion'  -> MediaFoundation (HW)      5,7-8,1 ms/quadro
 *
 * Por que nao so trocar o hint entao? Porque 'motion' e o unico que segura
 * o framerate, e isto e um app pra ver jogo (5 repeticoes de 20s):
 *
 *     'motion' (software): 56,0 / 56,2 / 55,8 / 55,6 / 55,5  -> 55,8 fps
 *     'detail' (hardware): 39,1 / 38,9 / 39,9 / 43,0 / 50,4  -> 42,3 fps
 *
 * 24% de framerate a menos, consistente; `maintain-framerate` melhora um
 * pouco e nao alcanca. Entao a saida e manter 'motion' numa track de
 * CANVAS, onde ele nao quebra nada: redesenhar cada quadro num canvas troca
 * o respaldo do buffer, o encoder de hardware aceita, e o hint continua
 * dizendo "priorize fluidez".
 *
 * RESULTADO (1080p60, 3 espectadores, 3 repeticoes):
 *
 *     hoje          OpenH264          28,8 / 28,2 / 29,0 % CPU   57 fps   15,4 ms
 *     com o relay   MediaFoundation   12,7 / 13,0 / 12,6 % CPU   57 fps    8,1 ms
 *
 * DETALHES QUE NAO SAO OPCIONAIS, todos com um teste que falhou antes:
 *
 *   - `MediaStreamTrackProcessor`, e nao um `<video>` intermediario. Com
 *     `<video>` + requestVideoFrameCallback o framerate oscila (42/57/57, e
 *     39/44/57 com o elemento no DOM) porque o relogio de renderizacao do
 *     elemento nao esta em fase com a captura. O Processor le da track: 1:1,
 *     57/57/57.
 *   - `captureStream(0)` + `requestFrame()`, e nao `captureStream(fps)`. A
 *     taxa fixa instala um amostrador com relogio proprio e perde ~15% dos
 *     quadros.
 *   - `frame.close()` em TODO quadro. O VideoFrame segura memoria de GPU; o
 *     pipeline trava depois de alguns quadros sem isso.
 *   - O canvas segue o tamanho do quadro que chega. E o que mantem o
 *     applyConstraints da escada de qualidade valendo: quando ela baixa a
 *     captura pra 720p, o relay acompanha sozinho.
 *
 * O QUE NAO FUNCIONA (testado, nao repetir):
 *   - `Processor -> Generator` sem canvas (repassar o quadro intacto):
 *     continua OpenH264. E o REDESENHO que troca o respaldo.
 *   - Detectar em runtime e trocar com `replaceTrack`: o WebRTC NAO
 *     reavalia o encoder na troca -- um sender que caiu em software fica em
 *     software. Por isso o relay entra ANTES da primeira oferta, sempre, em
 *     vez de ser ligado depois que o [diag] acusar software.
 *   - WebCodecs: nao alcanca o hardware a 1080p neste build, e em software
 *     e mais caro (18 ms/quadro) que o proprio OpenH264 do WebRTC.
 *
 * Ver a nota de investigacao completa na memoria do projeto.
 */

(function (root) {
  /** As duas APIs de que o relay depende. Faltando qualquer uma, quem chama
   * segue com a track de captura crua -- pior encoder, mas funciona. */
  function isSupported(escopo) {
    const g = escopo || root;
    return typeof g.MediaStreamTrackProcessor === 'function'
      && typeof g.HTMLCanvasElement === 'function'
      && typeof g.HTMLCanvasElement.prototype.captureStream === 'function';
  }

  /** Envolve `sourceTrack` num relay por canvas e devolve
   * `{ track, stop }` -- ou `null` quando nao da pra montar (sem suporte,
   * ou track invalida). `stop()` para o laco e a track de saida; a track de
   * ORIGEM continua viva e e responsabilidade de quem chamou (no GoLive
   * quem a fecha e o stopShare, junto do resto da captura).
   *
   * `onFrameError` recebe o primeiro erro do laco, se houver: o laco morre
   * em silencio de outra forma, e uma tela que congela sem log foi
   * exatamente o tipo de problema que originou esta investigacao. */
  function create(sourceTrack, opts) {
    const o = opts || {};
    const doc = o.document || (typeof document !== 'undefined' ? document : null);
    if (!doc || !sourceTrack || !isSupported(o.escopo)) return null;

    const g = o.escopo || root;
    let leitor;
    try {
      leitor = new g.MediaStreamTrackProcessor({ track: sourceTrack }).readable.getReader();
    } catch {
      return null; // track ja encerrada, ou tipo que o Processor recusa
    }

    const canvas = doc.createElement('canvas');
    const settings = typeof sourceTrack.getSettings === 'function' ? sourceTrack.getSettings() : {};
    // Um tamanho inicial plausivel evita um primeiro quadro esticado; o
    // laco corrige no primeiro frame de qualquer jeito.
    canvas.width = settings.width || 1920;
    canvas.height = settings.height || 1080;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) {
      try { leitor.cancel(); } catch { /* ja cancelado */ }
      return null;
    }

    const saida = canvas.captureStream(0);
    const track = saida.getVideoTracks()[0];
    if (!track) {
      try { leitor.cancel(); } catch { /* ja cancelado */ }
      return null;
    }
    // O ponto de tudo isto: 'motion' vive na track do CANVAS, onde nao
    // derruba o encoder de hardware.
    track.contentHint = 'motion';

    let vivo = true;
    let quadros = 0;

    (async () => {
      while (vivo) {
        let r;
        try {
          r = await leitor.read();
        } catch (err) {
          if (vivo) o.onFrameError?.(err);
          break;
        }
        if (r.done) break;
        const frame = r.value;
        try {
          const w = frame.displayWidth;
          const h = frame.displayHeight;
          if (w && h && (canvas.width !== w || canvas.height !== h)) {
            canvas.width = w;
            canvas.height = h;
          }
          ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
          // requestFrame e o que entrega UM quadro pra track de saida --
          // sem ele o captureStream(0) nao emite nada.
          track.requestFrame?.();
          quadros += 1;
        } catch (err) {
          if (vivo) o.onFrameError?.(err);
          try { frame.close(); } catch { /* ja fechado */ }
          break;
        }
        // Fora do try de cima pra fechar mesmo quando o desenho falhou uma
        // vez sem derrubar o laco.
        try { frame.close(); } catch { /* ja fechado */ }
      }
    })();

    return {
      track,
      quadros: () => quadros,
      stop() {
        vivo = false;
        try { leitor.cancel(); } catch { /* ja cancelado */ }
        try { track.stop(); } catch { /* ja parada */ }
      },
    };
  }

  const api = { isSupported, create };

  root.GoLive = root.GoLive || {};
  root.GoLive.screenrelay = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
