'use strict';

// Dados publicos de golive-site/apoie.html e do rodape do site (2026-10-30).
// O IPC recebe apenas o identificador; URLs nunca chegam do renderer.
(function (root) {
  const PIX = '6d947798-9d1e-4af9-8a4c-2c11123752c7';
  const LINKS = Object.freeze({
    sugestoes: 'https://forms.gle/ym5yB2bbbwip9ypm7',
    paypal: 'https://www.paypal.com/donate/?business=ZZM3JAT2YKVVC&no_recurring=0'
      + '&item_name=Contribute+to+the+golive+project&currency_code=BRL',
  });

  function linkDeApoio(id) {
    return typeof id === 'string' && Object.hasOwn(LINKS, id) ? LINKS[id] : null;
  }

  const api = { PIX, linkDeApoio };
  root.GoLive = root.GoLive || {};
  root.GoLive.comunidade = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
