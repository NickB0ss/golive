'use strict';

// Tela assistida que nunca mostrou imagem (hotfix 2026-09-12).
//
// Decide so com numeros (quadros exibidos pelo <video>, relogio), pra regra
// ficar testavel sem DOM nem WebRTC. Quem chama (app.js) mede e age.
//
// A regra so dispara quando a tela NUNCA exibiu um quadro desde que passou a
// ser assistida (ou desde que o tile foi recriado): e o retrato do defeito
// relatado ("cliquei pra assistir e ficou preta ate a pessoa sair e entrar").
// Uma tela que ja mostrou quadro e parou e, quase sempre, conteudo parado --
// um desktop ocioso nao gera quadro novo --, e refazer a conexao ali so
// trocaria uma imagem parada por uma tela preta de alguns segundos.
(function (root) {
  const DEFAULTS = { stallMs: 6000, cooldownMs: 20000, maxAttempts: 3 };
  const RELAY_RETRY_DEFAULTS = { baseDelayMs: 1000, maxAttempts: 3 };

  function createStallWatch(opts = {}) {
    const stallMs = opts.stallMs ?? DEFAULTS.stallMs;
    const cooldownMs = opts.cooldownMs ?? DEFAULTS.cooldownMs;
    const maxAttempts = opts.maxAttempts ?? DEFAULTS.maxAttempts;
    const byKey = new Map();

    function fresh(now, frames, prev) {
      return {
        since: now,
        base: frames,
        shown: false,
        // Tile recriado (contador de quadros reiniciou) nao zera as
        // tentativas: senao cada autocura que recria o tile abriria um laco.
        attempts: prev?.attempts || 0,
        lastHealAt: prev?.lastHealAt || 0,
        gaveUp: prev?.gaveUp || false,
      };
    }

    /** `watched`: a pessoa esta olhando esta tela agora (app visivel, tela
     * escolhida, origem nao pausada). `frames`: quadros exibidos pelo tile,
     * ou null quando nao da pra medir. Devolve null ou
     * `{ action: 'heal' | 'give-up' | 'recovered', stalledFor?, attempts }`. */
    function observe(key, { watched, frames, now, hasInbound = true }) {
      // Quando a arvore ainda nos manda assistir, mas a inConn e o tile ja
      // sumiram, isso e o mesmo sintoma de uma tela que nunca pintou. Nao
      // esquece o estado: usa a mesma histerese e o mesmo teto de curas.
      const missingInbound = hasInbound === false;
      if (!watched || (!missingInbound && (typeof frames !== 'number' || !Number.isFinite(frames)))) {
        byKey.delete(key);
        return null;
      }
      const observedFrames = missingInbound ? 0 : frames;
      const s = byKey.get(key);
      if (!s || observedFrames < s.base || (missingInbound && s.shown)) {
        byKey.set(key, fresh(now, observedFrames, s));
        return null;
      }
      if (observedFrames > s.base) {
        const attempts = s.attempts;
        s.base = frames;
        s.shown = true;
        if (attempts) {
          s.attempts = 0;
          s.lastHealAt = 0;
          s.gaveUp = false;
          return { action: 'recovered', attempts };
        }
        return null;
      }
      if (s.shown) return null;
      const stalledFor = now - s.since;
      if (stalledFor < stallMs) return null;
      if (s.attempts >= maxAttempts) {
        if (s.gaveUp) return null;
        s.gaveUp = true;
        return { action: 'give-up', stalledFor, attempts: s.attempts };
      }
      if (s.lastHealAt && now - s.lastHealAt < cooldownMs) return null;
      s.attempts += 1;
      s.lastHealAt = now;
      return { action: 'heal', stalledFor, attempts: s.attempts };
    }

    function forget(key) {
      byKey.delete(key);
    }

    function reset() {
      byKey.clear();
    }

    return { observe, forget, reset };
  }

  // A falha de uma outConn de repasse chega uma vez por PC. Como cada nova
  // tentativa cria outra PC, contador E timer precisam viver fora dela e ser
  // por filho/kind; sem teto, uma folha offline faria o relay renegociar pra
  // sempre. O relogio e injetavel para testar cancelamento sem WebRTC/DOM.
  function createRelayRetry(opts = {}) {
    const baseDelayMs = opts.baseDelayMs ?? RELAY_RETRY_DEFAULTS.baseDelayMs;
    const maxAttempts = opts.maxAttempts ?? RELAY_RETRY_DEFAULTS.maxAttempts;
    const scheduleTimeout = opts.setTimeout || setTimeout;
    const cancelTimeout = opts.clearTimeout || clearTimeout;
    const byKey = new Map();

    function next(key) {
      const state = byKey.get(key) || { attempts: 0, gaveUp: false, timer: null };
      if (state.gaveUp) return null;
      if (state.attempts >= maxAttempts) {
        state.gaveUp = true;
        byKey.set(key, state);
        return { action: 'give-up', attempts: state.attempts };
      }
      state.attempts += 1;
      byKey.set(key, state);
      return {
        action: 'retry',
        attempts: state.attempts,
        delayMs: baseDelayMs * (2 ** (state.attempts - 1)),
      };
    }

    function cancel(key) {
      const state = byKey.get(key);
      if (state?.timer != null) cancelTimeout(state.timer);
      if (state) state.timer = null;
    }

    /** Registra uma falha e agenda a proxima tentativa. `onRetry` so roda
     * se este key ainda estiver ativo quando o timer vencer. */
    function failed(key, onRetry) {
      const existing = byKey.get(key);
      if (existing?.timer != null) return null;
      const result = next(key);
      if (result?.action !== 'retry') return result;
      const state = byKey.get(key);
      const timer = scheduleTimeout(() => {
        const current = byKey.get(key);
        if (!current || current.timer !== timer) return;
        current.timer = null;
        onRetry();
      }, result.delayMs);
      state.timer = timer;
      return result;
    }

    function reset(key) {
      cancel(key);
      byKey.delete(key);
    }

    function connectionState(key, state) {
      if (state === 'connected') reset(key);
    }

    // Um pedido explicito da folha e um novo ciclo, mesmo se o anterior
    // esgotou. Tambem cancela eventual tentativa automatica pendente para
    // que a reoferta pedida nao corra em paralelo com ela.
    function restart(key) {
      reset(key);
    }

    function clear() {
      for (const key of byKey.keys()) reset(key);
    }

    function cancelAll() {
      for (const key of byKey.keys()) cancel(key);
    }

    function cancelWhere(matches) {
      if (typeof matches !== 'function') return;
      for (const key of byKey.keys()) if (matches(key)) cancel(key);
    }

    function clearPeer(peerId) {
      const prefix = `${peerId}|`;
      for (const key of [...byKey.keys()]) if (key.startsWith(prefix)) reset(key);
    }

    function cancelPeer(peerId) {
      const prefix = `${peerId}|`;
      for (const key of byKey.keys()) if (key.startsWith(prefix)) cancel(key);
    }

    return {
      next, failed, cancel, reset, connectionState, restart,
      clear, cancelAll, cancelWhere, clearPeer, cancelPeer,
    };
  }

  const api = { createStallWatch, createRelayRetry, DEFAULTS, RELAY_RETRY_DEFAULTS };
  root.GoLive = root.GoLive || {};
  root.GoLive.stallwatch = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
