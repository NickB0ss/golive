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

  // Volume/mute por tile remoto, roteado via Web Audio pra poder passar de
  // 100% (o <video> nativo so vai ate 1.0) -- ver Step 3 do Task 11 do plano
  // de implementacao pra contexto completo.
  let playbackAudioCtx = null;
  function getPlaybackAudioContext() {
    if (!playbackAudioCtx) playbackAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return playbackAudioCtx;
  }

  const tileAudio = new Map(); // id -> { volume, muted, source, gain }

  function getOrCreateAudioState(id) {
    let state = tileAudio.get(id);
    if (!state) {
      state = { volume: 1, muted: false, source: null, gain: null };
      tileAudio.set(id, state);
    }
    return state;
  }

  function ensureTileAudio(id, video, stream) {
    if (id === 'me' || id === 'cam-me') return;
    video.muted = true;
    const state = getOrCreateAudioState(id);
    const ctx = getPlaybackAudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (state.source) {
      try { state.source.disconnect(); } catch { /* ja desconectado */ }
    }
    state.source = ctx.createMediaStreamSource(stream);
    if (!state.gain) state.gain = ctx.createGain();
    state.gain.gain.value = state.muted ? 0 : state.volume;
    state.source.connect(state.gain).connect(ctx.destination);
  }

  function releaseTileAudio(id) {
    const state = tileAudio.get(id);
    if (!state) return;
    try { state.source?.disconnect(); } catch { /* ja desconectado */ }
    try { state.gain?.disconnect(); } catch { /* ja desconectado */ }
    tileAudio.delete(id);
  }

  function showTile(id, label, stream, muted = false) {
    gridEl.querySelector('.empty')?.remove();

    let tile = document.getElementById(`tile-${id}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'tile';
      tile.id = `tile-${id}`;
      tile.innerHTML = `
        <video autoplay playsinline></video>
        <span class="tile-label"></span>
        <button class="tile-fullscreen-btn" type="button" title="Tela cheia">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
        </button>`;
      tile.addEventListener('dblclick', () => tile.classList.toggle('fullscreen'));
      tile.querySelector('.tile-fullscreen-btn').addEventListener('click', (event) => {
        event.stopPropagation();
        tile.classList.toggle('fullscreen');
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
    video.muted = muted;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      ensureTileAudio(id, video, stream);
    }
    tile.querySelector('.tile-label').textContent = label;
  }

  function removeTile(id, emptyMessage) {
    document.getElementById(`tile-${id}`)?.remove();
    releaseTileAudio(id);
    if (!gridEl.children.length) {
      gridEl.innerHTML = `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
    }
  }

  let openMenuEl = null;

  function closeTileMenu() {
    openMenuEl?.remove();
    openMenuEl = null;
    document.removeEventListener('click', closeTileMenu, true);
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

    setTimeout(() => document.addEventListener('click', closeTileMenu, true), 0);
  }

  const peerListEl = $('peer-list');

  const AVATAR_PALETTE = ['#f23f42', '#f0b232', '#23a55a', '#5865f2', '#eb459e', '#00a8fc'];

  function avatarColorFor(id) {
    const str = String(id);
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  }

  function renderMembers(peers) {
    peerListEl.innerHTML = '';
    if (!peers.size) {
      peerListEl.innerHTML = '<li class="muted">só você por aqui</li>';
      return;
    }
    for (const peer of peers.values()) {
      const li = document.createElement('li');
      const state = peer.inConn?.connectionState || peer.outConn?.connectionState;
      const borderClass = state === 'connected' ? 'ok' : state ? 'warn' : '';
      const initial = escapeHtml((peer.name || '?').trim().charAt(0).toUpperCase() || '?');
      const avatarInner = peer.avatar
        ? `<img src="${escapeHtml(peer.avatar)}" alt="" />`
        : `<span class="peer-avatar-fallback" style="background:${avatarColorFor(peer.id)}">${initial}</span>`;
      li.innerHTML = `
        <span class="peer-avatar ${borderClass}">${avatarInner}</span>
        ${escapeHtml(peer.name)}
        ${peer.live ? '<em>AO VIVO</em>' : ''}`;
      peerListEl.appendChild(li);
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
  const audioDeviceEl = $('audio-device');
  const btnGoLiveEl = $('btn-go-live');
  let selectedSourceId = null;

  function currentAudioMode() {
    return document.querySelector('input[name="audio-mode"]:checked').value;
  }

  document.querySelectorAll('input[name="audio-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      audioDeviceEl.classList.toggle('hidden', currentAudioMode() !== 'device');
    });
  });

  $('picker-cancel').addEventListener('click', () => pickerEl.classList.add('hidden'));

  async function openPicker({ onGoLive }) {
    selectedSourceId = null;
    btnGoLiveEl.disabled = true;
    pickerGridEl.innerHTML = '';
    audioDeviceEl.innerHTML = '';

    const sources = await window.golive.listSources();
    for (const source of sources) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'source-card';
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

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      for (const d of devices.filter((d) => d.kind === 'audioinput')) {
        audioDeviceEl.add(new Option(d.label || 'Entrada de áudio', d.deviceId));
      }
    } catch {
      /* sem permissao ainda */
    }

    btnGoLiveEl.onclick = () => {
      const mode = currentAudioMode();
      pickerEl.classList.add('hidden');
      onGoLive(selectedSourceId, mode, mode === 'device' ? audioDeviceEl.value : null);
    };

    pickerEl.classList.remove('hidden');
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
