'use strict';

/* Dicionario es -- mesmas chaves do pt-BR.js. */

(function (root) {
  const textos = {
    'config.idioma.titulo': 'Idioma',
    'config.idioma.rotulo': 'Idioma de la app',
    'config.idioma.auto': 'Automático (idioma del sistema)',
    'config.idioma.aoSair': 'Se aplica cuando salgas de la sala.',
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
