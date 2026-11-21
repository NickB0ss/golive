'use strict';

(function (root) {
  const INITIAL_RETRY_MS = 1000;
  const MAX_RETRY_MS = 10000;

  // A ordem dos campos do dicionario nao muda o alvo. A das listas muda.
  function snapshot(value) {
    if (Array.isArray(value)) return value.map(snapshot);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, snapshot(value[key])]));
    }
    return value;
  }

  function create(options = {}) {
    const setTimer = options.setTimeout || setTimeout;
    const clearTimer = options.clearTimeout || clearTimeout;
    // Uma chamada do navegador continua em voo apos o reset. A mesma track
    // espera por ela, mas uma nova track pode comecar no mesmo instante.
    const inFlight = new WeakSet();
    let active = null;

    function cancelRetry(state) {
      if (state.retry === null) return;
      clearTimer(state.retry);
      state.retry = null;
    }

    function reset() {
      if (!active) return;
      const state = active;
      active = null;
      cancelRetry(state);
      state.track.removeEventListener?.('ended', state.onEnded);
    }

    function scheduleRetry(state, delay) {
      const timer = setTimer(() => {
        if (active !== state || state.retry !== timer) return;
        state.retry = null;
        applyNext();
      }, delay);
      state.retry = timer;
      timer?.unref?.();
    }

    function onFailure(state, target, error) {
      if (active !== state || state.track.readyState === 'ended') return;
      const { key, constraints, attempt } = target;
      let retryMs = 0;
      if (state.target.key === key) {
        state.target.attempt = attempt;
        retryMs = Math.min(INITIAL_RETRY_MS * 2 ** (attempt - 1), MAX_RETRY_MS);
        scheduleRetry(state, retryMs);
      }
      try {
        const context = { track: state.track, constraints: snapshot(constraints), attempt, retryMs };
        void Promise.resolve(options.onError?.(error, context)).catch(() => {});
      } catch { /* falha no diagnostico nao altera a captura */ }
    }

    async function apply(state, target) {
      const { track } = state;
      inFlight.add(track);
      target.attempt += 1;
      try {
        await track.applyConstraints(target.constraints);
        if (active === state) state.appliedKey = target.key;
      } catch (error) {
        onFailure(state, target, error);
      } finally {
        inFlight.delete(track);
        if (active?.track === track) applyNext();
      }
    }

    function applyNext() {
      const state = active;
      if (!state) return;
      if (state.track.readyState === 'ended') {
        reset();
        return;
      }
      if (inFlight.has(state.track) || state.retry !== null || state.target.key === state.appliedKey) return;
      void apply(state, state.target);
    }

    function request(track, constraints) {
      if (typeof track?.applyConstraints !== 'function' || track.readyState === 'ended') {
        reset();
        return;
      }
      const copy = snapshot(constraints ?? {});
      const key = JSON.stringify(copy);
      if (active?.track !== track) {
        reset();
        const onEnded = () => {
          if (active === state) reset();
        };
        const state = { track, appliedKey: null, target: null, retry: null, onEnded };
        active = state;
        track.addEventListener?.('ended', onEnded);
      }
      if (active.target?.key === key) return;
      cancelRetry(active);
      active.target = { key, constraints: copy, attempt: 0 };
      applyNext();
    }

    return { request, reset };
  }

  const api = { create };
  root.GoLive = root.GoLive || {};
  root.GoLive.capturequality = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
