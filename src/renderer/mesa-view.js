'use strict';

/*
 * Mesa -- a vista (spec 2026-09-24, secoes 3, 5, 6 e 7; contrato em
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secoes 0, 5 e 6).
 *
 * Transmissao e Mesa sao VISTAS de cada pessoa. Enquanto a pessoa esta na
 * Transmissao, nada daqui existe no DOM nem roda: nenhum ouvinte, nenhum
 * requestAnimationFrame, nenhuma grade. `open()` monta tudo, manda
 * `mesa-view on` e espera o retrato (`mesa-sync`); `close()` manda
 * `mesa-view off`, devolve as telas ao palco de hoje (o MESMO elemento,
 * sem renegociar nada) e desmonta tudo.
 *
 * O que e da sala vem do servidor e passa pelo modelo puro (mesa.js); as
 * contas da vista (zoom, voo, grade, mapa, assentar, fora da vista) moram
 * em mesa-vista.js, testadas sem DOM. Aqui fica so o que precisa de DOM.
 *
 * O conteudo de cada janela com estado e do time Janelas
 * (`GoLive.mesaJanelas[tipo].mount(el, api)`, contrato secao 6); sem
 * conteudo registrado, a janela mostra o `summary(state)` do modulo.
 *
 * Telas e cameras: o servidor poe e tira as janelas `tela`/`camera`; a
 * vista pega o `<div class="tile">` do palco (com o `<video>` que ja esta
 * tocando) e o poe dentro da janela. Ao sair da Mesa, ele volta.
 */

(function (root) {
  const G = root.GoLive || {};
  const M = G.mesa;
  const V = G.mesaVista;

  const GROUP_LABELS = {
    assistir: 'Assistir e ouvir',
    jogos: 'Jogos',
    noite: 'Noite de jogo',
    ferramentas: 'Ferramentas',
  };
  const GROUP_ORDER = ['assistir', 'jogos', 'noite', 'ferramentas'];

  // Motivo de cada recusa do servidor, para o aviso curto. As que a vista
  // resolve sozinha (overlap, out-of-world, held, not-found) nao estao aqui.
  const DENIED_TEXT = {
    rate: 'Calma: muitas mudanças de uma vez.',
    locked: 'Só o líder mexe na Mesa agora.',
    'size-locked': 'O líder travou o tamanho das janelas.',
    'leader-only': 'Só o líder da sala muda isso.',
    full: 'A Mesa já tem 32 janelas.',
    'no-space': 'Não há lugar livre na Mesa para esta janela.',
    'too-small': 'A janela ficaria pequena demais.',
    'too-big': 'A janela ficaria grande demais.',
    'bad-rect': 'Não deu para pôr a janela ali.',
    'unknown-type': 'Esta sala não conhece este tipo de janela.',
    auto: 'Telas e câmeras entram na Mesa sozinhas.',
    'no-act': 'Esta janela não tem ação.',
    'state-too-big': 'A janela ficou cheia demais.',
    invalid: 'Não deu para fazer isso agora.',
    error: 'Não deu para fazer isso agora.',
    'bad-request': 'Não deu para fazer isso agora.',
  };

  const ICON = {
    fs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    fsExit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
    map: '<svg viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/></svg>',
    chev: '<svg class="mesa-menu-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    here: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 2l7 19 2.6-8.1L21 10z"/></svg>',
  };

  const TIME_SAMPLES = 5;
  const TIME_EVERY_MS = 60000;

  // Espelho do MESMO regex do servidor (server/signaling-core.js,
  // MESA_SURFACE_RE): a superficie do rabisco de uma janela da Mesa.
  const MESA_SURFACE_RE = /^mesa:([A-Za-z0-9_-]{1,32})$/;

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function reducedMotion() {
    try {
      return root.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    } catch {
      return false;
    }
  }

  // Conteudo das janelas (time Janelas): carregado na primeira vez que a
  // Mesa abre, nunca na Transmissao. Um <script> por tipo do registro;
  // arquivo ausente da so o 404 do navegador e o tipo fica no resumo.
  const janelasLoad = { started: false, listeners: new Set() };

  function loadJanelas() {
    if (janelasLoad.started || typeof document === 'undefined') return;
    janelasLoad.started = true;
    const reg = G.mesaRegistry;
    const names = new Set([...(reg?.MODULE_NAMES || []), ...((reg?.addable?.() || []).map((m) => m.type))]);
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'mesa-janelas.css';
    document.head.appendChild(css);
    for (const type of names) {
      if (!/^[a-z][a-z0-9]{0,23}$/.test(type)) continue;
      const tag = document.createElement('script');
      tag.src = `mesa-janelas/${type}.js`;
      tag.async = false;
      tag.dataset.mesaJanela = type;
      tag.onload = () => {
        for (const fn of janelasLoad.listeners) fn(type);
      };
      tag.onerror = () => tag.remove();
      document.head.appendChild(tag);
    }
  }

  function now() {
    return root.performance ? root.performance.now() : Date.now();
  }

  /**
   * `deps` (o app.js monta):
   *   stage, grid        -- o palco e a grade de hoje (a Mesa entra ao lado dela)
   *   send(msg)          -- sinalizacao; false se o socket nao esta aberto
   *   me(), isLeader()   -- id de conexao e se sou o lider da sala
   *   peers()            -- [{ id, name }] da sala, eu incluido
   *   nameOf(id), colorFor(id), avatarOf(id)
   *   viewers()          -- quem esta na vista Mesa agora ([id...])
   *   tileIdFor(kind, id), tileFor(kind, id) -- o `.tile` do palco dessa
   *                        tela/camera (id e elemento), ou null
   *   returnTile(tile)   -- devolve um tile ao palco
   *   openTileMenu(tileId, x, y) -- o menu de volume/silenciar do tile
   *   resyncGrid()       -- o palco se arruma depois que os tiles voltam
   *   onWatchChange()    -- a Mesa mudou o que quer assistir (view-state)
   *   onOpenChange(on), onLocksChange({ leaderOnly, lockSize })
   *   setFullScreen(on)  -- o fullscreen da janela do Electron (e o app
   *                        chama `onFullScreenChange` quando ele muda)
   */
  function create(deps) {
    const registry = () => G.mesaRegistry;
    const modOf = (type) => registry()?.get(type) || null;

    let S = null; // estado da vista aberta; null na Transmissao
    let showCursors = true;
    // Rabisco em janela da Mesa (contrato, secao 10, "Quadro"): quem ja
    // esta com uma janela montada manda o proprio retrato ('annotate-sync')
    // pra quem ACABA de entrar na vista Mesa -- so pra ids novos, senao toda
    // mudanca na lista (alguem saiu) reenviaria o retrato para todo mundo.
    let lastAnnotateViewers = new Set();

    // ------------------------------------------------------------------
    // Abrir e fechar
    // ------------------------------------------------------------------

    function isOpen() {
      return S !== null;
    }

    function open() {
      if (S) return;
      S = {
        section: null,
        world: null,
        gridBg: null,
        over: null,
        wins: new Map(), // id -> registro da janela no DOM
        state: null, // modelo puro: { mesa }
        view: { x: 0, y: 0, z: 1 },
        vw: 0,
        vh: 0,
        local: new Map(), // id -> retangulo meu (arrastando ou esperando o eco)
        remote: new Map(), // id -> { by, rect } (arraste de outra pessoa)
        grabs: M.createGrabs(),
        pointers: M.createPointerStore(),
        tracker: V.createWatchTracker(),
        widths: new Map(), // id -> largura em pixels da tela (teto de qualidade)
        drag: null,
        activeId: null,
        fly: 0,
        raf: new Set(),
        timers: new Set(),
        off: [], // desfazedores de ouvintes globais
        ro: null,
        fullId: null,
        fitted: false,
        lastCursorAt: 0,
        pendingCursor: null,
        cursorTimer: 0,
        time: { samples: [], offset: null, waiting: null, timer: 0 },
        menu: null,
        focusAfterAdd: false,
        watchTimer: 0,
        lastWatchKey: '',
        safe: null,
        mapOpen: false,
      };
      build();
      loadJanelas();
      S.onJanela = (type) => {
        // O conteudo deste tipo chegou depois de a janela ja estar na mesa
        // (mostrando o resumo): troca pelo conteudo de verdade.
        if (!S) return;
        for (const rec of S.wins.values()) {
          const win = findWin(rec.id);
          if (win && win.type === type && rec.kind === 'summary') {
            rec.body.textContent = '';
            rec.summaryEl = null;
            mountContent(rec, win);
          }
        }
      };
      janelasLoad.listeners.add(S.onJanela);
      deps.onOpenChange?.(true);
      deps.send({ type: 'mesa-view', on: true });
      startTimeSync();
    }

    /** Sai da Mesa. `silent`: a sala acabou (nao ha a quem avisar). */
    function close({ silent = false } = {}) {
      if (!S) return;
      const s = S;
      if (!silent) deps.send({ type: 'mesa-view', on: false });
      if (s.drag) cancelDrag();
      if (s.fullId) exitFull({ fromClose: true });
      closeMenu();
      for (const id of s.raf) root.cancelAnimationFrame(id);
      for (const t of s.timers) root.clearTimeout(t);
      root.clearTimeout(s.time.timer);
      root.clearTimeout(s.cursorTimer);
      root.clearTimeout(s.watchTimer);
      for (const off of s.off) off();
      janelasLoad.listeners.delete(s.onJanela);
      s.ro?.disconnect();
      for (const rec of s.wins.values()) unmountWin(rec, { returnTile: true });
      s.section.remove();
      s.menuEl.remove();
      s.subEl.remove();
      S = null;
      renderPeople();
      lastAnnotateViewers = new Set();
      deps.resyncGrid?.();
      deps.onOpenChange?.(false);
      deps.onWatchChange?.();
    }

    /** Depois de QUALQUER welcome (inclusive retomada): o servidor tirou a
     * pessoa da vista Mesa; quem estava nela pede o retrato de novo. */
    function afterWelcome() {
      if (!S) return;
      S.state = null;
      S.grabs = M.createGrabs();
      S.remote.clear();
      S.local.clear();
      deps.send({ type: 'mesa-view', on: true });
      startTimeSync();
    }

    function later(fn, ms) {
      const t = root.setTimeout(() => {
        S?.timers.delete(t);
        fn();
      }, ms);
      S.timers.add(t);
      return t;
    }

    function frame(fn) {
      const id = root.requestAnimationFrame((ts) => {
        S?.raf.delete(id);
        if (S) fn(ts);
      });
      S.raf.add(id);
      return id;
    }

    function listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      S.off.push(() => target.removeEventListener(type, fn, opts));
    }

    // ------------------------------------------------------------------
    // DOM
    // ------------------------------------------------------------------

    function build() {
      const sec = document.createElement('section');
      sec.className = 'mesa';
      sec.tabIndex = 0;
      sec.setAttribute('role', 'region');
      sec.setAttribute('aria-label', 'Mesa da sala');
      sec.setAttribute('aria-describedby', 'mesa-help');
      sec.innerHTML = `
        <p id="mesa-help" class="sr-only">Arraste o fundo ou use as setas para andar. Roda do mouse, + e - aproximam; 0 mostra tudo. Botão direito, tecla de menu ou Shift+F10 abrem o menu para adicionar uma janela. Numa janela: setas movem, Alt+setas mudam o tamanho, F põe em tela cheia, Delete tira da mesa as janelas que não são tela nem câmera.</p>
        <div class="mesa-grid" aria-hidden="true"></div>
        <div class="mesa-world"><div class="mesa-edge" aria-hidden="true"></div></div>
        <div class="mesa-over" aria-hidden="true"></div>
        <p class="mesa-loading" role="status"><span class="spinner" aria-hidden="true"></span>Abrindo a Mesa…</p>
        <div class="mesa-people" role="group" aria-label="Quem está na Mesa"></div>
        <div class="mesa-nav">
          <div id="mesa-map" class="mesa-map" hidden aria-label="Mapa da Mesa"></div>
          <div class="mesa-zoom" role="group" aria-label="Aproximação">
            <button type="button" class="mesa-zoom-btn btn btn--quiet btn--sm btn--icon" data-zoom="out" aria-label="Afastar" title="Afastar (-)">${ICON.minus}</button>
            <output class="mesa-zoom-val" aria-live="off">100%</output>
            <button type="button" class="mesa-zoom-btn btn btn--quiet btn--sm btn--icon" data-zoom="in" aria-label="Aproximar" title="Aproximar (+)">${ICON.plus}</button>
            <button type="button" class="mesa-zoom-btn btn btn--quiet btn--sm" data-zoom="fit" title="Ver tudo (0)">Ver tudo</button>
            <button type="button" class="mesa-zoom-btn btn btn--quiet btn--sm" data-zoom="map" title="Mapa"
              aria-expanded="false" aria-controls="mesa-map">Mapa</button>
          </div>
        </div>
        <p class="mesa-lock-note" hidden></p>
        <p class="sr-only mesa-live" aria-live="polite"></p>`;
      const q = (sel) => sec.querySelector(sel);
      S.section = sec;
      S.gridBg = q('.mesa-grid');
      S.world = q('.mesa-world');
      S.over = q('.mesa-over');
      S.loadingEl = q('.mesa-loading');
      S.peopleEl = q('.mesa-people');
      S.mapEl = q('.mesa-map');
      S.mapButton = q('[data-zoom="map"]');
      S.zoomVal = q('.mesa-zoom-val');
      S.lockNote = q('.mesa-lock-note');
      S.liveEl = q('.mesa-live');
      // Os menus moram no body, nao na secao: a secao cria um contexto de empilhamento
      // (isolation + z-index) e o z-index do menu ficaria preso nele, com a Conversa por cima.
      S.menuEl = criarMenuFlutuante();
      S.subEl = criarMenuFlutuante();
      const edge = q('.mesa-edge');
      edge.style.width = `${V.WORLD.w}px`;
      edge.style.height = `${V.WORLD.h}px`;

      deps.grid.after(sec);
      if (deps.peopleSlot) S.peopleEl.remove();
      try {
        S.mapOpen = root.localStorage.getItem('golive.mesa.mapa') === 'aberto';
      } catch (erro) {
        console.warn('Não foi possível ler o estado do mapa da Mesa:', erro);
      }
      setMapOpen(S.mapOpen);
      measure();
      S.view = V.centerOn(V.WORLD.w / 2, V.WORLD.h / 2, 1, S.vw, S.vh, { safe: S.safe });
      applyView();
      wire();
      renderPeople();
    }

    function measure() {
      S.vw = S.section.clientWidth || 1;
      S.vh = S.section.clientHeight || 1;
      const sec = S.section.getBoundingClientRect();
      const nav = S.section.querySelector('.mesa-nav').getBoundingClientRect();
      const toast = document.getElementById('toast')?.getBoundingClientRect();
      const dock = deps.dockEl?.()?.getBoundingClientRect();
      const margem = 12;
      // Quanto uma caixa ocupa do fundo da Mesa. Caixa sem tamanho (escondida ou antes do
      // layout) tem top 0 e viraria a Mesa inteira: nao conta.
      const doFundo = (r) => (r && r.height > 0 && r.top > sec.top && r.top < sec.bottom ? sec.bottom - r.top : 0);
      S.section.style.setProperty('--dock-h', `${dock?.height || 0}px`);
      S.section.style.setProperty('--toast-h', `${toast?.height || 0}px`);
      S.safe = {
        top: margem,
        right: margem,
        bottom: Math.min(S.vh / 2, Math.max(doFundo(nav), doFundo(toast), doFundo(dock)) + margem),
        left: margem,
      };
    }

    function wire() {
      const sec = S.section;
      listen(sec, 'pointerdown', onBackgroundDown);
      listen(sec, 'pointermove', onPointerMove, { passive: true });
      listen(sec, 'wheel', onWheel, { passive: false });
      listen(sec, 'keydown', onKeyDown);
      listen(sec, 'contextmenu', onContextMenu, true);
      // Duplo clique e botao direito num tile de video iriam para o tile
      // (tela cheia e menu do palco). Na Mesa quem responde e a janela:
      // pega na captura, antes do tile.
      listen(sec, 'dblclick', onDoubleClick, true);
      listen(S.mapEl, 'pointerdown', onMapDown);
      for (const b of sec.querySelectorAll('.mesa-zoom-btn')) {
        listen(b, 'click', () => {
          const k = b.dataset.zoom;
          if (k !== 'map') S.viewTouched = true;
          if (k === 'fit') {
            flyTo(V.fitAll(windows(), S.vw, S.vh, { safe: S.safe }));
          }
          else if (k === 'map') setMapOpen(!S.mapOpen);
          else setView(V.zoomStep(S.view, k === 'in' ? 1 : -1, S.vw, S.vh));
        });
      }
      listen(document, 'pointerdown', (e) => {
        if (S.menu && !e.target.closest?.('.mesa-menu') && !e.target.closest?.('[data-mesa-add]')) closeMenu();
      }, true);
      listen(document, 'keydown', (e) => {
        if (e.key === 'Escape' && S.mapOpen) {
          e.preventDefault();
          setMapOpen(false);
          S.mapButton.focus();
          return;
        }
        if (e.key === 'Escape' && S.fullId) {
          e.preventDefault();
          exitFull();
        }
      });
      if (typeof root.ResizeObserver === 'function') {
        S.ro = new root.ResizeObserver(() => {
          if (!S) return;
          measure();
          setView(S.view, { quiet: true });
        });
        S.ro.observe(sec);
      }
    }

    function setMapOpen(open) {
      if (!S) return;
      S.mapOpen = Boolean(open);
      S.mapEl.hidden = !S.mapOpen;
      S.mapEl.classList.toggle('is-open', S.mapOpen);
      S.mapButton.setAttribute('aria-expanded', String(S.mapOpen));
      S.mapButton.setAttribute('aria-label', S.mapOpen ? 'Fechar mapa' : 'Abrir mapa');
      try {
        root.localStorage.setItem('golive.mesa.mapa', S.mapOpen ? 'aberto' : 'fechado');
      } catch (erro) {
        console.warn('Não foi possível guardar o estado do mapa da Mesa:', erro);
      }
      if (S.mapOpen) scheduleMap();
    }

    /** O fullscreen da janela do Electron mudou por qualquer via (Esc do
     * sistema, atalho): saindo dele, a janela volta para a mesa. */
    function onFullScreenChange(on) {
      if (!on && S?.fullId) exitFull({ fromWindow: true });
    }

    // ------------------------------------------------------------------
    // Vista: andar, aproximar, voar
    // ------------------------------------------------------------------

    function setView(view, { quiet = false } = {}) {
      S.view = V.clampView(view, S.vw, S.vh);
      applyView();
      if (!quiet) wakeWillChange();
    }

    function applyView() {
      if (S.fullId) return; // em tela cheia a transformacao e a da janela
      const v = S.view;
      S.world.style.transform = V.transformFor(v);
      // Controles da janela (avatar, Tela cheia, Tirar) ficam do mesmo
      // tamanho na tela com zoom baixo, ate um teto (janela minuscula).
      S.world.style.setProperty('--mesa-inv', String(Math.min(2.5, Math.max(1, 1 / v.z))));
      S.section.toggleAttribute('data-far', v.z < 0.6);
      for (const bar of S.world.querySelectorAll('.mesa-bar')) {
        bar.title = v.z < 0.6 ? 'Clique duplo: tela cheia · botão direito: mais ações' : '';
      }
      const g = V.gridStyle(v);
      const st = S.gridBg.style;
      st.backgroundImage = g.backgroundImage;
      st.backgroundSize = g.backgroundSize;
      st.backgroundPosition = g.backgroundPosition;
      S.zoomVal.textContent = `${Math.round(v.z * 100)}%`;
      scheduleCursors();
      scheduleMap();
      scheduleWatch();
    }

    // will-change so enquanto a vista anda (e um pouco depois): camada
    // promovida sempre custaria memoria de GPU a toa.
    function wakeWillChange() {
      S.world.classList.add('is-moving');
      root.clearTimeout(S.moveTimer);
      S.moveTimer = later(() => S?.world.classList.remove('is-moving'), 200);
    }

    function flyTo(target, { ms = V.FLY_MS } = {}) {
      const to = V.clampView(target, S.vw, S.vh);
      if (S.fly) root.cancelAnimationFrame(S.fly);
      if (reducedMotion() || ms <= 0) {
        setView(to);
        return;
      }
      const from = { ...S.view };
      const t0 = now();
      const step = () => {
        if (!S) return;
        const t = Math.min(1, (now() - t0) / ms);
        S.view = V.flyStep(from, to, t, S.vw, S.vh);
        applyView();
        wakeWillChange();
        S.fly = t < 1 ? frame(step) : 0;
      };
      S.fly = frame(step);
    }

    function onWheel(e) {
      if (e.target.closest?.('.mesa-menu, .mesa-nav')) return;
      // Janela com conteudo rolavel (lista, nota) rola por dentro; so a roda
      // no fundo e em janelas de video aproxima.
      const winEl = e.target.closest?.('.mesa-win');
      if (winEl && !winEl.classList.contains('is-media') && scrollsInside(e.target, winEl, e.deltaY)) return;
      e.preventDefault();
      S.viewTouched = true;
      const r = S.section.getBoundingClientRect();
      setView(V.wheelZoom(S.view, e.clientX - r.left, e.clientY - r.top, e.deltaY, e.ctrlKey, S.vw, S.vh));
    }

    function scrollsInside(el, stop, dy) {
      for (let n = el; n && n !== stop; n = n.parentElement) {
        const cs = root.getComputedStyle(n);
        if (!/(auto|scroll)/.test(cs.overflowY)) continue;
        if (dy < 0 && n.scrollTop > 0) return true;
        if (dy > 0 && n.scrollTop + n.clientHeight < n.scrollHeight) return true;
      }
      return false;
    }

    function localPoint(e) {
      const r = S.section.getBoundingClientRect();
      return { sx: e.clientX - r.left, sy: e.clientY - r.top };
    }

    function worldPoint(e) {
      const { sx, sy } = localPoint(e);
      return V.toWorld(S.view, sx, sy);
    }

    function isBackground(t) {
      return t === S.section || t === S.gridBg || t === S.world || t === S.over
        || t.classList?.contains('mesa-edge');
    }

    function onBackgroundDown(e) {
      if (e.button !== 0 || !isBackground(e.target)) return;
      e.preventDefault();
      S.viewTouched = true;
      closeMenu();
      S.section.focus({ preventScroll: true });
      S.section.setPointerCapture?.(e.pointerId);
      const x0 = e.clientX;
      const y0 = e.clientY;
      const start = { ...S.view };
      S.section.classList.add('is-panning');
      const move = (ev) => setView(V.pan(start, ev.clientX - x0, ev.clientY - y0, S.vw, S.vh));
      const up = () => {
        S?.section.classList.remove('is-panning');
        S?.section.removeEventListener('pointermove', move);
        S?.section.removeEventListener('pointerup', up);
        S?.section.removeEventListener('pointercancel', up);
      };
      S.section.addEventListener('pointermove', move);
      S.section.addEventListener('pointerup', up);
      S.section.addEventListener('pointercancel', up);
    }

    // ------------------------------------------------------------------
    // Rede
    // ------------------------------------------------------------------

    /** Uma mensagem da sinalizacao. `true` se era da Mesa. */
    function handle(msg) {
      switch (msg?.type) {
        case 'mesa-sync': if (S) onSync(msg); return true;
        case 'mesa': if (S) onMesa(msg); return true;
        case 'mesa-denied': if (S) onDenied(msg); return true;
        case 'mesa-grab': if (S) onGrab(msg); return true;
        case 'mesa-release': if (S) onRelease(msg); return true;
        case 'mesa-drag': if (S) onRemoteDrag(msg); return true;
        case 'cursor': if (S) onCursor(msg); return true;
        case 'time': if (S) onTime(msg); return true;
        case 'mesa-ack': return true; // a vista so manda operacoes estando na Mesa
        default: return false;
      }
    }

    // Rabisco em janela da Mesa (contrato, secao 10, "Quadro"). 'annotate' e
    // 'annotate-sync' tambem existem para o rabisco sobre TELA/CAMERA (fora
    // da Mesa, app.js/ui.js cuidam); a chave que separa os dois mundos e o
    // formato da superficie ('mesa:<id>'). `false` aqui devolve a mensagem
    // pro caminho de tela/camera de sempre; `true` diz "era da Mesa, ja
    // tratei" mesmo quando a janela em questao nao esta (mais) montada aqui
    // (ex.: 'mesa-view' desligada, ou a janela fechou entre o envio e a
    // chegada) -- o ponto e nunca deixar sobrar pro lado da tela.
    function handleAnnotate(msg) {
      const m = typeof msg?.surface === 'string' ? MESA_SURFACE_RE.exec(msg.surface) : null;
      if (!m) return false;
      const rec = S && S.wins.get(m[1]);
      if (rec?.inst && typeof rec.inst.annotateOp === 'function') {
        try {
          rec.inst.annotateOp(msg);
        } catch (err) {
          console.error('[mesa] annotateOp do conteudo falhou:', err);
        }
      }
      return true;
    }

    function handleAnnotateSync(msg) {
      const m = typeof msg?.surface === 'string' ? MESA_SURFACE_RE.exec(msg.surface) : null;
      if (!m) return false;
      const rec = S && S.wins.get(m[1]);
      if (rec?.inst && typeof rec.inst.annotateSync === 'function') {
        try {
          rec.inst.annotateSync(Array.isArray(msg.items) ? msg.items : []);
        } catch (err) {
          console.error('[mesa] annotateSync do conteudo falhou:', err);
        }
      }
      return true;
    }

    function requestSync() {
      deps.send({ type: 'mesa-sync' });
    }

    function onSync(msg) {
      const first = !S.state;
      S.state = M.createState({ mesa: msg.mesa });
      S.local.clear();
      S.remote.clear();
      S.grabs = M.createGrabs();
      const t = Date.now();
      for (const g of Array.isArray(msg.grabs) ? msg.grabs : []) {
        if (g && typeof g.id === 'string' && g.by != null) S.grabs.set(g.id, String(g.by), t);
      }
      S.loadingEl.hidden = true;
      renderAll({ refreshContent: true });
      // Mesa vazia nao conta como enquadrada: numa sala Mesa ela abre antes de qualquer tela existir, e o
      // enquadramento fica para a primeira janela que chegar (ver onMesa 'add').
      if (first && !S.fitted && windows().length) {
        S.fitted = true;
        setView(V.fitAll(windows(), S.vw, S.vh, { safe: S.safe }), { quiet: true });
      }
      scheduleGrabExpiry();
      emitLocks();
    }

    function onMesa(msg) {
      if (!S.state) return; // o retrato vem logo; ele ja inclui isto
      const res = M.applyMessage(S.state, msg);
      if (res.needSync) {
        requestSync();
        return;
      }
      if (res.stale || res.state === S.state) return;
      const before = S.state;
      S.state = res.state;
      const mine = String(msg.by) === String(deps.me());
      switch (msg.op) {
        case 'add': {
          renderAll();
          const rec = S.wins.get(msg.win?.id);
          if (rec) animateIn(rec);
          // A Mesa abre vazia numa sala Mesa e as telas chegam depois, uma a uma: enquanto a pessoa nao
          // mexeu na vista (roda, arrastar o fundo, zoom), cada tela/camera que entra sozinha reenquadra tudo.
          const autoMedia = !mine && msg.win && isMedia(msg.win)
            && String(msg.win.state?.peerId) === String(msg.by);
          if (windows().length && (!S.fitted || (autoMedia && !S.viewTouched))) {
            S.fitted = true;
            flyTo(V.fitAll(windows(), S.vw, S.vh, { safe: S.safe }));
          }
          if (mine) S.pendingAdd = null;
          if (mine && S.focusAfterAdd && rec) {
            S.focusAfterAdd = false;
            rec.el.focus({ preventScroll: true });
          }
          if (!mine) {
            // Tela e camera entram sozinhas (a pessoa foi ao vivo): nao e
            // alguem "pondo" a janela.
            const auto = msg.win && isMedia(msg.win) && String(msg.win.state?.peerId) === String(msg.by);
            announce(auto ? `${labelOf(msg.win)} entrou na Mesa` : `${deps.nameOf(msg.by)} pôs ${titleOf(msg.win)} na Mesa`, msg.by);
          }
          break;
        }
        case 'remove': {
          const old = before.mesa.windows.find((w) => w.id === msg.id);
          S.local.delete(msg.id);
          S.remote.delete(msg.id);
          S.grabs.drop(msg.id);
          renderAll();
          if (old && !mine) {
            const media = old.type === 'tela' || old.type === 'camera';
            // Quem parou de transmitir "perde a janela": nao e alguem
            // tirando da mesa, entao o aviso e outro.
            if (media && String(old.state?.peerId) === String(msg.by)) announce(`${titleOf(old)} saiu da Mesa`, msg.by);
            else announce(`${deps.nameOf(msg.by)} tirou ${titleOf(old)} da Mesa`, msg.by);
          }
          break;
        }
        case 'place': {
          // So o eco do ULTIMO place meu solta a posicao local: com setas
          // apertadas em sequencia, o eco da primeira chega quando a janela
          // ja esta na terceira, e solta-la ali fazia a janela voltar e pular.
          if (mine && V.sameRect(S.local.get(msg.id), msg)) S.local.delete(msg.id);
          S.remote.delete(msg.id);
          const rec = S.wins.get(msg.id);
          if (rec) {
            if (!mine && !reducedMotion()) settle(rec);
            placeWin(rec);
          }
          scheduleMap();
          scheduleWatch();
          break;
        }
        // Janela secret: o servidor manda o estado ja filtrado para mim
        // (`state`); quem saiu de vez larga cadeira e mao (`drop`).
        // Para o conteudo e igual a um act: update(state, meta).
        case 'act':
        case 'state':
        case 'drop': {
          const rec = S.wins.get(msg.id);
          const win = findWin(msg.id);
          if (rec && win) updateContent(rec, win, { by: msg.by ?? null, isLeader: msg.isLeader === true });
          break;
        }
        case 'lock':
          applyLocks();
          emitLocks();
          if (!mine) {
            const lo = S.state.mesa.leaderOnly;
            announce(lo ? `${deps.nameOf(msg.by)} travou a Mesa: só o líder mexe` : 'A Mesa está liberada para todo mundo mexer', msg.by);
          }
          break;
        default:
          break;
      }
    }

    function onDenied(msg) {
      const id = typeof msg.id === 'string' ? msg.id : null;
      const reason = String(msg.reason || '');
      if (msg.op === 'act' && id) {
        const rec = S.wins.get(id);
        const fns = rec ? [...rec.denied] : [];
        if (fns.length) {
          for (const fn of fns) {
            try {
              fn({ reason, detail: typeof msg.detail === 'string' ? msg.detail : null });
            } catch (err) {
              console.error('[mesa] onDenied do conteudo falhou:', err);
            }
          }
          return;
        }
      }
      if (reason === 'not-viewing') {
        deps.send({ type: 'mesa-view', on: true });
        return;
      }
      if (reason === 'not-found') {
        if (id) S.local.delete(id);
        requestSync();
        return;
      }
      if (msg.op === 'grab') {
        if (S.drag && S.drag.id === id) cancelDrag();
      }
      if (reason === 'held') {
        const by = msg.holder != null ? String(msg.holder) : null;
        if (id && by) {
          S.grabs.set(id, by, Date.now());
          renderGrab(id);
          scheduleGrabExpiry();
        }
        if (id) {
          S.local.delete(id);
          const rec = S.wins.get(id);
          if (rec) placeWin(rec);
        }
        toast(by ? `${deps.nameOf(by)} está movendo esta janela` : 'Outra pessoa está movendo esta janela', by);
        return;
      }
      if ((reason === 'overlap' || reason === 'out-of-world') && msg.fix && id && (msg.op === 'place')) {
        // Corrida: duas pessoas soltaram no mesmo espaco. Quem perdeu
        // assenta no lugar livre mais perto que o servidor mandou.
        const rec = S.wins.get(id);
        const fix = M.normRect(msg.fix);
        if (rec && fix && !rec.fixTried) {
          rec.fixTried = true;
          S.local.set(id, fix);
          settle(rec);
          placeWin(rec);
          deps.send({ type: 'mesa', op: 'place', id, ...fix });
          later(() => {
            if (rec) rec.fixTried = false;
          }, 1500);
          return;
        }
        if (id) S.local.delete(id);
        if (rec) placeWin(rec);
        toast('Não coube ali: a janela voltou para onde estava.');
        return;
      }
      if ((reason === 'overlap' || reason === 'out-of-world') && msg.fix && msg.op === 'add') {
        const fix = M.normRect(msg.fix);
        if (fix && S.pendingAdd) {
          const type = S.pendingAdd;
          S.pendingAdd = null;
          deps.send({ type: 'mesa', op: 'add', win: { type, ...fix } });
          return;
        }
      }
      if (id && msg.op === 'place') {
        S.local.delete(id);
        const rec = S.wins.get(id);
        if (rec) placeWin(rec);
      }
      // Tela/camera nao fecham (nem ha botao): recusa 'media' fica sem aviso.
      if (reason === 'media') return;
      toast(DENIED_TEXT[reason] || 'Não deu para fazer isso agora.');
    }

    function onGrab(msg) {
      if (typeof msg.id !== 'string' || msg.by == null) return;
      const by = String(msg.by);
      S.grabs.set(msg.id, by, Date.now());
      if (by === String(deps.me())) return;
      renderGrab(msg.id);
      scheduleGrabExpiry();
    }

    function onRelease(msg) {
      if (typeof msg.id !== 'string') return;
      S.grabs.release(msg.id);
      S.remote.delete(msg.id);
      renderGrab(msg.id);
      const rec = S.wins.get(msg.id);
      if (rec) placeWin(rec);
    }

    function onRemoteDrag(msg) {
      const rect = M.normDragRect(msg);
      if (typeof msg.id !== 'string' || !rect || msg.by == null) return;
      const by = String(msg.by);
      if (by === String(deps.me())) return;
      S.grabs.set(msg.id, by, Date.now());
      S.remote.set(msg.id, { by, rect });
      const rec = S.wins.get(msg.id);
      if (rec) {
        rec.el.classList.add('is-remote-drag');
        placeWin(rec);
        renderGrab(msg.id);
      }
      scheduleMap();
      scheduleGrabExpiry();
      // O ponteiro de quem arrasta anda junto, mesmo entre um `cursor` e
      // outro (os dois saem a 20 Hz, mas por canais separados).
    }

    /** Apaga o "Bia esta movendo" GRAB_MS depois do ultimo sinal, se a
     * soltura nunca chegar (socket de quem movia caiu). */
    function scheduleGrabExpiry() {
      root.clearTimeout(S.grabTimer);
      const list = S.grabs.list(Date.now());
      if (!list.length) return;
      const next = Math.min(...list.map((g) => g.until)) - Date.now();
      S.grabTimer = later(() => {
        if (!S) return;
        const alive = new Set(S.grabs.list(Date.now()).map((g) => g.id));
        for (const id of [...S.remote.keys()]) {
          if (!alive.has(id)) S.remote.delete(id);
        }
        for (const rec of S.wins.values()) {
          renderGrab(rec.id);
          placeWin(rec);
        }
        scheduleGrabExpiry();
      }, Math.max(50, next + 20));
    }

    function holderOf(id) {
      const by = S.grabs.holder(id, Date.now());
      return by && by !== String(deps.me()) ? by : null;
    }

    // ------------------------------------------------------------------
    // Travas
    // ------------------------------------------------------------------

    function locks() {
      const m = S?.state?.mesa;
      return m ? { leaderOnly: m.leaderOnly, lockSize: m.lockSize } : null;
    }

    function canEdit() {
      const m = S?.state?.mesa;
      return !m || !m.leaderOnly || deps.isLeader();
    }

    function canResize() {
      const m = S?.state?.mesa;
      return canEdit() && (!m || !m.lockSize || deps.isLeader());
    }

    function canRemove(win) {
      if (!canEdit()) return false;
      // Tela e camera nao fecham: saem sozinhas quando a transmissao acaba.
      return !isMedia(win);
    }

    function lockReason() {
      if (!canEdit()) return 'Só o líder mexe na Mesa agora.';
      if (!canResize()) return 'O líder travou o tamanho das janelas.';
      return null;
    }

    function applyLocks() {
      if (!S) return;
      S.section.classList.toggle('no-edit', !canEdit());
      S.section.classList.toggle('no-resize', !canResize());
      const reason = lockReason();
      S.lockNote.hidden = !reason;
      S.lockNote.innerHTML = reason ? `${ICON.lock}<span>${escapeHtml(reason)}</span>` : '';
      for (const rec of S.wins.values()) {
        const win = findWin(rec.id);
        if (win) syncControls(rec, win);
      }
    }

    function emitLocks() {
      const l = locks();
      if (l) deps.onLocksChange?.(l);
    }

    /** Liga/desliga uma trava (so o lider; o servidor confere). */
    // Vale tambem na Transmissao (S null): o lider muda as travas pelo `...`
    // sem abrir a Mesa, e o servidor aceita `lock` do lider em qualquer vista.
    function setLock(name, value) {
      if (!['leaderOnly', 'lockSize'].includes(name)) return;
      deps.send({ type: 'mesa', op: 'lock', [name]: Boolean(value) });
    }

    // ------------------------------------------------------------------
    // Janelas
    // ------------------------------------------------------------------

    function windows() {
      return S?.state ? S.state.mesa.windows : [];
    }

    function findWin(id) {
      return windows().find((w) => w.id === id) || null;
    }

    function isMedia(win) {
      return win.type === 'tela' || win.type === 'camera';
    }

    function titleOf(win) {
      if (!win) return 'uma janela';
      if (win.type === 'tela') return `a tela de ${deps.nameOf(win.state?.peerId)}`;
      if (win.type === 'camera') return `a câmera de ${deps.nameOf(win.state?.peerId)}`;
      return modOf(win.type)?.title || 'uma janela';
    }

    function labelOf(win) {
      if (win.type === 'tela') return `Tela de ${deps.nameOf(win.state?.peerId)}`;
      if (win.type === 'camera') return `Câmera de ${deps.nameOf(win.state?.peerId)}`;
      return modOf(win.type)?.title || 'Janela';
    }

    function rectOf(win) {
      return S.local.get(win.id) || S.remote.get(win.id)?.rect || win;
    }

    // Modulos privados podem ocultar seu conteudo de outras pessoas. O
    // cursor tambem e conteudo: nao sai enquanto esta sobre essa janela.
    // Em tela cheia a janela nao ocupa o proprio retangulo do mundo, entao
    // tambem vale o elemento debaixo do ponteiro (e qualquer privada em tela cheia).
    function janelaPrivada(win) {
      return !!win && modOf(win.type)?.isPrivate?.(win.state) === true;
    }

    function cursorSobreJanelaPrivada(point, alvo) {
      const winEl = alvo?.closest?.('.mesa-win');
      if (winEl && janelaPrivada(findWin(winEl.dataset.id))) return true;
      return windows().some((win) => {
        if (!janelaPrivada(win)) return false;
        if (S.wins.get(win.id)?.el?.classList.contains('is-full')) return true;
        const rect = rectOf(win);
        return point.x >= rect.x
          && point.y >= rect.y
          && point.x <= rect.x + rect.w
          && point.y <= rect.y + rect.h;
      });
    }

    /** Casa o DOM com o estado: cria o que falta, tira o que saiu, poe cada
     * uma no lugar. */
    function renderAll({ refreshContent = false } = {}) {
      const list = windows();
      const ids = new Set(list.map((w) => w.id));
      for (const [id, rec] of [...S.wins]) {
        if (!ids.has(id)) {
          const hadFocus = rec.el.contains(document.activeElement);
          if (S.fullId === id) exitFull();
          removeWin(rec);
          // A janela com o foco sumiu (outra pessoa tirou): o foco volta
          // para a mesa, nunca para o body.
          if (hadFocus) S.section.focus({ preventScroll: true });
        }
      }
      for (const win of list) {
        let rec = S.wins.get(win.id);
        if (!rec) {
          rec = makeWin(win);
          S.wins.set(win.id, rec);
        } else if (refreshContent || rec.type !== win.type) {
          updateContent(rec, win, null);
        }
        syncControls(rec, win);
        placeWin(rec);
      }
      applyLocks();
      scheduleMap();
      scheduleWatch();
    }

    function makeWin(win) {
      const el = document.createElement('div');
      const media = isMedia(win);
      el.className = `mesa-win${media ? ' is-media' : ''}`;
      el.dataset.id = win.id;
      el.dataset.type = win.type;
      el.tabIndex = 0;
      el.setAttribute('role', 'group');
      el.innerHTML = `
        <div class="mesa-bar">
          ${media ? '<span class="mesa-live-slot"></span>' : ''}
          <span class="mesa-type" aria-hidden="true">${escapeHtml(typeGlyph(win.type))}</span>
          <span class="mesa-bar-title"></span>
          <span class="mesa-bar-status"></span>
          <span class="mesa-bar-turn tag tag--wire" hidden>Sua vez</span>
          <span class="mesa-moving" hidden></span>
          <span class="mesa-avatar node" data-size="16"></span>
          <button type="button" class="mesa-bar-btn btn btn--quiet btn--sm btn--icon" data-act="menu" aria-label="Mais ações da janela"
            title="Mais ações (Shift+F10)" aria-haspopup="menu">${ICON.more}</button>
          <button type="button" class="mesa-bar-btn btn btn--quiet btn--sm btn--icon" data-act="full" aria-label="Tela cheia"
            title="Tela cheia (F)">${ICON.fs}</button>
          <button type="button" class="mesa-bar-btn btn btn--quiet btn--sm btn--icon" data-act="remove" aria-label="Tirar da Mesa"
            title="Tirar da Mesa (Delete)">${ICON.x}</button>
        </div>
        <div class="mesa-win-body"></div>
        <div class="mesa-resize" data-edge="l" aria-hidden="true"></div>
        <div class="mesa-resize" data-edge="r" aria-hidden="true"></div>
        <div class="mesa-resize" data-edge="b" aria-hidden="true"></div>
        <div class="mesa-resize" data-edge="bl" aria-hidden="true"></div>
        <div class="mesa-resize" data-edge="br" aria-hidden="true"></div>`;
      const rec = {
        id: win.id,
        type: win.type,
        el,
        body: el.querySelector('.mesa-win-body'),
        kind: null,
        inst: null,
        tile: null,
        placeholder: null,
        summaryEl: null,
        denied: new Set(),
        fixTried: false,
      };
      S.world.appendChild(el);
      el.querySelector('[data-act="menu"]').addEventListener('click', (e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        openMenuAt(r.left, r.bottom + 4, rec.id, { keyboard: e.detail === 0 });
      });
      el.querySelector('[data-act="full"]').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFull(rec.id);
      });
      el.querySelector('[data-act="remove"]').addEventListener('click', (e) => {
        e.stopPropagation();
        removeFromMesa(rec.id);
      });
      el.addEventListener('pointerdown', (e) => onWinDown(e, rec));
      el.addEventListener('keydown', (e) => onWinKey(e, rec));
      // Chegou pelo Tab numa janela fora da vista: a vista vai ate ela (o
      // navegador nao rola a mesa -- ela e overflow: clip).
      el.addEventListener('focus', () => {
        setActive(rec.id);
        const w = findWin(rec.id);
        // So o foco do teclado: clicar numa janela meio de fora nao voa.
        if (!w || S.fullId || S.drag || !el.matches(':focus-visible')) return;
        const seen = V.watchable(S.view, S.vw, S.vh, rectOf(w), { minPx: 1 });
        const s2 = V.screenRect(S.view, rectOf(w));
        const inteira = s2.x >= 0 && s2.y >= 0 && s2.x + s2.w <= S.vw && s2.y + s2.h <= S.vh;
        if (!seen.onScreen || !inteira) {
          flyTo(V.centerOn(w.x + w.w / 2, w.y + w.h / 2, S.view.z, S.vw, S.vh, {
            safe: S.safe,
          }));
        }
      });
      for (const edge of el.querySelectorAll('.mesa-resize')) {
        edge.addEventListener('pointerdown', (e) => onResizeDown(e, rec, edge.dataset.edge));
      }
      mountContent(rec, win);
      return rec;
    }

    function syncControls(rec, win) {
      const owner = win.owner != null ? String(win.owner) : null;
      const label = labelOf(win);
      rec.el.setAttribute('aria-label', owner ? `${label}, posta por ${deps.nameOf(owner)}` : label);
      rec.el.querySelector('.mesa-bar-title').textContent = label;
      rec.el.querySelector('.mesa-bar').title = !canEdit() ? lockReason() || '' : '';
      const av = rec.el.querySelector('.mesa-avatar');
      const avKey = owner || '';
      if (av.dataset.key !== avKey) {
        av.dataset.key = avKey;
        av.innerHTML = owner ? avatarHtml(owner) : '';
        av.hidden = !owner;
        av.title = owner ? `Pôs na Mesa: ${deps.nameOf(owner)}` : '';
        if (owner) av.style.setProperty('--who', deps.colorFor(owner));
      }
      rec.el.querySelector('[data-act="remove"]').hidden = !canRemove(win);
      if (isMedia(win)) {
        const liveSlot = rec.el.querySelector('.mesa-live-slot');
        const live = win.type === 'tela';
        let pill = liveSlot.querySelector('.mesa-live');
        if (live && !pill) {
          pill = document.createElement('span');
          pill.className = 'mesa-live tag tag--live';
          pill.textContent = 'AO VIVO';
          liveSlot.append(pill);
        } else if (!live && pill) pill.remove();
        adoptTile(rec, win);
      }
      renderGrab(rec.id);
    }

    function setActive(id) {
      if (!S || S.activeId === id) return;
      S.wins.get(S.activeId)?.el.classList.remove('is-active');
      S.activeId = id;
      S.wins.get(id)?.el.classList.add('is-active');
    }

    function avatarHtml(id) {
      const url = deps.avatarOf?.(id);
      if (url) return `<img src="${escapeHtml(url)}" alt="" />`;
      const initial = (deps.nameOf(id) || '?').trim().charAt(0).toUpperCase() || '?';
      return `<span class="mesa-avatar-initial">${escapeHtml(initial)}</span>`;
    }

    function typeGlyph(type) {
      return ({ youtube: '▶', radio: '◉', nota: '□', lista: '☷', enquete: '◌', imagem: '▧',
        galeria: '▦', quadro: '✎', placar: '≡', cronometro: '◷', velha: '×', xadrez: '♞',
        damas: '●', dados: '⚄', roleta: '◉', quiz: '?', domino: '▯', truco: '♠' })[type] || '◇';
    }

    function placeWin(rec) {
      const win = findWin(rec.id);
      if (!win) return;
      const r = S.fullId === rec.id ? null : rectOf(win);
      if (!r) return;
      const st = rec.el.style;
      const pos = `translate(${r.x}px, ${r.y}px)`;
      // A entrada anima o transform com a posicao de quando nasceu: se a
      // janela muda de lugar no meio, a animacao sai para nao prende-la la.
      if (rec.entrance && st.transform !== pos) {
        rec.entrance.cancel();
        rec.entrance = null;
      }
      st.transform = pos;
      st.width = `${r.w}px`;
      st.height = `${r.h}px`;
    }

    /** Desliza ate o lugar novo (260 ms) em vez de pular. */
    function settle(rec) {
      if (reducedMotion()) return;
      rec.el.classList.add('is-settling');
      root.clearTimeout(rec.settleTimer);
      rec.settleTimer = later(() => rec.el.classList.remove('is-settling'), V.SETTLE_MS + 40);
    }

    function animateIn(rec) {
      if (reducedMotion() || typeof rec.el.animate !== 'function') return;
      // A escala vai DENTRO do transform, depois do translate: a propriedade
      // `scale` avulsa e aplicada por fora do transform e encolhia tambem a
      // posicao, e a janela nascia voando de perto do canto da mesa.
      const pos = rec.el.style.transform;
      const a = rec.el.animate(
        [{ opacity: 0, transform: `${pos} scale(0.94)` }, { opacity: 1, transform: pos }],
        { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
      );
      rec.entrance = a;
      a.onfinish = () => {
        if (rec.entrance === a) rec.entrance = null;
      };
    }

    function removeWin(rec) {
      S.wins.delete(rec.id);
      S.tracker.drop(rec.id);
      S.widths.delete(rec.id);
      unmountWin(rec, { returnTile: true });
      const el = rec.el;
      if (reducedMotion() || typeof el.animate !== 'function') {
        el.remove();
        return;
      }
      el.style.pointerEvents = 'none';
      const pos = el.style.transform;
      el.animate([{ opacity: 1, transform: pos }, { opacity: 0, transform: `${pos} scale(0.96)` }], { duration: 120, easing: 'cubic-bezier(0.4, 0, 1, 1)' }).onfinish = () => el.remove();
    }

    function unmountWin(rec, { returnTile = false } = {}) {
      if (rec.inst) {
        try {
          rec.inst.destroy?.();
        } catch (err) {
          console.error('[mesa] destroy do conteudo falhou:', err);
        }
        rec.inst = null;
      }
      rec.denied.clear();
      if (returnTile && rec.tile) {
        if (rec.tile.isConnected && rec.body.contains(rec.tile)) deps.returnTile(rec.tile);
        rec.tile = null;
      }
    }

    // ------------------------------------------------------------------
    // Conteudo: tela/camera (o tile de hoje), janela do time Janelas, ou o
    // resumo do modulo
    // ------------------------------------------------------------------

    function mountContent(rec, win) {
      rec.type = win.type;
      if (isMedia(win)) {
        rec.kind = 'media';
        adoptTile(rec, win);
        return;
      }
      const J = G.mesaJanelas?.[win.type];
      if (J && typeof J.mount === 'function') {
        const el = document.createElement('div');
        el.className = 'mesa-content';
        rec.body.appendChild(el);
        try {
          rec.inst = J.mount(el, makeApi(rec)) || null;
          rec.kind = 'janela';
          rec.contentEl = el;
          rec.inst?.update?.(win.state, null);
          return;
        } catch (err) {
          console.error(`[mesa] conteudo de ${win.type} falhou ao montar:`, err);
          rec.inst = null;
          el.remove();
        }
      }
      rec.kind = 'summary';
      rec.summaryEl = document.createElement('div');
      rec.summaryEl.className = 'mesa-summary';
      rec.summaryEl.innerHTML = '<p class="mesa-summary-title"></p><p class="mesa-summary-text"></p>';
      rec.body.appendChild(rec.summaryEl);
      updateSummary(rec, win);
    }

    function updateContent(rec, win, meta) {
      if (rec.type !== win.type) {
        unmountWin(rec, { returnTile: true });
        rec.body.textContent = '';
        mountContent(rec, win);
        return;
      }
      if (rec.kind === 'janela' && rec.inst) {
        try {
          rec.inst.update?.(win.state, meta);
        } catch (err) {
          console.error(`[mesa] update de ${win.type} falhou:`, err);
        }
      } else if (rec.kind === 'summary') {
        updateSummary(rec, win);
      } else if (rec.kind === 'media') {
        adoptTile(rec, win);
      }
    }

    function updateSummary(rec, win) {
      const mod = modOf(win.type);
      let text = '';
      try {
        text = typeof mod?.summary === 'function' ? String(mod.summary(win.state) ?? '') : '';
      } catch {
        text = '';
      }
      rec.summaryEl.querySelector('.mesa-summary-title').textContent = mod?.title || 'Janela';
      rec.summaryEl.querySelector('.mesa-summary-text').textContent = text;
    }

    /** A `api` que a Vista da ao conteudo de cada janela (contrato, secao
     * 6). Tudo le o estado ATUAL na hora da chamada. */
    function makeApi(rec) {
      return {
        act(action) {
          if (!S || !findWin(rec.id)) return false;
          return deps.send({ type: 'mesa', op: 'act', id: rec.id, action });
        },
        validate(action) {
          const win = S && findWin(rec.id);
          const mod = win ? modOf(win.type) : null;
          if (!mod || typeof mod.validate !== 'function') return 'janela sem ação';
          // Janela secret: o cliente nao tem o estado inteiro; quem decide e
          // o servidor, e a interface usa o `me` que veio na view.
          if (mod.secret === true) return true;
          try {
            return mod.validate(win.state, action, { from: String(deps.me()), isLeader: deps.isLeader(), now: serverNow(), peers: deps.peers() });
          } catch {
            return 'ação inválida';
          }
        },
        me: () => String(deps.me()),
        isLeader: () => deps.isLeader(),
        peers: () => deps.peers(),
        nameOf: (id) => deps.nameOf(id),
        colorFor: (id) => deps.colorFor(id),
        serverNow: () => serverNow(),
        setStatus(texto) {
          const el = rec.el.querySelector('.mesa-bar-status');
          el.textContent = String(texto ?? '').slice(0, 60);
        },
        setTurn(on) {
          const el = rec.el.querySelector('.mesa-bar-turn');
          const antes = !el.hidden;
          el.hidden = !on;
          // So o leitor de tela ouve: a pilula na barra ja e o sinal visual, e um aviso
          // por jogada viraria ruido com varias janelas de jogo.
          if (on && !antes) {
            S.liveEl.textContent = '';
            S.liveEl.textContent = `Sua vez: ${labelOf(findWin(rec.id) || { type: rec.type })}`;
          }
        },
        onDenied(fn) {
          if (typeof fn !== 'function') return () => {};
          rec.denied.add(fn);
          return () => rec.denied.delete(fn);
        },
        // Canal do rabisco endereçado a ESTA janela (contrato, secao 10,
        // "Quadro"): superficie 'mesa:<id>'. `sendAnnotate` so manda -- o
        // conteudo aplica o proprio traco local (otimista) do mesmo jeito
        // que o rabisco sobre a tela ja faz; o servidor nunca ecoa pra quem
        // mandou. `handleAnnotate`/`handleAnnotateSync`, mais abaixo, e
        // quem entrega o que chega da rede de volta pro conteudo.
        annotateSurface: () => `mesa:${rec.id}`,
        sendAnnotate(op) {
          if (!S || !findWin(rec.id)) return false;
          return deps.send({ type: 'annotate', surface: `mesa:${rec.id}`, ...op });
        },
        sendAnnotateSyncAll(items) {
          if (!S || !findWin(rec.id) || !Array.isArray(items)) return false;
          const me = String(deps.me());
          const destinos = (deps.viewers?.() || []).map(String).filter((id) => id !== me);
          let enviado = false;
          for (const to of destinos) {
            if (deps.send({ type: 'annotate-sync', to, surface: `mesa:${rec.id}`, items })) enviado = true;
          }
          return enviado;
        },
      };
    }

    function tileKind(win) {
      return win.type === 'tela' ? 'screen' : 'camera';
    }

    /** Pega o tile do palco para dentro da janela. Sem tile ainda (a track
     * nao chegou, ou quem transmite e voce e a previa nao existe), a janela
     * mostra quem e ate ele chegar. */
    function adoptTile(rec, win) {
      const peerId = win.state?.peerId;
      const tile = peerId != null ? deps.tileFor(tileKind(win), String(peerId)) : null;
      if (rec.tile && rec.tile !== tile && rec.body.contains(rec.tile)) deps.returnTile(rec.tile);
      rec.tile = tile;
      if (tile) {
        if (tile.parentElement !== rec.body) {
          rec.body.prepend(tile);
          // Mudar o <video> de lugar na mesma pagina nao pausa, mas se ele
          // estava pausado por estar escondido, volta a pintar aqui -- a nao
          // ser que o veu de pausa (quem transmite pausou) mande nele.
          const video = tile.querySelector('video');
          if (video && video.paused && !tile.classList.contains('is-paused')) video.play?.().catch(() => {});
        }
        rec.placeholder?.remove();
        rec.placeholder = null;
      } else if (!rec.placeholder) {
        rec.placeholder = document.createElement('div');
        rec.placeholder.className = 'mesa-wait';
        rec.body.appendChild(rec.placeholder);
      }
      if (rec.placeholder) {
        const pid = String(peerId ?? '');
        const espera = win.type === 'tela' ? 'Esperando a tela chegar…' : 'Esperando a câmera chegar…';
        rec.placeholder.innerHTML = [
          `<span class="mesa-avatar mesa-wait-avatar node" data-size="56">${avatarHtml(pid)}</span>`,
          `<span class="mesa-wait-text">${escapeHtml(espera)}</span>`,
        ].join('');
        rec.placeholder.querySelector('.mesa-avatar').style.setProperty('--who', deps.colorFor(pid));
      }
    }

    /** O palco criou (ou recriou) um tile: se ele e de uma janela da mesa,
     * vem para ca. */
    function onTile(tileId) {
      if (!S) return;
      for (const rec of S.wins.values()) {
        if (rec.kind !== 'media') continue;
        const win = findWin(rec.id);
        if (!win) continue;
        const want = deps.tileIdFor(tileKind(win), String(win.state?.peerId));
        if (want === tileId) adoptTile(rec, win);
      }
    }

    // ------------------------------------------------------------------
    // Arrastar e redimensionar (com a vez da janela)
    // ------------------------------------------------------------------

    function onWinDown(e, rec) {
      if (e.button !== 0) return;
      setActive(rec.id);
      if (!e.target.closest('.mesa-bar') || e.target.closest('.mesa-bar-btn, .mesa-resize')) return;
      const win = findWin(rec.id);
      if (!win || S.fullId) return;
      if (!canEdit()) {
        toast('Só o líder mexe na Mesa agora.');
        return;
      }
      const held = holderOf(rec.id);
      if (held) {
        toast(`${deps.nameOf(held)} está movendo esta janela`, held);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      startDrag(e, rec, win, null);
    }

    function onResizeDown(e, rec, edge) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const win = findWin(rec.id);
      if (!win || S.fullId) return;
      if (!canResize()) {
        toast(lockReason() || 'Não dá para mudar o tamanho agora.');
        return;
      }
      const held = holderOf(rec.id);
      if (held) {
        toast(`${deps.nameOf(held)} está movendo esta janela`, held);
        return;
      }
      startDrag(e, rec, win, edge);
    }

    function startDrag(e, rec, win, edge) {
      const target = e.currentTarget || rec.el;
      target.setPointerCapture?.(e.pointerId);
      const p0 = worldPoint(e);
      const orig = { ...rectOf(win) };
      const mod = modOf(win.type);
      S.drag = {
        id: rec.id,
        rec,
        edge,
        target,
        pointerId: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        p0,
        orig,
        rect: { ...orig },
        moved: false,
        grabbed: false,
        lastEmit: 0,
        size: mod?.size || { minW: M.MIN_W, minH: M.MIN_H, aspect: null },
      };
      const move = (ev) => onDragMove(ev);
      const up = (ev) => onDragEnd(ev, false);
      const cancel = (ev) => onDragEnd(ev, true);
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', cancel);
      S.drag.detach = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', cancel);
      };
    }

    function onDragMove(ev) {
      const d = S?.drag;
      if (!d) return;
      if (!d.moved) {
        if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 4) return;
        d.moved = true;
        // A vez: pede ao servidor e ja comeca (a recusa, se vier, desfaz).
        deps.send({ type: 'mesa-grab', id: d.id });
        d.grabbed = true;
        d.rec.el.classList.add('is-dragging');
        S.section.classList.add('is-dragging');
      }
      const p = worldPoint(ev);
      const dx = p.x - d.p0.x;
      const dy = p.y - d.p0.y;
      const others = windows();
      if (d.edge) {
        const want = V.resizeRect(d.orig, d.edge, dx, dy, d.size);
        d.rect = V.resizeStop(others, d.id, d.rect, want);
      } else {
        d.rect = { x: Math.round(d.orig.x + dx), y: Math.round(d.orig.y + dy), w: d.orig.w, h: d.orig.h };
        // Durante o arraste a janela segue o mouse (pode passar por cima de
        // outra e da borda, ate a folga da vista).
        const o = V.OVERSCROLL;
        d.rect.x = Math.max(-o, Math.min(V.WORLD.w + o - d.rect.w, d.rect.x));
        d.rect.y = Math.max(-o, Math.min(V.WORLD.h + o - d.rect.h, d.rect.y));
      }
      S.local.set(d.id, d.rect);
      placeWin(d.rec);
      showLanding(d.edge ? null : V.landing(others, d.rect, d.id), d.rect);
      const t = now();
      if (M.shouldEmit(d.lastEmit, t)) {
        d.lastEmit = t;
        deps.send({ type: 'mesa-drag', id: d.id, ...d.rect });
      }
      scheduleMap();
    }

    function onDragEnd(ev, cancelled) {
      const d = S?.drag;
      if (!d) return;
      d.detach();
      S.drag = null;
      d.rec.el.classList.remove('is-dragging');
      S.section.classList.remove('is-dragging');
      showLanding(null);
      if (!d.moved) {
        S.local.delete(d.id);
        placeWin(d.rec);
        return;
      }
      const win = findWin(d.id);
      let final = null;
      if (!cancelled && win) {
        final = d.edge ? (V.fits(windows(), d.rect, { ignoreId: d.id }) ? d.rect : null) : V.landing(windows(), d.rect, d.id);
      }
      if (final && win && (final.x !== win.x || final.y !== win.y || final.w !== win.w || final.h !== win.h)) {
        S.local.set(d.id, final);
        settle(d.rec);
        placeWin(d.rec);
        deps.send({ type: 'mesa', op: 'place', id: d.id, ...final });
      } else {
        S.local.delete(d.id);
        settle(d.rec);
        placeWin(d.rec);
        if (!final && !cancelled) toast('Não há lugar livre ali.');
      }
      if (d.grabbed) deps.send({ type: 'mesa-release', id: d.id });
      scheduleMap();
      scheduleWatch();
    }

    function cancelDrag() {
      const d = S?.drag;
      if (!d) return;
      d.detach();
      S.drag = null;
      d.rec.el.classList.remove('is-dragging');
      S.section.classList.remove('is-dragging');
      showLanding(null);
      S.local.delete(d.id);
      placeWin(d.rec);
    }

    /** Contorno tracejado de onde a janela vai assentar, so quando nao e ali
     * mesmo. */
    function showLanding(r, cur) {
      let el = S.landingEl;
      const same = r && cur && r.x === cur.x && r.y === cur.y;
      if (!r || same) {
        if (el) el.hidden = true;
        return;
      }
      if (!el) {
        el = document.createElement('div');
        el.className = 'mesa-landing';
        el.setAttribute('aria-hidden', 'true');
        S.world.appendChild(el);
        S.landingEl = el;
      }
      el.hidden = false;
      el.style.transform = `translate(${r.x}px, ${r.y}px)`;
      el.style.width = `${r.w}px`;
      el.style.height = `${r.h}px`;
    }

    function renderGrab(id) {
      const rec = S?.wins.get(id);
      if (!rec) return;
      const by = holderOf(id);
      const chip = rec.el.querySelector('.mesa-moving');
      rec.el.classList.toggle('is-held', Boolean(by));
      if (!by) rec.el.classList.remove('is-remote-drag');
      if (by) {
        rec.el.style.setProperty('--who', deps.colorFor(by));
        chip.textContent = `${deps.nameOf(by)} está movendo`;
        chip.hidden = false;
      } else {
        rec.el.style.removeProperty('--who');
        chip.hidden = true;
        chip.textContent = '';
      }
    }

    // ------------------------------------------------------------------
    // Teclado
    // ------------------------------------------------------------------

    function onKeyDown(e) {
      if (isMenuKey(e)) {
        e.preventDefault();
        const winEl = e.target.closest?.('.mesa-win');
        const r = (winEl || S.section).getBoundingClientRect();
        openMenuAt(r.left + Math.min(r.width / 2, 160), r.top + Math.min(r.height / 2, 120), winEl ? winEl.dataset.id : null, { keyboard: true });
        return;
      }
      if (e.target !== S.section) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const panned = V.keyPan(S.view, e.key, S.vw, S.vh);
      if (panned) {
        e.preventDefault();
        setView(panned);
        return;
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setView(V.zoomStep(S.view, 1, S.vw, S.vh));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setView(V.zoomStep(S.view, -1, S.vw, S.vh));
      } else if (e.key === '0') {
        e.preventDefault();
          flyTo(V.fitAll(windows(), S.vw, S.vh, { safe: S.safe }));
      }
    }

    function isMenuKey(e) {
      return e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
    }

    function onWinKey(e, rec) {
      if (e.target !== rec.el || isMenuKey(e)) return;
      const win = findWin(rec.id);
      if (!win) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFull(rec.id);
        return;
      }
      if (e.key === 'Delete') {
        e.preventDefault();
        removeFromMesa(rec.id);
        return;
      }
      if (e.key === 'Enter' && rec.inst?.focus) {
        e.preventDefault();
        rec.inst.focus();
        return;
      }
      const mod = modOf(win.type);
      const want = V.keyRect(rectOf(win), e.key, { shift: e.shiftKey, alt: e.altKey, ...(mod?.size || {}) });
      if (!want) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.altKey ? !canResize() : !canEdit()) {
        toast(lockReason() || 'Não dá para mexer nesta janela agora.');
        return;
      }
      const held = holderOf(rec.id);
      if (held) {
        toast(`${deps.nameOf(held)} está movendo esta janela`, held);
        return;
      }
      if (!V.fits(windows(), want, { ignoreId: rec.id })) {
        toast(e.altKey ? 'Encostou em outra janela.' : 'Tem outra janela ali.');
        return;
      }
      S.local.set(rec.id, want);
      placeWin(rec);
      deps.send({ type: 'mesa', op: 'place', id: rec.id, ...want });
    }

    // ------------------------------------------------------------------
    // Tirar da mesa, tela cheia, centralizar
    // ------------------------------------------------------------------

    function removeFromMesa(id) {
      const win = findWin(id);
      if (!win) return;
      if (isMedia(win)) return;
      if (!canRemove(win)) {
        toast('Só o líder mexe na Mesa agora.');
        return;
      }
      const held = holderOf(id);
      if (held) {
        toast(`${deps.nameOf(held)} está movendo esta janela`, held);
        return;
      }
      deps.send({ type: 'mesa', op: 'remove', id });
    }

    function centerWin(id) {
      const win = findWin(id);
      if (win) flyTo(V.focusRect(win, S.vw, S.vh, { safe: S.safe }));
    }

    /** Tela cheia de uma janela, so para voce: a janela do Electron vai a
     * tela cheia (o mesmo caminho do tile do palco) e a janela da mesa
     * ocupa tudo, sem sair do lugar no DOM (um iframe dentro dela nao
     * recarrega). A transformacao da mesa sai enquanto isso, para o
     * `position: fixed` valer para a tela inteira. */
    function toggleFull(id) {
      if (S.fullId === id) exitFull();
      else enterFull(id);
    }

    function enterFull(id) {
      const rec = S.wins.get(id);
      if (!rec) return;
      if (S.fullId) exitFull({ keepWindow: true });
      closeMenu();
      S.fullId = id;
      // `will-change: transform` tambem prende o position:fixed: sai junto.
      S.world.classList.remove('is-moving');
      S.world.style.transform = 'none';
      rec.el.classList.add('is-full');
      rec.el.style.transform = '';
      rec.el.style.width = '';
      rec.el.style.height = '';
      S.section.classList.add('has-full');
      document.body.classList.add('mesa-full');
      setFullButton(rec, true);
      if (!rec.el.contains(document.activeElement)) rec.el.focus({ preventScroll: true });
      deps.setFullScreen?.(true);
      scheduleWatch();
    }

    function exitFull({ keepWindow = false, fromWindow = false, fromClose = false } = {}) {
      const id = S.fullId;
      if (!id) return;
      S.fullId = null;
      const rec = S.wins.get(id);
      if (rec) {
        rec.el.classList.remove('is-full');
        setFullButton(rec, false);
        placeWin(rec);
      }
      S.section.classList.remove('has-full');
      document.body.classList.remove('mesa-full');
      if (!keepWindow && !fromWindow) deps.setFullScreen?.(false);
      if (!fromClose) {
        applyView();
        rec?.el.focus({ preventScroll: true });
      }
    }

    function setFullButton(rec, on) {
      const b = rec.el.querySelector('[data-act="full"]');
      b.innerHTML = on ? ICON.fsExit : ICON.fs;
      b.setAttribute('aria-label', on ? 'Sair da tela cheia' : 'Tela cheia');
      b.title = on ? 'Sair da tela cheia (F)' : 'Tela cheia (F)';
    }

    function onDoubleClick(e) {
      const winEl = e.target.closest?.('.mesa-win');
      if (!winEl) return;
      e.stopPropagation();
      e.preventDefault();
      const win = findWin(winEl.dataset.id);
      if (win && e.target.closest('.mesa-bar')) toggleFull(win.id);
    }

    // ------------------------------------------------------------------
    // Menu do botao direito (e o + do dock)
    // ------------------------------------------------------------------

    function onContextMenu(e) {
      if (e.target.closest?.('input, textarea, [contenteditable="true"], .mesa-nav, .mesa-menu')) return;
      e.preventDefault();
      e.stopPropagation();
      const winEl = e.target.closest?.('.mesa-win');
      openMenuAt(e.clientX, e.clientY, winEl ? winEl.dataset.id : null, { at: worldPoint(e) });
    }

    /** Menu flutuante (position: fixed via .pop), fora da secao da Mesa para ficar acima da Conversa. */
    function criarMenuFlutuante() {
      const el = document.createElement('div');
      el.className = 'mesa-menu pop';
      el.setAttribute('role', 'menu');
      el.hidden = true;
      document.body.appendChild(el);
      return el;
    }

    function closeMenu() {
      if (!S?.menu) return;
      const back = S.menu.returnFocus;
      const hadFocus = S.menuEl.contains(document.activeElement) || S.subEl.contains(document.activeElement);
      S.menu = null;
      S.menuEl.hidden = true;
      S.subEl.hidden = true;
      S.menuEl.classList.remove('is-open');
      S.subEl.classList.remove('is-open');
      S.menuEl.textContent = '';
      S.subEl.textContent = '';
      // O foco so volta se estava no menu (clicar fora ja o levou a outro
      // lugar, e ali ele fica).
      if (hadFocus && back && back.isConnected) back.focus?.({ preventScroll: true });
    }

    function row(label, { act, sub, kbd, small, danger, disabled, reason } = {}) {
      const attrs = [
        'type="button"', 'role="menuitem"', 'class="mesa-menu-row menu__item' + (danger ? ' menu__item--danger' : '') + '"',
        act ? `data-act="${act}"` : '', sub ? 'data-sub="add" aria-haspopup="menu" aria-expanded="false"' : '',
        disabled ? 'aria-disabled="true"' : '', reason ? `title="${escapeHtml(reason)}"` : '',
      ].filter(Boolean).join(' ');
      const tail = sub ? ICON.chev : kbd ? `<kbd>${escapeHtml(kbd)}</kbd>` : small ? `<small>${escapeHtml(small)}</small>` : '';
      return `<button ${attrs}><span class="mesa-menu-label">${escapeHtml(label)}</span>${tail}</button>`;
    }

    function openMenuAt(x, y, winId, { at = null, keyboard = false } = {}) {
      closeMenu();
      const returnFocus = document.activeElement;
      S.menu = { winId, at, returnFocus, x, y };
      const m = S.menuEl;
      if (winId) {
        const win = findWin(winId);
        if (!win) return;
        const removable = canRemove(win);
        // Tela/camera de outra pessoa: o volume e o silenciar do tile (o
        // botao direito do palco, que aqui e o menu da janela).
        const volume = isMedia(win) && deps.openTileMenu && String(win.state?.peerId) !== String(deps.me());
        m.innerHTML = [
          row('Tela cheia', { act: 'full', kbd: 'F' }),
          row('Centralizar na vista', { act: 'center' }),
          volume ? row('Volume e silenciar…', { act: 'volume' }) : '',
          // Tela e camera nao fecham: sem "Tirar da Mesa" (nem o separador).
          isMedia(win) ? '' : '<hr class="mesa-menu-sep">',
          isMedia(win) ? '' : row('Tirar da Mesa', {
            act: 'remove',
            kbd: 'Del',
            danger: true,
            disabled: !removable,
            reason: removable ? '' : 'Só o líder mexe na Mesa agora.',
          }),
        ].join('');
      } else {
        const locked = !canEdit();
        m.innerHTML = [
          row('Adicionar janela', { sub: true, disabled: locked, reason: locked ? 'Só o líder mexe na Mesa agora.' : '' }),
          '<hr class="mesa-menu-sep">',
          row('Ver tudo', { act: 'fit', kbd: '0' }),
        ].join('');
      }
      m.setAttribute('aria-label', winId ? 'Janela' : 'Mesa');
      placeMenu(m, x, y);
      wireMenu(m, null);
      const first = m.querySelector('.mesa-menu-row');
      if (first) first.focus({ preventScroll: true });
      if (!keyboard && !winId) {
        const addRow = m.querySelector('[data-sub]');
        // Hover abre sem roubar foco; assim o menu continua navegavel. Se a
        // pessoa digitar, wireMenu leva o texto para a busca do painel aberto.
        addRow?.addEventListener('pointerenter', () => openSub(addRow, false));
        m.querySelector('[data-act="fit"]')?.addEventListener('pointerenter', () => closeSub());
      }
    }

    // Onde os menus da Mesa podem chegar embaixo: o bus da sala fica por cima da
    // Mesa (so a Mesa em tela cheia passa por cima dele).
    function menuFloor() {
      if (document.body.classList.contains('mesa-full')) return root.innerHeight;
      const bus = document.querySelector('.bus');
      const r = bus ? bus.getBoundingClientRect() : null;
      return r && r.height > 0 ? Math.min(r.top, root.innerHeight) : root.innerHeight;
    }

    function placeMenu(m, x, y, flipFrom = null) {
      const H = menuFloor();
      m.hidden = false;
      m.classList.add('is-open');
      m.style.maxHeight = `${Math.max(160, H - 16)}px`;
      m.style.left = '0px';
      m.style.top = '0px';
      const r = m.getBoundingClientRect();
      const W = root.innerWidth;
      let nx = x;
      let ny = y;
      if (nx + r.width > W - 8) nx = flipFrom != null ? flipFrom - r.width : W - 8 - r.width;
      if (ny + r.height > H - 8) ny = H - 8 - r.height;
      m.style.left = `${Math.max(8, nx)}px`;
      m.style.top = `${Math.max(8, ny)}px`;
    }

    function wireMenu(m, onLeft) {
      m.onclick = (e) => {
        const b = e.target.closest('.mesa-menu-row');
        if (!b) return;
        if (b.getAttribute('aria-disabled') === 'true') {
          toast(b.title || 'Indisponível agora.');
          return;
        }
        if (b.dataset.sub) {
          openSub(b, true);
          return;
        }
        if (b.dataset.add) {
          addWindow(b.dataset.add);
          return;
        }
        menuAction(b.dataset.act);
      };
      m.onkeydown = (e) => {
        const subAbertoPorHover = !S.subEl.hidden && document.activeElement?.dataset.sub;
        if (subAbertoPorHover && deveRedirecionarBusca(e.key, true, e)) {
          enviarTeclaParaBusca(e);
          return;
        }
        const rows = [...m.querySelectorAll('.mesa-menu-row')];
        const i = rows.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          rows[(i + 1) % rows.length]?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          rows[(i - 1 + rows.length) % rows.length]?.focus();
        } else if (e.key === 'Home') {
          e.preventDefault();
          rows[0]?.focus();
        } else if (e.key === 'End') {
          e.preventDefault();
          rows[rows.length - 1]?.focus();
        } else if (e.key === 'ArrowRight' && document.activeElement?.dataset.sub) {
          e.preventDefault();
          if (document.activeElement.getAttribute('aria-disabled') !== 'true') openSub(document.activeElement, true);
        } else if (e.key === 'ArrowLeft' && onLeft) {
          e.preventDefault();
          onLeft();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closeMenu();
        } else if (e.key === 'Tab') {
          closeMenu();
        }
      };
    }

    function menuAction(act) {
      const winId = S.menu?.winId;
      const { x = 0, y = 0 } = S.menu || {};
      closeMenu();
      if (act === 'fit') flyTo(V.fitAll(windows(), S.vw, S.vh, { safe: S.safe }));
      else if (act === 'volume' && winId) {
        const win = findWin(winId);
        if (win) deps.openTileMenu(deps.tileIdFor(tileKind(win), String(win.state?.peerId)), x, y);
      } else if (act === 'full' && winId) toggleFull(winId);
      else if (act === 'center' && winId) centerWin(winId);
      else if (act === 'remove' && winId) removeFromMesa(winId);
    }

    function closeSub() {
      S.subEl.hidden = true;
      S.subEl.classList.remove('is-open');
      S.subEl.textContent = '';
      const row0 = S.menuEl.querySelector('[data-sub]');
      row0?.classList.remove('is-open');
      row0?.setAttribute('aria-expanded', 'false');
    }

    /** Submenu "Adicionar janela": os grupos do registro, na ordem dele. */
    function openSub(rowEl, focus) {
      if (!S.menu) return;
      if (rowEl.getAttribute('aria-disabled') === 'true') return;
      rowEl.classList.add('is-open');
      rowEl.setAttribute('aria-expanded', 'true');
      const r = rowEl.getBoundingClientRect();
      openAddPanel(S.subEl, r.right + 4, r.top - 6, r.left - 4, focus);
    }

    function addMenuHtml() {
      const mods = registry()?.addable() || [];
      const locked = !canEdit();
      const full = windows().length >= M.MAX_WINDOWS;
      const out = [];
      for (const g of GROUP_ORDER) {
        const list = mods.filter((m) => m.group === g);
        if (!list.length) continue;
        out.push(`<p class="mesa-menu-head" role="presentation">${escapeHtml(GROUP_LABELS[g])}</p>`);
        for (const mod of list) {
          const reason = locked ? 'Só o líder mexe na Mesa agora.' : full ? 'A Mesa já tem 32 janelas.' : '';
          out.push(row(mod.title, { disabled: Boolean(reason), reason }).replace('<button ', `<button data-add="${escapeHtml(mod.type)}" `));
        }
      }
      if (!out.length) out.push('<p class="mesa-menu-head" role="presentation">Nenhuma janela disponível</p>');
      return out.join('');
    }

    function openAddPanel(panel, x, y, flipFrom, focus) {
      const state = {
        termo: '',
        grupo: 'tudo',
        recentes: readRecentes(),
        mods: registry()?.addable() || [],
        catalogo: G.mesaCatalogo,
      };
      panel.setAttribute('aria-label', 'Adicionar janela');
      panel.setAttribute('role', 'dialog');
      panel.style.setProperty('--mesa-add-max-h', `${Math.max(160, menuFloor() - 16)}px`);
      if (!state.catalogo) {
        panel.innerHTML = addMenuHtml();
        panel.classList.add('is-open');
        placeMenu(panel, x, y, flipFrom);
        wireMenu(panel, null);
        return;
      }
      panel.innerHTML = addPanelHtml(state);
      panel.classList.add('is-open');
      placeMenu(panel, x, y, flipFrom);
      wireAddPanel(panel, state);
      if (focus) root.requestAnimationFrame(() => panel.querySelector('[data-add-search]')?.focus());
    }

    function addPanelHtml(state) {
      const tabs = [['tudo', 'Tudo'], ...GROUP_ORDER.map((g) => [g, GROUP_LABELS[g]])];
      const tabHtml = tabs.map(([group, label]) => `<button type="button" class="seg__opt" role="tab"
        data-add-group="${group}" aria-selected="${group === state.grupo}">${label}</button>`).join('');
      return `<section class="mesa-add-panel">
        <header class="mesa-add-head"><h2>Adicionar janela</h2></header>
        <input class="input" data-add-search type="search" autocomplete="off" placeholder="Buscar janelas"
          aria-label="Buscar janelas">
        <p id="mesa-add-aviso" class="mesa-add-aviso" role="alert" hidden></p>
        <div class="seg mesa-add-tabs" role="tablist" aria-label="Grupo de janela">${tabHtml}</div>
        <div class="mesa-add-scroll" data-add-results></div>
      </section>`;
    }

    function wireAddPanel(panel, state) {
      const search = panel.querySelector('[data-add-search]');
      const render = () => renderAddCards(panel, state);
      // S.subEl e reutilizado em cada abertura; atribuicoes substituem os
      // handlers anteriores e impedem que um cartao adicione varias janelas.
      search.oninput = () => {
        state.termo = search.value;
        render();
      };
      panel.onclick = (e) => {
        const group = e.target.closest('[data-add-group]');
        if (group) {
          state.grupo = group.dataset.addGroup;
          panel.querySelectorAll('[data-add-group]').forEach((tab) => {
            tab.setAttribute('aria-selected', String(tab === group));
          });
          render();
          return;
        }
        if (e.target.closest('[data-add-clear]')) {
          state.termo = '';
          search.value = '';
          render();
          search.focus();
          return;
        }
        const card = e.target.closest('[data-add-card]');
        if (!card) return;
        if (card.getAttribute('aria-disabled') === 'true') {
          toast(panel.querySelector('#mesa-add-aviso')?.textContent || 'Indisponivel agora.');
          return;
        }
        rememberRecent(card.dataset.addCard);
        addWindow(card.dataset.addCard);
      };
      panel.onkeydown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closeMenu();
          return;
        }
        const focoNaGrade = Boolean(e.target.closest?.('[data-add-card]'));
        if (deveRedirecionarBusca(e.key, focoNaGrade, e)) {
          enviarTeclaParaBusca(e);
          return;
        }
        const cards = [...panel.querySelectorAll('[data-add-card]')];
        const i = cards.indexOf(document.activeElement);
        if (i < 0) return;
        const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1
          : e.key === 'ArrowUp' ? -2 : e.key === 'ArrowDown' ? 2 : 0;
        if (!delta) return;
        e.preventDefault();
        cards[Math.max(0, Math.min(cards.length - 1, i + delta))]?.focus();
      };
      render();
    }

    function deveRedirecionarBusca(tecla, focoNaGrade, e) {
      return !e.ctrlKey && !e.metaKey && !e.altKey
        && G.mesaCatalogo?.deveRedirecionarParaBusca(tecla, focoNaGrade);
    }

    function enviarTeclaParaBusca(e) {
      const search = S.subEl.querySelector('[data-add-search]');
      if (!search) return;
      e.preventDefault();
      search.focus();
      search.value += e.key;
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function renderAddCards(panel, state) {
      const result = panel.querySelector('[data-add-results]');
      const catalogo = state.catalogo;
      const filtered = catalogo?.filtrar ? catalogo.filtrar(state.mods, state.termo, state.grupo) : state.mods;
      const reason = !canEdit() ? 'Só o líder mexe na Mesa agora.'
        : windows().length >= M.MAX_WINDOWS ? 'A Mesa já tem 32 janelas.' : '';
      const aviso = panel.querySelector('#mesa-add-aviso');
      aviso.hidden = !reason;
      aviso.textContent = reason;
      if (!filtered.length) {
        result.innerHTML = `<p class="mesa-add-empty">Nada com “${escapeHtml(state.termo)}”.
          <button class="btn btn--quiet btn--sm" type="button" data-add-clear>Ver tudo</button></p>`;
        return;
      }
      const card = (mod) => {
        const meta = catalogo?.itens?.[mod.type] || {};
        return `<button class="mesa-add-card" type="button" data-add-card="${escapeHtml(mod.type)}"
          ${reason ? `aria-disabled="true" aria-describedby="mesa-add-aviso"` : ''}>
          <svg aria-hidden="true"><use href="#${escapeHtml(meta.icone || 'i-app-window')}"></use></svg>
          <span><b>${escapeHtml(mod.title)}</b><small>${escapeHtml(meta.desc || mod.title)}</small></span>
        </button>`;
      };
      const sections = [];
      if (!state.termo && state.grupo === 'tudo') {
        const recentes = state.recentes.map((type) => state.mods.find((mod) => mod.type === type)).filter(Boolean);
        if (recentes.length) sections.push(`<h3>Recentes</h3><div class="mesa-add-grid">${recentes.map(card).join('')}</div>`);
      }
      if (state.grupo === 'tudo') {
        for (const group of GROUP_ORDER) {
          const list = filtered.filter((mod) => mod.group === group);
          if (list.length) sections.push(`<h3>${GROUP_LABELS[group]}</h3><div class="mesa-add-grid">${list.map(card).join('')}</div>`);
        }
      } else {
        sections.push(`<div class="mesa-add-grid">${filtered.map(card).join('')}</div>`);
      }
      result.innerHTML = sections.join('');
    }

    function readRecentes() {
      try {
        const saved = JSON.parse(root.localStorage.getItem('golive.mesa.recentes') || '[]');
        return Array.isArray(saved) ? saved.filter((type) => typeof type === 'string').slice(0, 4) : [];
      } catch (err) {
        console.warn('[mesa] nao deu para ler recentes:', err);
        return [];
      }
    }

    function rememberRecent(type) {
      try {
        const list = G.mesaCatalogo?.lembrarRecente?.(readRecentes(), type) || [type];
        root.localStorage.setItem('golive.mesa.recentes', JSON.stringify(list));
      } catch (err) {
        console.warn('[mesa] nao deu para guardar recente:', err);
      }
    }

    /** O + do dock: o mesmo submenu, e a janela nasce no meio da vista. */
    function openAddMenu(anchor) {
      if (!S) return;
      closeMenu();
      S.menu = { winId: null, at: null, returnFocus: anchor || document.activeElement, dock: true };
      const r = anchor ? anchor.getBoundingClientRect() : { left: root.innerWidth / 2, top: root.innerHeight - 80 };
      const floor = Math.min(r.top, menuFloor());
      openAddPanel(S.subEl, r.left, floor - 440, null, true);
    }

    function addWindow(type) {
      const at = S.menu?.at || null;
      closeMenu();
      const mod = modOf(type);
      if (!mod) return;
      if (!canEdit()) {
        toast('Só o líder mexe na Mesa agora.');
        return;
      }
      const { w, h } = mod.size;
      // Pelo botao direito a janela nasce com o canto no ponto do clique;
      // pelo + (ou teclado), no meio da vista.
      const c = V.viewCenter(S.view, S.vw, S.vh, S.safe);
      const want = at ? { x: at.x, y: at.y, w, h } : { x: c.x - w / 2, y: c.y - h / 2, w, h };
      const rect = M.nearestFree(windows(), want, { gap: M.GAP });
      if (!rect) {
        toast('Não há lugar livre na Mesa para esta janela.');
        return;
      }
      S.focusAfterAdd = true;
      S.pendingAdd = type;
      deps.send({ type: 'mesa', op: 'add', win: { type, ...rect } });
    }

    // ------------------------------------------------------------------
    // Ponteiros das pessoas
    // ------------------------------------------------------------------

    function onPointerMove(e) {
      if (!S.state) return;
      const p = worldPoint(e);
      const pt = M.normCursor(p);
      if (!pt) return;
      if (cursorSobreJanelaPrivada(pt, e.target)) return;
      S.pendingCursor = pt;
      const t = now();
      if (M.shouldEmit(S.lastCursorAt, t)) {
        S.lastCursorAt = t;
        S.pendingCursor = null;
        deps.send({ type: 'cursor', ...pt });
      } else if (!S.cursorTimer) {
        // O ultimo ponto sempre sai (senao o ponteiro para antes do fim).
        S.cursorTimer = root.setTimeout(() => {
          if (!S) return;
          S.cursorTimer = 0;
          if (S.pendingCursor) {
            S.lastCursorAt = now();
            deps.send({ type: 'cursor', ...S.pendingCursor });
            S.pendingCursor = null;
          }
        }, 1000 / M.EMIT_HZ);
      }
    }

    function onCursor(msg) {
      const pt = M.normCursor(msg);
      if (!pt || msg.from == null) return;
      S.pointers.apply(String(msg.from), pt, Date.now());
      scheduleCursors();
      scheduleMap();
    }

    function scheduleCursors() {
      if (!S || S.cursorFrame) return;
      S.cursorFrame = frame(() => {
        S.cursorFrame = 0;
        renderCursors();
      });
    }

    function renderCursors() {
      const t = Date.now();
      const active = showCursors ? S.pointers.active(t) : [];
      const seen = new Set();
      S.cursorEls = S.cursorEls || new Map();
      for (const c of active) {
        seen.add(c.from);
        let el = S.cursorEls.get(c.from);
        if (!el) {
          el = document.createElement('div');
          el.className = 'mesa-cursor';
          el.innerHTML = `${ICON.arrow}<span class="mesa-cursor-name"></span>`;
          S.over.appendChild(el);
          S.cursorEls.set(c.from, el);
        }
        el.style.setProperty('--who', deps.colorFor(c.from));
        el.querySelector('.mesa-cursor-name').textContent = deps.nameOf(c.from);
        const s = V.toScreen(S.view, c.x, c.y);
        el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`;
      }
      for (const [from, el] of [...S.cursorEls]) {
        if (!seen.has(from)) {
          el.remove();
          S.cursorEls.delete(from);
        }
      }
      // Some em 1 s parado: confere de novo quando o mais velho vencer.
      root.clearTimeout(S.cursorTtl);
      if (active.length) {
        const oldest = Math.max(...active.map((c) => c.age));
        S.cursorTtl = later(() => {
          scheduleCursors();
          scheduleMap();
        }, Math.max(30, M.CURSOR_TTL_MS - oldest + 10));
      }
    }

    function setShowCursors(on) {
      showCursors = Boolean(on);
      if (S) {
        scheduleCursors();
        scheduleMap();
      }
    }

    // ------------------------------------------------------------------
    // Mapa e pessoas
    // ------------------------------------------------------------------

    function scheduleMap() {
      if (!S || S.mapFrame) return;
      S.mapFrame = frame(() => {
        S.mapFrame = 0;
        renderMap();
      });
    }

    function renderMap() {
      if (!S.mapOpen) return;
      const mw = S.mapEl.clientWidth || 192;
      const mh = S.mapEl.clientHeight || 120;
      const s = V.minimapScale(mw, mh);
      const parts = [];
      for (const w of windows()) {
        const r = rectOf(w);
        parts.push(`<i class="${w.type === 'tela' ? 'is-live' : ''}" style="transform:translate(${(r.x * s).toFixed(1)}px,${(r.y * s).toFixed(1)}px);width:${Math.max(3, r.w * s).toFixed(1)}px;height:${Math.max(3, r.h * s).toFixed(1)}px"></i>`);
      }
      if (showCursors) {
        for (const c of S.pointers.active(Date.now())) {
          parts.push(`<b style="transform:translate(${(c.x * s).toFixed(1)}px,${(c.y * s).toFixed(1)}px);--who:${escapeHtml(deps.colorFor(c.from))}"></b>`);
        }
      }
      const vr = V.visibleRect(S.view, S.vw, S.vh);
      parts.push(`<u style="transform:translate(${(vr.x * s).toFixed(1)}px,${(vr.y * s).toFixed(1)}px);width:${(vr.w * s).toFixed(1)}px;height:${(vr.h * s).toFixed(1)}px"></u>`);
      S.mapEl.innerHTML = parts.join('');
    }

    function onMapDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const r = S.mapEl.getBoundingClientRect();
      const p = V.fromMinimap(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
      flyTo(V.centerOn(p.x, p.y, S.view.z, S.vw, S.vh, { safe: S.safe }));
    }

    /** Avatares de quem esta na Mesa: "Ir ate Bia" voa ate o ponteiro. */
    function renderPeople() {
      const me = String(deps.me());
      const ids = (deps.viewers?.() || []).map(String).filter((id) => id !== me);
      const peopleEl = deps.peopleSlot?.() || S?.peopleEl;
      if (!peopleEl) return;
      peopleEl.hidden = ids.length === 0;
      const visiveis = ids.slice(0, 5);
      const restantes = ids.slice(5);
      peopleEl.innerHTML = visiveis.map((id) => {
        const nome = deps.nameOf(id);
        const acao = `Ir até ${nome}`;
        return `<button type="button" class="mesa-person node" data-size="16" data-id="${escapeHtml(id)}"
          aria-label="${escapeHtml(acao)}" title="${escapeHtml(acao)}">${avatarHtml(id)}</button>`;
      }).join('');
      if (restantes.length) {
        const nomes = restantes.map((id) => deps.nameOf(id)).join(', ');
        const mais = `<span class="mesa-person-more cluster__more" title="${escapeHtml(nomes)}">+${restantes.length}</span>`;
        peopleEl.insertAdjacentHTML('beforeend', mais);
      }
      for (const b of peopleEl.querySelectorAll('.mesa-person')) {
        b.style.setProperty('--who', deps.colorFor(b.dataset.id));
        b.addEventListener('click', (event) => {
          event.stopPropagation();
          if (S) goTo(b.dataset.id);
        });
      }
    }

    function goTo(id) {
      const p = S.pointers.active(Date.now(), 60000).find((c) => c.from === String(id));
      if (!p) {
        toast(`${deps.nameOf(id)} ainda não mexeu o ponteiro na Mesa.`, id);
        return;
      }
      flyTo(V.centerOn(p.x, p.y, S.view.z, S.vw, S.vh, { safe: S.safe }));
    }

    function onPeersChange() {
      if (!S) return;
      renderPeople();
      const alive = new Set((deps.peers() || []).map((p) => String(p.id)));
      for (const c of S.pointers.active(Date.now(), 1e12)) {
        if (!alive.has(c.from)) S.pointers.drop(c.from);
      }
      for (const [id, rec] of S.wins) {
        const win = findWin(id);
        if (win) syncControls(rec, win);
      }
      scheduleCursors();
      scheduleMap();
    }

    // ------------------------------------------------------------------
    // Desempenho: tela fora da vista nao recebe video
    // ------------------------------------------------------------------

    function scheduleWatch() {
      if (!S || S.watchFrame) return;
      S.watchFrame = frame(() => {
        S.watchFrame = 0;
        evaluateWatch();
      });
    }

    function evaluateWatch() {
      const t = Date.now();
      let changed = false;
      const dpr = root.devicePixelRatio || 1;
      for (const w of windows()) {
        if (!isMedia(w)) continue;
        let seen;
        if (S.fullId) {
          seen = S.fullId === w.id ? { ok: true, widthPx: Math.round(S.vw) } : { ok: false, widthPx: 0 };
        } else {
          seen = V.watchable(S.view, S.vw, S.vh, rectOf(w));
        }
        if (S.tracker.see(w.id, seen.ok, t)) changed = true;
        // Teto de qualidade: so muda o que vai na rede quando a largura
        // cruza um degrau de 64 px (andar 1 px nao reconfigura encoder).
        const px = seen.ok ? Math.ceil((seen.widthPx * dpr) / 64) * 64 : null;
        if (S.widths.get(w.id) !== px) {
          S.widths.set(w.id, px);
          changed = true;
        }
      }
      root.clearTimeout(S.watchTimer);
      const next = S.tracker.nextDeadline(t);
      if (next != null) S.watchTimer = root.setTimeout(() => S && evaluateWatch(), next + 20);
      if (changed) deps.onWatchChange?.();
    }

    function mediaWin(kind, peerId) {
      const type = kind === 'camera' ? 'camera' : 'tela';
      return windows().find((w) => w.type === type && String(w.state?.peerId) === String(peerId)) || null;
    }

    /** Clique numa fonte do barramento: centraliza a janela da tela/camera de `peerId`. Sem a janela (alguem a
     * fechou; so o servidor poe tela e camera na Mesa), avisa. Devolve se centralizou. */
    function focusMedia(kind, peerId) {
      if (!S?.state) return false; // o retrato ainda nao chegou: nao da para dizer que a janela nao existe
      const win = mediaWin(kind, peerId);
      if (!win) {
        toast(`${kind === 'camera' ? 'A câmera' : 'A tela'} de ${deps.nameOf(peerId)} não está na Mesa.`);
        return false;
      }
      S.viewTouched = true; // a pessoa escolheu para onde olhar: telas novas nao a tiram dali
      centerWin(win.id);
      return true;
    }

    /** Na Mesa, quero o video desta tela/camera? `null` fora da Mesa (vale
     * a regra da Transmissao). */
    function wants(kind, peerId) {
      if (!S || !S.state) return null;
      const w = mediaWin(kind, peerId);
      return w ? S.tracker.wanted(w.id) : false;
    }

    /** Largura em pixels da janela na tela (teto de qualidade) ou null. */
    function widthFor(kind, peerId) {
      if (!S || !S.state) return null;
      const w = mediaWin(kind, peerId);
      return w ? S.widths.get(w.id) ?? null : null;
    }

    /** Onde uma janela nova do tipo nasce: no lugar livre mais perto do
     * meio da minha vista ("Pôr na mesa" do chat). null sem o retrato. */
    function spot(type) {
      const mod = modOf(type);
      if (!S?.state || !mod) return null;
      const c = V.viewCenter(S.view, S.vw, S.vh, S.safe);
      const { w, h } = mod.size;
      return M.nearestFree(windows(), { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h }, { gap: M.GAP });
    }

    // ------------------------------------------------------------------
    // Relogio do servidor (mensagem `time`)
    // ------------------------------------------------------------------

    function startTimeSync() {
      if (!S) return;
      root.clearTimeout(S.time.timer);
      S.time.samples = [];
      pingTime();
    }

    function pingTime() {
      if (!S) return;
      const t0 = now();
      S.time.waiting = t0;
      deps.send({ type: 'time', t0 });
      // Sem resposta em 2 s (servidor antigo, socket caindo): segue sem.
      S.time.timer = root.setTimeout(() => {
        if (S) finishTime();
      }, 2000);
    }

    function onTime(msg) {
      if (typeof msg.t0 !== 'number' || typeof msg.server !== 'number') return;
      root.clearTimeout(S.time.timer);
      S.time.samples.push({ t0: msg.t0, t1: now(), server: msg.server });
      if (S.time.samples.length < TIME_SAMPLES) pingTime();
      else finishTime();
    }

    function finishTime() {
      const best = V.clockOffset(S.time.samples);
      if (best) S.time.offset = best.offset;
      S.time.samples = [];
      root.clearTimeout(S.time.timer);
      S.time.timer = root.setTimeout(() => S && startTimeSync(), TIME_EVERY_MS);
    }

    /** Hora do servidor estimada (epoch ms). Sem medida ainda, a local. */
    function serverNow() {
      if (S && S.time.offset != null) return Math.round(now() + S.time.offset);
      return Date.now();
    }

    // ------------------------------------------------------------------
    // Avisos
    // ------------------------------------------------------------------

    /** O aviso da Mesa usa o mesmo #toast global da Sala. */
    function toast(text) {
      if (!S) return;
      const globalToast = document.getElementById('toast');
      const globalText = document.getElementById('toast-text');
      if (globalToast && globalText) {
        globalText.textContent = text;
        globalToast.classList.remove('hidden');
        root.clearTimeout(S.toastTimer);
        S.toastTimer = later(() => globalToast.classList.add('hidden'), 5000);
      }
      S.liveEl.textContent = '';
      S.liveEl.textContent = text;
    }

    function announce(text) {
      toast(text);
    }

    function onViewers() {
      renderPeople();
      syncAnnotateToNewViewers();
    }

    /** Quem ja tem uma janela de rabisco montada manda o proprio retrato
     * pra quem ACABOU de entrar na vista Mesa (contrato, secao 10,
     * "Quadro") -- o mesmo papel que 'peer-joined' tem pro rabisco sobre
     * tela (app.js), so que aqui o gatilho e 'mesa-viewers' (so quem esta
     * na Mesa importa). So para ids NOVOS na lista, senao toda saida de
     * outra pessoa reenviaria o retrato de novo pra todo mundo. */
    function syncAnnotateToNewViewers() {
      if (!S) {
        lastAnnotateViewers = new Set();
        return;
      }
      const me = String(deps.me());
      const ids = (deps.viewers?.() || []).map(String);
      const novos = ids.filter((id) => id !== me && !lastAnnotateViewers.has(id));
      lastAnnotateViewers = new Set(ids);
      if (!novos.length) return;
      for (const [wid, rec] of S.wins) {
        if (rec.kind !== 'janela' || !rec.inst || typeof rec.inst.annotateSnapshot !== 'function') continue;
        let items;
        try {
          items = rec.inst.annotateSnapshot();
        } catch {
          items = null;
        }
        if (!Array.isArray(items) || !items.length) continue;
        for (const id of novos) deps.send({ type: 'annotate-sync', to: id, surface: `mesa:${wid}`, items });
      }
    }

    return {
      open,
      close,
      isOpen,
      afterWelcome,
      handle,
      handleAnnotate,
      handleAnnotateSync,
      onFullScreenChange,
      onTile,
      onPeersChange,
      onViewers,
      onLeaderChange: () => {
        if (!S) return;
        applyLocks();
        emitLocks();
      },
      locks,
      setLock,
      setShowCursors,
      showsCursors: () => showCursors,
      openAddMenu,
      wants,
      focusMedia,
      widthFor,
      spot,
      serverNow,
    };
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaView = { create };
})(window);
