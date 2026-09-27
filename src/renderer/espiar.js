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
    '--spy-s2': '--s2',
    '--spy-s3': '--s3',
    '--spy-act': '--act',
    '--spy-on-act': '--on-act',
    '--font-body': '--font-body',
    '--font-display': '--font-display',
    '--font-mono': '--font-mono',
  });

  // So cor: `#rgb`..`#rrggbbaa` ou rgb()/rgba() com numeros. A janela nao
  // aceita nada que pudesse virar outra coisa dentro de um `style`.
  const COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*(?:,\s*[\d.]+%?\s*){2,3}\))$/i;
  // Fonte: lista de familias, com ou sem aspas simples, so letras, digitos,
  // espaco e hifen -- sem parenteses, barras nem aspas duplas.
  const FAMILIA = "(?:'[A-Za-z0-9 -]+'|[A-Za-z][A-Za-z0-9 -]*)";
  const FONT = new RegExp(`^${FAMILIA}(?:\\s*,\\s*${FAMILIA})*$`);

  function validSpyThemeValue(name, value) {
    return name.startsWith('--font-') ? FONT.test(value) : COLOR.test(value);
  }

  /** Le do tema da janela principal os tokens do Espiar. `read(nome)` devolve
   * o valor computado de um token (`getComputedStyle(...).getPropertyValue`).
   * Token vazio ou invalido fica de fora: o Espiar mantem o padrao. */
  function spyThemeVars(read) {
    const out = {};
    for (const [spyVar, appVar] of Object.entries(SPY_THEME_VARS)) {
      const value = String(read(appVar) ?? '').trim();
      if (validSpyThemeValue(spyVar, value)) out[spyVar] = value;
    }
    return out;
  }

  /** Filtra o que chega na janela Espiar: so variaveis conhecidas e valores
   * seguros para cor ou fonte. */
  function sanitizeSpyTheme(vars) {
    const out = {};
    if (!vars || typeof vars !== 'object') return out;
    for (const spyVar of Object.keys(SPY_THEME_VARS)) {
      const value = typeof vars[spyVar] === 'string' ? vars[spyVar].trim() : '';
      if (validSpyThemeValue(spyVar, value)) out[spyVar] = value;
    }
    return out;
  }

  const api = { createSpyState, SPY_THEME_VARS, spyThemeVars, sanitizeSpyTheme };
  root.GoLive = root.GoLive || {};
  root.GoLive.espiar = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
