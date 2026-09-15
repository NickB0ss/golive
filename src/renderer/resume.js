'use strict';

(function (root) {
  // Decide so com os ids: a integracao aplica as quedas/ofertas no mesh e
  // assim a regra de retomada fica testavel sem WebRTC nem DOM.
  function planResume({ resumed, welcomePeerIds, meshPeerIds }) {
    if (resumed !== true) return { adopt: false, offerTo: [], dropPeers: [] };
    const welcome = new Set(Array.isArray(welcomePeerIds) ? welcomePeerIds.map(String) : []);
    const mesh = new Set(Array.isArray(meshPeerIds) ? meshPeerIds.map(String) : []);
    return {
      adopt: true,
      offerTo: [...welcome].filter((id) => !mesh.has(id)),
      dropPeers: [...mesh].filter((id) => !welcome.has(id)),
    };
  }

  // A retomada pode achar uma oferta perdida no meio do caminho. Uma pc so
  // fica de fora se ainda esta negociada e conectada; `disconnected` espera
  // a carencia do mesh, que e quem depois a transforma em `failed`.
  function kindsToReoffer({ outConnStates }) {
    const states = outConnStates && typeof outConnStates === 'object' ? outConnStates : {};
    return Object.entries(states)
      .filter(([, state]) => !state?.exists
        || state.signalingState !== 'stable'
        || state.connectionState === 'failed'
        || state.connectionState === 'closed')
      .map(([kind]) => kind);
  }

  // Do lado de quem RECEBE, a retomada fecha as entradas que ficaram no meio
  // de SDP/ICE -- e ninguem as reabre: quem serve aquela conexao ve a propria
  // saida saudavel e responde 'nada a re-ofertar' ao peer-resumed. So quem
  // serve pode ofertar, entao cada entrada derrubada vira um pedido de
  // 'reoffer' (o mesmo da autocura) pro peer daquela conexao. Saida derrubada
  // nao entra: o onPeerState ja re-oferta por conta propria.
  //
  // `delayMs` espaca os pedidos: o servidor aceita 2 'reoffer' por segundo de
  // cada peer, em janela fixa (MAX_REOFFER_PER_SECOND em signaling-core.js).
  // Tela e camera de mais de um peer caindo juntas passariam disso, e o
  // excedente sumiria calado -- sem entrada, nem o stallwatch o pediria de novo.
  const RESUME_REOFFER_SPACING_MS = 600;

  function reofferRequests(recovered) {
    const seen = new Set();
    const requests = [];
    for (const item of Array.isArray(recovered) ? recovered : []) {
      if (!item || item.dir !== 'in') continue;
      const to = item.peerId == null ? '' : String(item.peerId);
      const kind = typeof item.kind === 'string' ? item.kind : '';
      if (!to || !kind) continue;
      const key = `${to}|${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      requests.push({ to, kind, delayMs: requests.length * RESUME_REOFFER_SPACING_MS });
    }
    return requests;
  }

  // Espacar nao GARANTE a chegada: pausa do renderer ou rede engasgada junta
  // mensagens, e o limitador descarta. Por isso o pedido e repetido enquanto
  // a entrada nao volta. 3 tentativas a cada 8 s: a ultima cai depois da
  // carencia de 15 s do 'reoffer' no emissor (REOFFER_MIN_GAP_MS em app.js),
  // entao ela passa mesmo que a primeira tenha chegado e nao rendido oferta.
  const RESUME_REOFFER_ATTEMPTS = 3;
  const RESUME_REOFFER_RETRY_MS = 8000;

  // A entrada so renasce por oferta nova (ensureInConn e chamado apenas pelo
  // handleOffer do mesh). Existindo de novo, o pedido ja foi atendido por
  // algum caminho -- repetir faria o emissor derrubar uma saida saudavel.
  function reofferStillNeeded({ peer, kind }) {
    if (!peer || typeof kind !== 'string' || !kind) return false;
    return !peer.inConns?.[kind];
  }

  const api = {
    planResume, kindsToReoffer, reofferRequests, reofferStillNeeded,
    RESUME_REOFFER_SPACING_MS, RESUME_REOFFER_ATTEMPTS, RESUME_REOFFER_RETRY_MS,
  };
  root.GoLive = root.GoLive || {};
  root.GoLive.resume = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
