'use strict';

/* Dicionario en -- mesmas chaves do pt-BR.js. */

(function (root) {
  const textos = {
    'config.idioma.titulo': 'Language',
    'config.idioma.rotulo': 'App language',
    'config.idioma.auto': 'Automatic (system language)',
    'config.idioma.aoSair': 'Applies when you leave the room.',
    'splash.procurando': 'Checking for updates…',
    'splash.baixando': 'Downloading update — {pct}%',
    'splash.instalando': 'Installing…',
    'splash.abrindo': 'Opening…',
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.i18nDicionarios = root.GoLive.i18nDicionarios || {};
  root.GoLive.i18nDicionarios.en = textos;
  if (typeof module !== 'undefined') module.exports = textos;
})(typeof window !== 'undefined' ? window : globalThis);
