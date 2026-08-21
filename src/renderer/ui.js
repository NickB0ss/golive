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

  function toggleTileFullscreen(tile, id) {
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

    tileRegistry.set(id, { label, stream, avatar, kind, displayName });
  }

  function removeTile(id, emptyMessage) {
    document.getElementById(`tile-${id}`)?.remove();
    releaseTileAudio(id);
    tileRegistry.delete(id);
    pinnedPip.delete(id);
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

  function buildPipThumb(id) {
    const entry = tileRegistry.get(id);
    const wrap = document.createElement('div');
    wrap.className = 'pip-thumb';

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
      const fsTile = document.getElementById(`tile-${fullscreenTileId}`);
      if (fsTile) renderPipStrip(fsTile);
    });
    wrap.appendChild(removeBtn);

    wrap.addEventListener('click', () => switchFullscreenFocus(id));
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
    for (const pinnedId of pinnedPip) {
      if (pinnedId === id || !tileRegistry.has(pinnedId)) continue;
      strip.appendChild(buildPipThumb(pinnedId));
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
      <button class="tile-menu-mute" type="button">${state.muted ? 'Reativar som' : 'Silenciar'}</button>
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

    const muteBtn = menu.querySelector('.tile-menu-mute');
    muteBtn.addEventListener('click', () => {
      state.muted = !state.muted;
      muteBtn.textContent = state.muted ? 'Reativar som' : 'Silenciar';
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

  const AVATAR_PALETTE = ['#f23f42', '#f0b232', '#23a55a', '#5865f2', '#eb459e', '#00a8fc'];

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

  function buildMemberRow({ id, name, avatar, borderClass, live, isSelf }) {
    const li = document.createElement('li');
    if (isSelf) li.classList.add('self');
    li.innerHTML = `
      <span class="peer-avatar-wrap">
        <span class="peer-avatar ${borderClass || ''}">${avatarInnerHtml(id, name, avatar)}</span>
        ${live ? `<span class="peer-live-badge" title="Compartilhando tela">${SHARE_ICON}</span>` : ''}
      </span>
      ${escapeHtml(name)}${isSelf ? ' <span class="peer-you-tag">(você)</span>' : ''}
      ${live ? '<em>AO VIVO</em>' : ''}`;
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
    if (self) {
      peerListEl.appendChild(
        buildMemberRow({ id: 'me', name: self.name || 'anônimo', avatar: self.avatar, live: self.live, isSelf: true })
      );
    }
    for (const peer of peers.values()) {
      const state = peer.inConns?.screen?.connectionState || peer.outConns?.screen?.connectionState
        || peer.inConns?.camera?.connectionState || peer.outConns?.camera?.connectionState;
      const borderClass = state === 'connected' ? 'ok' : state ? 'warn' : '';
      peerListEl.appendChild(
        buildMemberRow({ id: peer.id, name: peer.name, avatar: peer.avatar, borderClass, live: peer.live })
      );
    }
  }

  const roomListEl = $('room-list');
  const roomListLiveEl = $('room-list-live');
  const roomsLiveTitleEl = $('rooms-live-title');
  const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
  const CONNECT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`;
  const CONNECTED_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  function fillRoomList(listEl, rooms, { onSelect, onDelete, activeAddress, emptyMessage, isOnCooldown }) {
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

      if (onDelete) {
        const del = document.createElement('button');
        del.className = 'room-delete';
        del.type = 'button';
        del.title = 'Remover sala da lista';
        del.innerHTML = TRASH_ICON;
        del.addEventListener('click', () => onDelete(room));
        li.appendChild(del);
      }

      listEl.appendChild(li);
    }
  }

  // `rooms` = historico local (cfg.recentRooms): enderecos ja usados antes,
  // podem estar offline agora — tem botao de excluir. `liveRooms` = salas
  // descobertas agora mesmo via broadcast UDP na LAN (src/main/discovery.js)
  // — "isso esta aberto agora", sem botao de excluir (nao e uma entrada
  // salva, so aparece enquanto o beacon continuar chegando).
  function renderRooms(rooms, { onSelect, onDelete, activeAddress, liveRooms = [], isOnCooldown }) {
    roomsLiveTitleEl.classList.toggle('hidden', !liveRooms.length);
    fillRoomList(roomListLiveEl, liveRooms, { onSelect, activeAddress, isOnCooldown });
    fillRoomList(roomListEl, rooms, {
      onSelect,
      onDelete,
      activeAddress,
      isOnCooldown,
      emptyMessage: 'nenhuma sala salva ainda — crie uma ou entre por endereço',
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
    voice: $('settings-voice'),
    broadcast: $('settings-broadcast'),
    network: $('settings-network'),
    stats: $('settings-stats'),
  };

  settingsCatButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      settingsCatButtons.forEach((b) => b.classList.toggle('active', b === btn));
      Object.entries(settingsPanes).forEach(([cat, pane]) =>
        pane.classList.toggle('hidden', cat !== btn.dataset.cat)
      );
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
    stopSettingsCameraPreview();
  }

  function bandwidthLine(config) {
    const screenMbps = config.quality.bitrate / 1_000_000;
    const cameraMbps = config.camera.bitrate / 1_000_000;
    return `${screenMbps.toFixed(1)} Mbps (tela) + ${cameraMbps.toFixed(1)} Mbps (câmera) × número de espectadores`;
  }

  async function openSettings(config, deps) {
    settingsPanes.voice.innerHTML = `
      <h3>Câmera</h3>
      <div class="settings-field">
        <label for="settings-camera-device">Dispositivo</label>
        <select id="settings-camera-device"></select>
      </div>
      <div class="settings-field">
        <video id="settings-camera-preview" autoplay playsinline muted></video>
      </div>
      <h3>Áudio</h3>
      <div class="settings-field">
        <label for="settings-audio-device">Dispositivo padrão pra compartilhamento</label>
        <select id="settings-audio-device"></select>
      </div>`;

    settingsPanes.broadcast.innerHTML = `
      <h3>Tela</h3>
      <div class="settings-field">
        <label>Resolução</label>
        <select id="settings-res">
          <option value="1920x1080">1920x1080 (Full HD)</option>
          <option value="2560x1440">2560x1440 (QHD)</option>
          <option value="1280x720">1280x720 (HD)</option>
        </select>
      </div>
      <div class="settings-field">
        <label>Framerate</label>
        <select id="settings-fps">
          <option value="60">60 fps</option>
          <option value="30">30 fps</option>
        </select>
      </div>
      <div class="settings-field">
        <label>Bitrate: <b id="settings-bitrate-label"></b></label>
        <input id="settings-bitrate" type="range" min="2" max="40" step="1" />
      </div>
      <div class="settings-field">
        <label>Codec</label>
        <select id="settings-codec">
          <option value="video/H264">H.264 (hardware, menor latência)</option>
          <option value="video/VP9">VP9 (melhor imagem, mais CPU)</option>
          <option value="video/AV1">AV1 (menor banda, exige GPU nova)</option>
        </select>
      </div>
      <h3>Câmera</h3>
      <div class="settings-field">
        <label>Bitrate da câmera: <b id="settings-camera-bitrate-label"></b></label>
        <input id="settings-camera-bitrate" type="range" min="1" max="8" step="1" />
        <small>${escapeHtml(bandwidthLine(config))}</small>
      </div>`;

    settingsPanes.network.innerHTML = `
      <div class="settings-field">
        <label class="check-inline"><input id="settings-advertise" type="checkbox" /> Anunciar minha sala na rede</label>
        <small>Desligado, a sala funciona normalmente e só entra quem receber o endereço.</small>
      </div>`;

    settingsPanes.stats.innerHTML = '<div id="settings-stats-body" class="stats"></div>';

    $('settings-res').value = `${config.quality.width}x${config.quality.height}`;
    $('settings-fps').value = String(config.quality.fps);
    $('settings-bitrate').value = String(config.quality.bitrate / 1_000_000);
    $('settings-bitrate-label').textContent = `${config.quality.bitrate / 1_000_000} Mbps`;
    $('settings-codec').value = config.quality.codec;
    $('settings-camera-bitrate').value = String(config.camera.bitrate / 1_000_000);
    $('settings-camera-bitrate-label').textContent = `${config.camera.bitrate / 1_000_000} Mbps`;
    $('settings-advertise').checked = config.network.advertise;

    function emitQuality() {
      const [width, height] = $('settings-res').value.split('x').map(Number);
      deps.onQualityChange({
        width,
        height,
        fps: Number($('settings-fps').value),
        bitrate: Number($('settings-bitrate').value) * 1_000_000,
        codec: $('settings-codec').value,
      });
    }

    $('settings-res').addEventListener('change', emitQuality);
    $('settings-fps').addEventListener('change', emitQuality);
    $('settings-codec').addEventListener('change', emitQuality);
    $('settings-bitrate').addEventListener('input', () => {
      $('settings-bitrate-label').textContent = `${$('settings-bitrate').value} Mbps`;
      emitQuality();
    });
    $('settings-camera-bitrate').addEventListener('input', () => {
      $('settings-camera-bitrate-label').textContent = `${$('settings-camera-bitrate').value} Mbps`;
      deps.onCameraQualityChange({ ...config.camera, bitrate: Number($('settings-camera-bitrate').value) * 1_000_000 });
    });
    $('settings-advertise').addEventListener('change', () => {
      deps.onNetworkChange({ ...config.network, advertise: $('settings-advertise').checked });
    });

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameraSelect = $('settings-camera-device');
      const audioSelect = $('settings-audio-device');
      for (const d of devices.filter((d) => d.kind === 'videoinput')) {
        cameraSelect.add(new Option(d.label || 'Câmera', d.deviceId));
      }
      for (const d of devices.filter((d) => d.kind === 'audioinput')) {
        audioSelect.add(new Option(d.label || 'Entrada de áudio', d.deviceId));
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
  const shareSoundEl = $('share-sound');
  const shareDiscordRowEl = $('share-discord-row');
  const shareDiscordEl = $('share-discord');
  const btnGoLiveEl = $('btn-go-live');
  let selectedSourceId = null;
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
    renderPickerGrid();
  });

  // A 2a checkbox ("incluir o som do Discord") so faz sentido com a 1a
  // ligada -- some junto, e some desmarcada tambem (nao fica um estado
  // "incluir Discord" escondido e ativo por baixo dos panos).
  shareSoundEl.addEventListener('change', () => {
    shareDiscordRowEl.classList.toggle('hidden', !shareSoundEl.checked);
    if (!shareSoundEl.checked) shareDiscordEl.checked = false;
  });

  $('picker-cancel').addEventListener('click', () => pickerEl.classList.add('hidden'));

  // Esc fecha o dialogo (sem iniciar nada) e Enter inicia a transmissao --
  // so quando o dialogo esta aberto e (pro Enter) ja tem uma fonte
  // selecionada, senao o botao "Ir ao vivo" tambem estaria desabilitado.
  document.addEventListener('keydown', (event) => {
    if (pickerEl.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      pickerEl.classList.add('hidden');
    } else if (event.key === 'Enter' && !btnGoLiveEl.disabled) {
      btnGoLiveEl.click();
    }
  });

  async function openPicker({ onGoLive }) {
    selectedSourceId = null;
    btnGoLiveEl.disabled = true;
    pickerTab = 'screen';
    pickerTabsEl.querySelectorAll('.picker-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'screen'));
    pickerGridEl.innerHTML = '';
    shareSoundEl.checked = true;
    shareDiscordEl.checked = false;
    shareDiscordRowEl.classList.remove('hidden');

    btnGoLiveEl.onclick = () => {
      pickerEl.classList.add('hidden');
      onGoLive(selectedSourceId, shareSoundEl.checked, shareSoundEl.checked && shareDiscordEl.checked);
    };

    // O dialogo aparece na hora e as fontes entram conforme chegam -- antes
    // ele so era exibido depois de capturar o thumbnail de TODAS as telas e
    // janelas, o que dava a impressao de que o clique nao tinha funcionado.
    const run = ++pickerRun;
    pickerSources = [];
    pickerLoading = { screen: true, window: true };
    renderPickerGrid();
    pickerEl.classList.remove('hidden');

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

  root.GoLive = root.GoLive || {};
  root.GoLive.ui = {
    escapeHtml,
    grid: { showTile, removeTile },
    members: { render: renderMembers },
    rooms: { render: renderRooms },
    stageHeader: { set: setStageHeader, clear: clearStageHeader },
    settings: { open: openSettings, close: closeSettings, setStatsHtml },
    picker: { open: openPicker },
  };
})(window);
