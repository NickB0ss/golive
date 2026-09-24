(function (root) {
  'use strict';

  function createSpyState() {
    let currentTileId = null;
    return {
      open(tileId) {
        const action = currentTileId ? 'replace' : 'open';
        currentTileId = tileId;
        return { action, tileId };
      },
      closeFor(tileId) {
        if (currentTileId !== tileId) return false;
        currentTileId = null;
        return true;
      },
      closed(tileId) {
        return this.closeFor(tileId);
      },
      tileId: () => currentTileId,
    };
  }

  // A janela Espiar tem a propria folha (espiar.html) e so cinco cores, mais
  // o anel de foco. Cada uma vem de um token do tema da janela principal --
  // os mesmos papeis que o app usa: fundo, texto, texto secundario, botao
  // (superficie elevada), hover (a mais elevada) e o acento. Os valores
  // padrao em espiar.html sao os do tema GoLive, pra janela abrir certa
  // mesmo antes de receber o tema.
  const SPY_THEME_VARS = Object.freeze({
    '--spy-bg': '--bg',
    '--spy-fg': '--tx',
    '--spy-muted': '--tx2',
    '--spy-control': '--s2',
    '--spy-hover': '--s4',
    '--spy-act': '--act',
  });

  // So cor: `#rgb`..`#rrggbbaa` ou rgb()/rgba() com numeros. A janela nao
  // aceita nada que pudesse virar outra coisa dentro de um `style`.
  const COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*(?:,\s*[\d.]+%?\s*){2,3}\))$/i;

  /** Le do tema da janela principal as cores do Espiar. `read(nome)` devolve
   * o valor computado de um token (`getComputedStyle(...).getPropertyValue`).
   * Token vazio ou invalido fica de fora: o Espiar mantem o padrao. */
  function spyThemeVars(read) {
    const out = {};
    for (const [spyVar, appVar] of Object.entries(SPY_THEME_VARS)) {
      const value = String(read(appVar) ?? '').trim();
      if (COLOR.test(value)) out[spyVar] = value;
    }
    return out;
  }

  /** Filtra o que chega na janela Espiar: so as variaveis conhecidas, so
   * valores de cor. */
  function sanitizeSpyTheme(vars) {
    const out = {};
    if (!vars || typeof vars !== 'object') return out;
    for (const spyVar of Object.keys(SPY_THEME_VARS)) {
      const value = typeof vars[spyVar] === 'string' ? vars[spyVar].trim() : '';
      if (COLOR.test(value)) out[spyVar] = value;
    }
    return out;
  }

  const api = { createSpyState, SPY_THEME_VARS, spyThemeVars, sanitizeSpyTheme };
  root.GoLive = root.GoLive || {};
  root.GoLive.espiar = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
