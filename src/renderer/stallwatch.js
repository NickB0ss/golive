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
    function observe(key, { watched, frames, now }) {
      if (!watched || typeof frames !== 'number' || !Number.isFinite(frames)) {
        byKey.delete(key);
        return null;
      }
      const s = byKey.get(key);
      if (!s || frames < s.base) {
        byKey.set(key, fresh(now, frames, s));
        return null;
      }
      if (frames > s.base) {
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

  const api = { createStallWatch, DEFAULTS };
  root.GoLive = root.GoLive || {};
  root.GoLive.stallwatch = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
