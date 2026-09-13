'use strict';

/*
 * Ponteiro laser -- a parte PURA: decide quando uma posicao pode sair e
 * guarda so a ultima de cada pessoa. O desenho escolhe o fim pelo proprio
 * relogio, para que perder a ultima mensagem nunca deixe um ponto preso.
 */

(function (root) {
  const TTL_MS = 1000;
  const EMIT_HZ = 24;

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function round3(v) {
    return Math.round(v * 1000) / 1000;
  }

  function isNorm(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  }

  /** Zero tambem significa que ainda nao houve envio: o primeiro ponto nao
   * espera um intervalo so porque o relogio comecou em zero. */
  function shouldEmit(lastSentAt, now, hz) {
    if (!lastSentAt) return true;
    if (!(typeof hz === 'number' && Number.isFinite(hz) && hz > 0)) return false;
    return now - lastSentAt >= 1000 / hz;
  }

  function createStore() {
    const points = new Map(); // peerId -> { surfaceId, x, y, ts }

    function apply(surfaceId, from, op, now) {
      if (!op || typeof op !== 'object' || !isNorm(op.x) || !isNorm(op.y)) return false;
      points.set(String(from), {
        surfaceId: String(surfaceId),
        x: round3(clamp01(op.x)),
        y: round3(clamp01(op.y)),
        ts: now,
      });
      return true;
    }

    function active(now, ttlMs = TTL_MS) {
      const out = [];
      for (const [from, point] of points) {
        const age = now - point.ts;
        if (age < ttlMs) out.push({ from, surfaceId: point.surfaceId, x: point.x, y: point.y, age });
      }
      return out;
    }

    function dropAuthor(peerId) {
      points.delete(String(peerId));
    }

    function drop(surfaceId) {
      const key = String(surfaceId);
      for (const [from, point] of points) {
        if (point.surfaceId === key) points.delete(from);
      }
    }

    return { apply, active, dropAuthor, drop };
  }

  const api = { TTL_MS, EMIT_HZ, shouldEmit, createStore };

  root.GoLive = root.GoLive || {};
  root.GoLive.laser = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
