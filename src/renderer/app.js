// src/renderer/app.js
'use strict';

(function () {
  const { config, signaling, mesh: meshModule, ui, sound } = window.GoLive;

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
  // Funcoes de parada das capturas nativas de audio por processo (WASAPI
  // Process Loopback) ligadas ao compartilhamento de tela atual, se houver
  // -- ver startShare/stopShare. Vazio quando nao ha nenhuma rodando (sem
  // "compartilhar som", ou addon nativo indisponivel nesta maquina).
  let stopNativeAudioFns = [];
  let hostInfo = null;
  let activeRoomAddress = null;
  let statsTimer = null;
  let lastBytes = 0;
  let lastAt = 0;
  // Salas descobertas agora mesmo via broadcast UDP na LAN (main process,
  // src/main/discovery.js). Distinto de cfg.recentRooms (historico local).
  let discoveredRooms = [];

  // Cooldown de 2s pra entrar/sair da mesma sala repetidamente: endereco ->
  // timestamp da ultima transicao (entrada ou saida).
  const roomCooldowns = new Map();

  function cooldownRemaining(address) {
    if (!address) return 0;
    const last = roomCooldowns.get(address);
    if (last == null) return 0;
    return Math.max(0, 2000 - (Date.now() - last));
  }

  function markCooldown(address) {
    if (!address) return;
    roomCooldowns.set(address, Date.now());
    setTimeout(() => {
      renderRoomList();
      updateDisconnectButtonState();
    }, 2000);
  }

  function updateDisconnectButtonState() {
    const btn = $('btn-disconnect');
    btn.disabled = !!activeRoomAddress && cooldownRemaining(activeRoomAddress) > 0;
  }

  const $ = (id) => document.getElementById(id);

  function persist() {
    localStorage.setItem('golive', config.serialize(cfg));
  }

  function emptyMessage() {
    return currentSession ? 'Ninguém transmitindo ainda.' : 'Entre ou crie uma sala pra começar.';
  }

  // ---------- Painel do usuario ----------

  const nameInput = $('user-panel-name');
  const avatarBtn = $('user-panel-avatar');
  const avatarInput = $('user-panel-avatar-input');
  const avatarImg = $('user-panel-avatar-img');
  const avatarFallback = $('user-panel-avatar-fallback');

  function renderUserPanel() {
    nameInput.value = cfg.name || '';
    if (cfg.avatar) {
      avatarImg.src = cfg.avatar;
      avatarImg.classList.remove('hidden');
      avatarFallback.textContent = '';
    } else {
      avatarImg.classList.add('hidden');
      avatarImg.src = '';
      avatarFallback.textContent = (cfg.name || '?').trim().charAt(0).toUpperCase() || '?';
    }
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

  avatarBtn.addEventListener('click', () => avatarInput.click());

  function resizeImageToAvatar(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('load failed'));
      };
      img.src = url;
    });
  }

  avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files[0];
    avatarInput.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert('Imagem muito grande (máx. 10MB).');
      return;
    }
    try {
      const dataUrl = await resizeImageToAvatar(file);
      cfg = { ...cfg, avatar: dataUrl };
      persist();
      renderUserPanel();
    } catch {
      alert('Não consegui processar essa imagem.');
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
    currentSession?.mesh?.applyEncoding(cfg.quality, 'screen');
  }

  // ---------- Lista de salas ----------

  function renderRoomList() {
    ui.rooms.render(cfg.recentRooms, {
      activeAddress: activeRoomAddress,
      liveRooms: discoveredRooms,
      isOnCooldown: (address) => cooldownRemaining(address) > 0,
      onSelect: (room) => {
        if (room.address === activeRoomAddress) return; // já conectado nessa sala
        if (cooldownRemaining(room.address) > 0) return;
        hostInfo = null;
        renderHostWarning();
        // Sala que EU criei: o "servidor" dela é o meu proprio processo, que
        // morreu junto com o app da ultima vez que fechei. Nao existe nada
        // pra "entrar como convidado" nesse endereco -- a unica forma de
        // voltar pra ela e subir o host de novo (normalmente recupera o
        // mesmo endereco, ja que IP e porta tendem a se repetir).
        if (room.isOwn) {
          hostRoomFlow();
        } else {
          joinRoom(room.address, cfg.name);
        }
      },
      onDelete: (room) => {
        if (room.address === activeRoomAddress) {
          if (cooldownRemaining(activeRoomAddress) > 0) return; // delete de sala ativa espera o cooldown, evita estado desincronizado
          leaveRoom();
        }
        cfg = config.removeRecentRoom(cfg, room.address);
        persist();
        renderRoomList();
      },
    });
  }
  renderRoomList();
  renderMembersPanel();

  // Assina a lista de salas descobertas ao vivo na LAN (main process manda
  // sempre que a lista muda: sala nova anunciada ou sala expirou).
  window.golive.onRoomsDiscovered((rooms) => {
    discoveredRooms = Array.isArray(rooms) ? rooms : [];
    renderRoomList();
  });

  $('btn-refresh-discovery').addEventListener('click', () => {
    const btn = $('btn-refresh-discovery');
    btn.classList.remove('spin');
    void btn.offsetWidth; // força reflow pra reiniciar a animacao mesmo se clicado de novo dentro dos 600ms
    btn.classList.add('spin');
    window.golive.refreshDiscovery();
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

  // Sobe (ou re-sobe) o servidor embutido e entra nele como host. Usada tanto
  // pelo botao "Criar sala" quanto ao reconectar numa sala propria que estava
  // salva em "Recentes" (ver isOwn em onSelect, acima).
  async function hostRoomFlow() {
    $('setup-error').textContent = '';
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
  }

  $('btn-create-room').addEventListener('click', async () => {
    const btn = $('btn-create-room');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      await hostRoomFlow();
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
      stopNativeAudioFns.forEach((stop) => stop());
      stopNativeAudioFns = [];
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
    renderMembersPanel();
  }

  // ---------- Painel "Na sala" (membros + eu) ----------

  // `currentSession` so passa a existir com id/nome depois do 'welcome' (ver
  // handleSignal), mas mostramos o proprio usuario assim que a sessao existe
  // -- sem isso a coluna direita fica em branco enquanto o handshake nao
  // termina, e ele nunca aparece pra si mesmo mesmo depois.
  function currentSelfInfo() {
    if (!currentSession) return null;
    return { name: cfg.name || 'anônimo', avatar: cfg.avatar || null, live: !!localStream };
  }

  function renderMembersPanel() {
    ui.members.render(currentSession ? currentSession.mesh.peers : new Map(), currentSelfInfo());
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

  // Endereco "canonico" (sem esquema ws://) usado como chave em
  // cfg.recentRooms/activeRoomAddress. Sem isso, entrar numa sala pelo
  // endereco cru ("192.168.1.5:9000", vindo da lista ou digitado a mao) e
  // entrar na MESMA sala hospedada por voce (que guarda o endereco sem
  // esquema) geravam duas entradas distintas pro mesmo lugar -- uma com
  // "ws://" e outra sem.
  function canonicalAddress(url) {
    return url.replace(/^wss?:\/\//, '');
  }

  function joinRoom(rawUrl, name, publicAddress, onSettled) {
    $('setup-error').textContent = '';
    const url = normalizeRoomUrl(rawUrl);
    const roomAddress = publicAddress || canonicalAddress(url);

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
          session.opened = true;
          activeRoomAddress = roomAddress;
          cfg = config.addRecentRoom(cfg, {
            address: roomAddress,
            name: `sala de ${name || 'anônimo'}`,
            isOwn: !!publicAddress, // publicAddress só vem preenchido quando EU estou hospedando (ver hostRoomFlow)
          });
          persist();
          markCooldown(activeRoomAddress);
          updateDisconnectButtonState();
          renderRoomList();
          session.sig.send({ type: 'join', room: 'geral', name: name || 'anônimo', avatar: cfg.avatar || null });
          ui.stageHeader.set({ name: `sala de ${name || 'anônimo'}`, address: roomAddress });
          sound.playJoinSound();
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
          // Se a conexao nunca chegou a abrir (ex: sala propria cujo host
          // morreu junto com o app anterior), nao ha sessao pra desmontar --
          // so teardownSession() ja limpava o painel de membros pra "só você
          // por aqui" mesmo sem ter entrado em lugar nenhum, mascarando o
          // erro de conexao que o onError acima acabou de mostrar.
          if (session.opened) teardownSession(session);
          renderMembersPanel();
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
      onTrack: (peerId, peerName, stream, kind) => {
        if (currentSession !== session) return;
        const peer = session.mesh.peers.get(peerId);
        const tileId = kind === 'camera' ? `cam-${peerId}` : peerId;
        ui.grid.showTile(tileId, peerName, stream, { avatar: peer?.avatar || null, kind });
      },
      onPeerState: (peerId, { removedTile, kind }) => {
        if (currentSession !== session) return;
        if (removedTile) ui.grid.removeTile(kind === 'camera' ? `cam-${peerId}` : peerId, emptyMessage());
        renderMembersPanel();
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
    if (cooldownRemaining(activeRoomAddress) > 0) return;
    sound.playLeaveSound();
    const session = currentSession;
    const leavingAddress = activeRoomAddress;
    currentSession = null;
    activeRoomAddress = null;
    hostInfo = null;
    session.sig?.close();
    ui.stageHeader.clear();
    renderHostWarning();
    teardownSession(session);
    markCooldown(leavingAddress);
    renderRoomList();
  }
  $('btn-disconnect').addEventListener('click', () => {
    if (cooldownRemaining(activeRoomAddress) > 0) return;
    leaveRoom();
  });

  async function handleSignal(session, msg) {
    if (currentSession !== session) return;
    const mesh = session.mesh;
    const sig = session.sig;
    switch (msg.type) {
      case 'welcome': {
        myId = msg.id;
        for (const p of msg.peers) mesh.addPeer(p.id, p.name, p.avatar);
        renderMembersPanel();
        break;
      }
      case 'peer-joined': {
        mesh.addPeer(msg.id, msg.name, msg.avatar);
        renderMembersPanel();
        sound.playJoinSound();
        if (localStream) await mesh.offerTo(msg.id, localStream, cfg.quality, 'screen');
        if (cameraStream) await mesh.offerTo(msg.id, cameraStream, { ...cfg.camera, codec: 'video/VP8' }, 'camera');
        break;
      }
      case 'peer-left': {
        mesh.removePeer(msg.id);
        ui.grid.removeTile(msg.id, emptyMessage());
        ui.grid.removeTile(`cam-${msg.id}`, emptyMessage());
        renderMembersPanel();
        sound.playLeaveSound();
        break;
      }
      case 'offer': {
        const answerSdp = await mesh.handleOffer(msg.from, msg.sdp, msg.kind);
        if (currentSession !== session) return; // sessao caiu enquanto negociava
        sig.send({ type: 'answer', to: msg.from, sdp: answerSdp, kind: msg.kind });
        break;
      }
      case 'answer': {
        await mesh.handleAnswer(msg.from, msg.sdp, msg.kind);
        if (currentSession !== session) return;
        const quality = msg.kind === 'camera' ? { ...cfg.camera, codec: 'video/VP8' } : cfg.quality;
        mesh.applyEncoding(quality, msg.kind);
        break;
      }
      case 'ice': {
        await mesh.handleIce(msg.from, msg.dir, msg.candidate, msg.kind);
        break;
      }
      case 'broadcast-state': {
        const peer = mesh.peers.get(msg.id);
        if (peer) peer.live = msg.live;
        if (!msg.live) ui.grid.removeTile(msg.id, emptyMessage());
        renderMembersPanel();
        break;
      }
    }
  }

  // ---------- Audio por processo (WASAPI Process Loopback) ----------
  //
  // Alternativa ao loopback de sistema padrao do Electron: em vez de pegar
  // TODO o audio da maquina, o addon nativo (src/main.js + native/) captura
  // (ou exclui) o audio de um processo especifico. So existe de verdade no
  // Windows com o addon compilado -- em qualquer outra situacao
  // startProcessAudioCapture devolve `{ ok: false }` e quem chamou cai pro
  // loopback de sistema normal (ver startShare).
  //
  // O audio chega aqui como PCM float32 cru via IPC (main -> renderer), nao
  // como uma MediaStreamTrack pronta -- pcm-injector-worklet.js e a ponte
  // que injeta essas amostras num AudioWorkletNode de verdade, que da pra
  // conectar num grafo do Web Audio (e dali, misturar e virar uma track).

  let pcmAudioContext = null;
  let pcmWorkletModule = null; // promise, carregado uma unica vez
  const pcmNodesByCapture = new Map(); // captureId -> AudioWorkletNode

  function getPcmAudioContext() {
    if (!pcmAudioContext) pcmAudioContext = new AudioContext({ sampleRate: 48000 });
    return pcmAudioContext;
  }

  async function ensurePcmWorklet() {
    const ctx = getPcmAudioContext();
    if (!pcmWorkletModule) pcmWorkletModule = ctx.audioWorklet.addModule('pcm-injector-worklet.js');
    await pcmWorkletModule;
    return ctx;
  }

  window.golive.onAudioChunk((captureId, samples, channels) => {
    pcmNodesByCapture.get(captureId)?.port.postMessage({ samples, channels });
  });

  // Sobe uma captura nativa por processo e devolve o AudioWorkletNode ainda
  // desconectado (quem chama decide pra onde ligar -- normalmente direto
  // num MediaStreamAudioDestinationNode, sozinho ou junto de outro node
  // pra misturar), mais uma funcao `stop()`. Devolve null se indisponivel
  // ou a ativacao falhar (ex: processo sumiu entre escolher e confirmar).
  async function startNativeProcessAudioNode(ctx, pid, exclude) {
    const result = await window.golive.startProcessAudioCapture(pid, exclude);
    if (!result.ok) return null;
    const node = new AudioWorkletNode(ctx, 'pcm-injector', { outputChannelCount: [2] });
    pcmNodesByCapture.set(result.captureId, node);
    return {
      node,
      stop: () => {
        pcmNodesByCapture.delete(result.captureId);
        try {
          node.disconnect();
        } catch {
          /* ja desconectado */
        }
        window.golive.stopProcessAudioCapture(result.captureId).catch(() => {});
      },
    };
  }

  // ---------- Compartilhar tela ----------

  $('btn-toggle-share').addEventListener('click', () => {
    if (localStream) return stopShare();
    if (sharing) return; // ja tem um startShare() em andamento, ignora o duplo clique
    if (!currentSession || !currentSession.sig.isOpen()) return;
    ui.picker.open({ onGoLive: startShare });
  });

  async function startShare(sourceId, shareSound, includeDiscord) {
    if (sharing || localStream) return;
    const session = currentSession;
    if (!session || !session.sig.isOpen()) return;

    sharing = true;
    const startedNativeStops = [];
    try {
      // Estrategia de audio, decidida ANTES de chamar getDisplayMedia
      // porque o modo passado pra sources:select determina se o Electron
      // tenta anexar o loopback de sistema no video capturado:
      //  - compartilhando so uma JANELA: audio-base = so o app dono dela
      //    (captura nativa por processo, modo "incluir").
      //  - compartilhando a TELA inteira: audio-base = sistema inteiro
      //    EXCLUINDO o Discord (captura nativa, modo "excluir"). Sem
      //    Discord rodando (ou sem o addon nativo nesta maquina), cai pro
      //    loopback de sistema normal do Electron -- nao ha o que excluir
      //    mesmo, e esse caminho ja e testado e simples.
      const isWindowSource = typeof sourceId === 'string' && sourceId.startsWith('window:');
      const discordPid = shareSound ? await window.golive.findDiscordPid() : 0;

      let useElectronLoopback = false;
      let basePid = 0;
      let baseExclude = false;
      if (shareSound) {
        if (isWindowSource) {
          basePid = await window.golive.pidForSource(sourceId);
          // Nao achou o PID da janela (SO diferente do Windows, addon
          // indisponivel, ou a janela sumiu entre escolher e confirmar) --
          // melhor cair pro sistema inteiro do que nao ter audio nenhum.
          if (!basePid) useElectronLoopback = true;
        } else if (discordPid) {
          basePid = discordPid;
          baseExclude = true;
        } else {
          useElectronLoopback = true;
        }
      }

      await window.golive.selectSource(sourceId, useElectronLoopback ? 'system' : 'none');
      if (currentSession !== session) return; // sessao caiu antes de capturar qualquer coisa

      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: config.videoConstraints(cfg.quality),
          audio: useElectronLoopback,
        });
      } catch (err) {
        alert(`Não consegui capturar a tela: ${err.message}`);
        return;
      }

      if (currentSession !== session) {
        stream.getTracks().forEach((t) => t.stop()); // sessao caiu durante o picker do SO, nao deixa a captura orfa rodando
        return;
      }

      // Captura nativa por processo (base + Discord opcional), misturadas
      // num unico MediaStreamAudioDestinationNode -- so entra aqui quando
      // NAO estamos usando o loopback do Electron (os dois sao alternativas
      // mutuamente exclusivas, nunca somados, senao duplicaria o audio do
      // sistema).
      if (basePid) {
        const ctx = await ensurePcmWorklet();
        const dest = ctx.createMediaStreamDestination();

        const base = await startNativeProcessAudioNode(ctx, basePid, baseExclude);
        if (base) {
          base.node.connect(dest);
          startedNativeStops.push(base.stop);
        }
        if (includeDiscord && discordPid && discordPid !== basePid) {
          const discordNode = await startNativeProcessAudioNode(ctx, discordPid, false);
          if (discordNode) {
            discordNode.node.connect(dest);
            startedNativeStops.push(discordNode.stop);
          }
        }

        if (currentSession !== session) {
          stream.getTracks().forEach((t) => t.stop());
          startedNativeStops.forEach((stop) => stop());
          return;
        }

        const mixedTrack = dest.stream.getAudioTracks()[0];
        if (mixedTrack) stream.addTrack(mixedTrack);
      }

      localStream = stream;
      stopNativeAudioFns = startedNativeStops;
      const track = localStream.getVideoTracks()[0];
      if (track) {
        track.contentHint = 'motion';
        track.applyConstraints({ frameRate: { ideal: cfg.quality.fps, max: cfg.quality.fps } }).catch(() => {});
        track.addEventListener('ended', stopShare);
      }
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) audioTrack.contentHint = 'music';

      ui.grid.showTile('me', 'Você (prévia)', localStream, { muted: true, avatar: cfg.avatar || null, kind: 'screen', displayName: cfg.name || 'anônimo' });

      for (const peerId of session.mesh.peers.keys()) {
        await session.mesh.offerTo(peerId, localStream, cfg.quality, 'screen');
      }
      if (currentSession !== session) return;

      session.sig.send({ type: 'broadcast-state', live: true });
      $('btn-toggle-share').classList.add('active');
      renderMembersPanel();
      startStatsLoop();
    } finally {
      sharing = false;
    }
  }

  function stopShare() {
    if (!localStream) return;
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    stopNativeAudioFns.forEach((stop) => stop());
    stopNativeAudioFns = [];
    currentSession?.mesh?.closeAllOut('screen');
    ui.grid.removeTile('me', emptyMessage());
    if (currentSession?.sig?.isOpen()) currentSession.sig.send({ type: 'broadcast-state', live: false });
    $('btn-toggle-share').classList.remove('active');
    renderMembersPanel();
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
    // A camera leva um tempo pra abrir (o driver e quem manda nisso), entao
    // o botao acusa o clique na hora em vez de ficar parecendo que nada
    // aconteceu ate o primeiro frame chegar.
    $('btn-toggle-camera').classList.add('loading');
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

      ui.grid.showTile('cam-me', 'Você (câmera)', cameraStream, { muted: true, avatar: cfg.avatar || null, kind: 'camera', displayName: cfg.name || 'anônimo' });
      $('btn-toggle-camera').classList.add('active');

      if (currentSession) {
        const quality = { ...cfg.camera, codec: 'video/VP8' };
        for (const peerId of currentSession.mesh.peers.keys()) {
          await currentSession.mesh.offerTo(peerId, cameraStream, quality, 'camera');
        }
      }
    } finally {
      cameraStarting = false;
      $('btn-toggle-camera').classList.remove('loading');
    }
  }

  // Aquece a pilha de captura de midia do Chromium logo na abertura do app:
  // a primeira chamada de enumerateDevices/getUserMedia e a que paga por
  // enumerar os dispositivos, e fazer isso aqui tira esse custo do clique
  // no botao da camera.
  navigator.mediaDevices?.enumerateDevices().catch(() => {});

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
          session.mesh.removeTrack(peerId, track, 'camera').catch(() => {})
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
