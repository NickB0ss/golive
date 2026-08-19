// src/renderer/app.js
'use strict';

(function () {
  const { config, signaling, mesh: meshModule, ui } = window.GoLive;

  let cfg = config.load(localStorage.getItem('golive'));
  let sig = null;
  let mesh = null;
  let myId = null;
  let localStream = null;
  let hostInfo = null;
  let statsTimer = null;
  let lastBytes = 0;
  let lastAt = 0;

  const $ = (id) => document.getElementById(id);

  function persist() {
    localStorage.setItem('golive', config.serialize(cfg));
  }

  function emptyMessage() {
    return sig ? 'Ninguém transmitindo ainda.' : 'Entre ou crie uma sala pra começar.';
  }

  // ---------- Painel do usuario ----------

  function renderUserPanel() {
    $('user-panel-name').textContent = cfg.name || 'anônimo';
  }
  renderUserPanel();

  $('btn-open-settings').addEventListener('click', () => {
    ui.settings.open(cfg, {
      onQualityChange: (quality) => {
        cfg = { ...cfg, quality };
        persist();
        if (localStream) applyLiveQuality();
      },
      onCameraQualityChange: (camera) => {
        cfg = { ...cfg, camera };
        persist();
      },
      onCameraDeviceChange: () => {
        // Selecao de dispositivo de camera: consumida na Fase 2, quando a
        // webcam ganha captura propria. Por ora so persiste a escolha.
      },
      onNetworkChange: (network) => {
        cfg = { ...cfg, network };
        persist();
      },
    });
  });

  async function applyLiveQuality() {
    const track = localStream.getVideoTracks()[0];
    if (track) {
      await track.applyConstraints(config.videoConstraints(cfg.quality)).catch(() => {});
    }
    mesh.applyEncoding(cfg.quality);
  }

  // ---------- Lista de salas ----------

  function renderRoomList() {
    ui.rooms.render(cfg.recentRooms, { onSelect: (room) => joinRoom(room.address, cfg.name) });
  }
  renderRoomList();

  $('btn-join-address').addEventListener('click', () => {
    $('join-address-form').classList.toggle('hidden');
  });

  $('btn-connect').addEventListener('click', () => {
    let url = $('in-server').value.trim();
    if (!url) return ($('setup-error').textContent = 'Informe o endereço do servidor.');
    if (!/^wss?:\/\//.test(url)) url = `ws://${url}`;
    if (!/:\d+$/.test(url)) url += ':9000';
    joinRoom(url, cfg.name);
  });

  $('btn-create-room').addEventListener('click', async () => {
    let result;
    try {
      result = await window.golive.hostRoom({ name: cfg.name || 'anônimo' });
    } catch {
      $('setup-error').textContent = 'Não consegui subir a sala: erro inesperado. Tente de novo.';
      return;
    }
    if (!result.ok) {
      $('setup-error').textContent =
        result.error === 'PORTS_EXHAUSTED'
          ? 'Todas as portas 9000-9010 estão ocupadas. Feche outras instâncias do GoLive e tente de novo.'
          : `Não consegui subir a sala: ${result.error}`;
      return;
    }
    hostInfo = { port: result.port, address: result.address, firewall: result.firewall, addressWarning: result.addressWarning };
    joinRoom(`ws://127.0.0.1:${result.port}`, cfg.name, hostInfo.address);
  });

  // ---------- Conexao de sinalizacao ----------

  function joinRoom(url, name, publicAddress) {
    sig = signaling.connect(url, {
      onOpen: () => {
        cfg = config.addRecentRoom(cfg, { address: publicAddress || url, name: `sala de ${name || 'anônimo'}` });
        persist();
        renderRoomList();
        sig.send({ type: 'join', room: 'geral', name: name || 'anônimo' });
        ui.stageHeader.set({ name: `sala de ${name || 'anônimo'}`, address: publicAddress || url });
      },
      onMessage: handleSignal,
      onError: () => {
        $('setup-error').textContent =
          'Não consegui conectar. Confira o IP, se o servidor está rodando e se a porta está liberada no firewall.';
      },
      onClose: () => {
        ui.stageHeader.clear();
        mesh = null;
        ui.members.render(new Map());
      },
    });

    mesh = meshModule.createMesh({
      send: (payload) => sig.send(payload),
      onTrack: (peerId, name, stream) => ui.grid.showTile(peerId, name, stream),
      onPeerState: (peerId, { removedTile }) => {
        if (removedTile) ui.grid.removeTile(peerId, emptyMessage());
        ui.members.render(mesh.peers);
      },
    });
  }

  $('btn-copy-address').addEventListener('click', () => {
    if (hostInfo?.address) navigator.clipboard.writeText(hostInfo.address);
  });

  async function handleSignal(msg) {
    switch (msg.type) {
      case 'welcome': {
        myId = msg.id;
        for (const p of msg.peers) mesh.addPeer(p.id, p.name);
        ui.members.render(mesh.peers);
        break;
      }
      case 'peer-joined': {
        mesh.addPeer(msg.id, msg.name);
        ui.members.render(mesh.peers);
        if (localStream) await mesh.offerTo(msg.id, localStream, cfg.quality);
        break;
      }
      case 'peer-left': {
        mesh.removePeer(msg.id);
        ui.grid.removeTile(msg.id, emptyMessage());
        ui.members.render(mesh.peers);
        break;
      }
      case 'offer': {
        const answerSdp = await mesh.handleOffer(msg.from, msg.sdp);
        sig.send({ type: 'answer', to: msg.from, sdp: answerSdp });
        break;
      }
      case 'answer': {
        await mesh.handleAnswer(msg.from, msg.sdp);
        mesh.applyEncoding(cfg.quality);
        break;
      }
      case 'ice': {
        await mesh.handleIce(msg.from, msg.dir, msg.candidate);
        break;
      }
      case 'broadcast-state': {
        const peer = mesh.peers.get(msg.id);
        if (peer) peer.live = msg.live;
        if (!msg.live) ui.grid.removeTile(msg.id, emptyMessage());
        ui.members.render(mesh.peers);
        break;
      }
    }
  }

  // ---------- Compartilhar tela ----------

  $('btn-toggle-share').addEventListener('click', () => {
    if (localStream) return stopShare();
    ui.picker.open({ onGoLive: startShare });
  });

  async function startShare(sourceId, audioMode, audioDeviceId) {
    if (!sig) return;
    await window.golive.selectSource(sourceId, audioMode);

    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: config.videoConstraints(cfg.quality),
        audio: audioMode === 'system',
      });
    } catch (err) {
      alert(`Não consegui capturar a tela: ${err.message}`);
      return;
    }

    if (audioMode === 'device' && audioDeviceId) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: audioDeviceId } } });
        const [track] = micStream.getAudioTracks();
        if (track) localStream.addTrack(track);
      } catch {
        /* usuario recusou o dispositivo, segue so com video */
      }
    }

    const track = localStream.getVideoTracks()[0];
    if (track) {
      track.contentHint = 'motion';
      track.applyConstraints({ frameRate: { ideal: cfg.quality.fps, max: cfg.quality.fps } }).catch(() => {});
      track.addEventListener('ended', stopShare);
    }
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) audioTrack.contentHint = 'music';

    ui.grid.showTile('me', 'Você (prévia)', localStream, true);

    for (const peerId of mesh.peers.keys()) await mesh.offerTo(peerId, localStream, cfg.quality);

    sig.send({ type: 'broadcast-state', live: true });
    $('btn-toggle-share').classList.add('active');
    startStatsLoop();
  }

  function stopShare() {
    if (!localStream) return;
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    mesh.closeAllOut();
    ui.grid.removeTile('me', emptyMessage());
    sig.send({ type: 'broadcast-state', live: false });
    $('btn-toggle-share').classList.remove('active');
    stopStatsLoop();
  }

  // ---------- Estatisticas ----------

  function startStatsLoop() {
    stopStatsLoop();
    statsTimer = setInterval(updateStats, 1000);
  }

  function stopStatsLoop() {
    clearInterval(statsTimer);
    statsTimer = null;
    ui.settings.setStatsHtml('');
  }

  async function updateStats() {
    let fps = 0, bytes = 0, rtt = 0, width = 0, height = 0, codec = '', limitation = '', connections = 0;

    for (const peerId of mesh.peers.keys()) {
      const report = await mesh.statsFor(peerId);
      if (!report) continue;
      connections++;
      report.forEach((stat) => {
        if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
          fps = Math.max(fps, stat.framesPerSecond || 0);
          bytes += stat.bytesSent || 0;
          width = stat.frameWidth || width;
          height = stat.frameHeight || height;
          if (stat.qualityLimitationReason && stat.qualityLimitationReason !== 'none') {
            limitation = stat.qualityLimitationReason;
          }
        }
        if (stat.type === 'codec' && stat.mimeType?.startsWith('video/')) {
          codec = stat.mimeType.split('/')[1];
        }
        if (stat.type === 'candidate-pair' && stat.nominated && stat.currentRoundTripTime != null) {
          rtt = Math.max(rtt, stat.currentRoundTripTime * 1000);
        }
      });
    }

    const now = performance.now();
    let mbps = 0;
    if (lastAt) mbps = ((bytes - lastBytes) * 8) / ((now - lastAt) / 1000) / 1_000_000;
    lastBytes = bytes;
    lastAt = now;

    const motivo = { bandwidth: 'banda da rede insuficiente', cpu: 'CPU no limite', other: 'limite do encoder' }[limitation];

    ui.settings.setStatsHtml(`
      <div class="stat"><span>enviando pra</span><b>${connections} peer(s)</b></div>
      <div class="stat"><span>resolução</span><b>${width}x${height}</b></div>
      <div class="stat"><span>fps real</span><b class="${fps >= 50 ? 'good' : 'warn-text'}">${Math.round(fps)}</b></div>
      <div class="stat"><span>saída total</span><b>${mbps.toFixed(1)} Mbps</b></div>
      <div class="stat"><span>latência</span><b>${rtt ? Math.round(rtt) + ' ms' : '-'}</b></div>
      <div class="stat"><span>codec</span><b>${codec || '-'}</b></div>
      ${motivo ? `<div class="stat-warn">Limitado por: ${motivo}</div>` : ''}`);
  }
})();
