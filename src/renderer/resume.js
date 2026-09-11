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

  const api = { planResume, kindsToReoffer };
  root.GoLive = root.GoLive || {};
  root.GoLive.resume = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
