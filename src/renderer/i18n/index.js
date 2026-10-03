'use strict';

/*
 * Traducao do app. A janela carrega este arquivo por script, depois dos tres
 * dicionarios. O processo principal e o servidor carregam pelo require.
 */

(function (root) {
  const IDIOMAS = Object.freeze(['pt-BR', 'en', 'es']);
  const BASE = 'pt-BR';
  const FORMA_CHAVE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;
  const avisadas = new Set();
  let ativo = BASE;

  function dicionarios() {
    const globais = root.GoLive && root.GoLive.i18nDicionarios;
    if (globais && globais[BASE]) return globais;
    if (typeof module !== 'undefined' && typeof require === 'function') {
      return {
        'pt-BR': require('./pt-BR'),
        en: require('./en'),
        es: require('./es'),
      };
    }
    return { [BASE]: {} };
  }

  function definirIdioma(codigo) {
    ativo = IDIOMAS.includes(codigo) ? codigo : BASE;
    return ativo;
  }

  function idiomaAtivo() {
    return ativo;
  }

  function bruto(chave) {
    const dicionario = dicionarios();
    const proprio = dicionario[ativo] && dicionario[ativo][chave];
    if (proprio !== undefined) return proprio;
    return dicionario[BASE] ? dicionario[BASE][chave] : undefined;
  }

  function forma(valor, n) {
    if (typeof valor === 'string') return valor;
    if (!valor || typeof valor !== 'object') return undefined;
    const plural = new Intl.PluralRules(ativo).select(Number(n) || 0);
    return valor[plural] !== undefined ? valor[plural] : valor.other;
  }

  function preencher(texto, valores) {
    return texto.replace(/\{(\w+)\}/g, (inteiro, nome) => {
      if (!valores || valores[nome] === undefined || valores[nome] === null) return inteiro;
      return String(valores[nome]);
    });
  }

  function t(chave, valores) {
    const texto = forma(bruto(chave), valores && valores.n);
    if (typeof texto !== 'string') {
      if (!avisadas.has(chave)) {
        avisadas.add(chave);
        if (typeof console !== 'undefined') console.warn(`i18n: chave sem texto: ${chave}`);
      }
      return chave;
    }
    return preencher(texto, valores);
  }

  function existe(chave) {
    const dicionario = dicionarios();
    return Boolean(dicionario[BASE] && Object.prototype.hasOwnProperty.call(dicionario[BASE], chave));
  }

  function codigo(chave, valores) {
    if (!valores) return chave;
    const parametros = new URLSearchParams();
    for (const [nome, valor] of Object.entries(valores)) parametros.set(nome, String(valor));
    const busca = parametros.toString();
    return busca ? `${chave}?${busca}` : chave;
  }

  function traduzirCodigo(texto) {
    if (typeof texto !== 'string') return '';
    const corte = texto.indexOf('?');
    const chave = corte < 0 ? texto : texto.slice(0, corte);
    if (!FORMA_CHAVE.test(chave) || !existe(chave)) return texto;
    const valores = corte < 0 ? undefined : Object.fromEntries(new URLSearchParams(texto.slice(corte + 1)));
    return t(chave, valores);
  }

  function formatarHora(ts, opcoes) {
    const segundos = opcoes && opcoes.segundos ? { second: '2-digit' } : {};
    return new Date(ts).toLocaleTimeString(ativo, {
      hour: '2-digit',
      minute: '2-digit',
      ...segundos,
    });
  }

  function formatarData(ts) {
    return new Date(ts).toLocaleDateString(ativo, { day: 'numeric', month: 'long' });
  }

  function maiuscula(texto) {
    return texto ? texto.charAt(0).toLocaleUpperCase(ativo) + texto.slice(1) : texto;
  }

  function aplicarNoDom(raiz) {
    const base = raiz || root.document;
    if (!base) return;
    base.querySelectorAll('[data-i18n]').forEach((elemento) => {
      elemento.textContent = t(elemento.dataset.i18n);
    });
    base.querySelectorAll('[data-i18n-attr]').forEach((elemento) => {
      for (const par of elemento.dataset.i18nAttr.split(';')) {
        const [atributo, chave] = par.split(':').map((valor) => valor.trim());
        if (atributo && chave) elemento.setAttribute(atributo, t(chave));
      }
    });
    if (!raiz && base.documentElement) base.documentElement.lang = ativo;
  }

  function chaves(idioma) {
    return Object.keys(dicionarios()[idioma] || {});
  }

  const doPreload = (root.golive && root.golive.idioma)
    || (root.goliveSpy && root.goliveSpy.idioma)
    || (root.goliveOverlay && root.goliveOverlay.idioma);
  if (doPreload && doPreload.ativo) definirIdioma(doPreload.ativo);

  const api = {
    IDIOMAS,
    definirIdioma,
    idiomaAtivo,
    t,
    codigo,
    traduzirCodigo,
    existe,
    formatarHora,
    formatarData,
    maiuscula,
    aplicarNoDom,
    chaves,
  };
  root.GoLive = root.GoLive || {};
  root.GoLive.i18n = api;
  // O HTML estatico ja foi lido (os scripts ficam no fim do body): troca o
  // texto fixo antes de config.js, ui.js, app.js e do primeiro desenho.
  if (root.document && root.document.body) aplicarNoDom();
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
