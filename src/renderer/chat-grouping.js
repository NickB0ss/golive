'use strict';

// Regra sem DOM para o historico e as mensagens que chegam na sala.
(function (root) {
  const CINCO_MINUTOS = 5 * 60 * 1000;

  function deveAgrupar(anterior, atual) {
    if (!anterior || !atual) return false;
    if (anterior.system || atual.system) return false;
    if (anterior.separadorDeDia || atual.separadorDeDia) return false;
    if (anterior.from !== atual.from) return false;
    return atual.ts - anterior.ts <= CINCO_MINUTOS;
  }

  const api = { deveAgrupar };
  root.GoLive = root.GoLive || {};
  root.GoLive.chatGrouping = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
