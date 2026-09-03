// src/renderer/ui.js
'use strict';

(function (root) {
  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  const gridEl = $('grid');

  // tileRegistry espelha os tiles ativos (id -> {label, stream, avatar}) e e
  // a fonte de candidatos pro "+" do PiP. fullscreenTileId e o id do tile em
  // fullscreen agora (ou null). pinnedPip sao os ids marcados como miniatura
  // -- sobrevive a trocas de foco e a sair/entrar de fullscreen, so e limpo
  // quando o id some do tileRegistry ou o usuario remove manualmente (ver
  // spec docs/superpowers/specs/2026-08-20-tile-avatars-and-fullscreen-pip-design.md).
  const tileRegistry = new Map();
  let fullscreenTileId = null;
  const pinnedPip = new Set();

  // Posicao/tamanho de cada miniatura arrastavel dentro do fullscreen --
  // id -> { x, y, w }. x/y em % da area do fullscreen (0-100, sobrevive a
  // trocar de monitor/resolucao), w em px (altura sempre w * 9/16). Mesmo
  // ciclo de vida do pinnedPip: sobrevive a trocar de foco e a sair/entrar
  // de fullscreen, so e limpo quando o id sai do tileRegistry ou o usuario
  // remove a miniatura manualmente.
  const pipLayout = new Map();
  const PIP_MIN_W = 120;
  const PIP_MAX_W_RATIO = 0.45;
  const PIP_DEFAULT_W = 140;
  const PIP_MARGIN_PX = 16;

  // Mantem a classe `.fullscreen` do tile sincronizada quando o usuario sai
  // do fullscreen por Esc ou pelos controles nativos do SO, sem passar pelo
  // nosso botao/duplo-clique (toggleTileFullscreen, mais abaixo).
  window.golive.onFullScreenChange((enabled) => {
    if (enabled) return;
    document.querySelectorAll('.tile.fullscreen').forEach((t) => t.classList.remove('fullscreen', 'idle'));
    fullscreenTileId = null;
    clearTimeout(fullscreenIdleTimer);
  });

  // Nome, avatar, "+" do PiP e o botao de sair do fullscreen (`.tile.fullscreen.idle`
  // no CSS) e o proprio cursor do mouse (`cursor: none`) somem depois de um
  // tempo parado, tipo player de video, e voltam no primeiro movimento.
  const FULLSCREEN_IDLE_MS = 3000;
  let fullscreenIdleTimer = null;

  function scheduleFullscreenIdle(tile) {
    clearTimeout(fullscreenIdleTimer);
    tile.classList.remove('idle');
    fullscreenIdleTimer = setTimeout(() => tile.classList.add('idle'), FULLSCREEN_IDLE_MS);
  }

  function clearFullscreenIdle(tile) {
    clearTimeout(fullscreenIdleTimer);
    fullscreenIdleTimer = null;
    tile?.classList.remove('idle');
  }

  document.addEventListener('mousemove', () => {
    if (!fullscreenTileId) return;
    const tile = document.getElementById(`tile-${fullscreenTileId}`);
    if (tile) scheduleFullscreenIdle(tile);
  });

  // Volume/mute por tile remoto, roteado via Web Audio pra poder passar de
  // 100% (o <video> nativo so vai ate 1.0) -- ver Step 3 do Task 11 do plano
  // de implementacao pra contexto completo.
  let playbackAudioCtx = null;
  function getPlaybackAudioContext() {
    if (!playbackAudioCtx) playbackAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return playbackAudioCtx;
  }

  const tileAudio = new Map(); // id -> { volume, muted, source, gain, builtForStream, builtAudioTrackCount }

  function getOrCreateAudioState(id) {
    let state = tileAudio.get(id);
    if (!state) {
      state = {
        volume: 1,
        muted: false,
        source: null,
        gain: null,
        builtForStream: null,
        builtAudioTrackCount: 0,
      };
      tileAudio.set(id, state);
    }
    return state;
  }

  // Chamada em TODA renderizacao do tile (nao so quando o srcObject muda),
  // porque mesh.js dispara um evento 'track' por track (video, depois audio,
  // separadamente) e cada um vira uma chamada a showTile com o MESMO objeto
  // de stream -- entao na 1a chamada (so video) pode nao existir audio track
  // ainda, e a 2a chamada (audio chegou) e a que realmente precisa construir
  // o grafo. Tambem cobre tiles camera-only, que nunca ganham audio track:
  // nesse caso so retornamos sem tentar nada, sem lancar excecao.
  function ensureTileAudio(id, video, stream) {
    if (id === 'me' || id === 'cam-me') return;
    const state = getOrCreateAudioState(id);
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return; // sem audio track (ainda, ou nunca) -- nada a conectar
    if (state.source && state.builtForStream === stream && state.builtAudioTrackCount === audioTracks.length) {
      return; // grafo ja construido pra essa combinacao exata de stream+tracks
    }

    const ctx = getPlaybackAudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (state.source) {
      try { state.source.disconnect(); } catch { /* ja desconectado */ }
    }
    try {
      // MediaStreamAudioSourceNode so enxerga as tracks que existem no
      // momento da criacao -- por isso recriamos sempre que a contagem de
      // audio tracks muda, em vez de confiar que uma track adicionada depois
      // vai "aparecer" nesse node.
      state.source = ctx.createMediaStreamSource(stream);
    } catch {
      // Chromium pode lancar InvalidStateError numa corrida (ex: track
      // removida entre o check acima e a criacao). Nao derruba showTile --
      // so deixa sem grafo ativo pra esse tile, e tenta de novo na proxima
      // chamada.
      state.source = null;
      return;
    }
    if (!state.gain) state.gain = ctx.createGain();
    state.gain.gain.value = state.muted ? 0 : state.volume;
    state.source.connect(state.gain).connect(ctx.destination);
    state.builtForStream = stream;
    state.builtAudioTrackCount = audioTracks.length;
  }

  function releaseTileAudio(id) {
    const state = tileAudio.get(id);
    if (!state) return;
    try { state.source?.disconnect(); } catch { /* ja desconectado */ }
    try { state.gain?.disconnect(); } catch { /* ja desconectado */ }
    tileAudio.delete(id);
  }

  // Motion #14, a transicao de maior alavancagem do app: o tile CRESCE ate
  // virar fullscreen em vez de cortar seco. startViewTransition existe no
  // Chromium 128 (Electron 32), entao nao precisa de polyfill nem de
  // biblioteca.
  //
  // O `view-transition-name` so existe DURANTE a transicao: dois elementos
  // com o mesmo nome ao mesmo tempo abortam a transicao inteira, e sair do
  // fullscreen com outro tile ja marcado seria exatamente isso.
  //
  // ATENCAO, pendencia de verificacao da spec: view transitions tiram um
  // snapshot do elemento, e <video> tocando pode piscar ou congelar um
  // frame na captura. Se piscar na pratica, a alternativa e animar o
  // transform do tile do retangulo de origem ate o de destino (FLIP).
  function toggleTileFullscreen(tile, id) {
    const apply = () => {
      const entering = !tile.classList.contains('fullscreen');
      tile.classList.toggle('fullscreen', entering);
      window.golive.setFullScreen(entering);
      if (entering) {
        fullscreenTileId = id;
        renderPipStrip(tile);
        scheduleFullscreenIdle(tile);
      } else {
        fullscreenTileId = null;
        clearFullscreenIdle(tile);
      }
    };

    if (!document.startViewTransition) return apply(); // fallback: corte seco, como antes

    tile.style.viewTransitionName = 'tile';
    const transition = document.startViewTransition(apply);
    transition.finished.finally(() => {
      tile.style.viewTransitionName = '';
    });
  }

  // Pintura dos <video>. Um <video> pausado deixa de compor frames, mas a
  // MediaStreamTrack por tras continua viva e sendo enviada -- pausar o
  // elemento e parada de EXIBICAO, nao de captura nem de encode (que rodam
  // no processo de GPU). E o que permite nao gastar GPU desenhando a propria
  // tela dentro da propria tela enquanto o jogo esta por cima. Ver a spec de
  // 2026-08-23, F1.4.
  let paintingEnabled = true;

  function applyPainting(video) {
    if (!video) return;
    if (paintingEnabled) video.play().catch(() => {});
    else video.pause();
  }

  function setPainting(enabled) {
    if (paintingEnabled === enabled) return;
    paintingEnabled = enabled;
    gridEl.querySelectorAll('video').forEach(applyPainting);
  }

  // Quem esta assistindo cada tile agora (F1.3 + o broadcast de
  // 'watchers' em app.js) -- id do tile -> [{ id, name, avatar }]. Guardado
  // aqui (nao so no DOM) porque a mensagem 'watchers' pode chegar antes do
  // tile existir (renegociacao) ou depois dele ter sido recriado.
  const tileWatchers = new Map();

  function renderTileWatchers(tile, watchers) {
    const el = tile?.querySelector('.tile-watchers');
    if (!el) return;
    if (!watchers?.length) {
      el.classList.add('empty');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('empty');
    el.innerHTML = `
      <span class="tile-watchers-label">assistindo</span>
      <ul class="tile-watchers-list">
        ${watchers
          .map(
            (w) => `<li>
              <span class="tile-watchers-avatar">${avatarInnerHtml(w.id, w.name, w.avatar)}</span>
              <span class="tile-watchers-name">${escapeHtml(w.name || '?')}</span>
            </li>`
          )
          .join('')}
      </ul>`;
  }

  /** `tileId` e o id usado em showTile ('me'/'cam-me' pro proprio, peerId ou
   * `cam-${peerId}` pro de um peer). `watchers` e a lista devolvida por
   * mesh.watchersOf, ja carimbada com quem mandou (ver app.js). */
  function setWatchers(tileId, watchers) {
    tileWatchers.set(tileId, watchers || []);
    renderTileWatchers(document.getElementById(`tile-${tileId}`), watchers);
  }

  function showTile(id, label, stream, { muted = false, avatar = null, kind = null, displayName = null } = {}) {
    gridEl.querySelector('.empty')?.remove();

    let tile = document.getElementById(`tile-${id}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'tile';
      tile.id = `tile-${id}`;
      tile.innerHTML = `
        <video autoplay playsinline></video>
        <span class="tile-avatar"></span>
        <span class="tile-kind-badge"></span>
        <span class="tile-label"></span>
        <div class="tile-watchers empty"></div>
        <button class="tile-fullscreen-btn" type="button" title="Tela cheia">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
        </button>
        <div class="pip-strip"></div>`;
      tile.addEventListener('dblclick', () => toggleTileFullscreen(tile, id));
      tile.querySelector('.tile-fullscreen-btn').addEventListener('click', (event) => {
        event.stopPropagation();
        toggleTileFullscreen(tile, id);
      });
      if (id !== 'me' && id !== 'cam-me') {
        tile.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          openTileMenu(id, event.clientX, event.clientY);
        });
      }
      gridEl.appendChild(tile);
      // Tile pode ter sido recriado (ex: renegociacao) depois de ja termos
      // recebido um 'watchers' pra esse id -- sem isto o overlay ficaria
      // vazio ate a proxima mudanca de audiencia.
      renderTileWatchers(tile, tileWatchers.get(id));
    }

    const video = tile.querySelector('video');
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    ensureTileAudio(id, video, stream);
    // Ultima coisa a mexer em video.muted -- tem que rodar em TODA chamada
    // (nao so quando o srcObject muda), porque a 2a chamada de showTile pro
    // mesmo peer (audio track chegando separado, ver ensureTileAudio acima)
    // reusa o mesmo objeto de stream e passaria pelo `if` de cima sem entrar
    // nele, deixando o video desmutado se essa linha so rodasse ali dentro.
    video.muted = (id === 'me' || id === 'cam-me') ? muted : true;
    tile.querySelector('.tile-label').textContent = label;
    // O nome pro avatar vem de `displayName` quando existe: o label dos tiles
    // locais e "Voce (previa)"/"Voce (camera)", que daria a inicial "V" em vez
    // da inicial do nome do usuario.
    const avatarName = displayName || label;
    tile.querySelector('.tile-avatar').innerHTML = avatarInnerHtml(displayName || id, avatarName, avatar);
    const badgeEl = tile.querySelector('.tile-kind-badge');
    badgeEl.innerHTML = tileKindIcon(kind);
    if (kind === 'camera') badgeEl.title = 'Câmera';
    else if (kind === 'screen') badgeEl.title = 'Tela';
    else badgeEl.removeAttribute('title');

    // Tile criado enquanto a janela esta oculta nasce pausado (o atributo
    // autoplay do <video> tocaria sozinho, sem isto).
    applyPainting(video);

    tileRegistry.set(id, { label, stream, avatar, kind, displayName });
  }

  function removeTile(id, emptyMessage) {
    document.getElementById(`tile-${id}`)?.remove();
    releaseTileAudio(id);
    tileRegistry.delete(id);
    tileWatchers.delete(id);
    pinnedPip.delete(id);
    pipLayout.delete(id);
    if (id === fullscreenTileId) {
      fullscreenTileId = null;
      clearTimeout(fullscreenIdleTimer);
      window.golive.setFullScreen(false);
    } else if (fullscreenTileId) {
      const fsTile = document.getElementById(`tile-${fullscreenTileId}`);
      if (fsTile) renderPipStrip(fsTile);
    }
    if (!gridEl.children.length) {
      gridEl.innerHTML = `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
    }
  }

  // ---------- PiP (miniaturas dentro do fullscreen) ----------

  let openPipMenuEl = null;

  function closePipMenu() {
    openPipMenuEl?.remove();
    openPipMenuEl = null;
    document.removeEventListener('click', closePipMenu);
  }

  function switchFullscreenFocus(newId) {
    const oldId = fullscreenTileId;
    if (oldId === newId || !tileRegistry.has(newId)) return;
    const newTile = document.getElementById(`tile-${newId}`);
    if (!newTile) return;
    clearFullscreenIdle(document.getElementById(`tile-${oldId}`));
    document.getElementById(`tile-${oldId}`)?.classList.remove('fullscreen');
    newTile.classList.add('fullscreen');
    fullscreenTileId = newId;
    pinnedPip.delete(newId);
    if (oldId) pinnedPip.add(oldId);
    renderPipStrip(newTile);
    scheduleFullscreenIdle(newTile);
  }

  // Posicao/tamanho inicial de uma miniatura que ainda nao foi arrastada --
  // empilha da esquerda pra direita a partir do canto inferior esquerdo
  // (mesmo lugar da antiga faixa fixa), e fica gravado em `pipLayout` daqui
  // pra frente (nao e recalculado a cada render, senao empilhar de novo
  // toda vez que uma miniatura for removida atropelaria posicoes ja
  // arrastadas pelo usuario).
  function ensurePipLayout(id, containerRect, stackIndex) {
    let layout = pipLayout.get(id);
    if (layout) return layout;
    const w = PIP_DEFAULT_W;
    const h = (w * 9) / 16;
    const leftPx = PIP_MARGIN_PX + 56 + stackIndex * (w + 10); // 56 ~= largura do "+" + espaco
    const topPx = containerRect.height - PIP_MARGIN_PX - h;
    layout = {
      x: containerRect.width ? (leftPx / containerRect.width) * 100 : 0,
      y: containerRect.height ? (topPx / containerRect.height) * 100 : 0,
      w,
    };
    pipLayout.set(id, layout);
    return layout;
  }

  function applyPipLayout(wrap, layout) {
    const h = (layout.w * 9) / 16;
    wrap.style.left = `${layout.x}%`;
    wrap.style.top = `${layout.y}%`;
    wrap.style.width = `${layout.w}px`;
    wrap.style.height = `${h}px`;
  }

  function clampPipLayout(layout, containerRect) {
    const h = (layout.w * 9) / 16;
    const maxXPx = Math.max(0, containerRect.width - layout.w);
    const maxYPx = Math.max(0, containerRect.height - h);
    const xPx = Math.min(Math.max((layout.x / 100) * containerRect.width, 0), maxXPx);
    const yPx = Math.min(Math.max((layout.y / 100) * containerRect.height, 0), maxYPx);
    layout.x = containerRect.width ? (xPx / containerRect.width) * 100 : 0;
    layout.y = containerRect.height ? (yPx / containerRect.height) * 100 : 0;
  }

  function buildPipThumb(id, containerRect, stackIndex) {
    const entry = tileRegistry.get(id);
    const layout = ensurePipLayout(id, containerRect, stackIndex);
    clampPipLayout(layout, containerRect);

    const wrap = document.createElement('div');
    wrap.className = 'pip-thumb';
    applyPipLayout(wrap, layout);

    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = entry.stream;
    wrap.appendChild(video);

    const avatarEl = document.createElement('span');
    avatarEl.className = 'pip-thumb-avatar';
    avatarEl.innerHTML = avatarInnerHtml(entry.displayName || id, entry.displayName || entry.label, entry.avatar);
    wrap.appendChild(avatarEl);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'pip-thumb-remove';
    removeBtn.title = 'Remover miniatura';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      pinnedPip.delete(id);
      pipLayout.delete(id);
      const fsTile = document.getElementById(`tile-${fullscreenTileId}`);
      if (fsTile) renderPipStrip(fsTile);
    });
    wrap.appendChild(removeBtn);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'pip-thumb-resize';
    resizeHandle.title = 'Redimensionar';
    wrap.appendChild(resizeHandle);

    // Arrasto vs clique: clicar na miniatura troca o foco do fullscreen
    // (switchFullscreenFocus), mas isso so deve valer se o ponteiro nao se
    // moveu -- senao todo arrasto pra mover a miniatura terminaria trocando
    // de tela junto.
    const DRAG_THRESHOLD_PX = 4;

    function startDrag(event, onMove, onClick) {
      event.preventDefault();
      event.stopPropagation();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      wrap.setPointerCapture(pointerId);

      function onPointerMove(moveEvent) {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) moved = true;
        onMove(dx, dy, moveEvent);
      }
      function onPointerUp() {
        wrap.releasePointerCapture(pointerId);
        wrap.removeEventListener('pointermove', onPointerMove);
        wrap.removeEventListener('pointerup', onPointerUp);
        wrap.removeEventListener('pointercancel', onPointerUp);
        if (!moved) onClick?.();
      }
      wrap.addEventListener('pointermove', onPointerMove);
      wrap.addEventListener('pointerup', onPointerUp);
      wrap.addEventListener('pointercancel', onPointerUp);
    }

    wrap.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const strip = wrap.parentElement;
      const startXPct = layout.x;
      const startYPct = layout.y;
      startDrag(
        event,
        (dx, dy) => {
          const rect = strip.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          layout.x = startXPct + (dx / rect.width) * 100;
          layout.y = startYPct + (dy / rect.height) * 100;
          clampPipLayout(layout, rect);
          applyPipLayout(wrap, layout);
        },
        () => switchFullscreenFocus(id)
      );
    });

    resizeHandle.addEventListener('pointerdown', (event) => {
      const strip = wrap.parentElement;
      const startW = layout.w;
      startDrag(event, (dx) => {
        const rect = strip.getBoundingClientRect();
        const maxW = rect.width * PIP_MAX_W_RATIO;
        layout.w = Math.min(Math.max(startW + dx, PIP_MIN_W), Math.max(PIP_MIN_W, maxW));
        clampPipLayout(layout, rect);
        applyPipLayout(wrap, layout);
      });
    });

    return wrap;
  }

  function openPipPicker(anchorBtn, fullscreenId) {
    closePipMenu();
    const rect = anchorBtn.getBoundingClientRect();
    const candidates = Array.from(tileRegistry.entries()).filter(
      ([id]) => id !== fullscreenId && !pinnedPip.has(id)
    );

    const menu = document.createElement('div');
    menu.className = 'pip-picker';
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.top}px`;

    if (!candidates.length) {
      menu.innerHTML = '<div class="pip-picker-empty">ninguém mais pra mostrar</div>';
    } else {
      for (const [id, entry] of candidates) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'pip-picker-item';
        item.innerHTML = `
          <span class="pip-picker-avatar">${avatarInnerHtml(entry.displayName || id, entry.displayName || entry.label, entry.avatar)}</span>
          <span>${escapeHtml(entry.label)}</span>`;
        item.addEventListener('click', (event) => {
          event.stopPropagation();
          pinnedPip.add(id);
          closePipMenu();
          const fsTile = document.getElementById(`tile-${fullscreenId}`);
          if (fsTile) renderPipStrip(fsTile);
        });
        menu.appendChild(item);
      }
    }

    menu.addEventListener('click', (event) => event.stopPropagation());
    document.body.appendChild(menu);
    openPipMenuEl = menu;
    setTimeout(() => document.addEventListener('click', closePipMenu), 0);
  }

  function renderPipStrip(tile) {
    const strip = tile.querySelector('.pip-strip');
    if (!strip) return;
    const id = tile.id.slice('tile-'.length);
    strip.innerHTML = '';
    const containerRect = tile.getBoundingClientRect();
    let stackIndex = 0;
    for (const pinnedId of pinnedPip) {
      if (pinnedId === id || !tileRegistry.has(pinnedId)) continue;
      strip.appendChild(buildPipThumb(pinnedId, containerRect, stackIndex));
      stackIndex++;
    }
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'pip-add-btn';
    addBtn.title = 'Adicionar miniatura';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openPipPicker(addBtn, id);
    });
    strip.appendChild(addBtn);
  }

  let openMenuEl = null;

  function closeTileMenu() {
    openMenuEl?.remove();
    openMenuEl = null;
    document.removeEventListener('click', closeTileMenu);
  }

  function openTileMenu(id, x, y) {
    closeTileMenu();
    const state = getOrCreateAudioState(id);

    const menu = document.createElement('div');
    menu.className = 'tile-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.innerHTML = `
      <label class="check-inline tile-menu-mute-row">
        <input type="checkbox" class="tile-menu-mute" ${state.muted ? 'checked' : ''} /> Silenciar
      </label>
      <label class="tile-menu-volume">
        <span>Volume: <b class="tile-menu-volume-label">${Math.round(state.volume * 100)}%</b></span>
        <input type="range" min="0" max="200" step="1" value="${Math.round(state.volume * 100)}" />
      </label>`;
    menu.addEventListener('click', (event) => event.stopPropagation());
    document.body.appendChild(menu);
    openMenuEl = menu;

    function applyGain() {
      if (state.gain) state.gain.gain.value = state.muted ? 0 : state.volume;
    }

    const muteCheckbox = menu.querySelector('.tile-menu-mute');
    muteCheckbox.addEventListener('change', () => {
      state.muted = muteCheckbox.checked;
      applyGain();
    });

    const range = menu.querySelector('input[type=range]');
    const volumeLabel = menu.querySelector('.tile-menu-volume-label');
    range.addEventListener('input', () => {
      state.volume = Number(range.value) / 100;
      volumeLabel.textContent = `${range.value}%`;
      applyGain();
    });

    // Bubble phase (nao capture): o listener de `click` do proprio menu, que
    // chama stopPropagation, roda ANTES desse e impede que ele chegue aqui
    // quando o clique foi dentro do menu (botao de mute, slider). Em fase de
    // captura isso nao funcionaria -- stopPropagation na fase de bolha nao
    // afeta um listener de captura no document, que ja teria rodado antes.
    setTimeout(() => document.addEventListener('click', closeTileMenu), 0);
  }

  // Tons neutros com um traco de matiz, nao as seis cores saturadas do
  // Discord que estavam aqui antes. O avatar diz QUEM, nao O QUE ESTA
  // ACONTECENDO -- e neste tema cor saturada quer dizer uma coisa so:
  // alguem esta ao vivo. Continua dando pra distinguir as pessoas de
  // relance, sem competir com o unico sinal que importa.
  const AVATAR_PALETTE = ['#3a4152', '#453c4e', '#4a3f39', '#38474a', '#444a38', '#4c3a41'];

  function avatarColorFor(id) {
    const str = String(id);
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  }

  // Mesmo fallback (foto ou iniciais sobre cor gerada) usado em `buildMemberRow`
  // e nos avatares de tile/PiP -- centralizado aqui pra nao divergir.
  function avatarInnerHtml(id, name, avatar) {
    const initial = escapeHtml((name || '?').trim().charAt(0).toUpperCase() || '?');
    return avatar
      ? `<img src="${escapeHtml(avatar)}" alt="" />`
      : `<span class="peer-avatar-fallback" style="background:${avatarColorFor(id)}">${initial}</span>`;
  }

  const SHARE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
  const CAMERA_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`;

  // Badge no canto do tile indicando se aquele stream e tela compartilhada
  // ou camera -- necessario pra diferenciar quando o mesmo peer compartilha
  // as duas coisas ao mesmo tempo (ver ids `cam-<peerId>` vs `<peerId>` em
  // app.js).
  // Retorna so o <svg>: o elemento `.tile-kind-badge` ja existe no tile e este
  // html vai pra dentro dele (envolver num segundo span aninhava dois badges
  // absolutos, deixando a bolinha de fora vazia e o icone deslocado).
  function tileKindIcon(kind) {
    if (kind === 'camera') return CAMERA_ICON;
    if (kind === 'screen') return SHARE_ICON;
    return '';
  }

  // ---------- Lobby: lista de salas ----------

  const roomListLiveEl = $('room-list-live');
  const CONNECT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`;
  const CONNECTED_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  function fillRoomList(listEl, rooms, { onSelect, activeAddress, emptyMessage, isOnCooldown }) {
    listEl.innerHTML = '';
    if (!rooms.length) {
      if (emptyMessage) listEl.innerHTML = `<li class="muted" style="padding:8px 10px;">${escapeHtml(emptyMessage)}</li>`;
      return;
    }
    for (const room of rooms) {
      const isActive = activeAddress && room.address === activeAddress;
      const onCooldown = !isActive && !!isOnCooldown && isOnCooldown(room.address);
      const li = document.createElement('li');
      li.className = 'room-row';
      if (isActive) li.classList.add('active');

      const info = document.createElement('div');
      info.className = 'room-info';
      info.innerHTML = `
        <span class="dot ${isActive ? 'ok' : ''}"></span>
        <span class="room-item-text">
          <span class="room-name">${room.protected ? '<span class="room-lock" title="Precisa de PIN">&#128274;</span> ' : ''}${escapeHtml(room.name || room.hostName || 'sala')}</span>
          <span class="room-meta">${room.peers != null ? `${escapeHtml(String(room.peers))} pessoa(s)` : escapeHtml(room.address)}</span>
        </span>`;
      li.appendChild(info);

      const connectBtn = document.createElement('button');
      connectBtn.className = 'room-connect';
      connectBtn.type = 'button';
      connectBtn.title = isActive ? 'Já conectado nessa sala' : 'Conectar nessa sala';
      connectBtn.disabled = isActive || onCooldown;
      if (onCooldown) connectBtn.classList.add('cooldown');
      connectBtn.innerHTML = isActive ? CONNECTED_ICON : CONNECT_ICON;
      connectBtn.addEventListener('click', () => onSelect(room));
      li.appendChild(connectBtn);

      listEl.appendChild(li);
    }
  }

  // `liveRooms` = salas descobertas agora mesmo via broadcast UDP na LAN
  // (src/main/discovery.js) — nao ha historico local salvo em disco, so
  // "isso esta aberto agora"; a lista some sozinha quando o beacon para de
  // chegar.
  function renderRooms({ onSelect, activeAddress, liveRooms = [], isOnCooldown }) {
    fillRoomList(roomListLiveEl, liveRooms, {
      onSelect,
      activeAddress,
      isOnCooldown,
      emptyMessage: 'nenhuma sala aberta na rede agora — crie uma ou entre por endereço',
    });
  }

  // ---------- Foco em modais (helpers temporarios) ----------

  // TEMP: Task 16 replaces with verbatim port
  function focusFirstInteractive(container) {
    const el = container.querySelector('input, select, textarea, button');
    if (el) el.focus();
  }
  // TEMP: Task 16 replaces with verbatim port
  let lastFocusedBeforeModal = null;
  // TEMP: Task 16 replaces with verbatim port
  function restoreFocusAfterModal() {
    if (lastFocusedBeforeModal && lastFocusedBeforeModal.focus) lastFocusedBeforeModal.focus();
    lastFocusedBeforeModal = null;
  }

  // ---------- Dialogo: Criar sala ----------
  const dlgCreateEl = $('dialog-create-room');
  let onCreateConfirm = null;

  function openCreateRoom({ onConfirm }) {
    $('create-room-error').textContent = '';
    $('chk-protect-room').checked = false;
    onCreateConfirm = onConfirm;
    dlgCreateEl.classList.remove('hidden');
    focusFirstInteractive(dlgCreateEl);
  }
  function closeCreateRoom() {
    dlgCreateEl.classList.add('hidden');
    restoreFocusAfterModal();
    onCreateConfirm = null;
  }
  function setCreateRoomError(text) {
    $('create-room-error').textContent = text || '';
  }
  $('btn-create-room-cancel').addEventListener('click', closeCreateRoom);
  $('btn-create-room-confirm').addEventListener('click', () => {
    onCreateConfirm?.({ protect: $('chk-protect-room').checked });
  });
  dlgCreateEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCreateRoom(); });

  // ---------- Dialogo: Entrar numa sala ----------
  const dlgJoinEl = $('dialog-join-room');
  let onJoinConnect = null;

  function openJoinRoom({ onConnect, address, showPinField = false }) {
    $('setup-error').textContent = '';
    $('in-server').value = address || '';
    $('in-pin').value = '';
    $('join-pin-field').classList.toggle('hidden', !showPinField);
    onJoinConnect = onConnect;
    dlgJoinEl.classList.remove('hidden');
    focusFirstInteractive(dlgJoinEl);
  }
  function closeJoinRoom() {
    dlgJoinEl.classList.add('hidden');
    restoreFocusAfterModal();
    onJoinConnect = null;
  }
  function setJoinRoomPinVisible(visible) {
    $('join-pin-field').classList.toggle('hidden', !visible);
  }
  $('btn-join-room-cancel').addEventListener('click', closeJoinRoom);
  $('btn-connect').addEventListener('click', () => {
    onJoinConnect?.({ address: $('in-server').value.trim(), pin: $('in-pin').value.trim() || null });
  });
  dlgJoinEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeJoinRoom(); });

  root.GoLive = root.GoLive || {};
  root.GoLive.ui = {
    escapeHtml,
    grid: { showTile, removeTile, setPainting, setWatchers },
    rooms: { render: renderRooms },
    dialogs: {
      openCreateRoom, closeCreateRoom, setCreateRoomError,
      openJoinRoom, closeJoinRoom, setJoinRoomPinVisible,
    },
  };
})(window);
