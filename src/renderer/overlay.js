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
 * Ver docs/superpowers/specs/2026-09-05-rabisco-na-tela-real-design.md e
 * docs/superpowers/specs/2026-09-12-laser-e-reacoes-design.md (laser e
 * reacao, que chegam por um canal PROPRIO -- overlay:fx -- ja filtrados
 * pelo app.js: so o que e da MINHA tela e so com a permissao ligada).
 */

(function () {
  const annotate = window.GoLive.annotate;
  const laser = window.GoLive.laser;
  const reactions = window.GoLive.reactions;
  const canvas = document.getElementById('lousa');
  const ctx = canvas.getContext('2d');

  // Um deposito proprio, alimentado pelas mesmas ops que o app aplica no
  // dele. Guardar o estado aqui (em vez de receber a lista inteira a cada
  // ponto) e o que mantem o custo constante: um traco de 3 segundos manda
  // ~50 mensagens de lote, nao 50 copias de uma lousa de 400 itens.
  const store = annotate.createStore();
  // Depositos do laser e das reacoes -- mesma ideia, so que efemeros: nao
  // ha snapshot nem `load` pra eles (ver spec, secao 3.3).
  const laserStore = laser.createStore();
  const reactionsStore = reactions.createStore();

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
      // colorOf, nao colorFor: desde 2026-09-05 quem desenha pode escolher
      // a cor, e ela viaja no item. Sem cor escolhida (ou com uma que nao
      // passou na validacao) cai na cor de quem desenhou, como antes.
      const cor = annotate.colorOf(item);
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

    // Laser: mesmo desenho (ponto com brilho, opacidade pela idade) que
    // ui.js pinta no tile -- so a cor troca de fonte (colorFor, nao colorOf:
    // laser nao tem campo de cor escolhida, sempre a da pessoa).
    for (const pt of laserStore.active(Date.now(), laser.TTL_MS)) {
      if (pt.surfaceId !== surfaceId) continue;
      const p = annotate.toPx(pt.x, pt.y, rect);
      const cor = annotate.colorFor(pt.from);
      ctx.globalAlpha = Math.max(0, 1 - pt.age / laser.TTL_MS);
      ctx.fillStyle = cor;
      ctx.shadowColor = cor;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // Reacao: sobe e desaparece, igual ao tile -- so que sem DOM/CSS aqui, e
    // por isso a posicao horizontal (que no tile e um `style.left` aleatorio
    // fixado na criacao) sai de um hash do id da bolha: PRECISA ser estavel
    // quadro a quadro, e este `redraw()` roda de novo a cada frame do loop.
    for (const bolha of reactionsStore.active(surfaceId, Date.now(), reactions.TTL_MS)) {
      const now = Date.now();
      const age = now - bolha.ts;
      const t = age / reactions.TTL_MS; // 0 (nasceu) .. 1 (hora de sumir)
      const xFrac = xFracFromId(bolha.id);
      const px = rect.left + xFrac * rect.width;
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const deslocamento = reducedMotion ? 0 : t * rect.height * 0.28;
      const py = rect.top + rect.height * 0.82 - deslocamento;
      const tamanho = Math.max(24, rect.height * 0.05);
      ctx.font = `${tamanho}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      // Some suave no ultimo terco, nao um corte seco.
      ctx.globalAlpha = t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.3);
      ctx.fillText(bolha.emoji, px, py);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left'; // volta o padrao -- o texto de anotacao acima conta com isso
  }

  /** Hash simples e estavel: mesma bolha sempre cai na mesma fracao
   * horizontal em TODOS os quadros que ela vive, sem guardar estado num
   * Map a parte. Faixa 28%-72% -- mesma faixa central que ui.js usa no
   * tile, pra reacao real e reacao no tile lerem parecido. */
  function xFracFromId(id) {
    let h = 0;
    const s = String(id);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 0.28 + (h % 1000) / 1000 * 0.44;
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

  // Laser e reacao chegam por um canal PROPRIO (overlay:fx) -- ja filtrados
  // pelo app.js (so a MINHA tela, so com a permissao ligada). Nenhum dos
  // dois tem `load`/snapshot: nascem e morrem sozinhos (ver spec, secao 3.3).
  window.goliveOverlay.onFx(({ kind, surface, from, ...payload }) => {
    if (kind === 'drop-author') {
      laserStore.dropAuthor(from);
      reactionsStore.dropAuthor(from);
      scheduleRedraw();
      return;
    }
    surfaceId = String(surface);
    const now = Date.now();
    const aceitou = kind === 'laser'
      ? laserStore.apply(surfaceId, from, payload, now)
      : kind === 'reaction'
        ? Boolean(reactionsStore.apply(surfaceId, from, payload.emoji, now))
        : false;
    if (!aceitou) return;
    scheduleRedraw();
    scheduleFxLoop();
  });

  // Loop de repintura continuo e barato: laser e reacao desbotam por
  // IDADE, entao precisam de um quadro novo mesmo sem mensagem nenhuma
  // chegando. Para sozinho quando os dois depositos ficam vazios -- nao
  // fica um requestAnimationFrame rodando pra sempre numa tela parada.
  let fxRafId = null;
  function scheduleFxLoop() {
    if (fxRafId !== null) return;
    const step = () => {
      fxRafId = null;
      const now = Date.now();
      const temLaser = laserStore.active(now, laser.TTL_MS).length > 0;
      reactionsStore.prune(now);
      const temReacao = surfaceId && reactionsStore.active(surfaceId, now, reactions.TTL_MS).length > 0;
      if (!temLaser && !temReacao) return;
      redraw();
      fxRafId = requestAnimationFrame(step);
    };
    fxRafId = requestAnimationFrame(step);
  }

  // Trocar a resolucao do monitor com a transmissao no ar redimensiona a
  // janela; o canvas e redesenhado da lista de itens, nunca esticado.
  window.addEventListener('resize', scheduleRedraw);
})();
