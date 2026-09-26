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
    locked: 'Só o líder mexe na mesa agora.',
    'size-locked': 'O líder travou o tamanho das janelas.',
    'leader-only': 'Só o líder da sala muda isso.',
    'not-yours': 'Só a própria pessoa ou o líder tira esta tela da mesa.',
    full: 'A mesa já tem 32 janelas.',
    'no-space': 'Não há lugar livre na mesa para esta janela.',
    'too-small': 'A janela ficaria pequena demais.',
    'too-big': 'A janela ficaria grande demais.',
    'bad-rect': 'Não deu para pôr a janela ali.',
    'unknown-type': 'Esta sala não conhece este tipo de janela.',
    auto: 'Telas e câmeras entram na mesa sozinhas.',
    'no-act': 'Esta janela não tem ação.',
    'state-too-big': 'A janela ficou cheia demais.',
    invalid: 'Não deu para fazer isso agora.',
    error: 'Não deu para fazer isso agora.',
    'bad-request': 'Não deu para fazer isso agora.',
  };

  const ICON = {
    fs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    fsExit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
    chev: '<svg class="mesa-menu-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    here: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 2l7 19 2.6-8.1L21 10z"/></svg>',
  };

  const TIME_SAMPLES = 5;
  const TIME_EVERY_MS = 60000;
  const TOAST_MS = 2600;

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
      S = null;
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
        <p id="mesa-help" class="visually-hidden">Arraste o fundo ou use as setas para andar. Roda do mouse, + e - aproximam; 0 mostra tudo. Botão direito, tecla de menu ou Shift+F10 abrem o menu para adicionar uma janela. Numa janela: setas movem, Alt+setas mudam o tamanho, F põe em tela cheia, Delete tira da mesa.</p>
        <div class="mesa-grid" aria-hidden="true"></div>
        <div class="mesa-world"><div class="mesa-edge" aria-hidden="true"></div></div>
        <div class="mesa-over" aria-hidden="true"></div>
        <p class="mesa-empty" hidden><b>A mesa está vazia.</b> Clique com o botão direito para adicionar uma janela.</p>
        <p class="mesa-loading" role="status">Abrindo a mesa…</p>
        <div class="mesa-people" role="group" aria-label="Quem está na mesa"></div>
        <div class="mesa-nav">
          <p class="mesa-lock-note" hidden></p>
          <div class="mesa-map" role="button" tabindex="0" aria-label="Mapa da mesa: clique para ir até um ponto; Enter mostra tudo"></div>
          <div class="mesa-zoom" role="group" aria-label="Aproximação">
            <button type="button" class="mesa-zoom-btn" data-zoom="out" aria-label="Afastar" title="Afastar (-)">${ICON.minus}</button>
            <output class="mesa-zoom-val" aria-live="off">100%</output>
            <button type="button" class="mesa-zoom-btn" data-zoom="in" aria-label="Aproximar" title="Aproximar (+)">${ICON.plus}</button>
            <button type="button" class="mesa-zoom-btn" data-zoom="fit" aria-label="Ver tudo" title="Ver tudo (0)">${ICON.fs}</button>
          </div>
        </div>
        <div class="mesa-toast" aria-hidden="true"><span class="mesa-toast-dot"></span><span class="mesa-toast-text"></span></div>
        <p class="visually-hidden mesa-live" aria-live="polite"></p>
        <div class="mesa-menu" role="menu" hidden></div>
        <div class="mesa-menu" role="menu" hidden></div>`;
      const q = (sel) => sec.querySelector(sel);
      S.section = sec;
      S.gridBg = q('.mesa-grid');
      S.world = q('.mesa-world');
      S.over = q('.mesa-over');
      S.emptyEl = q('.mesa-empty');
      S.loadingEl = q('.mesa-loading');
      S.peopleEl = q('.mesa-people');
      S.mapEl = q('.mesa-map');
      S.zoomVal = q('.mesa-zoom-val');
      S.lockNote = q('.mesa-lock-note');
      S.toastEl = q('.mesa-toast');
      S.liveEl = q('.mesa-live');
      [S.menuEl, S.subEl] = sec.querySelectorAll('.mesa-menu');
      const edge = q('.mesa-edge');
      edge.style.width = `${V.WORLD.w}px`;
      edge.style.height = `${V.WORLD.h}px`;

      deps.grid.after(sec);
      measure();
      S.view = V.centerOn(V.WORLD.w / 2, V.WORLD.h / 2, 1, S.vw, S.vh);
      applyView();
      wire();
      renderPeople();
    }

    function measure() {
      S.vw = S.section.clientWidth || 1;
      S.vh = S.section.clientHeight || 1;
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
      listen(S.mapEl, 'keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          flyTo(V.fitAll(windows(), S.vw, S.vh));
        }
      });
      for (const b of sec.querySelectorAll('.mesa-zoom-btn')) {
        listen(b, 'click', () => {
          const k = b.dataset.zoom;
          if (k === 'fit') flyTo(V.fitAll(windows(), S.vw, S.vh));
          else setView(V.zoomStep(S.view, k === 'in' ? 1 : -1, S.vw, S.vh));
        });
      }
      listen(document, 'pointerdown', (e) => {
        if (S.menu && !e.target.closest?.('.mesa-menu') && !e.target.closest?.('[data-mesa-add]')) closeMenu();
      }, true);
      listen(document, 'keydown', (e) => {
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
        || t.classList?.contains('mesa-edge') || t.classList?.contains('mesa-empty');
    }

    function onBackgroundDown(e) {
      if (e.button !== 0 || !isBackground(e.target)) return;
      e.preventDefault();
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
      if (first && !S.fitted) {
        S.fitted = true;
        setView(V.fitAll(windows(), S.vw, S.vh), { quiet: true });
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
          if (mine) S.pendingAdd = null;
          if (mine && S.focusAfterAdd && rec) {
            S.focusAfterAdd = false;
            rec.el.focus({ preventScroll: true });
          }
          if (!mine) {
            // Tela e camera entram sozinhas (a pessoa foi ao vivo): nao e
            // alguem "pondo" a janela.
            const auto = msg.win && isMedia(msg.win) && String(msg.win.state?.peerId) === String(msg.by);
            announce(auto ? `${labelOf(msg.win)} entrou na mesa` : `${deps.nameOf(msg.by)} pôs ${titleOf(msg.win)} na mesa`, msg.by);
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
            if (media && String(old.state?.peerId) === String(msg.by)) announce(`${titleOf(old)} saiu da mesa`, msg.by);
            else announce(`${deps.nameOf(msg.by)} tirou ${titleOf(old)} da mesa`, msg.by);
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
        case 'act': {
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
            announce(lo ? `${deps.nameOf(msg.by)} travou a mesa: só o líder mexe` : 'A mesa está liberada para todo mundo mexer', msg.by);
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
      if (win.type === 'tela' || win.type === 'camera') {
        return String(win.state?.peerId) === String(deps.me()) || deps.isLeader();
      }
      return true;
    }

    function lockReason() {
      if (!canEdit()) return 'Só o líder mexe na mesa agora.';
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
    function setLock(name, value) {
      if (!S || !['leaderOnly', 'lockSize'].includes(name)) return;
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
      S.emptyEl.hidden = list.length > 0 || !S.state;
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
        <div class="mesa-win-body"></div>
        ${media ? '' : '<div class="mesa-handle" aria-hidden="true"></div>'}
        ${media ? '<p class="mesa-win-label"><span class="mesa-win-name"></span></p>' : ''}
        <span class="mesa-moving" hidden></span>
        <div class="mesa-ctrls">
          <span class="mesa-avatar"></span>
          <button type="button" class="mesa-ctrl" data-act="full" aria-label="Tela cheia" title="Tela cheia (F)">${ICON.fs}</button>
          <button type="button" class="mesa-ctrl" data-act="remove" aria-label="Tirar da mesa" title="Tirar da mesa (Delete)">${ICON.x}</button>
        </div>
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
        const w = findWin(rec.id);
        // So o foco do teclado: clicar numa janela meio de fora nao voa.
        if (!w || S.fullId || S.drag || !el.matches(':focus-visible')) return;
        const seen = V.watchable(S.view, S.vw, S.vh, rectOf(w), { minPx: 1 });
        const s2 = V.screenRect(S.view, rectOf(w));
        const inteira = s2.x >= 0 && s2.y >= 0 && s2.x + s2.w <= S.vw && s2.y + s2.h <= S.vh;
        if (!seen.onScreen || !inteira) flyTo(V.centerOn(w.x + w.w / 2, w.y + w.h / 2, S.view.z, S.vw, S.vh));
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
      const av = rec.el.querySelector('.mesa-avatar');
      const avKey = owner || '';
      if (av.dataset.key !== avKey) {
        av.dataset.key = avKey;
        av.innerHTML = owner ? avatarHtml(owner) : '';
        av.hidden = !owner;
        av.title = owner ? `Pôs na mesa: ${deps.nameOf(owner)}` : '';
        if (owner) av.style.setProperty('--who', deps.colorFor(owner));
      }
      rec.el.querySelector('[data-act="remove"]').hidden = !canRemove(win);
      if (isMedia(win)) {
        const name = rec.el.querySelector('.mesa-win-name');
        if (name) name.textContent = label;
        const labelEl = rec.el.querySelector('.mesa-win-label');
        const live = win.type === 'tela';
        let pill = labelEl.querySelector('.mesa-live-pill');
        if (live && !pill) {
          pill = document.createElement('span');
          pill.className = 'mesa-live-pill';
          pill.textContent = 'AO VIVO';
          labelEl.prepend(pill);
        } else if (!live && pill) pill.remove();
        adoptTile(rec, win);
      }
      renderGrab(rec.id);
    }

    function avatarHtml(id) {
      const url = deps.avatarOf?.(id);
      if (url) return `<img src="${escapeHtml(url)}" alt="" />`;
      const initial = (deps.nameOf(id) || '?').trim().charAt(0).toUpperCase() || '?';
      return `<span class="mesa-avatar-initial">${escapeHtml(initial)}</span>`;
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
        onDenied(fn) {
          if (typeof fn !== 'function') return () => {};
          rec.denied.add(fn);
          return () => rec.denied.delete(fn);
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
        rec.placeholder.innerHTML = `<span class="mesa-avatar mesa-wait-avatar">${avatarHtml(pid)}</span><span class="mesa-wait-text">${escapeHtml(win.type === 'tela' ? 'Esperando a tela chegar…' : 'Esperando a câmera chegar…')}</span>`;
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
      if (e.target.closest('.mesa-ctrls, .mesa-resize')) return;
      const win = findWin(rec.id);
      if (!win || S.fullId) return;
      const media = isMedia(win);
      const onHandle = Boolean(e.target.closest('.mesa-handle'));
      // Janela de video: arrasta por qualquer ponto. Janela com conteudo:
      // so pela alca (clicar no tabuleiro nao pode mover a janela).
      if (!media && !onHandle) return;
      // Controles do tile (volume, rabisco) continuam do tile.
      if (media && e.target.closest('button, input, select, textarea, a, .tile-annot-bar, .tile-react-bar')) return;
      if (!canEdit()) {
        toast('Só o líder mexe na mesa agora.');
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
        flyTo(V.fitAll(windows(), S.vw, S.vh));
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
      if (!canRemove(win)) {
        toast(!canEdit() ? 'Só o líder mexe na mesa agora.' : 'Só a própria pessoa ou o líder tira esta tela da mesa.');
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
      if (win) flyTo(V.focusRect(win, S.vw, S.vh));
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
      b.title = on ? 'Sair da tela cheia (Esc)' : 'Tela cheia (F)';
    }

    function onDoubleClick(e) {
      const winEl = e.target.closest?.('.mesa-win');
      if (!winEl) return;
      e.stopPropagation();
      e.preventDefault();
      const win = findWin(winEl.dataset.id);
      if (win && (isMedia(win) || e.target.closest('.mesa-handle'))) toggleFull(win.id);
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

    function closeMenu() {
      if (!S?.menu) return;
      const back = S.menu.returnFocus;
      const hadFocus = S.menuEl.contains(document.activeElement) || S.subEl.contains(document.activeElement);
      S.menu = null;
      S.menuEl.hidden = true;
      S.subEl.hidden = true;
      S.menuEl.textContent = '';
      S.subEl.textContent = '';
      // O foco so volta se estava no menu (clicar fora ja o levou a outro
      // lugar, e ali ele fica).
      if (hadFocus && back && back.isConnected) back.focus?.({ preventScroll: true });
    }

    function row(label, { act, sub, kbd, small, danger, disabled, reason } = {}) {
      const attrs = [
        'type="button"', 'role="menuitem"', 'class="mesa-menu-row' + (danger ? ' is-danger' : '') + '"',
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
          row('Centralizar na tela', { act: 'center' }),
          volume ? row('Volume e silenciar…', { act: 'volume' }) : '',
          '<hr class="mesa-menu-sep">',
          row('Tirar da mesa', { act: 'remove', kbd: 'Del', danger: true, disabled: !removable, reason: removable ? '' : (!canEdit() ? 'Só o líder mexe na mesa agora.' : 'Só a própria pessoa ou o líder tira esta tela.') }),
        ].join('');
      } else {
        const locked = !canEdit();
        m.innerHTML = [
          row('Adicionar janela', { sub: true, disabled: locked, reason: locked ? 'Só o líder mexe na mesa agora.' : '' }),
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
        addRow?.addEventListener('pointerenter', () => openSub(addRow, false));
        m.querySelector('[data-act="fit"]')?.addEventListener('pointerenter', () => closeSub());
      }
    }

    function placeMenu(m, x, y, flipFrom = null) {
      m.hidden = false;
      m.style.left = '0px';
      m.style.top = '0px';
      const r = m.getBoundingClientRect();
      const W = root.innerWidth;
      const H = root.innerHeight;
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
      if (act === 'fit') flyTo(V.fitAll(windows(), S.vw, S.vh));
      else if (act === 'volume' && winId) {
        const win = findWin(winId);
        if (win) deps.openTileMenu(deps.tileIdFor(tileKind(win), String(win.state?.peerId)), x, y);
      } else if (act === 'full' && winId) toggleFull(winId);
      else if (act === 'center' && winId) centerWin(winId);
      else if (act === 'remove' && winId) removeFromMesa(winId);
    }

    function closeSub() {
      S.subEl.hidden = true;
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
      const sub = S.subEl;
      sub.innerHTML = addMenuHtml();
      sub.setAttribute('aria-label', 'Adicionar janela');
      const r = rowEl.getBoundingClientRect();
      placeMenu(sub, r.right + 4, r.top - 6, r.left - 4);
      wireMenu(sub, () => {
        closeSub();
        rowEl.focus();
      });
      if (focus) sub.querySelector('.mesa-menu-row')?.focus({ preventScroll: true });
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
          const reason = locked ? 'Só o líder mexe na mesa agora.' : full ? 'A mesa já tem 32 janelas.' : '';
          out.push(row(mod.title, { disabled: Boolean(reason), reason }).replace('<button ', `<button data-add="${escapeHtml(mod.type)}" `));
        }
      }
      if (!out.length) out.push('<p class="mesa-menu-head" role="presentation">Nenhuma janela disponível</p>');
      return out.join('');
    }

    /** O + do dock: o mesmo submenu, e a janela nasce no meio da vista. */
    function openAddMenu(anchor) {
      if (!S) return;
      closeMenu();
      S.menu = { winId: null, at: null, returnFocus: anchor || document.activeElement, dock: true };
      const sub = S.subEl;
      sub.innerHTML = addMenuHtml();
      sub.setAttribute('aria-label', 'Adicionar janela');
      const r = anchor ? anchor.getBoundingClientRect() : { left: root.innerWidth / 2, top: root.innerHeight - 80 };
      sub.hidden = false;
      sub.style.left = '0px';
      sub.style.top = '0px';
      const h = sub.getBoundingClientRect().height;
      placeMenu(sub, r.left, r.top - h - 8);
      wireMenu(sub, null);
      sub.querySelector('.mesa-menu-row')?.focus({ preventScroll: true });
    }

    function addWindow(type) {
      const at = S.menu?.at || null;
      closeMenu();
      const mod = modOf(type);
      if (!mod) return;
      if (!canEdit()) {
        toast('Só o líder mexe na mesa agora.');
        return;
      }
      const { w, h } = mod.size;
      // Pelo botao direito a janela nasce com o canto no ponto do clique;
      // pelo + (ou teclado), no meio da vista.
      const c = V.viewCenter(S.view, S.vw, S.vh);
      const want = at ? { x: at.x, y: at.y, w, h } : { x: c.x - w / 2, y: c.y - h / 2, w, h };
      const rect = M.nearestFree(windows(), want, { gap: M.GAP });
      if (!rect) {
        toast('Não há lugar livre na mesa para esta janela.');
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
      flyTo(V.centerOn(p.x, p.y, S.view.z, S.vw, S.vh));
    }

    /** Avatares de quem esta na Mesa: "Ir ate Bia" voa ate o ponteiro. */
    function renderPeople() {
      if (!S) return;
      const me = String(deps.me());
      const ids = (deps.viewers?.() || []).map(String).filter((id) => id !== me);
      S.peopleEl.innerHTML = ids.map((id) => `<button type="button" class="mesa-avatar mesa-person" data-id="${escapeHtml(id)}" aria-label="Ir até ${escapeHtml(deps.nameOf(id))}" title="Ir até ${escapeHtml(deps.nameOf(id))}">${avatarHtml(id)}</button>`).join('');
      for (const b of S.peopleEl.querySelectorAll('.mesa-person')) {
        b.style.setProperty('--who', deps.colorFor(b.dataset.id));
        b.addEventListener('click', () => goTo(b.dataset.id));
      }
    }

    function goTo(id) {
      const p = S.pointers.active(Date.now(), 60000).find((c) => c.from === String(id));
      if (!p) {
        toast(`${deps.nameOf(id)} ainda não mexeu o ponteiro na mesa.`, id);
        return;
      }
      flyTo(V.centerOn(p.x, p.y, S.view.z, S.vw, S.vh));
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
      const c = V.viewCenter(S.view, S.vw, S.vh);
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

    /** Aviso curto no topo da mesa, tambem anunciado com educacao. */
    function toast(text, who = null) {
      if (!S) return;
      S.toastEl.querySelector('.mesa-toast-text').textContent = text;
      const dot = S.toastEl.querySelector('.mesa-toast-dot');
      dot.hidden = who == null;
      if (who != null) dot.style.setProperty('--who', deps.colorFor(who));
      S.toastEl.classList.add('is-shown');
      root.clearTimeout(S.toastTimer);
      S.toastTimer = later(() => S?.toastEl.classList.remove('is-shown'), TOAST_MS);
      S.liveEl.textContent = '';
      S.liveEl.textContent = text;
    }

    function announce(text, who) {
      toast(text, who);
    }

    function onViewers() {
      renderPeople();
    }

    return {
      open,
      close,
      isOpen,
      afterWelcome,
      handle,
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
      widthFor,
      spot,
      serverNow,
    };
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaView = { create };
})(window);
