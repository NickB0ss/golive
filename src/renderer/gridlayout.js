'use strict';

(function (root) {
  /** Decide a hierarquia visual sem conhecer o DOM. Tela assistida e o
   * conteudo principal; o resto so vai pra tira quando existe conteudo e
   * companhia -- com um tile so a grade continua tendo a altura inteira. */
  function gridLayout(tiles) {
    const list = Array.isArray(tiles) ? tiles : [];
    const main = list.filter((tile) => tile?.kind === 'screen' && tile.watched).map((tile) => tile.id);
    const spotlight = main.length > 0 && main.length < list.length;

    if (!spotlight) {
      return { layout: 'grid', count: list.length, main: list.map((tile) => tile.id), strip: [] };
    }

    return {
      layout: 'spotlight',
      count: list.length,
      main,
      strip: list.filter((tile) => !main.includes(tile.id)).map((tile) => tile.id),
    };
  }

  const api = { gridLayout };

  root.GoLive = root.GoLive || {};
  root.GoLive.gridLayout = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
