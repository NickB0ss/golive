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

  // Topologia degenerada: todo mundo recebe oferta direta da origem. E o
  // que a malha (arvore desligada) sempre foi, escrito como uma atribuicao
  // de verdade pra que DESLIGAR o interruptor no meio de uma sessao consiga
  // dissolver uma arvore ja no ar -- sem isto as folhas ficariam orfas,
  // cortadas da origem e sem relay. Ver app.js recomputeTree.
  function allDirect(originId, candidates) {
    const assignments = new Map();
    for (const c of candidates) assignments.set(c.id, { role: 'direct', paiId: originId, filhosIds: [] });
    return assignments;
  }

  // Compara duas atribuicoes pelo que de fato importa (papel, pai e
  // conjunto de filhos -- a ORDEM dos filhos nao muda nada). Serve pra
  // origem pular um recalculo que nao mudou nada: sem isto, qualquer
  // entra-e-sai na sala re-emitia 'tree' com epoch novo, e cada relay
  // chamava relayTo de novo pros MESMOS filhos -- o que empilha um
  // transceiver (e portanto um encoder) extra por vez, exatamente o custo
  // que a arvore existe pra evitar.
  function sameAssignments(a, b) {
    if (!a || !b || a.size !== b.size) return false;
    for (const [id, x] of a) {
      const y = b.get(id);
      if (!y) return false;
      if (x.role !== y.role || x.paiId !== y.paiId) return false;
      const xs = [...(x.filhosIds || [])].sort();
      const ys = [...(y.filhosIds || [])].sort();
      if (xs.length !== ys.length) return false;
      for (let i = 0; i < xs.length; i += 1) if (xs[i] !== ys[i]) return false;
    }
    return true;
  }

  // candidates: Array<{ id, joinedAt, rtt: number|null, transmitting,
  // suspended, relayIneligible }> -- todo peer da sala, exceto a propria
  // origem.
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
    // suspenso por F1.3 (quem minimizou nao e candidato). `relayIneligible`
    // e o veto de curto prazo de quem ACABOU de falhar como relay -- sem
    // ele a re-eleicao logo apos a falha reelege o mesmo no (ele continua
    // com o melhor RTT lembrado, justamente por ter estado conectado) e a
    // arvore fica batendo entre os mesmos dois estados. Ver app.js.
    const eligible = candidates.filter((c) => !c.transmitting && !c.suspended && !c.relayIneligible);

    eligible.sort((a, b) => {
      const rttA = a.rtt == null ? Infinity : a.rtt;
      const rttB = b.rtt == null ? Infinity : b.rtt;
      if (rttA !== rttB) return rttA - rttB;
      return a.joinedAt - b.joinedAt; // desempate: quem entrou ha mais tempo
    });

    const relay = eligible[0] || null;

    if (!relay) return allDirect(originId, candidates);

    const rest = candidates.filter((c) => c.id !== relay.id);
    const leaves = rest.slice(0, FANOUT_RELAY);
    const leafIds = leaves.map((c) => c.id);
    const overflow = rest.filter((c) => !leafIds.includes(c.id));

    assignments.set(relay.id, { role: 'relay', paiId: originId, filhosIds: leafIds });
    for (const leaf of leaves) assignments.set(leaf.id, { role: 'folha', paiId: relay.id, filhosIds: [] });
    for (const extra of overflow) assignments.set(extra.id, { role: 'direct', paiId: originId, filhosIds: [] });

    return assignments;
  }

  const api = { computeTree, allDirect, sameAssignments, FANOUT_ORIGEM, FANOUT_RELAY, PROFUNDIDADE_MAX };

  root.GoLive = root.GoLive || {};
  root.GoLive.tree = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
