'use strict';

// Liga a faixa de titulo propria (#titlebar) aos controles de janela do
// processo principal. So faz algo no Windows -- macOS/Linux ficam com a
// barra nativa e a faixa segue hidden. Modulo puro: nao toca em DOM fora
// de init(), e o document entra por injecao (sem jsdom no projeto).
// Ver spec docs/superpowers/specs/2026-09-07-controles-de-janela-estilo-discord-design.md
(function (root) {
  function init(win, doc) {
    if (!win || win.platform !== 'win32') return;

    doc.getElementById('titlebar').hidden = false;
    doc.body.classList.add('has-titlebar');

    doc.getElementById('tb-min').addEventListener('click', () => win.minimize());
    doc.getElementById('tb-max').addEventListener('click', () => win.toggleMaximize());
    doc.getElementById('tb-close').addEventListener('click', () => win.close());

    const maxBtn = doc.getElementById('tb-max');
    win.onMaximizeChange((isMax) => {
      maxBtn.classList.toggle('is-maximized', isMax);
      maxBtn.setAttribute('aria-label', isMax ? 'Restaurar' : 'Maximizar');
    });
  }

  const api = { init };
  root.GoLive = root.GoLive || {};
  root.GoLive.titlebar = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
