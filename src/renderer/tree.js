'use strict';

(function (root) {
  // A origem manda pra ate DOIS relays; cada relay atende no maximo dois
  // filhos. Profundidade 2 (origem -> relay -> folha) e estrutural: um relay
  // sempre pendura na origem e uma folha nunca tem filho -- nao ha constante
  // pra isso porque nao ha caminho no codigo que monte um terceiro nivel.
  //
  // Por que 2 na origem, e nao 1 (auditoria 2026-09-18, anexo 3): com um
  // relay so, o teto era 4 pessoas; na sala de 6 o excedente virava 'direct'
  // e 3 dos 5 encoders voltavam pra origem (18,5 Mbps de upload em quem esta
  // jogando). Com dois relays a sala de 6 fica com 2 encoders na origem
  // (12,3 Mbps) e a de 7 cabe sem nenhum 'direct'. As duas constantes sao
  // LIDAS por computeTree -- os testes provam isso pelo comportamento (quantos
  // relays e quantas folhas saem), nao pelo valor escrito.
  const FANOUT_ORIGEM = 2;
  const FANOUT_RELAY = 2;

  // Orcamento de encode POR QUADRO usado na eleicao de relay (H2). O gargalo
  // medido nao e rede, e encode: o relay carrega 2 encoders + 1 decoder, o
  // trabalho mais pesado da sala. Um candidato que JA gasta mais que um
  // quadro inteiro codificando o pouco que ele proprio manda nao vai dar
  // conta desse acrescimo -- entao vira PENALIDADE (nao veto). Derivado do
  // alvo de 60 fps: 1000/60 ~= 16.6 ms. A 30 fps sobra folga, entao o teto
  // de 60 e o pior caso e serve de referencia unica. Mesmo numero do painel
  // de estatisticas em app.js (renderStats).
  const ORCAMENTO_MS_POR_QUADRO = 1000 / 60;

  // encodeHealth ausente/null e NEUTRO: quem nunca reportou nada nao e
  // "software" e nao leva penalidade. Um candidato sem dado nunca pode
  // perder para um comprovadamente ruim.
  function encoderEhSoftware(c) {
    return Boolean(c.encodeHealth && c.encodeHealth.softwareEncoder === true);
  }

  // Binario: 1 se o candidato COMPROVOU gastar mais que o orcamento por
  // quadro, 0 caso contrario (inclui msPerFrame null e encodeHealth
  // ausente). Nao e veto -- um relay lento ainda entrega melhor que a malha
  // pura, onde a origem paga um encoder por espectador.
  function penalidadeEncode(c) {
    const h = c.encodeHealth;
    if (!h || h.msPerFrame == null) return 0;
    return h.msPerFrame > ORCAMENTO_MS_POR_QUADRO ? 1 : 0;
  }

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

  // Ordem de preferencia pra relay. R2: carga de relay vem PRIMEIRO. Cada
  // origem calcula sua propria arvore, entao escolher por RTT sem esse sinal
  // concentrava varios repasses no mesmo peer. Campo ausente (cliente antigo)
  // vale zero. Depois dela, H2 ordena por SAUDE DE ENCODE antes de RTT. RTT
  // e a metrica que menos importa aqui -- o gargalo e o encoder do relay,
  // nao a rede.
  //  1. encoder em software e VETO quando ha alternativa que nao codifica
  //     em software (encodeHealth ausente conta como alternativa: e
  //     neutro, nao "software"). Se TODOS forem software, nao inventa
  //     exclusao -- cai pro resto do criterio.
  //  2. msPerFrame acima do orcamento e PENALIDADE, nao veto.
  //  3. ESTABILIDADE (so com `anterior`): entre candidatos empatados nos
  //     criterios acima, quem ja e relay fica, e quem e folha de um pai que
  //     continua de pe vai pro fim. Ver estabilidade() logo abaixo.
  //  4. RTT como desempate (comportamento anterior).
  //  5. joinedAt como desempate final (comportamento anterior).
  // Sem nenhum encodeHealth em nenhum candidato os passos 1 e 2 sao
  // no-ops (todos empatam em 0), e sem `anterior` o passo 3 tambem: a ordem
  // e so rtt, depois joinedAt.
  function rankRelays(eligible, anterior) {
    const algumNaoSoftware = eligible.some((c) => !encoderEhSoftware(c));
    const elegiveis = new Set(eligible.map((c) => c.id));
    // 0: ja e relay -- manter nao custa renegociacao nenhuma.
    // 1: novo, direct, ou folha ORFA (o pai dela nao pode mais ser relay):
    //    esse no vai precisar de oferta da origem ou de um pai novo de
    //    qualquer jeito.
    // 2: folha de um pai que segue elegivel. Promove-la tira um filho de um
    //    relay que nao tinha nada a ver com a mudanca -- duas renegociacoes
    //    (ela e quem ocupar a vaga dela) sem ganho nenhum.
    // Vem DEPOIS de carga e saude de encode de proposito: um relay que
    // passou a codificar em software continua sendo trocado. So o RTT --
    // ruido na LAN, e congelado nas folhas (ver app.js recomputeTree) --
    // perde pra estabilidade.
    const estabilidade = (c) => {
      const antes = anterior?.get(c.id);
      if (!anterior || !antes) return anterior ? 1 : 0;
      if (antes.role === 'relay') return 0;
      if (antes.role === 'folha' && elegiveis.has(antes.paiId)) return 2;
      return 1;
    };
    return [...eligible].sort((a, b) => {
      const cargaA = Number.isInteger(a.relayLoad) && a.relayLoad >= 0 ? a.relayLoad : 0;
      const cargaB = Number.isInteger(b.relayLoad) && b.relayLoad >= 0 ? b.relayLoad : 0;
      if (cargaA !== cargaB) return cargaA - cargaB;
      if (algumNaoSoftware) {
        const sa = encoderEhSoftware(a) ? 1 : 0;
        const sb = encoderEhSoftware(b) ? 1 : 0;
        if (sa !== sb) return sa - sb; // software vai pro fim da fila
      }
      const pa = penalidadeEncode(a);
      const pb = penalidadeEncode(b);
      if (pa !== pb) return pa - pb;
      const ea = estabilidade(a);
      const eb = estabilidade(b);
      if (ea !== eb) return ea - eb;
      const rttA = a.rtt == null ? Infinity : a.rtt;
      const rttB = b.rtt == null ? Infinity : b.rtt;
      if (rttA !== rttB) return rttA - rttB;
      return a.joinedAt - b.joinedAt; // desempate: quem entrou ha mais tempo
    });
  }

  // Quantos relays a sala pede. Cada relay cobre ele mesmo e FANOUT_RELAY
  // folhas; so abre um relay novo quando o anterior ja nao cobre todo mundo.
  // Na sala de 4 (3 espectadores) isso da UM relay, como antes: dois relays
  // ali custariam 2 encoders na origem em vez de 1, sem cobrir ninguem a
  // mais. Da sala de 5 em diante vira dois (teto FANOUT_ORIGEM), e o que nao
  // cabe em FANOUT_ORIGEM x (1 + FANOUT_RELAY) vira 'direct'.
  function relaysNecessarios(espectadores) {
    return Math.min(FANOUT_ORIGEM, Math.max(1, Math.ceil(espectadores / (1 + FANOUT_RELAY))));
  }

  // candidates: Array<{ id, joinedAt, rtt: number|null, transmitting,
  // suspended, relayIneligible,
  //   encodeHealth?: { softwareEncoder: boolean, msPerFrame: number|null } | null,
  //   relayLoad?: number
  // }> -- todo peer da sala, exceto a propria origem. `encodeHealth` e
  // opcional: sobe do proprio peer junto do 'view-state' (ver app.js) e so
  // existe quando ele esta de fato codificando algum kind.
  //
  // opts.anterior: a atribuicao que esta no ar agora (a que esta origem
  // aplicou por ultimo), ou nada. So serve pra ESTABILIDADE, em dois
  // pontos: (a) no ranking, como desempate antes do RTT (ver rankRelays);
  // (b) uma folha cujo relay continua relay e ainda tem vaga fica com ele.
  // Sem isto, quando um dos dois relays cai (ou alguem entra), o recalculo
  // promovia a relay a folha de melhor RTT -- tirando-a do relay que NAO
  // caiu -- e redistribuia as folhas em ordem de chegada. Cada troca e uma
  // renegociacao (tela preta) numa folha que nao tinha nada a ver com a
  // falha.
  //
  // Devolve Map<peerId, { role: 'relay'|'folha'|'direct', paiId, filhosIds }>.
  // 'direct' fica fora da arvore e recebe oferta direta da origem -- e o
  // fallback de malha, tanto pra "nenhum candidato elegivel" quanto pro
  // excedente que nao cabe em FANOUT_ORIGEM relays de FANOUT_RELAY filhos.
  function computeTree(originId, candidates, opts = {}) {
    const assignments = new Map();
    if (!candidates.length) return assignments;
    const anterior = opts.anterior instanceof Map ? opts.anterior : null;

    // Nao pode estar transmitindo (ja e origem de outra arvore) nem estar
    // suspenso por F1.3 (quem minimizou nao e candidato). `relayIneligible`
    // e o veto de curto prazo de quem ACABOU de falhar como relay -- sem
    // ele a re-eleicao logo apos a falha reelege o mesmo no (ele continua
    // com o melhor RTT lembrado, justamente por ter estado conectado) e a
    // arvore fica batendo entre os mesmos dois estados. Ver app.js.
    const eligible = candidates.filter((c) => !c.transmitting && !c.suspended && !c.relayIneligible);
    if (!eligible.length) return allDirect(originId, candidates);

    const relays = rankRelays(eligible, anterior).slice(0, relaysNecessarios(candidates.length));
    const filhos = new Map(relays.map((r) => [r.id, []]));
    const resto = candidates.filter((c) => !filhos.has(c.id));

    // 1. Estabilidade: folha fica com o pai de antes, se ele segue relay e
    //    tem vaga (ver opts.anterior acima).
    const semPai = [];
    for (const c of resto) {
      const antes = anterior?.get(c.id);
      const lista = antes?.role === 'folha' ? filhos.get(antes.paiId) : null;
      if (lista && lista.length < FANOUT_RELAY) lista.push(c.id);
      else semPai.push(c);
    }

    // 2. O resto, em ordem de chegada na lista, vai pro relay com MENOS
    //    filhos (empate: o melhor ranqueado). Equilibrar em vez de encher o
    //    primeiro: na sala de 5 da 1+1 em vez de 2+0 -- mesmos 2 encoders na
    //    origem, mas um encoder por relay em vez de dois num so, e o teto de
    //    uplink do relay (qualityForRelay) dividido por 1 em vez de 2.
    //    Sem vaga em nenhum: 'direct' na origem.
    const excedente = [];
    for (const c of semPai) {
      let destino = null;
      for (const r of relays) {
        const lista = filhos.get(r.id);
        if (lista.length >= FANOUT_RELAY) continue;
        if (!destino || lista.length < filhos.get(destino).length) destino = r.id;
      }
      if (destino == null) excedente.push(c);
      else filhos.get(destino).push(c.id);
    }

    for (const r of relays) {
      const filhosIds = filhos.get(r.id);
      assignments.set(r.id, { role: 'relay', paiId: originId, filhosIds });
      for (const id of filhosIds) assignments.set(id, { role: 'folha', paiId: r.id, filhosIds: [] });
    }
    for (const extra of excedente) assignments.set(extra.id, { role: 'direct', paiId: originId, filhosIds: [] });

    return assignments;
  }

  // A malha degenerada nao e so uma topologia: e o modo de FALHA. Quando
  // sobra alguem elegivel, a origem paga um encoder por relay (no maximo
  // FANOUT_ORIGEM); quando nao sobra, ela volta a pagar um por espectador. Quem chama precisa distinguir os dois
  // casos pra baixar o preset junto -- sem isso a malha volta em qualidade
  // cheia, o encoder cai pra software, o jitter derruba mais links, mais
  // relays sao vetados e a malha se realimenta (auditoria H3).
  //
  // E uma funcao pura sobre o RESULTADO, e nao um campo novo no retorno, de
  // proposito: `computeTree` devolve um Map que applyOriginAssignments
  // itera direto, e embrulhar isso num objeto quebraria quem chama.
  //
  // Mapa vazio da `false`: sala sem ninguem nao e o modo degradado -- nao ha
  // espectador, nao ha encoder, nao ha nada a degradar.
  function isAllDirect(assignments) {
    if (!assignments || assignments.size === 0) return false;
    for (const assignment of assignments.values()) {
      if (assignment.role !== 'direct') return false;
    }
    return true;
  }

  const api = { computeTree, allDirect, isAllDirect, sameAssignments, FANOUT_ORIGEM, FANOUT_RELAY };

  root.GoLive = root.GoLive || {};
  root.GoLive.tree = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
