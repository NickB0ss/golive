'use strict';

/*
 * Fonte de video de um cenario: sintetica ou janela propria, direta ou via o
 * screenrelay (canvas) de PRODUCAO. Devolve a track que vai pros senders e
 * como desligar tudo.
 *
 *   direct  = a track da fonte vai direto pro sender (sem segundo redraw);
 *   canvas  = GoLive.screenrelay.create(track, opts): MediaStreamTrackProcessor
 *             -> canvas -> captureStream(0), o mesmo caminho do app.
 *
 * `stop()` NAO para a track da fonte do relay (o screenrelay deixa isso a
 * cargo de quem criou); a bancada para as duas.
 */
(function (root) {
  async function captureOwnedWindow(cfg, arm) {
    await arm(); // o main so autoriza o getDisplayMedia armado, e so a janela propria
    const stream = await root.navigator.mediaDevices.getDisplayMedia({
      video: { width: cfg.width, height: cfg.height, frameRate: cfg.fps },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('getDisplayMedia nao devolveu track de video');
    return {
      track, stop: () => stream.getTracks().forEach((t) => t.stop()), stats: () => ({}),
      // O que a captura entregou de verdade (nao o que foi pedido).
      measured: () => { const s = track.getSettings(); return { width: s.width ?? null, height: s.height ?? null, frameRate: s.frameRate ?? null }; },
    };
  }

  function captureSynthetic(cfg) {
    const scene = root.MediaBench.scene.create({ width: cfg.width, height: cfg.height, fps: cfg.fps });
    scene.start();
    return { track: scene.track, stop: () => scene.stop(), stats: () => scene.stats() };
  }

  /**
   * @param cfg configuracao do cenario (contrato de lib/config.js)
   * @param deps { arm }  arm() pede ao main a autorizacao da captura (owned-window)
   */
  async function create(cfg, deps = {}) {
    const raw = cfg.source === 'owned-window'
      ? await captureOwnedWindow(cfg, deps.arm)
      : captureSynthetic(cfg);
    const cleanups = [raw.stop];
    let relay = null;
    try {
      let track = raw.track;
      let effectiveHint;
      if (cfg.pipeline === 'canvas') {
        const sr = root.GoLive?.screenrelay;
        if (!sr || !sr.isSupported()) throw new Error('screenrelay indisponivel neste runtime');
        let relayError = null;
        relay = sr.create(raw.track, {
          document: root.document,
          onFrameError: (err) => { relayError = err; },
        });
        // create devolve null quando nao da pra montar: falha o cenario, nao
        // cai calado na track crua (isso mediria outra coisa).
        if (!relay) throw new Error('screenrelay.create devolveu null (sem suporte ou track invalida)');
        cleanups.push(() => relay.stop());
        track = relay.track;
        effectiveHint = track.contentHint; // o relay fixa 'motion'
        return {
          track, effectiveHint, measured: raw.measured || null,
          stats: () => ({ ...raw.stats(), relayFrames: relay.quadros(), relayError: relayError ? String(relayError) : null }),
          stop: () => cleanups.reverse().forEach((fn) => { try { fn(); } catch { /* ja parado */ } }),
        };
      }
      track.contentHint = cfg.hint;
      effectiveHint = track.contentHint;
      return {
        track, effectiveHint, measured: raw.measured || null,
        stats: () => raw.stats(),
        stop: () => cleanups.reverse().forEach((fn) => { try { fn(); } catch { /* ja parado */ } }),
      };
    } catch (err) {
      cleanups.reverse().forEach((fn) => { try { fn(); } catch { /* ja parado */ } });
      throw err;
    }
  }

  root.MediaBench.source = { create };
})(globalThis);
