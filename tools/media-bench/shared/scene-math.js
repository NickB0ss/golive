'use strict';

/*
 * Cena sintetica DETERMINISTICA da bancada: so a matematica (posicoes, cores),
 * sem tocar em canvas. Dado o numero do quadro, o resultado e sempre o mesmo,
 * entao dois cenarios comparados veem exatamente o mesmo conteudo. O desenho
 * em si mora em renderer/scene.js.
 *
 * UMD: carrega no Node (testes) e como <script> classico na pagina.
 */
(function (root) {
  /** PRNG pequeno e estavel (mulberry32): mesma semente, mesma sequencia. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function proximo() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const RETANGULOS = 14;
  const BLOCOS_RUIDO = 160;

  /** Estado visual do quadro `n`. Tudo em coordenadas do canvas (w x h). */
  function frameState(n, w, h) {
    const t = n / 60; // "segundos" nominais de cena; independe do fps real
    const rects = [];
    for (let i = 0; i < RETANGULOS; i++) {
      const rw = Math.round(w * (0.08 + 0.03 * (i % 4)));
      const rh = Math.round(h * (0.10 + 0.02 * (i % 3)));
      const cx = (Math.sin(t * (0.7 + i * 0.13) + i) * 0.5 + 0.5) * (w - rw);
      const cy = (Math.cos(t * (0.5 + i * 0.09) + i * 1.7) * 0.5 + 0.5) * (h - rh);
      rects.push({ x: Math.round(cx), y: Math.round(cy), w: rw, h: rh, hue: (i * 47 + n * 2) % 360 });
    }
    // Ruido: semente por quadro, entao o encoder tem textura nova a cada
    // quadro (conteudo que nao comprime a nada) mas reproduzivel.
    const rnd = mulberry32(0x9E3779B1 ^ n);
    const lado = Math.max(8, Math.round(Math.min(w, h) / 45));
    const blocks = [];
    for (let i = 0; i < BLOCOS_RUIDO; i++) {
      blocks.push({
        x: Math.floor(rnd() * Math.max(1, w - lado)),
        y: Math.floor(rnd() * Math.max(1, h - lado)),
        s: lado,
        hue: Math.floor(rnd() * 360),
      });
    }
    return {
      n,
      bgHue: (n * 0.5) % 360,
      rects,
      blocks,
      bar: { x: Math.round(((n * 7) % (w + 200)) - 200), w: 200 },
      label: `quadro ${n}`,
    };
  }

  const api = { mulberry32, frameState, RETANGULOS, BLOCOS_RUIDO };
  root.MediaBench = root.MediaBench || {};
  root.MediaBench.sceneMath = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
