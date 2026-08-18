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

  function showTile(id, label, stream, muted = false) {
    gridEl.querySelector('.empty')?.remove();

    let tile = document.getElementById(`tile-${id}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'tile';
      tile.id = `tile-${id}`;
      tile.innerHTML = `<video autoplay playsinline></video><span class="tile-label"></span>`;
      tile.addEventListener('dblclick', () => tile.classList.toggle('fullscreen'));
      gridEl.appendChild(tile);
    }

    const video = tile.querySelector('video');
    if (video.srcObject !== stream) video.srcObject = stream;
    video.muted = muted;
    tile.querySelector('.tile-label').textContent = label;
  }

  function removeTile(id, emptyMessage) {
    document.getElementById(`tile-${id}`)?.remove();
    if (!gridEl.children.length) {
      gridEl.innerHTML = `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
    }
  }

  const peerListEl = $('peer-list');

  function renderMembers(peers) {
    peerListEl.innerHTML = '';
    if (!peers.size) {
      peerListEl.innerHTML = '<li class="muted">só você por aqui</li>';
      return;
    }
    for (const peer of peers.values()) {
      const li = document.createElement('li');
      const state = peer.inConn?.connectionState || peer.outConn?.connectionState;
      li.innerHTML = `
        <span class="dot ${state === 'connected' ? 'ok' : state ? 'warn' : ''}"></span>
        ${escapeHtml(peer.name)}
        ${peer.live ? '<em>AO VIVO</em>' : ''}`;
      peerListEl.appendChild(li);
    }
  }

  const roomListEl = $('room-list');

  function renderRooms(rooms, { onSelect }) {
    roomListEl.innerHTML = '';
    if (!rooms.length) {
      roomListEl.innerHTML = '<li class="muted" style="padding:8px 10px;">nenhuma sala por aqui ainda</li>';
      return;
    }
    for (const room of rooms) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'room-item';
      button.type = 'button';
      button.innerHTML = `
        <span class="room-name"># ${escapeHtml(room.name || room.hostName || 'sala')}</span>
        <span class="room-meta">${room.peers != null ? `${room.peers} pessoa(s)` : escapeHtml(room.address)}</span>`;
      button.addEventListener('click', () => onSelect(room));
      li.appendChild(button);
      roomListEl.appendChild(li);
    }
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

  root.GoLive = root.GoLive || {};
  root.GoLive.ui = {
    escapeHtml,
    grid: { showTile, removeTile },
    members: { render: renderMembers },
    rooms: { render: renderRooms },
    stageHeader: { set: setStageHeader, clear: clearStageHeader },
  };
})(window);
