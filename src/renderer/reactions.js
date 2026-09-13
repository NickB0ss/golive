'use strict';

/*
 * Reacoes rapidas -- estado puro das bolhas e limite de rajada. A lista
 * fechada existe para que a entrada da rede nunca vire texto arbitrario.
 */

(function (root) {
  const REACTIONS = ['👍', '😂', '😮', '🔥', '👏', '❤️'];
  const TTL_MS = 1400;

  function isValidEmoji(emoji) {
    return REACTIONS.includes(emoji);
  }

  function createBurstLimiter({ capacity = 5, refillMs = 300 } = {}) {
    let tokens = capacity;
    let lastRefillAt = null;

    function hit(now) {
      // Reposicao discreta conserva a promessa de uma ficha por intervalo,
      // em vez de liberar uma fracao que nenhum clique consegue gastar.
      if (lastRefillAt === null) {
        lastRefillAt = now;
      } else if (now > lastRefillAt && refillMs > 0) {
        const added = Math.floor((now - lastRefillAt) / refillMs);
        if (added > 0) {
          tokens = Math.min(capacity, tokens + added);
          lastRefillAt += added * refillMs;
        }
      }
      if (tokens <= 0) return false;
      tokens--;
      return true;
    }

    return { hit };
  }

  function createStore() {
    const surfaces = new Map(); // surfaceId -> bubble[]
    let nextId = 0;

    function listFor(surfaceId) {
      const key = String(surfaceId);
      let list = surfaces.get(key);
      if (!list) {
        list = [];
        surfaces.set(key, list);
      }
      return list;
    }

    function apply(surfaceId, from, emoji, now) {
      if (!isValidEmoji(emoji)) return null;
      const bubble = {
        id: `${String(from)}-${now}-${nextId++}`,
        surfaceId: String(surfaceId),
        from: String(from),
        emoji,
        ts: now,
      };
      listFor(surfaceId).push(bubble);
      return bubble;
    }

    function active(surfaceId, now, ttlMs = TTL_MS) {
      const list = surfaces.get(String(surfaceId)) || [];
      return list.filter((bubble) => now - bubble.ts < ttlMs);
    }

    function prune(now, ttlMs = TTL_MS) {
      for (const [surfaceId, list] of surfaces) {
        const kept = list.filter((bubble) => now - bubble.ts < ttlMs);
        if (kept.length) surfaces.set(surfaceId, kept);
        else surfaces.delete(surfaceId);
      }
    }

    function dropAuthor(from) {
      const author = String(from);
      for (const [surfaceId, list] of surfaces) {
        const kept = list.filter((bubble) => bubble.from !== author);
        if (kept.length) surfaces.set(surfaceId, kept);
        else surfaces.delete(surfaceId);
      }
    }

    return { apply, active, prune, dropAuthor };
  }

  const api = { REACTIONS, TTL_MS, isValidEmoji, createBurstLimiter, createStore };

  root.GoLive = root.GoLive || {};
  root.GoLive.reactions = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
