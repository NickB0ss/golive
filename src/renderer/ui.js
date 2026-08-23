// src/renderer/ui.js
'use strict';

(function (root) {
  const $ = (id) => document.getElementById(id);
  const configApi = root.GoLive.config;

  const QUALITY_PRESET_LABELS = {
    '720p30': '720p · 30 fps',
    '720p60': '720p · 60 fps',
    '1080p30': '1080p · 30 fps',
    '1080p60': '1080p · 60 fps (padrão)',
    '1440p30': '1440p · 30 fps',
    '1440p60': '1440p · 60 fps',
  };

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

  const peerListEl = $('peer-list');

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

  function buildMemberRow({ id, name, avatar, borderClass, live, isSelf, notWatching, pulsing }) {
    const li = document.createElement('li');
    if (isSelf) li.classList.add('self');
    // Sem esta marca o encode sob demanda (F1.3) vira bug fantasma: o
    // espectador para de receber video e ninguem na sala sabe por que.
    if (notWatching) li.classList.add('not-watching');
    li.innerHTML = `
      <span class="peer-avatar-wrap">
        <span class="peer-avatar ${borderClass || ''}">${avatarInnerHtml(id, name, avatar)}</span>
        ${live ? `<span class="peer-live-badge live-pulse${pulsing ? ' pulsing' : ''}" title="Compartilhando tela">${SHARE_ICON}</span>` : ''}
      </span>
      <span class="peer-name">${escapeHtml(name)}${isSelf ? ' <span class="peer-you-tag">(você)</span>' : ''}</span>
      ${live ? '<em>AO VIVO</em>' : ''}
      ${notWatching ? '<span class="peer-not-watching">não está assistindo</span>' : ''}`;
    return li;
  }

  // `self` = { name, avatar, live } | null (null quando nao esta em nenhuma
  // sala). `peers` nunca inclui o proprio usuario (ver mesh.js) -- por isso
  // ele e montado e inserido separadamente, sempre no topo da lista.
  function renderMembers(peers, self) {
    peerListEl.innerHTML = '';
    if (!self && !peers.size) {
      peerListEl.innerHTML = '<li class="muted">você não está em nenhuma sala</li>';
      return;
    }
    // O anel pulsante (motion #10) vai em UM so por vez: tres pulsos
    // dessincronizados na mesma coluna viram ruido, e o proposito dele e ser
    // o unico movimento em laco da interface. Quem ganha e o primeiro da
    // lista que esta ao vivo -- voce mesmo, se for o caso.
    let pulseTaken = false;
    const claimPulse = (live) => {
      if (!live || pulseTaken) return false;
      pulseTaken = true;
      return true;
    };

    if (self) {
      peerListEl.appendChild(
        buildMemberRow({
          id: 'me',
          name: self.name || 'anônimo',
          avatar: self.avatar,
          live: self.live,
          isSelf: true,
          pulsing: claimPulse(self.live),
        })
      );
    }
    for (const peer of peers.values()) {
      const state = peer.inConns?.screen?.connectionState || peer.outConns?.screen?.connectionState
        || peer.inConns?.camera?.connectionState || peer.outConns?.camera?.connectionState;
      const borderClass = state === 'connected' ? 'ok' : state ? 'warn' : '';
      peerListEl.appendChild(
        buildMemberRow({
          id: peer.id,
          name: peer.name,
          avatar: peer.avatar,
          borderClass,
          live: peer.live,
          notWatching: Boolean(peer.suspended?.screen || peer.suspended?.camera),
          pulsing: claimPulse(peer.live),
        })
      );
    }
  }

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
          <span class="room-name">${escapeHtml(room.name || room.hostName || 'sala')}</span>
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

  const stageHeaderEl = $('stage-header');
  const stageRoomNameEl = $('stage-room-name');
  const stageRoomAddressEl = $('stage-room-address');

  function setStageHeader({ name, address }) {
    stageRoomNameEl.textContent = name || '';
    stageRoomAddressEl.textContent = address || '';
    stageHeaderEl.classList.remove('hidden');
  }

  function clearStageHeader() {
    stageHeaderEl.classList.add('hidden');
  }

  // ---------- Modal de Configuracoes ----------

  const settingsModalEl = $('settings-modal');
  const settingsCatButtons = Array.from(document.querySelectorAll('.settings-cat'));
  const settingsPanes = {
    profile: $('settings-profile'),
    voice: $('settings-voice'),
    network: $('settings-network'),
    stats: $('settings-stats'),
  };

  // Indicador deslizante (motion #8). O CSS desenha UM retangulo em
  // ::before/::after e o JS so escreve onde ele fica; a transicao acontece
  // em `transform`, nunca em `top`/`left`.
  //
  // `animate` = false na abertura do modal: sem isso o indicador desliza
  // sozinho da posicao anterior toda vez que o dialogo abre, o que e
  // movimento sem acao do usuario -- justamente o anti-padrao.
  function moveIndicator(container, active, axis, animate = true) {
    if (!container) return;
    if (!active) {
      container.style.setProperty(axis === 'y' ? '--nav-ind-o' : '--tab-ind-o', '0');
      return;
    }
    const prev = container.style.transition;
    if (!animate) container.style.transition = 'none';
    if (axis === 'y') {
      container.style.setProperty('--nav-ind-y', `${active.offsetTop}px`);
      container.style.setProperty('--nav-ind-h', `${active.offsetHeight}px`);
      container.style.setProperty('--nav-ind-o', '1');
    } else {
      container.style.setProperty('--tab-ind-x', `${active.offsetLeft}px`);
      // Sem unidade: e um fator de scaleX sobre uma barra de 1px, nao uma
      // largura -- animar `width` seria animar layout (ver o CSS).
      container.style.setProperty('--tab-ind-w', String(active.offsetWidth));
      container.style.setProperty('--tab-ind-o', '1');
    }
    if (!animate) {
      void container.offsetWidth; // força o layout antes de devolver a transicao
      container.style.transition = prev;
    }
  }

  const settingsNavEl = document.querySelector('.settings-nav');

  function syncSettingsIndicator(animate = true) {
    moveIndicator(settingsNavEl, settingsCatButtons.find((b) => b.classList.contains('active')), 'y', animate);
  }

  settingsCatButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      settingsCatButtons.forEach((b) => b.classList.toggle('active', b === btn));
      Object.entries(settingsPanes).forEach(([cat, pane]) =>
        pane.classList.toggle('hidden', cat !== btn.dataset.cat)
      );
      syncSettingsIndicator();
    });
  });

  $('btn-close-settings').addEventListener('click', closeSettings);
  settingsModalEl.addEventListener('click', (event) => {
    if (event.target === settingsModalEl) closeSettings();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !settingsModalEl.classList.contains('hidden')) closeSettings();
  });

  // Preview de camera do modal de Configuracoes. E independente da "camera
  // ao vivo" gerida em app.js (botao da barra lateral) — abre sua propria
  // captura so pra mostrar aqui, e precisa ser parada ao fechar o modal,
  // senao a luz da webcam fica acesa com o modal fechado.
  let settingsCameraPreviewStream = null;

  function stopSettingsCameraPreview() {
    if (!settingsCameraPreviewStream) return;
    settingsCameraPreviewStream.getTracks().forEach((t) => t.stop());
    settingsCameraPreviewStream = null;
    const video = $('settings-camera-preview');
    if (video) video.srcObject = null;
  }

  async function startSettingsCameraPreview(deviceId) {
    stopSettingsCameraPreview();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      });
      // o modal pode ter fechado (ou o dispositivo pode ter mudado de novo)
      // enquanto aguardavamos a permissao/captura
      if (settingsModalEl.classList.contains('hidden')) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      settingsCameraPreviewStream = stream;
      const video = $('settings-camera-preview');
      if (video) video.srcObject = stream;
    } catch {
      /* permissao negada ou sem camera disponivel, preview fica preto */
    }
  }

  function closeSettings() {
    settingsModalEl.classList.add('hidden');
    restoreFocusAfterModal();
    stopSettingsCameraPreview();
  }

  // Gestao de foco dos modais (§5.6). Antes nao havia nenhuma: abrir um
  // dialogo deixava o foco no botao que ficou escondido atras do overlay,
  // entao um Tab levava pra tras da caixa em vez de pra dentro dela.
  const FOCUSABLE =
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
  let lastFocusedBeforeModal = null;

  function focusFirstInteractive(modalEl) {
    lastFocusedBeforeModal = document.activeElement;
    modalEl.querySelector(FOCUSABLE)?.focus();
  }

  function restoreFocusAfterModal() {
    lastFocusedBeforeModal?.focus?.();
    lastFocusedBeforeModal = null;
  }

  function bandwidthLine(quality) {
    const screenMbps = quality.bitrate / 1_000_000;
    return `≈${screenMbps.toFixed(1).replace(/\.0$/, '')} Mbps por espectador enquanto você estiver transmitindo`;
  }

  // Preview do avatar/apelido dentro do modal (aba Perfil) -- espelha o
  // mesmo estado que o painel do rodapé mostra, atualizado nos dois
  // lugares junto (ver deps.onNameChange/onAvatarChange).
  function renderProfilePreview(config) {
    const img = $('settings-profile-avatar-img');
    const fallback = $('settings-profile-avatar-fallback');
    const nameInput = $('settings-profile-name');
    if (!img || !fallback || !nameInput) return;
    if (config.avatar) {
      img.src = config.avatar;
      img.classList.remove('hidden');
      fallback.textContent = '';
    } else {
      img.classList.add('hidden');
      img.src = '';
      fallback.textContent = (config.name || '?').trim().charAt(0).toUpperCase() || '?';
    }
    if (document.activeElement !== nameInput) nameInput.value = config.name || '';
  }

  async function openSettings(config, deps) {
    settingsPanes.profile.innerHTML = `
      <h3>Perfil</h3>
      <div class="settings-field settings-profile-field">
        <button id="settings-profile-avatar" class="user-avatar user-avatar-lg" type="button" title="Alterar foto de perfil">
          <img id="settings-profile-avatar-img" class="hidden" alt="" />
          <span id="settings-profile-avatar-fallback"></span>
        </button>
        <input id="settings-profile-avatar-input" type="file" accept="image/*" class="hidden" />
      </div>
      <div class="settings-field">
        <label for="settings-profile-name">Apelido</label>
        <input id="settings-profile-name" type="text" placeholder="seu apelido" spellcheck="false" />
      </div>`;

    settingsPanes.voice.innerHTML = `
      <h3>Câmera</h3>
      <div class="settings-field">
        <label for="settings-camera-device">Dispositivo</label>
        <select id="settings-camera-device"></select>
      </div>
      <div class="settings-field">
        <video id="settings-camera-preview" autoplay playsinline muted></video>
      </div>`;

    settingsPanes.network.innerHTML = `
      <div class="settings-field">
        <label class="check-inline"><input id="settings-advertise" type="checkbox" /> Anunciar minha sala na rede</label>
        <small>Desligado, a sala funciona normalmente e só entra quem receber o endereço.</small>
      </div>`;

    settingsPanes.stats.innerHTML = '<div id="settings-stats-body" class="stats"></div>';

    renderProfilePreview(config);
    $('settings-advertise').checked = config.network.advertise;

    $('settings-profile-name').addEventListener('input', (event) => {
      deps.onNameChange(event.target.value);
      // So o fallback (iniciais) depende do nome -- so precisa re-renderizar
      // se nao houver avatar de foto; renderProfilePreview ja preserva o
      // valor do proprio input enquanto ele esta focado.
      if (!deps.getConfig().avatar) renderProfilePreview(deps.getConfig());
    });
    $('settings-profile-avatar').addEventListener('click', () => $('settings-profile-avatar-input').click());
    $('settings-profile-avatar-input').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      await deps.onAvatarChange(file);
      renderProfilePreview(deps.getConfig());
    });

    $('settings-advertise').addEventListener('change', () => {
      deps.onNetworkChange({ ...config.network, advertise: $('settings-advertise').checked });
    });

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameraSelect = $('settings-camera-device');
      for (const d of devices.filter((d) => d.kind === 'videoinput')) {
        cameraSelect.add(new Option(d.label || 'Câmera', d.deviceId));
      }
      if (config.camera.deviceId) cameraSelect.value = config.camera.deviceId;
      cameraSelect.addEventListener('change', () => {
        deps.onCameraDeviceChange(cameraSelect.value);
        startSettingsCameraPreview(cameraSelect.value);
      });
    } catch {
      /* sem permissao de midia ainda, dropdowns ficam vazios */
    }

    settingsModalEl.classList.remove('hidden');
    // Sem animar: o indicador aparece ja no lugar em vez de deslizar sozinho
    // toda vez que o dialogo abre. offsetTop/offsetHeight so valem depois de
    // o modal sair de display:none, dai a leitura ser aqui.
    syncSettingsIndicator(false);
    focusFirstInteractive(settingsModalEl);
    startSettingsCameraPreview($('settings-camera-device').value);
  }

  function setStatsHtml(html) {
    const body = $('settings-stats-body');
    if (body) body.innerHTML = html;
  }

  // ---------- Dialogo de compartilhar ----------

  const pickerEl = $('picker');
  const pickerGridEl = $('picker-grid');
  const pickerTabsEl = $('picker-tabs');
  const pickerWindowHintEl = $('picker-window-hint');
  const pickerQualityPresetEl = $('picker-quality-preset');
  const pickerQualityBandwidthEl = $('picker-quality-bandwidth');
  const shareSoundEl = $('share-sound');
  const shareDiscordRowEl = $('share-discord-row');
  const shareDiscordEl = $('share-discord');
  const btnGoLiveEl = $('btn-go-live');
  let selectedSourceId = null;
  // Preenchido a cada abertura do dialogo (ver openPicker) -- guardado aqui
  // porque o listener de 'change' do select e registrado uma unica vez, fora
  // de openPicker (o elemento e estatico, so o callback de destino muda).
  let pickerOnQualityChange = null;

  pickerQualityPresetEl.innerHTML = configApi.QUALITY_PRESET_ORDER.map(
    (preset) => `<option value="${preset}">${escapeHtml(QUALITY_PRESET_LABELS[preset] || preset)}</option>`
  ).join('');
  pickerQualityPresetEl.addEventListener('change', () => {
    const quality = configApi.qualityFromPreset(pickerQualityPresetEl.value);
    pickerQualityBandwidthEl.textContent = bandwidthLine(quality);
    pickerOnQualityChange?.(quality);
  });
  let pickerSources = [];
  let pickerTab = 'screen';
  // Um lote por aba: enquanto a busca daquela aba nao voltou, a grade mostra
  // "procurando..." em vez de "nenhuma janela encontrada" (que seria mentira).
  let pickerLoading = { screen: false, window: false };
  // Invalida respostas de uma abertura anterior do dialogo que so chegaram
  // depois do usuario fechar e abrir de novo.
  let pickerRun = 0;

  function renderPickerGrid() {
    pickerGridEl.innerHTML = '';
    const filtered = pickerSources.filter((s) => (pickerTab === 'screen' ? s.isScreen : !s.isScreen));
    if (!filtered.length) {
      if (pickerLoading[pickerTab]) {
        pickerGridEl.innerHTML = `<div class="picker-grid-empty">${
          pickerTab === 'screen' ? 'procurando telas…' : 'procurando janelas…'
        }</div>`;
        return;
      }
      pickerGridEl.innerHTML = `<div class="picker-grid-empty">${
        pickerTab === 'screen' ? 'nenhuma tela encontrada' : 'nenhuma janela encontrada'
      }</div>`;
      return;
    }
    for (const source of filtered) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'source-card';
      card.classList.toggle('selected', source.id === selectedSourceId);
      card.innerHTML = `
        <img src="${source.thumbnail}" alt="" />
        <span class="source-name">${escapeHtml(source.name)}</span>
        <span class="source-meta">${source.isScreen ? 'Tela' : 'Janela'}${
          source.resolution ? ` &middot; ${source.resolution}` : ''
        }</span>`;
      card.addEventListener('click', () => {
        selectedSourceId = source.id;
        btnGoLiveEl.disabled = false;
        pickerGridEl.querySelectorAll('.source-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
      });
      pickerGridEl.appendChild(card);
    }
  }

  pickerTabsEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.picker-tab');
    if (!btn || btn.classList.contains('active')) return;
    pickerTabsEl.querySelectorAll('.picker-tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    pickerTab = btn.dataset.tab;
    syncPickerIndicator();
    syncWindowHint();
    renderPickerGrid();
  });

  function syncPickerIndicator(animate = true) {
    moveIndicator(pickerTabsEl, pickerTabsEl.querySelector('.picker-tab.active'), 'x', animate);
  }

  // sources:list captura e codifica em PNG uma miniatura de CADA janela
  // aberta -- um pico de trabalho no instante exato em que a pessoa vai
  // transmitir, ou seja, com o jogo aberto. Por isso roda uma vez por
  // abertura do dialogo (trocar de aba nao recarrega: renderPickerGrid
  // filtra a lista ja em memoria) e so repete quando o usuario pede.
  // Ver a spec de 2026-08-23, F1.6.
  function loadPickerSources() {
    const run = ++pickerRun;
    pickerSources = [];
    pickerLoading = { screen: true, window: true };
    renderPickerGrid();

    // Telas primeiro (sao poucas e rapidas, e e a aba que abre selecionada);
    // as janelas, que sao a parte cara, chegam depois sem segurar o resto.
    const absorb = (tab) => (sources) => {
      if (run !== pickerRun) return; // dialogo ja foi fechado e reaberto
      pickerLoading[tab] = false;
      pickerSources = [...pickerSources, ...sources];
      renderPickerGrid();
    };
    const fail = (tab) => () => {
      if (run !== pickerRun) return;
      pickerLoading[tab] = false;
      renderPickerGrid();
    };
    window.golive.listSources(['screen']).then(absorb('screen'), fail('screen'));
    window.golive.listSources(['window']).then(absorb('window'), fail('window'));
  }

  // Uma fonte selecionada some se ela nao existir mais na lista nova, entao
  // o botao "Ir ao vivo" volta a ficar desabilitado -- melhor do que
  // transmitir uma janela que acabou de fechar.
  $('picker-refresh').addEventListener('click', () => {
    selectedSourceId = null;
    btnGoLiveEl.disabled = true;
    loadPickerSources();
  });

  // Capturar uma janela cai no caminho GDI/BitBlt do Chromium, que codifica
  // na CPU e devolve tela preta em fullscreen exclusivo -- ver a spec de
  // 2026-08-23, F1.2. A dica so aparece na aba onde a escolha errada mora.
  function syncWindowHint() {
    pickerWindowHintEl?.classList.toggle('hidden', pickerTab !== 'window');
  }

  // A 2a checkbox ("incluir o som do Discord") so faz sentido com a 1a
  // ligada -- some junto, e some desmarcada tambem (nao fica um estado
  // "incluir Discord" escondido e ativo por baixo dos panos).
  shareSoundEl.addEventListener('change', () => {
    shareDiscordRowEl.classList.toggle('hidden', !shareSoundEl.checked);
    if (!shareSoundEl.checked) shareDiscordEl.checked = false;
  });

  function closePicker() {
    pickerEl.classList.add('hidden');
    restoreFocusAfterModal();
  }

  $('picker-cancel').addEventListener('click', closePicker);

  // Esc fecha o dialogo (sem iniciar nada) e Enter inicia a transmissao --
  // so quando o dialogo esta aberto e (pro Enter) ja tem uma fonte
  // selecionada, senao o botao "Ir ao vivo" tambem estaria desabilitado.
  document.addEventListener('keydown', (event) => {
    if (pickerEl.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      closePicker();
    } else if (event.key === 'Enter' && !btnGoLiveEl.disabled) {
      btnGoLiveEl.click();
    }
  });

  async function openPicker({ onGoLive, nativeAudioAvailable = true, quality, onQualityChange }) {
    selectedSourceId = null;
    btnGoLiveEl.disabled = true;
    pickerTab = 'screen';
    pickerTabsEl.querySelectorAll('.picker-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'screen'));
    syncWindowHint();
    pickerGridEl.innerHTML = '';
    pickerQualityPresetEl.value = quality.preset;
    pickerQualityBandwidthEl.textContent = bandwidthLine(quality);
    pickerOnQualityChange = onQualityChange;
    shareSoundEl.checked = true;
    shareDiscordEl.checked = false;
    shareDiscordRowEl.classList.remove('hidden');
    // Sem o addon nativo (Windows apenas), nao ha como excluir o Discord do
    // audio capturado -- a checkbox nao teria efeito nenhum, entao fica
    // desabilitada em vez de prometer algo que nao entrega.
    shareDiscordEl.disabled = !nativeAudioAvailable;
    shareDiscordRowEl.title = nativeAudioAvailable
      ? ''
      : 'Indisponível nesta máquina (requer o addon nativo de áudio, só existe no Windows)';

    btnGoLiveEl.onclick = () => {
      closePicker();
      onGoLive(selectedSourceId, shareSoundEl.checked, shareSoundEl.checked && shareDiscordEl.checked);
    };

    // O dialogo aparece na hora e as fontes entram conforme chegam -- antes
    // ele so era exibido depois de capturar o thumbnail de TODAS as telas e
    // janelas, o que dava a impressao de que o clique nao tinha funcionado.
    pickerEl.classList.remove('hidden');
    // offsetLeft/offsetWidth so valem depois de sair de display:none.
    syncPickerIndicator(false);
    focusFirstInteractive(pickerEl);
    loadPickerSources();
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.ui = {
    escapeHtml,
    grid: { showTile, removeTile, setPainting },
    members: { render: renderMembers },
    rooms: { render: renderRooms },
    stageHeader: { set: setStageHeader, clear: clearStageHeader },
    settings: { open: openSettings, close: closeSettings, setStatsHtml },
    picker: { open: openPicker },
  };
})(window);
