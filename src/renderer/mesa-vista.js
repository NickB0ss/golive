'use strict';

/*
 * Mesa -- as contas PURAS da vista (spec 2026-09-24, secoes 3.2, 3.3 e 5).
 *
 * A "vista" e para onde cada pessoa olha na mesa: so dela, nunca vai para a
 * rede. Aqui mora a matematica que o mesa-view.js usa e que da para testar
 * com `node --test` sem DOM: mundo <-> tela, zoom no ponto do cursor,
 * limites com a sobra da borda, "Ver tudo", o voo de 420 ms, a grade, o
 * mapa, redimensionar com proporcao e o "esta janela esta fora da vista?"
 * que decide se o video dela continua chegando.
 *
 * Uma vista e `{ x, y, z }`: o ponto do mundo que aparece no canto de cima
 * a esquerda da area da mesa, e o zoom (1 = uma unidade da mesa por pixel).
 * Nada aqui le relogio: quem precisa de hora recebe `now` por parametro.
 */

(function (root) {
  const mesa = root.GoLive?.mesa
    || (typeof module !== 'undefined' && typeof module.require === 'function' ? module.require('./mesa.js') : null);
  const WORLD = mesa ? mesa.WORLD : { w: 4800, h: 3000 };
  const OVERSCROLL = mesa ? mesa.OVERSCROLL : 600;
  const GAP = mesa ? mesa.GAP : 16;

  const ZOOM_MIN = 0.2;
  const ZOOM_MAX = 2;
  // Um degrau de +/- (teclado e botoes): 5 degraus dobram o zoom.
  const ZOOM_STEP = 1.25;
  const GRID_MINOR = 40;
  const GRID_MAJOR = 200;
  // A grade fina some quando as linhas ficariam a menos disto na tela: com
  // zoom baixo ela vira um chuvisco que so pesa.
  const GRID_MINOR_MIN_PX = 14;
  const FLY_MS = 420;
  const SETTLE_MS = 260;
  // Janela fora da vista por 2 s (ou menor que 120 px na tela) para de
  // receber video. Voltar a vista pede na hora.
  const OFFSCREEN_MS = 2000;
  const MIN_WATCH_PX = 120;
  // Setas andam isto em pixels da tela (nao unidades), para o passo parecer
  // o mesmo em qualquer zoom.
  const PAN_STEP_PX = 80;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function clampZoom(z) {
    return clamp(isNum(z) ? z : 1, ZOOM_MIN, ZOOM_MAX);
  }

  /** Ponto da tela (relativo a area da mesa) -> ponto do mundo. */
  function toWorld(view, sx, sy) {
    return { x: view.x + sx / view.z, y: view.y + sy / view.z };
  }

  /** Ponto do mundo -> ponto da tela (relativo a area da mesa). */
  function toScreen(view, wx, wy) {
    return { x: (wx - view.x) * view.z, y: (wy - view.y) * view.z };
  }

  /** Retangulo do mundo -> retangulo da tela. */
  function screenRect(view, r) {
    const p = toScreen(view, r.x, r.y);
    return { x: p.x, y: p.y, w: r.w * view.z, h: r.h * view.z };
  }

  /** O pedaco do mundo que aparece numa area de `vw` x `vh` pixels. */
  function visibleRect(view, vw, vh) {
    return { x: view.x, y: view.y, w: vw / view.z, h: vh / view.z };
  }

  /** Prende a vista: o zoom na faixa e a area visivel dentro do mundo mais
   * a sobra da borda. Se a area visivel e maior que o mundo com sobra (zoom
   * baixo numa tela grande), a mesa fica centrada naquele eixo. */
  function clampView(view, vw, vh, { world = WORLD, overscroll = OVERSCROLL } = {}) {
    const z = clampZoom(view.z);
    const w = vw / z;
    const h = vh / z;
    const axis = (pos, size, span) => {
      const lo = -overscroll;
      const hi = span + overscroll - size;
      if (hi < lo) return (span - size) / 2;
      return clamp(isNum(pos) ? pos : 0, lo, hi);
    };
    return { x: axis(view.x, w, world.w), y: axis(view.y, h, world.h), z };
  }

  /** Zoom para `nz` mantendo parado o ponto do mundo que esta sob o cursor
   * (`sx`, `sy` na tela). */
  function zoomAt(view, sx, sy, nz, vw, vh, opts) {
    const anchor = toWorld(view, sx, sy);
    const z = clampZoom(nz);
    return clampView({ x: anchor.x - sx / z, y: anchor.y - sy / z, z }, vw, vh, opts);
  }

  /** Um degrau de zoom (`dir` +1 aproxima, -1 afasta) no meio da area. */
  function zoomStep(view, dir, vw, vh, opts) {
    const nz = dir > 0 ? view.z * ZOOM_STEP : view.z / ZOOM_STEP;
    return zoomAt(view, vw / 2, vh / 2, nz, vw, vh, opts);
  }

  /** Zoom pela roda do mouse. `deltaY` do evento; `pinch` (ctrlKey, gesto
   * de pinca no touchpad) anda mais rapido por evento. */
  function wheelZoom(view, sx, sy, deltaY, pinch, vw, vh, opts) {
    const k = pinch ? 0.01 : 0.0015;
    return zoomAt(view, sx, sy, view.z * Math.exp(-deltaY * k), vw, vh, opts);
  }

  /** Anda a vista `dx`,`dy` pixels da tela (arrastar o fundo: o mundo segue
   * a mao, entao a vista anda ao contrario). */
  function pan(view, dx, dy, vw, vh, opts) {
    return clampView({ x: view.x - dx / view.z, y: view.y - dy / view.z, z: view.z }, vw, vh, opts);
  }

  /** Vista centrada no ponto do mundo `cx`,`cy` com zoom `z`. */
  function centerOn(cx, cy, z, vw, vh, opts) {
    const zz = clampZoom(z);
    return clampView({ x: cx - vw / 2 / zz, y: cy - vh / 2 / zz, z: zz }, vw, vh, opts);
  }

  /** Centro da vista no mundo. */
  function viewCenter(view, vw, vh) {
    return { x: view.x + vw / 2 / view.z, y: view.y + vh / 2 / view.z };
  }

  /** Menor retangulo que cobre todas as janelas, ou `null` sem janela. */
  function boundsOf(windows) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const w of windows || []) {
      if (!w) continue;
      x0 = Math.min(x0, w.x);
      y0 = Math.min(y0, w.y);
      x1 = Math.max(x1, w.x + w.w);
      y1 = Math.max(y1, w.y + w.h);
    }
    if (!isNum(x0) || !isNum(x1)) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** Vista que mostra o retangulo inteiro com `pad` pixels de folga em
   * volta, sem passar de `maxZ` (uma janela so nao vira tela cheia). */
  function fitRect(rect, vw, vh, { pad = 64, maxZ = 1.2, ...opts } = {}) {
    const aw = Math.max(1, vw - pad * 2);
    const ah = Math.max(1, vh - pad * 2);
    const z = clamp(Math.min(aw / Math.max(1, rect.w), ah / Math.max(1, rect.h)), ZOOM_MIN, Math.min(ZOOM_MAX, maxZ));
    return centerOn(rect.x + rect.w / 2, rect.y + rect.h / 2, z, vw, vh, opts);
  }

  /** "Ver tudo": todas as janelas na tela. Mesa vazia: o meio da mesa a
   * 100 %, onde as primeiras janelas nascem. */
  function fitAll(windows, vw, vh, opts = {}) {
    const b = boundsOf(windows);
    const world = opts.world || WORLD;
    if (!b) return centerOn(world.w / 2, world.h / 2, 1, vw, vh, opts);
    return fitRect(b, vw, vh, opts);
  }

  /** "Centralizar na tela": a janela no meio, o maior zoom em que ela cabe
   * com folga (ate 150 %). */
  function focusRect(rect, vw, vh, opts = {}) {
    return fitRect(rect, vw, vh, { pad: 80, maxZ: 1.5, ...opts });
  }

  // ---------------------------------------------------------------------
  // Voo da vista (420 ms, desacelerando)
  // ---------------------------------------------------------------------

  /** Desaceleracao cubica: rapido no comeco, pousa devagar. */
  function easeOut(t) {
    const k = clamp(t, 0, 1);
    return 1 - (1 - k) ** 3;
  }

  /** Vista no instante `t` (0 a 1, ja sem easing) de um voo de `from` a
   * `to`. O centro anda em linha reta e o zoom em escala logaritmica, para
   * aproximar e afastar parecerem a mesma velocidade. */
  function flyStep(from, to, t, vw, vh) {
    const e = easeOut(t);
    const c0 = viewCenter(from, vw, vh);
    const c1 = viewCenter(to, vw, vh);
    const z = Math.exp(Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * e);
    const cx = c0.x + (c1.x - c0.x) * e;
    const cy = c0.y + (c1.y - c0.y) * e;
    if (e >= 1) return { ...to };
    return { x: cx - vw / 2 / z, y: cy - vh / 2 / z, z };
  }

  /** Transformacao CSS do conteiner da mesa: UMA para a mesa inteira. */
  function transformFor(view) {
    const tx = -view.x * view.z;
    const ty = -view.y * view.z;
    return `translate3d(${round2(tx)}px, ${round2(ty)}px, 0) scale(${round4(view.z)})`;
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  function round4(v) {
    return Math.round(v * 10000) / 10000;
  }

  // ---------------------------------------------------------------------
  // Grade (um fundo em linear-gradient, recalculado so quando a vista muda)
  // ---------------------------------------------------------------------

  /** Estilo do fundo da grade para a vista: linhas fortes a cada 200
   * unidades e finas a cada 40, alinhadas ao mundo. Devolve as tres
   * propriedades de `background-*` prontas. A fina sai quando ficaria a
   * menos de GRID_MINOR_MIN_PX na tela. */
  function gridStyle(view, { minorMinPx = GRID_MINOR_MIN_PX } = {}) {
    const major = GRID_MAJOR * view.z;
    const minor = GRID_MINOR * view.z;
    const ox = round2(-view.x * view.z);
    const oy = round2(-view.y * view.z);
    const layers = [
      'linear-gradient(var(--grid2) 1px, transparent 1px)',
      'linear-gradient(90deg, var(--grid2) 1px, transparent 1px)',
    ];
    const sizes = [`${round2(major)}px ${round2(major)}px`, `${round2(major)}px ${round2(major)}px`];
    const showMinor = minor >= minorMinPx;
    if (showMinor) {
      layers.push('linear-gradient(var(--grid) 1px, transparent 1px)', 'linear-gradient(90deg, var(--grid) 1px, transparent 1px)');
      sizes.push(`${round2(minor)}px ${round2(minor)}px`, `${round2(minor)}px ${round2(minor)}px`);
    }
    return {
      showMinor,
      backgroundImage: layers.join(', '),
      backgroundSize: sizes.join(', '),
      backgroundPosition: layers.map(() => `${ox}px ${oy}px`).join(', '),
    };
  }

  // ---------------------------------------------------------------------
  // Mapa da mesa
  // ---------------------------------------------------------------------

  /** Escala do mapa: o mundo inteiro cabendo em `mapW` x `mapH`. */
  function minimapScale(mapW, mapH, world = WORLD) {
    return Math.min(mapW / world.w, mapH / world.h);
  }

  /** Clique no mapa (pixels dentro dele) -> ponto do mundo, preso ao mundo. */
  function fromMinimap(px, py, mapW, mapH, world = WORLD) {
    const s = minimapScale(mapW, mapH, world);
    return { x: clamp(px / s, 0, world.w), y: clamp(py / s, 0, world.h) };
  }

  // ---------------------------------------------------------------------
  // Janela: arrastar, redimensionar, teclado
  // ---------------------------------------------------------------------

  /** A janela cabe ali? Dentro do mundo e sem encostar (com `gap`) em
   * nenhuma outra (menos ela mesma). */
  function fits(windows, rect, { ignoreId = null, gap = 0, world = WORLD } = {}) {
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > world.w || rect.y + rect.h > world.h) return false;
    for (const o of windows || []) {
      if (!o || o.id === ignoreId) continue;
      if (rect.x < o.x + o.w + gap && o.x < rect.x + rect.w + gap && rect.y < o.y + o.h + gap && o.y < rect.y + rect.h + gap) return false;
    }
    return true;
  }

  /** Onde a janela assenta se for solta em `rect`: ali mesmo se couber (vao
   * 0, o que o servidor exige), senao o lugar livre mais perto com o vao de
   * 16. `null` se nao cabe em lugar nenhum. */
  function landing(windows, rect, id) {
    const r = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
    if (fits(windows, r, { ignoreId: id, gap: 0 })) return r;
    if (!mesa) return null;
    return mesa.nearestFree(windows, r, { gap: GAP, ignoreId: id });
  }

  /** Novo retangulo ao puxar a borda `edge` ('l', 'r', 'b', 'bl', 'br') de
   * `orig` por `dx`,`dy` unidades. Com `aspect`, a proporcao manda: a borda
   * de baixo sozinha mexe na altura e a largura acompanha; as outras mexem
   * na largura e a altura acompanha. A borda esquerda segura a direita no
   * lugar. Nunca abaixo do minimo do tipo. */
  function resizeRect(orig, edge, dx, dy, { aspect = null, minW = 48, minH = 48 } = {}) {
    const left = edge.includes('l');
    const right = edge.includes('r');
    const bottom = edge.includes('b');
    let w = orig.w;
    let h = orig.h;
    if (right) w = orig.w + dx;
    if (left) w = orig.w - dx;
    if (bottom) h = orig.h + dy;
    if (aspect) {
      const minWa = Math.max(minW, minH * aspect);
      if (bottom && !left && !right) {
        h = Math.max(minWa / aspect, h);
        w = h * aspect;
      } else {
        w = Math.max(minWa, w);
        h = w / aspect;
      }
    } else {
      w = Math.max(minW, w);
      h = Math.max(minH, h);
    }
    w = Math.round(w);
    h = Math.round(h);
    return { x: left ? orig.x + orig.w - w : orig.x, y: orig.y, w, h };
  }

  /** Redimensionar para ao encostar numa vizinha (ou na borda do mundo):
   * procura, entre o tamanho de antes e o pedido, o maior que ainda cabe.
   * Devolve `prev` se nem um passo cabe. */
  function resizeStop(windows, id, prev, want) {
    if (fits(windows, want, { ignoreId: id })) return want;
    let lo = 0;
    let hi = 1;
    let best = prev;
    for (let i = 0; i < 12; i += 1) {
      const mid = (lo + hi) / 2;
      const r = {
        x: Math.round(prev.x + (want.x - prev.x) * mid),
        y: Math.round(prev.y + (want.y - prev.y) * mid),
        w: Math.round(prev.w + (want.w - prev.w) * mid),
        h: Math.round(prev.h + (want.h - prev.h) * mid),
      };
      if (fits(windows, r, { ignoreId: id })) {
        best = r;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return best;
  }

  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  /** Teclado numa janela focada: setas movem 10 (Shift, 100); Alt+setas
   * redimensionam pela borda de baixo a direita. `null` para outra tecla. */
  function keyRect(rect, key, { shift = false, alt = false, aspect = null, minW = 48, minH = 48 } = {}) {
    const d = ARROWS[key];
    if (!d) return null;
    const step = shift ? 100 : 10;
    if (alt) {
      if (aspect) {
        // Com proporcao, direita/baixo crescem e esquerda/cima encolhem.
        const grow = d[0] + d[1];
        return resizeRect(rect, 'r', grow * step, 0, { aspect, minW, minH });
      }
      return resizeRect(rect, 'br', d[0] * step, d[1] * step, { aspect, minW, minH });
    }
    return { x: rect.x + d[0] * step, y: rect.y + d[1] * step, w: rect.w, h: rect.h };
  }

  /** Setas com a mesa focada: anda PAN_STEP_PX pixels da tela. */
  function keyPan(view, key, vw, vh, opts) {
    const d = ARROWS[key];
    if (!d) return null;
    return pan(view, -d[0] * PAN_STEP_PX, -d[1] * PAN_STEP_PX, vw, vh, opts);
  }

  // ---------------------------------------------------------------------
  // Desempenho: janela de video fora da vista para de receber
  // ---------------------------------------------------------------------

  /** A janela aparece o bastante para valer o video? Precisa encostar na
   * area visivel e ter pelo menos `minPx` de largura na tela. Devolve
   * tambem a largura em pixels (o teto de qualidade). */
  function watchable(view, vw, vh, rect, { minPx = MIN_WATCH_PX } = {}) {
    const s = screenRect(view, rect);
    const onScreen = s.x < vw && s.y < vh && s.x + s.w > 0 && s.y + s.h > 0;
    const widthPx = Math.round(s.w);
    return { onScreen, widthPx, ok: onScreen && widthPx >= minPx };
  }

  /** Quem ainda quer o video de cada janela, com a carencia de 2 s para
   * sair: entrar na vista pede na hora; sumir so solta depois de
   * OFFSCREEN_MS seguidos fora (andar pela mesa nao pode ficar ligando e
   * desligando o encoder de quem transmite). Puro: `now` por parametro. */
  function createWatchTracker({ delayMs = OFFSCREEN_MS } = {}) {
    const items = new Map(); // id -> { wanted, outSince }

    /** Anota o que se ve agora. Devolve `true` se o "quer" de `id` mudou. */
    function see(id, visible, now) {
      let it = items.get(id);
      if (!it) {
        it = { wanted: Boolean(visible), outSince: visible ? null : now };
        items.set(id, it);
        return true;
      }
      if (visible) {
        it.outSince = null;
        if (!it.wanted) {
          it.wanted = true;
          return true;
        }
        return false;
      }
      if (it.outSince == null) it.outSince = now;
      if (it.wanted && now - it.outSince >= delayMs) {
        it.wanted = false;
        return true;
      }
      return false;
    }

    function wanted(id) {
      const it = items.get(id);
      return it ? it.wanted : false;
    }

    /** Quanto falta para alguma janela que ainda quer sair (para agendar a
     * proxima conferencia sem um timer por janela). `null` se nenhuma. */
    function nextDeadline(now) {
      let best = null;
      for (const it of items.values()) {
        if (!it.wanted || it.outSince == null) continue;
        const left = Math.max(0, it.outSince + delayMs - now);
        if (best == null || left < best) best = left;
      }
      return best;
    }

    function drop(id) {
      items.delete(id);
    }

    function clear() {
      items.clear();
    }

    return { see, wanted, nextDeadline, drop, clear };
  }

  /** Relogio do servidor pela mensagem `time`: de varias idas e voltas,
   * fica a de menor atraso (a menos distorcida pela fila), e o desvio e a
   * hora do servidor menos o meio do caminho. */
  function clockOffset(samples) {
    let best = null;
    for (const s of samples || []) {
      if (!s || !isNum(s.t0) || !isNum(s.t1) || !isNum(s.server) || s.t1 < s.t0) continue;
      const rtt = s.t1 - s.t0;
      if (!best || rtt < best.rtt) best = { rtt, offset: s.server - (s.t0 + rtt / 2) };
    }
    return best;
  }

  const api = {
    WORLD, OVERSCROLL, GAP,
    ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, GRID_MINOR, GRID_MAJOR, GRID_MINOR_MIN_PX,
    FLY_MS, SETTLE_MS, OFFSCREEN_MS, MIN_WATCH_PX, PAN_STEP_PX,
    clampZoom, toWorld, toScreen, screenRect, visibleRect, clampView,
    zoomAt, zoomStep, wheelZoom, pan, centerOn, viewCenter,
    boundsOf, fitRect, fitAll, focusRect,
    easeOut, flyStep, transformFor, gridStyle,
    minimapScale, fromMinimap,
    fits, landing, resizeRect, resizeStop, keyRect, keyPan,
    watchable, createWatchTracker, clockOffset,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaVista = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
