'use strict';

(function (root) {
  function ordenarFontes(fontes) {
    const prioridade = { screen: 0, camera: 1 };
    return (Array.isArray(fontes) ? fontes : []).slice().sort((a, b) => {
      const tipo = (prioridade[a?.kind] ?? 2) - (prioridade[b?.kind] ?? 2);
      if (tipo) return tipo;
      return (Number(a?.startedAt) || 0) - (Number(b?.startedAt) || 0);
    });
  }

  function modoConversa(largura, preferencia = null) {
    if (['pinned', 'peek', 'closed'].includes(preferencia)) return preferencia;
    return Number(largura) >= 1180 ? 'pinned' : 'peek';
  }

  function estadoPessoa(pessoa = {}) {
    if (pessoa.live) return 'live';
    if (pessoa.mesa) return 'watching';
    return 'present';
  }

  const api = { ordenarFontes, modoConversa, estadoPessoa };
  root.GoLive = root.GoLive || {};
  root.GoLive.roomUi = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
