'use strict';

/*
 * Pagina da JANELA PROPRIA que a bancada cria para o modo owned-window.
 * So anima a mesma cena sintetica; e a unica coisa que o modo captura.
 */
(function () {
  // Tamanho = area de conteudo da janela (useContentSize, sem moldura); fps vem
  // do cenario pela query (?fps=N), com 60 como padrao se faltar.
  const w = Math.max(320, window.innerWidth);
  const h = Math.max(240, window.innerHeight);
  const q = Number(new URLSearchParams(window.location.search).get('fps'));
  const fps = Number.isFinite(q) && q >= 1 && q <= 120 ? q : 60;
  const scene = window.MediaBench.scene.create({ width: w, height: h, fps });
  scene.canvas.style.cssText = 'display:block;width:100vw;height:100vh';
  document.body.appendChild(scene.canvas);
  scene.start();
  window.addEventListener('beforeunload', () => scene.stop());
})();
