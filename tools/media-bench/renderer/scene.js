'use strict';

/*
 * Cena sintetica animada num canvas, com track de saida.
 *
 * A track nasce de `captureStream(0)` e cada quadro desenhado chama
 * `requestFrame()`: e o mesmo mecanismo que o screenrelay de producao usa
 * (captureStream(fps) instala um amostrador com relogio proprio e perde
 * quadros). O laco e por setTimeout com horario-alvo, nao requestAnimationFrame:
 * numa janela escondida o rAF nao e garantido.
 *
 * Isto NAO e captura WGC real. Ver a nota em README.md.
 */
(function (root) {
  const M = root.MediaBench.sceneMath;

  function draw(ctx, st, w, h) {
    ctx.fillStyle = `hsl(${st.bgHue} 35% 18%)`;
    ctx.fillRect(0, 0, w, h);
    for (const r of st.rects) {
      ctx.fillStyle = `hsl(${r.hue} 70% 55%)`;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    for (const b of st.blocks) {
      ctx.fillStyle = `hsl(${b.hue} 80% 60%)`;
      ctx.fillRect(b.x, b.y, b.s, b.s);
    }
    ctx.fillStyle = '#fff';
    ctx.fillRect(st.bar.x, 0, st.bar.w, Math.max(4, Math.round(h / 60)));
    ctx.fillStyle = '#000';
    ctx.fillRect(8, h - 52, 360, 44);
    ctx.fillStyle = '#fff';
    ctx.font = '28px monospace';
    ctx.fillText(st.label, 16, h - 20);
  }

  /** @returns {{ canvas, track, start, stop, stats }} */
  function create({ width, height, fps, document: doc = root.document }) {
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const interval = 1000 / fps;
    let n = 0;
    let running = false;
    let timer = null;
    let next = 0;
    let late = 0;

    function tick() {
      if (!running) return;
      draw(ctx, M.frameState(n, width, height), width, height);
      track.requestFrame?.();
      n += 1;
      next += interval;
      const now = performance.now();
      let delay = next - now;
      if (delay < -2 * interval) { // ficou muito atrasado: nao recupera em rajada
        late += 1;
        next = now + interval;
        delay = interval;
      }
      timer = setTimeout(tick, Math.max(0, delay));
    }

    return {
      canvas,
      track,
      start() {
        if (running) return;
        running = true;
        next = performance.now();
        tick();
      },
      stop() {
        running = false;
        clearTimeout(timer);
        try { track.stop(); } catch { /* ja parada */ }
      },
      stats: () => ({ framesDrawn: n, lateResets: late }),
    };
  }

  root.MediaBench.scene = { create, draw };
})(globalThis);
