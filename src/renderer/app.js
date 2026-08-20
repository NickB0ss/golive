// src/renderer/app.js
'use strict';

(function () {
  const { config, signaling, mesh: meshModule, ui } = window.GoLive;

  let cfg = config.load(localStorage.getItem('golive'));
  // `currentSession` is the single source of truth for "the session that is
  // live right now". Every async callback (WS messages, WebRTC events,
  // capture promises) captures the specific `session` object it belongs to
  // and checks `currentSession !== session` before touching anything — that
  // way a late event from a torn-down or superseded session is a no-op
  // instead of throwing on stale/null state.
  let currentSession = null; // { sig, mesh } | null
  let myId = null;
  let localStream = null;
  let sharing = false; // in-flight latch: true while startShare() is mid-flight
  let cameraStream = null;
  let cameraStarting = false; // in-flight latch: true while startCamera() is mid-flight
  let hostInfo = null;
  let activeRoomAddress = null;
  let statsTimer = null;
  let lastBytes = 0;
  let lastAt = 0;
  // Salas descobertas agora mesmo via broadcast UDP na LAN (main process,
  // src/main/discovery.js). Distinto de cfg.recentRooms (historico local).
  let discoveredRooms = [];

  const $ = (id) => document.getElementById(id);

  function persist() {
    localStorage.setItem('golive', config.serialize(cfg));
  }

  function emptyMessage() {
    return currentSession ? 'Ninguém transmitindo ainda.' : 'Entre ou crie uma sala pra começar.';
  }

  // ---------- Painel do usuario ----------

  const nameInput = $('user-panel-name');

  function renderUserPanel() {
    nameInput.value = cfg.name || '';
  }
  renderUserPanel();

  function commitName() {
    const value = nameInput.value.trim();
    cfg = { ...cfg, name: value };
    persist();
    renderUserPanel();
  }
  nameInput.addEventListener('blur', commitName);
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      nameInput.blur(); // dispara commitName via blur
    } else if (event.key === 'Escape') {
      renderUserPanel();
      nameInput.blur();
    }
  });

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
      onCameraDeviceChange: (deviceId) => {
        cfg = { ...cfg, camera: { ...cfg.camera, deviceId } };
        persist();
        if (cameraStream) restartCamera();
      },
      onNetworkChange: (network) => {
        cfg = { ...cfg, network };
        persist();
        window.golive.setAdvertise(network.advertise);
      },
    });
  });

  async function applyLiveQuality() {
    const track = localStream.getVideoTracks()[0];
    if (track) {
      await track.applyConstraints(config.videoConstraints(cfg.quality)).catch(() => {});
    }
    currentSession?.mesh?.applyEncoding(cfg.quality);
  }

  // ---------- Lista de salas ----------

  function renderRoomList() {
    ui.rooms.render(cfg.recentRooms, {
      activeAddress: activeRoomAddress,
      liveRooms: discoveredRooms,
      onSelect: (room) => {
        if (room.address === activeRoomAddress) return; // já conectado nessa sala
        hostInfo = null;
        renderHostWarning();
        joinRoom(room.address, cfg.name);
      },
      onDelete: (room) => {
        if (room.address === activeRoomAddress) leaveRoom();
        cfg = config.removeRecentRoom(cfg, room.address);
        persist();
        renderRoomList();
      },
    });
  }
  renderRoomList();

  // Assina a lista de salas descobertas ao vivo na LAN (main process manda
  // sempre que a lista muda: sala nova anunciada ou sala expirou).
  window.golive.onRoomsDiscovered((rooms) => {
    discoveredRooms = Array.isArray(rooms) ? rooms : [];
    renderRoomList();
  });

  $('btn-join-address').addEventListener('click', () => {
    $('join-address-form').classList.toggle('hidden');
  });

  $('btn-connect').addEventListener('click', () => {
    $('setup-error').textContent = '';
    const url = $('in-server').value.trim();
    if (!url) return ($('setup-error').textContent = 'Informe o endereço do servidor.');

    hostInfo = null;
    renderHostWarning();

    const btn = $('btn-connect');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Conectando…';
    const restoreBtn = () => {
      btn.disabled = false;
      btn.textContent = originalText;
    };

    joinRoom(url, cfg.name, undefined, restoreBtn);
  });

  $('btn-create-room').addEventListener('click', async () => {
    $('setup-error').textContent = '';
    const btn = $('btn-create-room');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';

    try {
      let result;
      try {
        result = await window.golive.hostRoom({ name: cfg.name || 'anônimo', advertise: cfg.network.advertise });
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
      renderHostWarning();
      joinRoom(`ws://127.0.0.1:${result.port}`, cfg.name, hostInfo.address);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // ---------- Aviso de firewall/endereco do host ----------

  function renderHostWarning() {
    const el = $('stage-warning');
    if (!el) return;
    if (!hostInfo) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    const parts = [];
    if (hostInfo.addressWarning) {
      parts.push(`${hostInfo.addressWarning} — o endereço abaixo só funciona na mesma rede local.`);
    }
    if (hostInfo.firewall && !hostInfo.firewall.ok) {
      parts.push(
        `Não consegui liberar a porta no firewall automaticamente. Comando manual: ${hostInfo.firewall.manualCommand}`
      );
    }
    if (!parts.length) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.textContent = parts.join(' ');
    el.classList.remove('hidden');
  }
  renderHostWarning();

  // ---------- Encerramento de sessao (desconexao ou troca de sala) ----------

  // Limpa o estado de UI/mesh associado a uma sessao especifica. Chamada so
  // depois que `currentSession` ja deixou de apontar pra ela, entao qualquer
  // callback tardio dessa sessao ja vai ter parado de agir sozinho.
  function teardownSession(session) {
    stopStatsLoop();
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
      ui.grid.removeTile('me', emptyMessage());
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
      ui.grid.removeTile('cam-me', emptyMessage());
      $('btn-toggle-camera').classList.remove('active');
    }
    if (session?.mesh) {
      for (const peerId of Array.from(session.mesh.peers.keys())) {
        session.mesh.removePeer(peerId);
        ui.grid.removeTile(peerId, emptyMessage());
      }
    }
    $('btn-toggle-share').classList.remove('active');
    ui.members.render(new Map());
  }

  // ---------- Conexao de sinalizacao ----------

  // Aceita endereco cru ("192.168.1.5:9000", como vem da lista de salas ou
  // do historico) alem de URL ja completa (ws://... vindo de "Criar sala").
  // Sem isso, `new WebSocket()` estoura sincronamente com endereco sem esquema.
  function normalizeRoomUrl(url) {
    let out = url;
    if (!/^wss?:\/\//.test(out)) out = `ws://${out}`;
    if (!/:\d+$/.test(out)) out += ':9000';
    return out;
  }

  function joinRoom(rawUrl, name, publicAddress, onSettled) {
    $('setup-error').textContent = '';
    const url = normalizeRoomUrl(rawUrl);

    if (currentSession) {
      const oldSession = currentSession;
      currentSession = null; // invalida a sessao antiga imediatamente
      activeRoomAddress = null;
      oldSession.sig?.close();
      ui.stageHeader.clear();
      teardownSession(oldSession);
    }

    const session = { sig: null, mesh: null };

    let connHandle;
    try {
      connHandle = signaling.connect(url, {
        onOpen: () => {
          if (currentSession !== session) return;
          activeRoomAddress = publicAddress || url;
          cfg = config.addRecentRoom(cfg, { address: publicAddress || url, name: `sala de ${name || 'anônimo'}` });
          persist();
          renderRoomList();
          session.sig.send({ type: 'join', room: 'geral', name: name || 'anônimo' });
          ui.stageHeader.set({ name: `sala de ${name || 'anônimo'}`, address: publicAddress || url });
          onSettled?.();
        },
        onMessage: (msg) => handleSignal(session, msg),
        onError: () => {
          if (currentSession === session) {
            $('setup-error').textContent =
              'Não consegui conectar. Confira o IP, se o servidor está rodando e se a porta está liberada no firewall.';
          }
          onSettled?.();
        },
        onClose: () => {
          if (currentSession !== session) return; // conexao antiga, ja substituida
          currentSession = null;
          activeRoomAddress = null;
          ui.stageHeader.clear();
          teardownSession(session);
          renderRoomList();
        },
      });
    } catch {
      // Endereco malformado (ex: porta nao numerica) faz `new WebSocket`
      // estourar de forma sincrona. Sem isso o botao que chamou joinRoom
      // ficava travado em "Conectando…" pra sempre.
      $('setup-error').textContent = 'Não consegui conectar: endereço inválido.';
      onSettled?.();
      return;
    }
    session.sig = connHandle;

    session.mesh = meshModule.createMesh({
      send: (payload) => {
        if (currentSession === session) session.sig.send(payload);
      },
      onTrack: (peerId, peerName, stream) => {
        if (currentSession !== session) return;
        ui.grid.showTile(peerId, peerName, stream);
      },
      onPeerState: (peerId, { removedTile }) => {
        if (currentSession !== session) return;
        if (removedTile) ui.grid.removeTile(peerId, emptyMessage());
        ui.members.render(session.mesh.peers);
      },
    });

    currentSession = session;
  }

  $('btn-copy-address').addEventListener('click', () => {
    if (hostInfo?.address) navigator.clipboard.writeText(hostInfo.address);
  });

  // ---------- Desconectar ----------

  function leaveRoom() {
    if (!currentSession) return;
    const session = currentSession;
    currentSession = null;
    activeRoomAddress = null;
    hostInfo = null;
    session.sig?.close();
    ui.stageHeader.clear();
    renderHostWarning();
    teardownSession(session);
    renderRoomList();
  }
  $('btn-disconnect').addEventListener('click', leaveRoom);

  async function handleSignal(session, msg) {
    if (currentSession !== session) return;
    const mesh = session.mesh;
    const sig = session.sig;
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
        if (currentSession !== session) return; // sessao caiu enquanto negociava
        sig.send({ type: 'answer', to: msg.from, sdp: answerSdp });
        break;
      }
      case 'answer': {
        await mesh.handleAnswer(msg.from, msg.sdp);
        if (currentSession !== session) return;
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
    if (sharing) return; // ja tem um startShare() em andamento, ignora o duplo clique
    if (!currentSession || !currentSession.sig.isOpen()) return;
    ui.picker.open({ onGoLive: startShare });
  });

  async function startShare(sourceId, audioMode, audioDeviceId) {
    if (sharing || localStream) return;
    const session = currentSession;
    if (!session || !session.sig.isOpen()) return;

    sharing = true;
    try {
      await window.golive.selectSource(sourceId, audioMode);
      if (currentSession !== session) return; // sessao caiu antes de capturar qualquer coisa

      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: config.videoConstraints(cfg.quality),
          audio: audioMode === 'system',
        });
      } catch (err) {
        alert(`Não consegui capturar a tela: ${err.message}`);
        return;
      }

      if (currentSession !== session) {
        stream.getTracks().forEach((t) => t.stop()); // sessao caiu durante o picker do SO, nao deixa a captura orfa rodando
        return;
      }

      if (audioMode === 'device' && audioDeviceId) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: audioDeviceId } } });
          if (currentSession !== session) {
            stream.getTracks().forEach((t) => t.stop());
            micStream.getTracks().forEach((t) => t.stop());
            return;
          }
          const [track] = micStream.getAudioTracks();
          if (track) stream.addTrack(track);
        } catch {
          /* usuario recusou o dispositivo, segue so com video */
        }
      }

      localStream = stream;
      const track = localStream.getVideoTracks()[0];
      if (track) {
        track.contentHint = 'motion';
        track.applyConstraints({ frameRate: { ideal: cfg.quality.fps, max: cfg.quality.fps } }).catch(() => {});
        track.addEventListener('ended', stopShare);
      }
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) audioTrack.contentHint = 'music';

      ui.grid.showTile('me', 'Você (prévia)', localStream, true);

      for (const peerId of session.mesh.peers.keys()) await session.mesh.offerTo(peerId, localStream, cfg.quality);
      if (currentSession !== session) return;

      session.sig.send({ type: 'broadcast-state', live: true });
      $('btn-toggle-share').classList.add('active');
      startStatsLoop();
    } finally {
      sharing = false;
    }
  }

  function stopShare() {
    if (!localStream) return;
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    currentSession?.mesh?.closeAllOut();
    ui.grid.removeTile('me', emptyMessage());
    if (currentSession?.sig?.isOpen()) currentSession.sig.send({ type: 'broadcast-state', live: false });
    $('btn-toggle-share').classList.remove('active');
    stopStatsLoop();
  }

  // ---------- Câmera ----------

  $('btn-toggle-camera').addEventListener('click', () => {
    if (cameraStream) return stopCamera();
    if (cameraStarting) return; // ja tem um startCamera() em andamento, ignora o duplo clique
    startCamera();
  });

  async function startCamera() {
    if (cameraStream || cameraStarting) return;
    cameraStarting = true;
    try {
      const constraints = config.cameraConstraints(cfg.camera);
      if (cfg.camera.deviceId) constraints.deviceId = { exact: cfg.camera.deviceId };

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
      } catch (err) {
        alert(`Não consegui acessar a câmera: ${err.message}`);
        return;
      }

      cameraStream = stream;
      const track = cameraStream.getVideoTracks()[0];
      if (track) track.addEventListener('ended', stopCamera);

      ui.grid.showTile('cam-me', 'Você (câmera)', cameraStream, true);
      $('btn-toggle-camera').classList.add('active');

      if (currentSession) {
        const quality = { ...cfg.camera, codec: 'video/VP8' };
        for (const peerId of currentSession.mesh.peers.keys()) {
          await currentSession.mesh.offerTo(peerId, cameraStream, quality);
        }
      }
    } finally {
      cameraStarting = false;
    }
  }

  // Para a captura local e renegocia com cada peer pra remover a track de
  // camera da outConn (sem derrubar outras tracks ativas na mesma conexao,
  // como o compartilhamento de tela). Sem isso, o peer remoto continuava
  // vendo o ultimo frame da camera congelado indefinidamente mesmo depois
  // de desligada aqui — a conexao WebRTC seguia "viva" com aquela track.
  async function stopCamera() {
    if (!cameraStream) return;
    const track = cameraStream.getVideoTracks()[0];
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
    ui.grid.removeTile('cam-me', emptyMessage());
    $('btn-toggle-camera').classList.remove('active');

    if (currentSession && track) {
      const session = currentSession;
      await Promise.all(
        Array.from(session.mesh.peers.keys()).map((peerId) =>
          session.mesh.removeTrack(peerId, track).catch(() => {})
        )
      );
    }
  }

  async function restartCamera() {
    await stopCamera();
    await startCamera();
  }

  // ---------- Estatisticas ----------

  function startStatsLoop() {
    stopStatsLoop();
    lastBytes = 0;
    lastAt = 0;
    statsTimer = setInterval(updateStats, 1000);
  }

  function stopStatsLoop() {
    clearInterval(statsTimer);
    statsTimer = null;
    ui.settings.setStatsHtml('');
  }

  async function updateStats() {
    const session = currentSession;
    if (!session?.mesh) return;
    const activeMesh = session.mesh;

    let fps = 0, bytes = 0, rtt = 0, width = 0, height = 0, codec = '', limitation = '', connections = 0;

    for (const peerId of activeMesh.peers.keys()) {
      if (currentSession !== session) return; // sessao encerrou enquanto aguardavamos as stats
      const report = await activeMesh.statsFor(peerId);
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

    if (currentSession !== session) return; // sessao caiu enquanto aguardavamos as stats

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
