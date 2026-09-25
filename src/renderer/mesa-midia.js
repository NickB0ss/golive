'use strict';

/*
 * Coordenador da midia da Mesa neste PC -- `GoLive.mesaMidia`.
 *
 * Regra da spec (2026-09-24-sala-em-dois-modos-design.md, secao 5): um so
 * video com imagem tocando por PC. O primeiro conteudo de video (YouTube,
 * Twitch) que se registra fica ativo; os seguintes ficam "em espera" (so
 * para voce: o estado da sala continua andando) e mostram "Tocar este".
 * `take()` passa a vez: o ativo anterior vai para a espera. Saiu o ativo, o
 * mais antigo em espera assume.
 *
 * O Radio e so audio: tem a propria vaga (`kind: 'audio'`), com a mesma
 * regra, para duas radios na mesa nao tocarem por cima uma da outra.
 *
 * Sem DOM: cada conteudo recebe `onChange(ativo)` e decide o que mostrar.
 */

(function (root) {
  function createCoordinator() {
    const slots = new Map(); // kind -> { active: id|null, order: [id...] }
    const entries = new Map(); // id -> { kind, onChange }
    let nextId = 1;

    function slot(kind) {
      if (!slots.has(kind)) slots.set(kind, { active: null, order: [] });
      return slots.get(kind);
    }

    function notify(id, active) {
      const e = entries.get(id);
      if (!e || typeof e.onChange !== 'function') return;
      try {
        e.onChange(active);
      } catch {
        // conteudo que lanca nao derruba os outros
      }
    }

    function setActive(kind, id) {
      const s = slot(kind);
      const prev = s.active;
      if (prev === id) return;
      s.active = id;
      if (prev !== null) notify(prev, false);
      if (id !== null) notify(id, true);
    }

    /** Registra um conteudo. Devolve `{ id, active(), take(), release() }`.
     * O primeiro de cada tipo ja nasce ativo (sem chamar onChange: quem
     * registra le `active()` logo em seguida). */
    function register(kind, onChange) {
      const k = kind === 'audio' ? 'audio' : 'image';
      const id = nextId++;
      entries.set(id, { kind: k, onChange });
      const s = slot(k);
      s.order.push(id);
      if (s.active === null) s.active = id;
      return {
        id,
        active: () => slot(k).active === id,
        take: () => {
          if (entries.has(id)) setActive(k, id);
        },
        release: () => {
          if (!entries.has(id)) return;
          const cur = slot(k);
          cur.order = cur.order.filter((x) => x !== id);
          const wasActive = cur.active === id;
          entries.delete(id);
          if (wasActive) {
            cur.active = null;
            if (cur.order.length) setActive(k, cur.order[0]);
          }
        },
      };
    }

    function activeOf(kind) {
      return slot(kind === 'audio' ? 'audio' : 'image').active;
    }

    function size() {
      return entries.size;
    }

    return { register, activeOf, size };
  }

  const api = { createCoordinator, ...createCoordinator() };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaMidia = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
