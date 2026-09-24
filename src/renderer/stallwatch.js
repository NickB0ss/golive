'use strict';

// Tela assistida que nunca mostrou imagem (hotfix 2026-09-12).
//
// Decide so com numeros (quadros exibidos pelo <video>, relogio), pra regra
// ficar testavel sem DOM nem WebRTC. Quem chama (app.js) mede e age.
//
// A regra tambem cobre o tile que JA pintou e depois parou de decodificar:
// numa troca de arvore ele pode ficar preto embora a demanda continue ativa.
// A origem pode estar mostrando conteudo parado, mas o custo de um reoffer
// limitado e menor que deixar esse caso sem caminho de recuperacao.
(function (root) {
  const DEFAULTS = { stallMs: 6000, cooldownMs: 20000, maxAttempts: 3 };
  const RELAY_RETRY_DEFAULTS = { baseDelayMs: 1000, maxAttempts: 3 };

  // Separa a elegibilidade da medicao para que pausa, fim de transmissao,
  // escolha explicita e carencia tenham uma regra unica e testavel. `live`
  // ausente vale como ao vivo para continuar compativel com peer antigo.
  function stallDemand({ wanted, watching, paused, live, inViewHold }) {
    const eligible = Boolean(wanted) && !paused && live !== false;
    return {
      watched: Boolean(watching) && eligible && !inViewHold,
      keepWaiting: Boolean(watching) && eligible && Boolean(inViewHold),
    };
  }

  function createStallWatch(opts = {}) {
    const stallMs = opts.stallMs ?? DEFAULTS.stallMs;
    const cooldownMs = opts.cooldownMs ?? DEFAULTS.cooldownMs;
    const maxAttempts = opts.maxAttempts ?? DEFAULTS.maxAttempts;
    const byKey = new Map();

    function fresh(now, frames, transport, prev) {
      return {
        base: frames,
        transport,
        shown: false,
        stalledFor: 0,
        lastWatchedAt: now,
        // Tile recriado (contador de quadros reiniciou) nao zera as
        // tentativas: senao cada autocura que recria o tile abriria um laco.
        attempts: prev?.attempts || 0,
        lastHealAt: prev?.lastHealAt || 0,
        gaveUp: prev?.gaveUp || false,
        // Cura devolvida por `defer` (o diagnostico mandou esperar) e o
        // estado de antes da ultima cura, pra poder devolve-la.
        deferred: false,
        beforeHeal: null,
      };
    }

    /** `watched`: a pessoa esta olhando esta tela agora (app visivel, tela
     * escolhida, origem nao pausada). `frames`: quadros exibidos pelo tile,
     * ou null quando nao da pra medir. Devolve null ou
     * `{ action: 'heal' | 'give-up' | 'recovered', stalledFor?, attempts }`. */
    function observe(key, { watched, keepWaiting = false, frames, transport, now, hasInbound = true }) {
      // Quando a arvore ainda nos manda assistir, mas a inConn e o tile ja
      // sumiram, isso e o mesmo sintoma de uma tela que nunca pintou. Nao
      // esquece o estado: usa a mesma histerese e o mesmo teto de curas.
      const missingInbound = hasInbound === false;
      if (!watched) {
        const waiting = byKey.get(key);
        // Durante a carencia a demanda ainda esta reservada, mas o tile nao
        // esta visivel para medir. Pausa o relogio sem apagar a espera que ja
        // acumulou; uma piscada nao pode recomecar os 6 s do zero.
        if (keepWaiting && waiting) {
          if (waiting.lastWatchedAt != null) {
            waiting.stalledFor += Math.max(0, now - waiting.lastWatchedAt);
            waiting.lastWatchedAt = null;
          }
          return null;
        }
        byKey.delete(key);
        return null;
      }
      if (!missingInbound && (typeof frames !== 'number' || !Number.isFinite(frames))) {
        byKey.delete(key);
        return null;
      }
      const observedFrames = missingInbound ? 0 : frames;
      const s = byKey.get(key);
      const hasTransport = typeof transport === 'number' && Number.isFinite(transport);
      // Para um tile que ja mostrou imagem, falta de estatistica ainda nao e
      // prova de pane. Esperar a proxima amostra evita reofertar uma tela
      // estatica so porque framesShown nao muda com pixels iguais.
      if (!missingInbound && s?.shown && !hasTransport) return null;
      if (!s || observedFrames < s.base
        || (hasTransport && s.transport != null && transport < s.transport)
        || (missingInbound && s.shown)) {
        byKey.set(key, fresh(now, observedFrames, hasTransport ? transport : null, s));
        return null;
      }
      if (observedFrames > s.base) {
        const attempts = s.attempts;
        s.base = frames;
        if (hasTransport) s.transport = transport;
        s.shown = true;
        s.stalledFor = 0;
        s.lastWatchedAt = now;
        const deferred = s.deferred;
        s.deferred = false;
        s.beforeHeal = null;
        if (attempts || deferred) {
          s.attempts = 0;
          s.lastHealAt = 0;
          s.gaveUp = false;
          return { action: 'recovered', attempts, ...(deferred ? { deferred: true } : {}) };
        }
        return null;
      }
      const transportAdvanced = hasTransport && s.transport != null && transport > s.transport;
      if (hasTransport) s.transport = transport;
      if (transportAdvanced) {
        // Bytes/frames do RTP ainda chegam: a imagem pode ser estatica, mas
        // nao e a conexao morta que reoffer consegue consertar.
        s.stalledFor = 0;
        s.lastWatchedAt = now;
        s.attempts = 0;
        s.lastHealAt = 0;
        s.gaveUp = false;
        s.deferred = false;
        s.beforeHeal = null;
        return null;
      }
      if (s.lastWatchedAt != null) s.stalledFor += Math.max(0, now - s.lastWatchedAt);
      s.lastWatchedAt = now;
      const stalledFor = s.stalledFor;
      if (stalledFor < stallMs) return null;
      if (s.attempts >= maxAttempts) {
        if (s.gaveUp) return null;
        s.gaveUp = true;
        return { action: 'give-up', stalledFor, attempts: s.attempts };
      }
      if (s.lastHealAt && now - s.lastHealAt < cooldownMs) return null;
      s.beforeHeal = { attempts: s.attempts, lastHealAt: s.lastHealAt };
      s.attempts += 1;
      s.lastHealAt = now;
      return {
        action: 'heal',
        ...(s.shown ? { reason: 'frozen' } : {}),
        stalledFor,
        attempts: s.attempts,
      };
    }

    /** Quem chamou recebeu 'heal' e decidiu NAO agir agora (queda de rede
     * com reinicio de ICE a caminho, ver conndiag.reofferDecision): devolve
     * a tentativa e o intervalo que a cura gastou. O congelamento continua
     * contando, e a proxima olhada parada devolve 'heal' de novo -- a
     * decisao e refeita a cada olhada, com o diagnostico daquele momento.
     * Devolve true so na PRIMEIRA espera deste congelamento (pro log). */
    function defer(key) {
      const s = byKey.get(key);
      if (!s?.beforeHeal) return false;
      s.attempts = s.beforeHeal.attempts;
      s.lastHealAt = s.beforeHeal.lastHealAt;
      s.beforeHeal = null;
      const first = !s.deferred;
      s.deferred = true;
      return first;
    }

    function forget(key) {
      byKey.delete(key);
    }

    function reset() {
      byKey.clear();
    }

    return { observe, defer, forget, reset };
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

  const api = { createStallWatch, createRelayRetry, stallDemand, DEFAULTS, RELAY_RETRY_DEFAULTS };
  root.GoLive = root.GoLive || {};
  root.GoLive.stallwatch = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
