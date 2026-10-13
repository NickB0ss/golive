'use strict';

(function (root) {
  /** Custo LOCAL de tela: senders vivos e ofertas planejadas, por peer/kind.
   * O plano cobre o intervalo antes de PC/stats e durante resume. Um sender
   * atual ja previsto nao e cobrado duas vezes. looking nao regula transporte:
   * um relay sem tile ainda precisa do upstream que alimenta seus filhos. */
  function screenSenderLoad({ peers = new Map(), localScreen = false, assignments = new Map(),
    relays = new Map(), offers = [] } = {}) {
    const counts = new Map();
    const kinds = new Map();
    function add(peerId, kind, cost) {
      const peer = peers.get(peerId);
      if (!peer || peer.suspended?.[kind] || String(kind).split('@')[0] !== 'screen') return;
      const key = JSON.stringify([peerId, kind]);
      counts.set(key, Math.max(counts.get(key) || 0, cost));
      kinds.set(key, kind);
    }
    for (const [peerId, peer] of peers) {
      for (const [kind, pc] of Object.entries(peer.outConns || {})) {
        if (!pc || peer.suspended?.[kind] || String(kind).split('@')[0] !== 'screen') continue;
        const senders = new Set(pc.getSenders?.() || []);
        const active = [...senders].filter((s) => s.track?.kind === 'video' && s.track.readyState !== 'ended');
        add(peerId, kind, active.length);
      }
      if (localScreen && assignments.get(peerId)?.role !== 'folha') add(peerId, 'screen', 1);
    }
    for (const [sourceId, state] of relays) {
      // live:false e encerramento anunciado, nao falha de transporte.
      // Sem esse sinal, o plano ainda cobre primeira oferta/recuperacao.
      if (state.role !== 'relay' || peers.get(sourceId)?.live === false) continue;
      for (const childId of state.filhosIds || []) add(childId, `screen@${sourceId}`, 1);
    }
    for (const { peerId, kind } of offers) add(peerId, kind, 1);
    const byKind = new Map();
    let total = 0;
    for (const [key, count] of counts) {
      total += count;
      const kind = kinds.get(key);
      byKind.set(kind, (byKind.get(kind) || 0) + count);
    }
    return { total, byKind };
  }

  function finiteNonnegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  }

  /** Campos opcionais existentes passam intactos quando validos. Cliente
   * antigo continua neutro quando nao tem medicao normalizada. */
  function normalizeEncodeHealth(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const positive = (v) => finiteNonnegative(v) > 0 ? v : null;
    return {
      softwareEncoder: raw.softwareEncoder === true,
      msPerFrame: finiteNonnegative(raw.msPerFrame),
      load: finiteNonnegative(raw.load),
      budgetMs: positive(raw.budgetMs),
      fps: positive(raw.fps),
    };
  }

  const api = { screenSenderLoad, normalizeEncodeHealth };
  root.GoLive = root.GoLive || {};
  root.GoLive.qualitypolicy = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
