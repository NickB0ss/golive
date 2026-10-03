'use strict';

/* Dicionario es -- mesmas chaves do pt-BR.js. */

(function (root) {
  const textos = {
    'splash.procurando': 'Buscando actualizaciones…',
    'splash.baixando': 'Descargando actualización — {pct}%',
    'splash.instalando': 'Instalando…',
    'splash.abrindo': 'Abriendo…',
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.i18nDicionarios = root.GoLive.i18nDicionarios || {};
  root.GoLive.i18nDicionarios.es = textos;
  if (typeof module !== 'undefined') module.exports = textos;
})(typeof window !== 'undefined' ? window : globalThis);
