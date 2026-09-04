// src/renderer/overlay.js
'use strict';

/*
 * A lousa desenhada na TELA DE VERDADE de quem esta compartilhando.
 *
 * Esta pagina roda numa janela transparente, sem moldura, click-through e
 * sempre por cima, esticada sobre o monitor compartilhado (ver
 * src/main/overlay.js pra como esse monitor e escolhido). Ela e cega pro
 * resto do app: nao conhece sala, peer nem WebRTC -- so recebe ops de
 * anotacao pelo preload e as desenha.
 *
 * Coordenadas: o conteudo capturado E o monitor inteiro, entao o retangulo
 * de conteudo e a tela toda -- sem letterbox pra calcular, ao contrario do
 * tile dentro do app, onde o <video> e `object-fit: contain`. Por isso o
 * mesmo `toPx` do annotate.js cai no pixel certo aqui com um retangulo
 * trivial: e o que garante que o rabisco aterrisse onde quem desenhou viu.
 *
 * Ver docs/superpowers/specs/2026-09-05-rabisco-na-tela-real-design.md
 */

(function () {
  const annotate = window.GoLive.annotate;
  const canvas = document.getElementById('lousa');
  const ctx = canvas.getContext('2d');

  // Um deposito proprio, alimentado pelas mesmas ops que o app aplica no
  // dele. Guardar o estado aqui (em vez de receber a lista inteira a cada
  // ponto) e o que mantem o custo constante: um traco de 3 segundos manda
  // ~50 mensagens de lote, nao 50 copias de uma lousa de 400 itens.
  const store = annotate.createStore();

  // Ha uma superficie so nesta janela -- a tela de quem esta compartilhando,
  // que e o dono dela. O id real chega junto das ops.
  let surfaceId = null;
  let pendingFrame = null;

  /** Redesenho coalescido: varias ops no mesmo quadro pintam uma vez so. */
  function scheduleRedraw() {
    if (pendingFrame !== null) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      redraw();
    });
  }

  function redraw() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!surfaceId) return;

    // A tela inteira e o conteudo: nao ha barra preta pra descontar.
    const rect = { left: 0, top: 0, width: cssW, height: cssH };

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'top';
    for (const item of store.items(surfaceId)) {
      const cor = annotate.colorFor(item.from);
      if (item.kind === 'stroke') {
        ctx.strokeStyle = cor;
        ctx.lineWidth = item.width;
        // Mesma sombra do canvas do app: sobre uma janela branca, tinta
        // clara sem contorno some.
        ctx.shadowColor = 'rgba(0,0,0,.55)';
        ctx.shadowBlur = 3;
        ctx.beginPath();
        item.points.forEach(([x, y], i) => {
          const p = annotate.toPx(x, y, rect);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        if (item.points.length === 1) {
          const p = annotate.toPx(item.points[0][0], item.points[0][1], rect);
          ctx.arc(p.x, p.y, item.width / 2, 0, Math.PI * 2);
          ctx.fillStyle = cor;
          ctx.fill();
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (item.kind === 'text') {
        const p = annotate.toPx(item.x, item.y, rect);
        // Mesma escala do app (altura do conteudo / 540), pra o texto sair
        // do mesmo tamanho relativo que quem escreveu viu.
        const size = item.size * (rect.height / 540);
        ctx.font = `600 ${Math.max(10, size)}px system-ui, sans-serif`;
        ctx.shadowColor = 'rgba(0,0,0,.65)';
        ctx.shadowBlur = 4;
        ctx.fillStyle = cor;
        ctx.fillText(item.text, p.x, p.y);
        ctx.shadowBlur = 0;
      }
    }
  }

  window.goliveOverlay.onOp(({ surface, from, op }) => {
    surfaceId = String(surface);
    // `store.apply` ja carrega a regra de papeis (annotate.opAllowed): um op
    // do proprio dono da tela nao entra aqui, do mesmo jeito que nao entra no
    // app. A janela mostra o que a SALA escreveu.
    if (store.apply(surfaceId, from, op)) scheduleRedraw();
  });

  window.goliveOverlay.onLoad(({ surface, items }) => {
    surfaceId = String(surface);
    store.load(surfaceId, items);
    scheduleRedraw();
  });

  // Trocar a resolucao do monitor com a transmissao no ar redimensiona a
  // janela; o canvas e redesenhado da lista de itens, nunca esticado.
  window.addEventListener('resize', scheduleRedraw);
})();
