'use strict';

(function (root) {
  // Valores travados na spec de 2026-08-23 (F2, "Papeis e escolha do
  // relay"). A origem manda pra UM so relay; cada relay atende no maximo
  // dois; a arvore nao passa de origem -> relay -> folha. Profundidade
  // maxima 2 e o freio de latencia E a garantia contra ciclo -- com a
  // arvore recalculada so pela origem, nao ha como um no virar ancestral
  // de si mesmo.
  const FANOUT_ORIGEM = 1;
  const FANOUT_RELAY = 2;
  const PROFUNDIDADE_MAX = 2;

  // candidates: Array<{ id, joinedAt, rtt: number|null, transmitting,
  // suspended }> -- todo peer da sala, exceto a propria origem.
  //
  // Devolve Map<peerId, { role: 'relay'|'folha'|'direct', paiId, filhosIds }>.
  // 'direct' fica fora da arvore e recebe oferta direta da origem -- e o
  // fallback de malha, tanto pra "nenhum candidato elegivel" quanto pro
  // excedente que nao cabe no fanout de um relay so (a spec so cobre o
  // caso de uma sala de 4, que cabe exatamente; excedente alem disso e uma
  // decisao deste modulo, nao da spec).
  function computeTree(originId, candidates) {
    const assignments = new Map();
    if (!candidates.length) return assignments;

    // Nao pode estar transmitindo (ja e origem de outra arvore) nem estar
    // suspenso por F1.3 (quem minimizou nao e candidato).
    const eligible = candidates.filter((c) => !c.transmitting && !c.suspended);

    eligible.sort((a, b) => {
      const rttA = a.rtt == null ? Infinity : a.rtt;
      const rttB = b.rtt == null ? Infinity : b.rtt;
      if (rttA !== rttB) return rttA - rttB;
      return a.joinedAt - b.joinedAt; // desempate: quem entrou ha mais tempo
    });

    const relay = eligible[0] || null;

    if (!relay) {
      for (const c of candidates) assignments.set(c.id, { role: 'direct', paiId: originId, filhosIds: [] });
      return assignments;
    }

    const rest = candidates.filter((c) => c.id !== relay.id);
    const leaves = rest.slice(0, FANOUT_RELAY);
    const leafIds = leaves.map((c) => c.id);
    const overflow = rest.filter((c) => !leafIds.includes(c.id));

    assignments.set(relay.id, { role: 'relay', paiId: originId, filhosIds: leafIds });
    for (const leaf of leaves) assignments.set(leaf.id, { role: 'folha', paiId: relay.id, filhosIds: [] });
    for (const extra of overflow) assignments.set(extra.id, { role: 'direct', paiId: originId, filhosIds: [] });

    return assignments;
  }

  const api = { computeTree, FANOUT_ORIGEM, FANOUT_RELAY, PROFUNDIDADE_MAX };

  root.GoLive = root.GoLive || {};
  root.GoLive.tree = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
