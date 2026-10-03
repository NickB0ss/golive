'use strict';

/*
 * Dicionario pt-BR -- a REFERENCIA. Toda chave nasce aqui, com o texto
 * exatamente como estava no codigo; en.js e es.js tem de ter as mesmas
 * chaves e os mesmos {marcadores}. Objeto plano: area.subarea.nome -> texto,
 * ou { one, other } para plural.
 */

(function (root) {
  const textos = {
    'splash.procurando': 'Procurando atualizações…',
    'splash.baixando': 'Baixando atualização — {pct}%',
    'splash.instalando': 'Instalando…',
    'splash.abrindo': 'Abrindo…',
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.i18nDicionarios = root.GoLive.i18nDicionarios || {};
  root.GoLive.i18nDicionarios['pt-BR'] = textos;
  if (typeof module !== 'undefined') module.exports = textos;
})(typeof window !== 'undefined' ? window : globalThis);
