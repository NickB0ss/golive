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
  const { tree } = window.GoLive;
  let myId = null;

  // Topologia da arvore de retransmissao (F2), por kind -- so significativa
  // quando ESTA sessao e a origem daquele kind (localStream/cameraStream
  // existe). epoch sobe a cada recalculo, mesmo quando o resultado nao
  // muda -- o pior caso e um recalculo redundante, nao uma atribuicao velha
  // vencendo (ver a mensagem 'tree' em handleSignal, Task 5).
  const originTree = {
    screen: { epoch: 0, assignments: new Map() },
    camera: { epoch: 0, assignments: new Map() },
  };
  // Papel que ESTA sessao recebeu de alguma origem, por kind -- so
  // relevante quando esta sessao NAO e a origem daquele kind. 'relayed'
  // registra pra quais filhos ja repassamos NESTE epoch, pra relayTo nao
  // ser chamado duas vezes pro mesmo filho (duplicaria transceivers) --
  // ver o retry em 'offer' no handleSignal.
  const myRole = {
    screen: { epoch: 0, role: 'direct', paiId: null, filhosIds: [], relayed: new Set() },
    camera: { epoch: 0, role: 'direct', paiId: null, filhosIds: [], relayed: new Set() },
  };
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
  // Amostra anterior por sender (`${peerId}:${kind}`), pra derivar taxas a
  // partir dos contadores acumulados do getStats: Mbps a partir de
  // bytesSent, e ms de encode por frame a partir de totalEncodeTime e
  // framesEncoded. Sem a amostra anterior so daria pra ver a media desde o
  // inicio da conexao, que esconde exatamente o momento em que o encoder
  // comeca a sofrer.
  const statsPrev = new Map();
  // Aviso derivado das estatisticas (encoder em software). Fica separado do
  // aviso de host porque os dois dividem o mesmo #stage-warning.
  let encoderWarning = '';
  // Salas descobertas agora mesmo via broadcast UDP na LAN (main process,
  // src/main/discovery.js) -- nao ha historico local salvo em disco.
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

  // ---------- Painel do usuario (so exibicao -- edicao mora em Configuracoes > Perfil) ----------

  const nameDisplay = $('user-panel-name');
  const avatarBtn = $('user-panel-avatar');
  const avatarImg = $('user-panel-avatar-img');
  const avatarFallback = $('user-panel-avatar-fallback');

  function renderUserPanel() {
    nameDisplay.textContent = cfg.name || 'anônimo';
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

  avatarBtn.addEventListener('click', openSettingsOnProfile);
  nameDisplay.addEventListener('click', openSettingsOnProfile);

  // GIFs animados nao sobrevivem ao redimensionamento via canvas (drawImage +
  // toDataURL so capturam um frame estatico) -- pra manter a animacao, GIF
  // vai direto como data URL, sem passar pelo canvas.
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('load failed'));
      reader.readAsDataURL(file);
    });
  }

  function resizeImageToAvatar(file) {
    if (file.type === 'image/gif') return readFileAsDataUrl(file);
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

  function openSettingsOnProfile() {
    $('btn-open-settings').click();
    document.querySelector('.settings-cat[data-cat="profile"]')?.click();
  }

  $('btn-open-settings').addEventListener('click', () => {
    ui.settings.open(cfg, {
      getConfig: () => cfg,
      onNameChange: (name) => {
        cfg = { ...cfg, name };
        persist();
        renderUserPanel();
      },
      onAvatarChange: async (file) => {
        // GIFs vao sem redimensionar (ver resizeImageToAvatar), entao o
        // limite e mais apertado pra nao inflar demais as mensagens de
        // sala/join.
        const maxSize = file.type === 'image/gif' ? 3 * 1024 * 1024 : 10 * 1024 * 1024;
        if (file.size > maxSize) {
          alert(`Imagem muito grande (máx. ${Math.round(maxSize / (1024 * 1024))}MB).`);
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

  // Escolhida no dialogo de compartilhar (ver ui.picker.open, no clique de
  // "Compartilhar tela"), nao mais nas Configuracoes -- e a qualidade que
  // vai valer pra transmissao que esta prestes a comecar.
  function onQualityPresetChange(quality) {
    cfg = { ...cfg, quality };
    persist();
    if (localStream) applyLiveQuality();
  }

  // ---------- Lista de salas ----------

  function renderRoomList() {
    ui.rooms.render({
      activeAddress: activeRoomAddress,
      liveRooms: discoveredRooms,
      isOnCooldown: (address) => cooldownRemaining(address) > 0,
      onSelect: (room) => {
        if (room.address === activeRoomAddress) return; // já conectado nessa sala
        if (cooldownRemaining(room.address) > 0) return;
        hostInfo = null;
        renderHostWarning();
        joinRoom(room.address, cfg.name);
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

  // Auto-update: mostra um aviso discreto no canto quando ha uma versao
  // nova baixada. Nao reinicia sozinho -- se houver uma sessao ao vivo,
  // avisamos que vai esperar terminar a chamada antes de deixar reiniciar.
  let updateDownloaded = false;
  function renderUpdateBanner() {
    const banner = $('update-banner');
    const text = $('update-banner-text');
    const btn = $('btn-update-install');
    if (!updateDownloaded) return;
    banner.classList.remove('hidden');
    text.textContent = currentSession
      ? 'Atualização pronta. Será aplicada ao sair da sala atual.'
      : 'Atualização pronta.';
    btn.classList.toggle('hidden', !!currentSession);
  }
  window.golive.onUpdateStatus?.(({ status }) => {
    const banner = $('update-banner');
    const text = $('update-banner-text');
    const btn = $('btn-update-install');
    if (status === 'downloaded') {
      updateDownloaded = true;
      renderUpdateBanner();
    } else if (status === 'downloading') {
      banner.classList.remove('hidden');
      btn.classList.add('hidden');
      text.textContent = 'Baixando atualização…';
    }
  });

  $('btn-update-install').addEventListener('click', () => {
    if (currentSession) return; // nunca derruba uma chamada em andamento
    window.golive.installUpdate();
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

  // Um unico #stage-warning atende duas fontes independentes: os avisos de
  // host (endereco/firewall, definidos ao criar a sala) e o aviso derivado
  // das estatisticas (encoder caiu pra software). Elas nao se anulam --
  // podem estar ativas ao mesmo tempo -- entao o texto e a juncao das duas.
  function renderHostWarning() {
    const el = $('stage-warning');
    if (!el) return;
    const parts = [];
    if (hostInfo?.addressWarning) {
      parts.push(`${hostInfo.addressWarning} — o endereço abaixo só funciona na mesma rede local.`);
    }
    if (hostInfo?.firewall && !hostInfo.firewall.ok) {
      parts.push(
        `Não consegui liberar a porta no firewall automaticamente. Comando manual: ${hostInfo.firewall.manualCommand}`
      );
    }
    if (encoderWarning) parts.push(encoderWarning);
    if (!parts.length) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    // O texto vai dentro de um filho, nao direto no container: a abertura
    // anima `grid-template-rows: 0fr -> 1fr` (nunca `height`), e so um
    // elemento de verdade aceita o `min-height: 0; overflow: hidden` que
    // faz o corte funcionar. Um no de texto solto nao aceita.
    el.textContent = '';
    const inner = document.createElement('span');
    inner.textContent = parts.join(' ');
    el.appendChild(inner);
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
  // activeRoomAddress/roomCooldowns. Sem isso, entrar numa sala pelo
  // endereco cru ("192.168.1.5:9000", vindo da lista ou digitado a mao) e
  // entrar na MESMA sala hospedada por voce (que guarda o endereco sem
  // esquema) seriam tratados como enderecos distintos -- um com "ws://" e
  // outro sem.
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

  // Confirmacao no lugar (motion #4): o proprio botao vira "Copiado ✓" e
  // volta sozinho. Um toast no canto pede que a pessoa olhe pra outro lugar
  // pra confirmar algo que ela acabou de fazer aqui.
  const COPIED_HOLD_MS = 1400;
  let copiedTimer = null;

  $('btn-copy-address').addEventListener('click', (event) => {
    if (!hostInfo?.address) return;
    navigator.clipboard.writeText(hostInfo.address);

    const btn = event.currentTarget;
    if (copiedTimer) clearTimeout(copiedTimer);
    else btn.dataset.label = btn.textContent; // so na 1a vez, senao guarda "Copiado ✓"
    btn.textContent = 'Copiado ✓';
    btn.classList.add('copied-flash');
    copiedTimer = setTimeout(() => {
      btn.textContent = btn.dataset.label || 'Copiar';
      btn.classList.remove('copied-flash');
      copiedTimer = null;
    }, COPIED_HOLD_MS);
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
    renderUpdateBanner();
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
        if (localStream) {
          await mesh.offerTo(msg.id, localStream, cfg.quality, 'screen');
          broadcastWatchers('screen'); // novo espectador -- entra "assistindo" por padrao
          recomputeTree('screen');
        }
        if (cameraStream) {
          await mesh.offerTo(msg.id, cameraStream, { ...cfg.camera, codec: 'video/VP8' }, 'camera');
          broadcastWatchers('camera');
          recomputeTree('camera');
        }
        break;
      }
      case 'peer-left': {
        mesh.removePeer(msg.id);
        ui.grid.removeTile(msg.id, emptyMessage());
        ui.grid.removeTile(`cam-${msg.id}`, emptyMessage());
        renderMembersPanel();
        sound.playLeaveSound();
        broadcastWatchers('screen'); // quem saiu pode ter sido um espectador na lista
        broadcastWatchers('camera');
        recomputeTree('screen');
        recomputeTree('camera');
        break;
      }
      case 'offer': {
        const answerSdp = await mesh.handleOffer(msg.from, msg.sdp, msg.kind);
        if (currentSession !== session) return; // sessao caiu enquanto negociava
        sig.send({ type: 'answer', to: msg.from, sdp: answerSdp, kind: msg.kind });
        // Comecamos a receber com a janela ja oculta: o transmissor assume
        // "assistindo" por padrao, entao precisa ser corrigido na hora --
        // do contrario ele paga um encode que ninguem esta vendo ate a
        // proxima mudanca de visibilidade.
        if (!isAppVisible()) sig.send({ type: 'view-state', to: msg.from, kind: msg.kind, watching: false });
        await flushPendingRelay(session, msg.kind, msg.from);
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
      // Um espectador avisando que parou (ou voltou) de assistir. Suspender
      // o encode dele libera um encoder inteiro no PC de quem transmite.
      // Ver a spec de 2026-08-23, F1.3.
      case 'view-state': {
        const track = trackForKind(msg.kind);
        if (mesh.setPeerDemand(msg.from, msg.kind, Boolean(msg.watching), track)) {
          renderMembersPanel();
          broadcastWatchers(msg.kind);
          broadcastViewState(); // se formos relay, isto pode mudar o que reportamos rio acima
        }
        break;
      }
      // Recebido de QUALQUER peer da sala que esteja transmitindo (nao so o
      // host) -- desenha a lista de quem esta assistindo no tile daquele
      // kind. O tile local (nosso proprio) usa 'me'/'cam-me' e nunca chega
      // por aqui -- ver broadcastWatchers, que aplica localmente antes de
      // mandar pro servidor.
      case 'watchers': {
        const tileId = msg.kind === 'camera' ? `cam-${msg.from}` : msg.from;
        ui.grid.setWatchers(tileId, msg.watchers);
        break;
      }
      // Atribuicao de papel na arvore de retransmissao (F2), mandada pela
      // origem daquele kind. epoch descarta atribuicao velha (mensagens
      // cruzando) -- mesmo padrao do currentSession !== session usado no
      // resto deste arquivo. Ver a spec de 2026-08-23, secao F2.
      case 'tree': {
        const kind = msg.kind;
        if (kind !== 'screen' && kind !== 'camera') break;
        const state = myRole[kind];
        if (msg.epoch < state.epoch) break;
        state.epoch = msg.epoch;
        state.paiId = msg.paiId;
        state.filhosIds = Array.isArray(msg.filhos) ? msg.filhos : [];
        state.relayed = new Set();
        state.role = state.filhosIds.length
          ? 'relay'
          : msg.paiId === msg.origem ? 'direct' : 'folha';

        if (state.role === 'relay') await flushPendingRelay(session, kind, msg.origem);
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

  // Todo PID cuja arvore de processo tem `rootPid` como ancestral (inclusive
  // ele mesmo) -- usado pra excluir a arvore do GoLive e a do Discord da
  // lista de inclusao abaixo (o WASAPI Process Loopback so exclui UMA arvore
  // por captura, entao pra excluir duas de uma vez a gente inclui manualmente
  // todo o resto).
  function pidTreeSet(rootPid, processes) {
    const result = new Set();
    if (!rootPid) return result;
    const childrenOf = new Map();
    for (const p of processes) {
      if (!childrenOf.has(p.ppid)) childrenOf.set(p.ppid, []);
      childrenOf.get(p.ppid).push(p.pid);
    }
    const queue = [rootPid];
    result.add(rootPid);
    while (queue.length) {
      const pid = queue.shift();
      for (const childPid of childrenOf.get(pid) || []) {
        if (!result.has(childPid)) {
          result.add(childPid);
          queue.push(childPid);
        }
      }
    }
    return result;
  }

  // "Lista de inclusao": usada ao compartilhar a tela inteira com a
  // checkbox "Incluir o som do Discord" DESMARCADA. Nao existe uma unica
  // captura WASAPI que peça "tudo menos GoLive menos Discord" -- o
  // Process Loopback so exclui UMA arvore por captura. Em vez disso,
  // enumeramos quem esta tocando audio agora e subimos uma captura INCLUDE
  // por processo, pulando as arvores do GoLive e do Discord. Reavalia a
  // cada ciclo do poll enquanto a transmissao estiver no ar, pra pegar processos que
  // comecam a tocar som depois (ex: abriu um video no meio da call).
  //
  // O intervalo era de 2s. O que este poll detecta e "um app comecou a tocar
  // som" -- 5s de atraso pra um som novo entrar na mistura e imperceptivel
  // num jogo, e cada ciclo custa varredura da tabela de processos do Windows
  // no processo principal, disputando CPU com o jogo. Ver a spec de
  // 2026-08-23, F1.5.
  const INCLUDE_LIST_POLL_MS = 5000;

  // O pid do proprio GoLive nao muda durante a execucao, e findDiscordPid()
  // varre a tabela de processos inteira. Os dois eram chamados a cada ciclo
  // do poll -- duas varreduras completas a cada 2 segundos, durante o jogo.
  let ownPidCache = null;
  async function getOwnPidCached() {
    if (ownPidCache === null) ownPidCache = await window.golive.getOwnPid();
    return ownPidCache;
  }

  // O Discord reiniciar no meio de uma transmissao e raro, e se acontecer 30s
  // de atraso pra notar o pid novo e aceitavel. Fora do poll (em startShare,
  // que roda uma vez so) a chamada continua direta, sem cache: la o pid pode
  // ter acabado de nascer e nao ha ciclo seguinte pra corrigir.
  const DISCORD_PID_TTL_MS = 30_000;
  let discordPidCache = { pid: 0, at: 0 };
  async function getDiscordPidCached() {
    const now = Date.now();
    if (discordPidCache.at && now - discordPidCache.at < DISCORD_PID_TTL_MS) return discordPidCache.pid;
    const pid = await window.golive.findDiscordPid();
    discordPidCache = { pid, at: now };
    return pid;
  }

  function startIncludeListCapture(ctx, dest) {
    const nodesByPid = new Map(); // pid -> { node, stop }
    let stopped = false;

    async function refresh() {
      const [renderPids, processes, ownPid, discordPid] = await Promise.all([
        window.golive.listAudioRenderPids(),
        window.golive.listProcessNames(),
        getOwnPidCached(),
        getDiscordPidCached(),
      ]);
      if (stopped) return;
      const excluded = new Set([...pidTreeSet(ownPid, processes), ...pidTreeSet(discordPid, processes)]);
      const wanted = new Set(renderPids.filter((pid) => !excluded.has(pid)));

      for (const pid of Array.from(nodesByPid.keys())) {
        if (wanted.has(pid)) continue;
        nodesByPid.get(pid).stop();
        nodesByPid.delete(pid);
      }
      for (const pid of wanted) {
        if (nodesByPid.has(pid)) continue;
        const node = await startNativeProcessAudioNode(ctx, pid, false);
        if (stopped) {
          node?.stop();
          continue;
        }
        if (node) {
          node.node.connect(dest);
          nodesByPid.set(pid, node);
        }
      }
    }

    refresh();
    const pollTimer = setInterval(refresh, INCLUDE_LIST_POLL_MS);

    return {
      stop: () => {
        stopped = true;
        clearInterval(pollTimer);
        for (const { stop } of nodesByPid.values()) stop();
        nodesByPid.clear();
      },
    };
  }

  // ---------- Compartilhar tela ----------

  // `getOwnPid()` devolve 0 quando o addon nativo de audio nao esta
  // disponivel nesta maquina (so existe no Windows com o addon compilado)
  // -- mesmo sinal que startShare ja usa pra decidir se cai pro loopback de
  // sistema do Electron. Cacheado porque nao muda durante a execucao do app.
  let nativeAudioAvailable = null;
  async function isNativeAudioAvailable() {
    if (nativeAudioAvailable === null) {
      nativeAudioAvailable = (await getOwnPidCached()) !== 0;
    }
    return nativeAudioAvailable;
  }

  $('btn-toggle-share').addEventListener('click', async () => {
    if (localStream) return stopShare();
    if (sharing) return; // ja tem um startShare() em andamento, ignora o duplo clique
    if (!currentSession || !currentSession.sig.isOpen()) return;
    ui.picker.open({
      onGoLive: startShare,
      nativeAudioAvailable: await isNativeAudioAvailable(),
      quality: cfg.quality,
      onQualityChange: onQualityPresetChange,
    });
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
      //    (captura nativa por processo, modo "incluir"). "Incluir o som
      //    do Discord" soma uma segunda captura, so do Discord, por cima.
      //  - compartilhando a TELA inteira, com "incluir o Discord" MARCADO:
      //    audio-base = sistema inteiro EXCLUINDO o proprio GoLive (captura
      //    nativa, modo "excluir"). Sem isso, o audio que o proprio GoLive
      //    reproduz (voz e tela dos outros participantes) entraria na nossa
      //    propria captura e voltaria pra eles -- quando duas pessoas
      //    compartilham tela e se ouvem, isso cria um loop/eco que
      //    amplifica a cada rodada.
      //  - compartilhando a TELA inteira, com "incluir o Discord"
      //    DESMARCADO: nao da pra excluir GoLive E Discord numa unica
      //    captura (Process Loopback so exclui UMA arvore), entao usamos o
      //    modo lista de inclusao (startIncludeListCapture, acima) em vez
      //    de um basePid/baseExclude so.
      // Sem o addon nativo nesta maquina, tudo isso cai pro loopback de
      // sistema normal do Electron -- nesse caso nao ha como excluir o
      // proprio processo nem o Discord, e o loop/vazamento pode acontecer
      // (limitacao do loopback padrao).
      const isWindowSource = typeof sourceId === 'string' && sourceId.startsWith('window:');
      const discordPid = shareSound && isWindowSource && includeDiscord ? await window.golive.findDiscordPid() : 0;

      let useElectronLoopback = false;
      let useIncludeListMode = false;
      let basePid = 0;
      let baseExclude = false;
      if (shareSound) {
        if (isWindowSource) {
          basePid = await window.golive.pidForSource(sourceId);
          // Nao achou o PID da janela (SO diferente do Windows, addon
          // indisponivel, ou a janela sumiu entre escolher e confirmar) --
          // melhor cair pro sistema inteiro do que nao ter audio nenhum.
          if (!basePid) useElectronLoopback = true;
        } else {
          const ownPid = await getOwnPidCached();
          if (!ownPid) {
            useElectronLoopback = true; // addon indisponivel nesta maquina
          } else if (includeDiscord) {
            basePid = ownPid;
            baseExclude = true;
          } else {
            useIncludeListMode = true;
          }
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

      // Captura nativa por processo (base e/ou lista de inclusao, mais
      // Discord separado quando compartilhando uma janela), misturadas num
      // unico MediaStreamAudioDestinationNode -- so entra aqui quando NAO
      // estamos usando o loopback do Electron (os dois sao alternativas
      // mutuamente exclusivas, nunca somados, senao duplicaria o audio do
      // sistema).
      if (basePid || useIncludeListMode) {
        const ctx = await ensurePcmWorklet();
        const dest = ctx.createMediaStreamDestination();

        if (basePid) {
          const base = await startNativeProcessAudioNode(ctx, basePid, baseExclude);
          if (base) {
            base.node.connect(dest);
            startedNativeStops.push(base.stop);
          }
        }
        if (useIncludeListMode) {
          startedNativeStops.push(startIncludeListCapture(ctx, dest).stop);
        }
        // So faz sentido somar uma captura separada do Discord por cima
        // quando a base ja e so o audio de UMA janela (isWindowSource) --
        // nos outros dois modos o Discord ja esta incluido (baseExclude) ou
        // deliberadamente de fora (useIncludeListMode).
        if (isWindowSource && includeDiscord && discordPid && discordPid !== basePid) {
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
      broadcastWatchers('screen'); // lista inicial: todo mundo conta como assistindo
      recomputeTree('screen');

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
        broadcastWatchers('camera'); // lista inicial: todo mundo conta como assistindo
        recomputeTree('camera');
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

  // ---------- Visibilidade da janela ----------

  // Duas fontes pro mesmo estado, porque nenhuma cobre tudo sozinha:
  // document.visibilityState pega troca de aba/ocultacao do documento, e os
  // eventos de minimize/restore da janela vem do main (ver createWindow) --
  // disable-renderer-backgrounding faz o Chromium tratar o renderer como
  // visivel em situacoes em que ele nao esta.
  //
  // O que este estado desliga e PINTURA, nada mais: os <video> param de
  // compor frames e o painel de estatisticas desacelera. A captura e o
  // encode do WebRTC vivem no processo de GPU e seguem intactos -- os
  // espectadores nao veem diferenca nenhuma. Ver a spec de 2026-08-23, F1.4.
  let windowVisible = true;

  function isAppVisible() {
    return windowVisible && document.visibilityState !== 'hidden';
  }

  function onVisibilityChanged() {
    const visible = isAppVisible();
    ui.grid.setPainting(visible);
    // Pausa o pulso de "ao vivo" (motion #10): animacao em laco queima GPU
    // mesmo invisivel, e e a Parte I desta mesma spec que diz isso.
    document.body.classList.toggle('no-paint', !visible);
    if (statsTimer) scheduleStatsLoop();
    broadcastViewState();
  }

  /** A track de video local daquele kind, ou null. E o que volta pro sender
   * quando um espectador avisa que voltou a assistir. */
  function trackForKind(kind) {
    const stream = kind === 'camera' ? cameraStream : localStream;
    return stream?.getVideoTracks()[0] || null;
  }

  // Avisa cada transmissor de quem estamos recebendo se ainda estamos ou nao
  // olhando. Peer que nunca recebeu um 'view-state' conta como assistindo --
  // padrao seguro. Quando esta sessao e RELAY do peer em questao (F2), o
  // watching mandado pra cima e agregado: continua "sim" se qualquer folha
  // da nossa sub-arvore ainda estiver olhando, mesmo que esta janela esteja
  // minimizada -- um relay que minimizou mas tem espectadores atras nao pode
  // cortar o encode de quem esta assistindo de verdade. Ver a spec de
  // 2026-08-23, secao "Demanda propaga pra cima".
  function broadcastViewState() {
    const session = currentSession;
    if (!session?.mesh || !session.sig.isOpen()) return;
    for (const { peerId, kind } of session.mesh.receivingFrom()) {
      const state = myRole[kind];
      const isUpstreamOfRelay = state.role === 'relay' && state.paiId === peerId;
      const anyFolhaWatching = isUpstreamOfRelay
        && state.filhosIds.some((id) => !session.mesh.isPeerSuspended(id, kind));
      const watching = isAppVisible() || anyFolhaWatching;
      session.sig.send({ type: 'view-state', to: peerId, kind, watching });
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChanged);
  window.golive.onWindowVisibilityChange?.((visible) => {
    windowVisible = visible;
    onVisibilityChanged();
  });

  // Quem esta transmitindo (tela OU camera -- qualquer um na sala pode
  // compartilhar, nao so o host) manda pra SALA INTEIRA quem esta de fato
  // assistindo aquele kind agora. E o que deixa o overlay "assistindo" no
  // proprio tile funcionar pra qualquer espectador, nao so pra quem enviou
  // o view-state que mudou a lista.
  function broadcastWatchers(kind) {
    const session = currentSession;
    if (!session?.mesh) return;
    const hasStream = kind === 'camera' ? Boolean(cameraStream) : Boolean(localStream);
    if (!hasStream) return;
    const watchers = session.mesh.watchersOf(kind);
    ui.grid.setWatchers(kind === 'camera' ? 'cam-me' : 'me', watchers);
    if (session.sig.isOpen()) session.sig.send({ type: 'watchers', kind, watchers });
  }

  // ---------- Arvore de retransmissao (F2, spec de 2026-08-23) ----------

  // Tenta repassar (relayTo) pros filhos pendentes deste epoch. Chamado
  // tanto ao receber 'tree' (o caso comum: a offer da origem ja chegou)
  // quanto depois de processar uma 'offer' daquela origem (o caso de
  // corrida: 'tree' chegou ANTES da offer terminar de negociar, entao
  // mesh.relayTo devolveu false na hora -- ver Task 3). 'relayed' evita
  // repassar duas vezes pro mesmo filho.
  async function flushPendingRelay(session, kind, sourcePeerId) {
    const state = myRole[kind];
    if (state.role !== 'relay' || state.paiId !== sourcePeerId) return;
    const quality = kind === 'camera' ? { ...cfg.camera, codec: 'video/VP8' } : cfg.quality;
    for (const childId of state.filhosIds) {
      if (state.relayed.has(childId)) continue;
      const ok = await session.mesh.relayTo(childId, sourcePeerId, kind, quality);
      if (ok) state.relayed.add(childId);
    }
  }

  // So a origem chama isto, e so quando aquele kind esta ao vivo. Junta os
  // candidatos (todo peer da sala, com o RTT mais recente medido nas
  // estatisticas -- ver updateStats na Task 8) e delega o calculo puro pro
  // modulo tree.js. Recalculo e discreto: peer entrou/saiu, ou comecamos a
  // transmitir -- NAO a cada amostra de RTT (evitaria trocar de papel toda
  // hora). Ver "Fora de escopo" no cabecalho deste plano.
  function recomputeTree(kind) {
    const session = currentSession;
    if (!session?.mesh || !cfg.network.tree) return;
    const stream = kind === 'camera' ? cameraStream : localStream;
    if (!stream) return;

    const candidates = [];
    for (const [id, peer] of session.mesh.peers) {
      candidates.push({
        id,
        joinedAt: peer.joinedAt || 0,
        rtt: peer.rtt?.[kind] ?? null,
        transmitting: Boolean(peer.live),
        suspended: session.mesh.isPeerSuspended(id, kind),
      });
    }
    if (!candidates.length) return;

    const assignments = tree.computeTree(myId, candidates);
    const epoch = ++originTree[kind].epoch;
    originTree[kind].assignments = assignments;
    applyOriginAssignments(session, kind, assignments, epoch);
  }

  // Distribui os papeis calculados: manda 'tree' pra todo mundo (protocolo
  // exato da spec: { type, to, kind, origem, paiId, filhos, epoch }), e
  // ajusta as outConns desta sessao pra bater com o papel de cada um.
  // 'direct' e 'relay' recebem oferta direta (se ainda nao tiverem); quem
  // virou 'folha' e cortado daqui -- quem vai mandar pra ele e o relay, via
  // relayTo (Task 5).
  function applyOriginAssignments(session, kind, assignments, epoch) {
    const stream = kind === 'camera' ? cameraStream : localStream;
    const quality = kind === 'camera' ? { ...cfg.camera, codec: 'video/VP8' } : cfg.quality;

    for (const [peerId, assignment] of assignments) {
      session.sig.send({
        type: 'tree', to: peerId, kind,
        origem: myId, paiId: assignment.paiId, filhos: assignment.filhosIds, epoch,
      });

      const hasOutConn = Boolean(session.mesh.peers.get(peerId)?.outConns[kind]);
      if (assignment.role === 'direct' || assignment.role === 'relay') {
        if (!hasOutConn) session.mesh.offerTo(peerId, stream, quality, kind).catch(() => {});
      } else {
        session.mesh.closeOut(peerId, kind);
      }
    }

    broadcastWatchers(kind);
  }

  // ---------- Estatisticas ----------

  // Nomes que o Chromium usa quando quem codifica e a CPU. Qualquer outro
  // valor ('ExternalEncoder', 'NvCodec...', 'MediaFoundationVideo...') e
  // hardware. A comparacao e por substring porque com simulcast o nome vem
  // embrulhado: 'SimulcastEncoderAdapter (libvpx, libvpx)'.
  const SOFTWARE_ENCODERS = ['openh264', 'libvpx', 'libaom', 'ffmpeg', 'x264'];

  function isSoftwareEncoder(impl) {
    if (!impl) return false;
    const name = String(impl).toLowerCase();
    return SOFTWARE_ENCODERS.some((needle) => name.includes(needle));
  }

  // Com a janela oculta o painel de estatisticas nao esta na tela de
  // ninguem, mas getStats() + reescrita do innerHTML continuavam rodando a
  // cada segundo -- durante o jogo. Ver a spec de 2026-08-23, F1.4-c.
  const STATS_POLL_VISIBLE_MS = 1000;
  const STATS_POLL_HIDDEN_MS = 5000;

  function startStatsLoop() {
    stopStatsLoop();
    statsPrev.clear();
    scheduleStatsLoop();
  }

  function scheduleStatsLoop() {
    clearInterval(statsTimer);
    statsTimer = setInterval(updateStats, isAppVisible() ? STATS_POLL_VISIBLE_MS : STATS_POLL_HIDDEN_MS);
  }

  function stopStatsLoop() {
    clearInterval(statsTimer);
    statsTimer = null;
    statsPrev.clear();
    if (encoderWarning) {
      encoderWarning = '';
      renderHostWarning();
    }
    ui.settings.setStatsHtml('');
  }

  // Le um relatorio de getStats de UM sender e devolve os campos que
  // interessam pro diagnostico de encode. Ver a spec de 2026-08-23 (F1.1):
  // o campo decisivo e encoderImplementation -- o Chromium cai pro encoder
  // de software sem emitir erro nenhum quando estoura o limite de sessoes
  // do NVENC, e ate agora o app nao tinha como perceber isso.
  function readSenderReport(report) {
    const sample = {
      fps: 0,
      captureFps: null,
      bytesSent: 0,
      width: 0,
      height: 0,
      codec: '',
      limitation: '',
      encoder: '',
      powerEfficient: null,
      totalEncodeTime: 0,
      framesEncoded: 0,
      framesSent: 0,
      rtt: 0,
    };

    report.forEach((stat) => {
      if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
        sample.fps = Math.max(sample.fps, stat.framesPerSecond || 0);
        sample.bytesSent += stat.bytesSent || 0;
        sample.width = stat.frameWidth || sample.width;
        sample.height = stat.frameHeight || sample.height;
        sample.totalEncodeTime += stat.totalEncodeTime || 0;
        sample.framesEncoded += stat.framesEncoded || 0;
        sample.framesSent += stat.framesSent || 0;
        if (stat.encoderImplementation) sample.encoder = stat.encoderImplementation;
        if (stat.powerEfficientEncoder != null) sample.powerEfficient = stat.powerEfficientEncoder;
        if (stat.qualityLimitationReason && stat.qualityLimitationReason !== 'none') {
          sample.limitation = stat.qualityLimitationReason;
        }
      }
      // fps que a CAPTURA entrega, distinto do que sai codificado. Os dois
      // divergirem e o sinal de que o encoder nao esta dando conta.
      if (stat.type === 'media-source' && stat.kind === 'video' && stat.framesPerSecond != null) {
        sample.captureFps = stat.framesPerSecond;
      }
      if (stat.type === 'codec' && stat.mimeType?.startsWith('video/')) {
        sample.codec = stat.mimeType.split('/')[1];
      }
      if (stat.type === 'candidate-pair' && stat.nominated && stat.currentRoundTripTime != null) {
        sample.rtt = Math.max(sample.rtt, stat.currentRoundTripTime * 1000);
      }
    });

    return sample;
  }

  // Deriva as taxas do intervalo comparando com a amostra anterior daquele
  // mesmo sender. Contador acumulado sozinho da a media desde o inicio da
  // conexao, que e justamente onde o problema se esconde.
  function deriveRates(key, sample, now) {
    const prev = statsPrev.get(key);
    statsPrev.set(key, {
      bytesSent: sample.bytesSent,
      totalEncodeTime: sample.totalEncodeTime,
      framesEncoded: sample.framesEncoded,
      at: now,
    });
    if (!prev || now <= prev.at) return { mbps: 0, msPerFrame: null };

    const seconds = (now - prev.at) / 1000;
    const mbps = ((sample.bytesSent - prev.bytesSent) * 8) / seconds / 1_000_000;

    const frames = sample.framesEncoded - prev.framesEncoded;
    const encodeMs = (sample.totalEncodeTime - prev.totalEncodeTime) * 1000;
    const msPerFrame = frames > 0 ? encodeMs / frames : null;

    return { mbps: Math.max(mbps, 0), msPerFrame };
  }

  const LIMITATION_LABELS = {
    bandwidth: 'banda da rede insuficiente',
    cpu: 'CPU no limite',
    other: 'limite do encoder',
  };

  async function updateStats() {
    const session = currentSession;
    if (!session?.mesh) return;
    const activeMesh = session.mesh;

    const rows = [];
    const now = performance.now();

    // Uma linha por sender -- peer x kind. Agregar aqui (como antes) esconde
    // o caso tipico: a degradacao atinge UM sender so, e a media dos tres
    // continua parecendo saudavel.
    for (const [peerId, peer] of activeMesh.peers) {
      for (const kind of ['screen', 'camera']) {
        if (currentSession !== session) return; // sessao encerrou enquanto aguardavamos as stats
        const report = await activeMesh.statsFor(peerId, kind);
        if (!report) continue;
        const sample = readSenderReport(report);
        if (!sample.framesEncoded && !sample.bytesSent) continue;
        const rates = deriveRates(`${peerId}:${kind}`, sample, now);
        rows.push({ peerId, kind, name: peer.name || `#${peerId}`, ...sample, ...rates });
      }
    }

    if (currentSession !== session) return; // sessao caiu enquanto aguardavamos as stats

    renderStats(rows);
    updateEncoderWarning(rows);
  }

  // O orcamento de encode a 60 fps e 16,6 ms POR QUADRO, somando todos os
  // senders -- eles disputam o mesmo encoder. Por isso o resumo soma
  // ms/frame em vez de tirar media.
  function renderStats(rows) {
    if (!rows.length) {
      ui.settings.setStatsHtml('<div class="stat"><span>enviando pra</span><b>0 peer(s)</b></div>');
      return;
    }

    const esc = ui.escapeHtml;
    const totalMbps = rows.reduce((sum, r) => sum + r.mbps, 0);
    const encodeMsRows = rows.filter((r) => r.msPerFrame != null);
    const totalEncodeMs = encodeMsRows.reduce((sum, r) => sum + r.msPerFrame, 0);
    const anySoftware = rows.some((r) => isSoftwareEncoder(r.encoder));
    const budget = rows[0].fps >= 50 ? 16.6 : 33.3;
    const first = rows[0];

    const summary = `
      <div class="stat"><span>enviando pra</span><b>${rows.length} sender(s)</b></div>
      <div class="stat"><span>resolução</span><b>${first.width}x${first.height}</b></div>
      <div class="stat"><span>saída total</span><b>${totalMbps.toFixed(1)} Mbps</b></div>
      <div class="stat"><span>codec</span><b>${esc(first.codec || '-')}</b></div>
      <div class="stat"><span>encoder</span><b class="${anySoftware ? 'warn-text' : 'good'}">${
        anySoftware ? 'software (CPU)' : 'hardware'
      }</b></div>
      <div class="stat"><span>encode somado</span><b class="${
        encodeMsRows.length && totalEncodeMs > budget ? 'warn-text' : 'good'
      }">${encodeMsRows.length ? `${totalEncodeMs.toFixed(1)} / ${budget} ms` : '-'}</b></div>`;

    const body = rows
      .map((r) => {
        const software = isSoftwareEncoder(r.encoder);
        const dropped = Math.max(r.framesEncoded - r.framesSent, 0);
        return `<tr>
          <td>${esc(r.name)}<span class="stats-kind">${r.kind === 'camera' ? 'câmera' : 'tela'}</span></td>
          <td class="${r.fps >= 50 ? 'good' : 'warn-text'}">${Math.round(r.fps)}${
            r.captureFps != null ? `<span class="stats-kind">cap ${Math.round(r.captureFps)}</span>` : ''
          }</td>
          <td class="${r.msPerFrame != null && r.msPerFrame > budget ? 'warn-text' : ''}">${
            r.msPerFrame != null ? `${r.msPerFrame.toFixed(1)} ms` : '-'
          }</td>
          <td class="${software ? 'warn-text' : ''}">${esc(r.encoder || '-')}${
            r.powerEfficient === false ? '<span class="stats-kind">não eficiente</span>' : ''
          }</td>
          <td>${r.mbps.toFixed(1)}</td>
          <td>${r.rtt ? `${Math.round(r.rtt)} ms` : '-'}</td>
          <td class="${dropped ? 'warn-text' : ''}">${dropped || '-'}</td>
        </tr>`;
      })
      .join('');

    const limited = rows.filter((r) => r.limitation);
    const limitWarn = limited.length
      ? `<div class="stat-warn">Limitado por: ${limited
          .map((r) => `${esc(r.name)} — ${LIMITATION_LABELS[r.limitation] || esc(r.limitation)}`)
          .join('; ')}</div>`
      : '';

    ui.settings.setStatsHtml(`${summary}
      <table class="stats-table">
        <thead><tr><th>peer</th><th>fps</th><th>encode</th><th>encoder</th><th>Mbps</th><th>rtt</th><th>perdidos</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      ${limitWarn}`);
  }

  // O aviso so aparece com mais de um sender ativo: com um sender so, encoder
  // de software e desconfortavel mas nao e o problema que a spec persegue --
  // e a queda silenciosa por estouro do limite de sessoes do NVENC.
  function updateEncoderWarning(rows) {
    const software = rows.filter((r) => isSoftwareEncoder(r.encoder));
    const next =
      software.length && rows.length > 1
        ? 'Encoder em software — o vídeo está sendo codificado pela CPU. Reduza a qualidade ou o número de espectadores.'
        : '';
    if (next === encoderWarning) return;
    encoderWarning = next;
    renderHostWarning();
  }
})();
