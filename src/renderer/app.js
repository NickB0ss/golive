// src/renderer/app.js
'use strict';

(function () {
  const { config, signaling, mesh: meshModule, ui, sound, tree, queue } = window.GoLive;

  let cfg = config.load(localStorage.getItem('golive'));
  // `currentSession` is the single source of truth for "the session that is
  // live right now". Every async callback (WS messages, WebRTC events,
  // capture promises) captures the specific `session` object it belongs to
  // and checks `currentSession !== session` before touching anything — that
  // way a late event from a torn-down or superseded session is a no-op
  // instead of throwing on stale/null state.
  let currentSession = null; // { sig, mesh } | null
  let myId = null;

  const KINDS = ['screen', 'camera'];
  const { relayKindFor, parseKind } = meshModule;

  // Topologia da arvore de retransmissao (F2), por kind -- so significativa
  // quando ESTA sessao e a origem daquele kind (localStream/cameraStream
  // existe). epoch so sobe quando a topologia REALMENTE muda (ver
  // recomputeTree): antes ele subia a cada recalculo, e como o 'tree'
  // resultante zera o registro de repasse de cada relay, qualquer
  // entra-e-sai na sala fazia todo relay repassar de novo pros mesmos
  // filhos -- um encoder a mais por vez.
  const originTree = {
    screen: { epoch: 0, assignments: new Map() },
    camera: { epoch: 0, assignments: new Map() },
  };
  // Papel que ESTA sessao recebeu de alguma origem, por kind -- so
  // relevante quando esta sessao NAO e a origem daquele kind.
  //
  // A chave e a ORIGEM, nao so o kind: a sala permite varias pessoas
  // transmitindo ao mesmo tempo, e cada origem tem seu PROPRIO contador de
  // epoch (a spec: "epoch e por-origem: ignorar tree com epoch menor que o
  // ultimo visto DAQUELA origem"). Com um estado unico por kind, a origem B
  // no epoch 1 tinha seu 'tree' descartado pelo epoch 5 da origem A -- ou
  // sobrescrevia o papel dela.
  //
  // Cada entrada: { epoch, role, paiId, filhosIds, relayed }. 'relayed'
  // registra pra quais filhos ja repassamos NESTE epoch, pra relayTo nao
  // ser chamado duas vezes pro mesmo filho (duplicaria transceivers) --
  // ver o retry em 'offer' no handleSignal.
  const myRole = { screen: new Map(), camera: new Map() };

  function roleFor(kind, origem) {
    const byOrigin = myRole[kind];
    if (!byOrigin) return null;
    let state = byOrigin.get(origem);
    if (!state) {
      state = { epoch: 0, role: 'direct', paiId: null, filhosIds: [], relayed: new Set() };
      byOrigin.set(origem, state);
    }
    return state;
  }

  // Quem falhou como relay ha pouco, por kind: peerId -> timestamp. Ver
  // RELAY_FAILURE_COOLDOWN_MS e recoverFromRelayLoss.
  const recentRelayFailures = { screen: new Map(), camera: new Map() };

  // Todo o estado de arvore morre com a sessao. Sem isto, o epoch guardado
  // de uma sala anterior (digamos, 7) descarta pra sempre os 'tree' de uma
  // origem nova numa sala nova, cujo contador comeca em 1 -- este no nunca
  // mais aprenderia seu papel, ate reiniciar o app.
  function resetTreeState() {
    for (const kind of KINDS) {
      myRole[kind].clear();
      originTree[kind].epoch = 0;
      originTree[kind].assignments = new Map();
      recentRelayFailures[kind].clear();
    }
    // myId so tem sentido dentro de UMA sessao (e o id que o servidor nos
    // deu no 'welcome' daquela sala). Zerar aqui junto com o resto do
    // estado de arvore -- ele nao e usado fora de contexto de sessao ativa
    // hoje, mas deixa-lo sobreviver seria exatamente o tipo de estado
    // fantasma que esta funcao existe pra evitar.
    myId = null;
  }
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

  /** Id do tile de um peer naquele kind. `kind` aqui e sempre o kind BASE
   * ('screen'/'camera'), nunca o composto de repasse -- ver parseKind. */
  function tileIdFor(peerId, kind) {
    return kind === 'camera' ? `cam-${peerId}` : peerId;
  }

  // Qual conexao (peer + kind EXATO, composto inclusive) esta alimentando
  // cada tile agora. Durante uma troca de topologia a mesma origem chega
  // por dois caminhos ao mesmo tempo -- a oferta direta nova ('screen') e o
  // repasse antigo que ainda nao fechou ('screen@origem') -- e os dois
  // desenham no MESMO tile. Sem saber de quem e o tile, o fechamento do
  // caminho velho apagaria o tile que o caminho novo acabou de preencher, e
  // nada mais o traria de volta.
  const tileSource = new Map(); // tileId -> `${peerId}|${kind}`

  function connKeyOf(peerId, kind) {
    return `${peerId}|${kind}`;
  }

  function dropTile(tileId) {
    tileSource.delete(tileId);
    ui.grid.removeTile(tileId, emptyMessage());
  }

  /** Aceita tanto o kind cru quanto o composto de repasse. Tudo que chega
   * pela rede passa por aqui antes de virar chave de conexao ou indice de
   * estado -- um `kind` inventado por um cliente nao pode nos fazer
   * indexar em undefined. */
  function isKnownKind(kind) {
    return KINDS.includes(parseKind(kind).baseKind);
  }

  /** Qualidade de encode daquele kind. Usa o kind BASE, pra que uma
   * conexao de repasse ('camera@<origem>') nao caia no preset de tela. */
  function qualityFor(kind) {
    return parseKind(kind).baseKind === 'camera' ? { ...cfg.camera, codec: 'video/VP8' } : cfg.quality;
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
          showToast(`Imagem muito grande (máx. ${Math.round(maxSize / (1024 * 1024))}MB).`);
          return;
        }
        try {
          const dataUrl = await resizeImageToAvatar(file);
          cfg = { ...cfg, avatar: dataUrl };
          persist();
          renderUserPanel();
        } catch {
          showToast('Não consegui processar essa imagem.');
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

  // Atualizacao: fluxo explicito. O check roda no boot e quando a pessoa
  // aperta o botao de buscar (#btn-check-update). Nada e baixado ate o clique
  // em "Reiniciar e instalar"; quando o download termina, instala e reinicia
  // sozinho. Ver main/updater.js e a spec de 2026-08-26.
  let updateVersionAtual = null;
  Promise.resolve(window.golive.getVersion?.()).then((v) => { updateVersionAtual = v || null; }).catch(() => {});

  const btnCheckUpdate = $('btn-check-update');
  const spinCheck = (on) => {
    btnCheckUpdate.classList.remove('spin');
    if (on) {
      void btnCheckUpdate.offsetWidth; // reflow: reinicia a animacao
      btnCheckUpdate.classList.add('spin');
    }
  };

  function showUpdateBanner({ text, action = false, progress = null, indeterminate = false }) {
    $('update-banner').classList.remove('hidden');
    $('update-banner-text').textContent = text;
    $('update-banner-action').classList.toggle('hidden', !action);
    const wrap = $('update-progress');
    const fill = $('update-progress-fill');
    const showBar = progress != null || indeterminate;
    wrap.classList.toggle('hidden', !showBar);
    fill.classList.toggle('indeterminate', indeterminate);
    if (progress != null) fill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }

  window.golive.onUpdateStatus?.((payload) => {
    const { status, manual, version, progress } = payload || {};
    switch (status) {
      case 'checking':
        if (manual) spinCheck(true);
        break;
      case 'available':
        spinCheck(false);
        showUpdateBanner({ text: `Atualização ${version || 'nova'} disponível.`, action: true });
        break;
      case 'downloading':
        showUpdateBanner({ text: `Baixando atualização… ${progress ?? 0}%`, progress: progress ?? 0 });
        break;
      case 'downloaded':
        showUpdateBanner({ text: 'Instalando atualização…', indeterminate: true });
        window.golive.installUpdate?.();
        break;
      case 'not-available':
        spinCheck(false);
        if (manual) showToast(`Você já está na versão mais recente${updateVersionAtual ? ` (${updateVersionAtual})` : ''}.`);
        break;
      case 'error':
        spinCheck(false);
        if (manual) showToast('Não consegui verificar a atualização. Tente de novo mais tarde.');
        break;
      default:
        break;
    }
  });

  $('update-banner-action').addEventListener('click', () => {
    $('update-banner-action').classList.add('hidden');
    showUpdateBanner({ text: 'Baixando atualização… 0%', progress: 0 });
    window.golive.downloadUpdate?.();
  });

  btnCheckUpdate.addEventListener('click', () => {
    spinCheck(true);
    window.golive.checkForUpdates?.();
  });

  let toastTimer = null;
  function showToast(msg, ms = 4000) {
    $('toast-text').textContent = msg;
    $('toast').classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      $('toast').classList.add('hidden');
      toastTimer = null;
    }, ms);
  }

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
    if (encoderWarning) parts.push(encoderWarning);

    const firewallBroken = !!(hostInfo?.firewall && !hostInfo.firewall.ok);

    if (!parts.length && !firewallBroken) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    // Tudo vai dentro de um unico filho do container, nao direto nele: a
    // abertura anima `grid-template-rows: 0fr -> 1fr` (nunca `height`), e o
    // `min-height: 0; overflow: hidden` que faz o corte funcionar so vale
    // pro filho direto. Multiplos filhos quebrariam a animacao.
    el.textContent = '';
    const inner = document.createElement('div');

    if (parts.length) {
      const span = document.createElement('span');
      span.textContent = parts.join(' ');
      inner.appendChild(span);
    }
    if (firewallBroken) inner.appendChild(buildFirewallFix());

    el.appendChild(inner);
    el.classList.remove('hidden');
  }

  // Bloco de correcao do firewall: em vez de so despejar o comando netsh
  // como texto (o usuario nao vai copiar e colar no meio de uma call), um
  // botao que re-dispara o pedido de elevacao do Windows pra mesma porta
  // da sala. O comando manual so aparece como ultimo recurso, depois que
  // uma tentativa pelo botao tambem falha.
  function buildFirewallFix() {
    const box = document.createElement('div');
    box.className = 'firewall-fix';

    const msg = document.createElement('p');
    msg.textContent =
      'A porta da sala não está liberada no firewall do Windows — quem tentar entrar pela rede pode não conseguir.';
    box.appendChild(msg);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-firewall';
    btn.textContent = 'Permitir acesso à rede';
    box.appendChild(btn);

    const detail = document.createElement('p');
    detail.className = 'firewall-detail hidden';
    box.appendChild(detail);

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Aguardando permissão do Windows…';
      detail.classList.add('hidden');
      let res;
      try {
        res = await window.golive.retryFirewall();
      } catch (err) {
        res = { ok: false, error: err?.message };
      }
      if (res?.ok) {
        if (hostInfo) hostInfo.firewall = { ok: true };
        renderHostWarning();
        return;
      }
      btn.disabled = false;
      btn.textContent = 'Tentar de novo';
      const cmd = res?.manualCommand || hostInfo?.firewall?.manualCommand;
      detail.textContent = cmd
        ? `Se continuar sem funcionar, abra o PowerShell como administrador e rode: ${cmd}`
        : 'Não consegui liberar a porta. Confirme que aceitou o pedido do Windows e tente de novo.';
      detail.classList.remove('hidden');
    });

    return box;
  }
  renderHostWarning();

  // ---------- Encerramento de sessao (desconexao ou troca de sala) ----------

  // Limpa o estado de UI/mesh associado a uma sessao especifica. Chamada so
  // depois que `currentSession` ja deixou de apontar pra ela, entao qualquer
  // callback tardio dessa sessao ja vai ter parado de agir sozinho.
  function teardownSession(session) {
    stopStatsLoop();
    resetTreeState();
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
        dropTile(peerId);
        dropTile(`cam-${peerId}`);
      }
    }
    tileSource.clear();
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

  // Quantas reconexoes automaticas seguidas tentar antes de desistir e
  // devolver o controle pro usuario, e a folga de conexao estavel que
  // zera essa contagem (uma queda isolada horas depois nao deve herdar o
  // contador de uma sequencia de quedas antiga).
  const MAX_RECONNECT = 4;
  const STABLE_MS = 20000;

  function joinRoom(rawUrl, name, publicAddress, onSettled, reconnectAttempt = 0) {
    if (!reconnectAttempt) $('setup-error').textContent = '';
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

    // Sessao nova, arvore nova: nenhum epoch, papel ou atribuicao da sala
    // anterior pode sobreviver ate aqui (teardownSession ja limpa quando
    // havia sessao; isto cobre a primeira entrada e o caminho em que a
    // conexao anterior nunca chegou a abrir).
    resetTreeState();

    // A fila de sinalizacao e da SESSAO: morre com ela, entao nenhuma
    // mensagem de uma sala anterior fica encadeada na frente das novas.
    const session = { sig: null, mesh: null, signalQueue: queue.createSerialQueue() };

    // Contador de reconexoes que sobrevive entre as chamadas de joinRoom
    // (o parametro reseta a cada chamada); zera quando a conexao fica de
    // pe por STABLE_MS.
    let attempts = reconnectAttempt;
    let stableTimer = null;

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
          if (attempts > 0) $('setup-error').textContent = '';
          stableTimer = setTimeout(() => { attempts = 0; }, STABLE_MS);
          sound.playJoinSound();
          onSettled?.();
        },
        // handleSignal e async e ninguem aguardava seu retorno: duas
        // mensagens seguidas do WebSocket rodavam concorrentes, e uma 'ice'
        // atropelava o `await setRemoteDescription` da 'offer' anterior --
        // candidato descartado, ICE que nunca fecha. A fila serial devolve
        // ao tratamento a mesma ordem total em que o WebSocket entregou.
        // Ver a auditoria de 2026-08-27, item A1.
        onMessage: (msg) => session.signalQueue.push(() => handleSignal(session, msg)),
        onError: () => {
          if (currentSession === session && attempts === 0) {
            $('setup-error').textContent =
              'Não consegui conectar. Confira o IP, se o servidor está rodando e se a porta está liberada no firewall.';
          }
          onSettled?.();
        },
        onClose: (detail) => {
          if (currentSession !== session) return; // conexao antiga, ja substituida
          clearTimeout(stableTimer);
          // O code/reason do WebSocket diz se foi um close limpo (1000/1001,
          // ex: o proprio host fechando o app) ou uma queda anormal de
          // rede/processo (1006, sem handshake de close) -- tipico de NAT de
          // LAN virtual descartando um fluxo ocioso.
          console.error(`[signaling] conexao fechada: code=${detail?.code} reason="${detail?.reason}" wasClean=${detail?.wasClean}`);

          const abnormal = detail?.code === 1006 || detail?.wasClean === false;
          const canRetry = abnormal && (session.opened || attempts > 0) && attempts < MAX_RECONNECT;

          currentSession = null;
          activeRoomAddress = null;

          if (canRetry) {
            // Queda anormal, nao saida deliberada (leaveRoom zera
            // currentSession antes de fechar, entao nunca chega aqui):
            // volta pra mesma sala sozinho, com backoff. Desmonta a
            // sessao morta -- a reconexao reconstroi mesh/arvore do zero,
            // que e o estado seguro depois de perder a sinalizacao.
            const next = attempts + 1;
            $('setup-error').textContent = `Conexão caiu. Reconectando… (${next}/${MAX_RECONNECT})`;
            teardownSession(session);
            renderMembersPanel();
            renderRoomList();
            setTimeout(() => {
              if (currentSession) return; // usuario ja entrou noutra sala/saiu
              joinRoom(rawUrl, name, publicAddress, undefined, next);
            }, 1000 * 2 ** attempts);
            return;
          }

          if (abnormal && attempts >= MAX_RECONNECT) {
            $('setup-error').textContent =
              'Perdi a conexão com a sala e não consegui reconectar. Tente entrar de novo.';
          }

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
      // O tile pertence a quem PRODUZIU o video, nao a quem o entregou. Numa
      // conexao de repasse (kind composto 'screen@<origem>') quem entrega e
      // o relay, mas o conteudo e da origem -- desenhar sob o id do relay
      // mostraria a tela da origem com o nome e o avatar do relay, e ainda
      // brigaria pelo mesmo tile com o compartilhamento proprio do relay.
      onTrack: (peerId, peerName, stream, kind) => {
        if (currentSession !== session) return;
        const { baseKind, sourceId } = parseKind(kind);
        const ownerId = sourceId || peerId;
        const owner = session.mesh.peers.get(ownerId);
        const displayName = owner?.name || (sourceId ? `#${ownerId}` : peerName);
        const tileId = tileIdFor(ownerId, baseKind);
        tileSource.set(tileId, connKeyOf(peerId, kind));
        ui.grid.showTile(tileId, displayName, stream, {
          avatar: owner?.avatar || null,
          kind: baseKind,
        });
        // A stream chegou: se somos relay dela, e a hora de repassar. Este
        // e o gatilho CERTO pro repasse -- antes ele dependia de a
        // mensagem 'tree' ou uma 'offer' chegarem depois da stream, e como
        // a origem agora so re-emite 'tree' quando a topologia muda de
        // verdade, um repasse que perdeu a corrida nao teria segunda
        // chance. flushPendingRelay ignora quem nao e relay e nao repassa
        // duas vezes pro mesmo filho.
        if (!sourceId) flushPendingRelay(session, baseKind, peerId).catch(() => {});
      },
      onPeerState: (peerId, { removedTile, kind, dir, failed }) => {
        if (currentSession !== session) return;
        const { baseKind, sourceId } = parseKind(kind);
        if (removedTile) {
          // So apaga se o tile ainda for DESTA conexao: um caminho novo pro
          // mesmo conteudo pode ja te-lo assumido (ver tileSource).
          const tileId = tileIdFor(sourceId || peerId, baseKind);
          if (tileSource.get(tileId) === connKeyOf(peerId, kind)) dropTile(tileId);
          // A stream que entrava por esta conexao morreu (ou foi
          // substituida). Se estavamos RETRANSMITINDO ela, o que sai pros
          // filhos vale tanto quanto ela: derruba os repasses e limpa o
          // registro, pra que a proxima stream desta origem seja repassada
          // de novo em conexoes novas em vez de virar um transceiver extra
          // empilhado numa conexao que ja carrega uma track morta.
          if (!sourceId) dropRelaysOf(session, baseKind, peerId);
        }
        // So a conexao DIRETA origem->relay sinaliza perda de relay. Uma
        // out-conn de repasse que falha e a nossa ponta com um filho, nao
        // com o relay -- e nesse caso nem somos a origem.
        if (failed && dir === 'out' && !sourceId
            && originTree[baseKind]?.assignments.get(peerId)?.role === 'relay') {
          recoverFromRelayLoss(baseKind, peerId);
        }
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
    const wasHosting = !!hostInfo;
    currentSession = null;
    activeRoomAddress = null;
    hostInfo = null;
    session.sig?.close();
    // Se a sala era nossa, derruba o servidor embutido e o anuncio UDP junto
    // -- senao ela continua aparecendo em "Ao vivo agora" pros outros mesmo
    // vazia, ate o app fechar.
    if (wasHosting) window.golive.stopHosting?.().catch(() => {});
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
    try {
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
        dropTile(msg.id);
        dropTile(`cam-${msg.id}`);
        renderMembersPanel();
        sound.playLeaveSound();
        broadcastWatchers('screen'); // quem saiu pode ter sido um espectador na lista
        broadcastWatchers('camera');
        for (const kind of KINDS) {
          // Quem saiu nao e mais origem de nada: descarta o papel que ele
          // nos deu, junto com o epoch dele. Sem isto o mapa por-origem so
          // cresce, e um id reaproveitado herdaria um epoch alto.
          myRole[kind].delete(msg.id);
          recentRelayFailures[kind].delete(msg.id);
          if (originTree[kind].assignments.get(msg.id)?.role === 'relay') {
            recoverFromRelayLoss(kind, msg.id);
          } else {
            recomputeTree(kind);
          }
        }
        break;
      }
      case 'offer': {
        // msg.kind pode ser composto ('screen@<origem>') quando quem oferta
        // e um relay -- handleOffer usa a chave como veio, pra nao atropelar
        // o slot do compartilhamento proprio do relay.
        if (!isKnownKind(msg.kind)) break;
        const answerSdp = await mesh.handleOffer(msg.from, msg.sdp, msg.kind);
        if (currentSession !== session) return; // sessao caiu enquanto negociava
        sig.send({ type: 'answer', to: msg.from, sdp: answerSdp, kind: msg.kind });
        // Comecamos a receber com a janela ja oculta: o transmissor assume
        // "assistindo" por padrao, entao precisa ser corrigido na hora --
        // do contrario ele paga um encode que ninguem esta vendo ate a
        // proxima mudanca de visibilidade.
        if (!isAppVisible()) sig.send({ type: 'view-state', to: msg.from, kind: msg.kind, watching: false });
        // So uma oferta DIRETA da origem destrava um repasse pendente: a
        // stream que vamos repassar e a que acabou de chegar por ela.
        if (!parseKind(msg.kind).sourceId) await flushPendingRelay(session, msg.kind, msg.from);
        break;
      }
      case 'answer': {
        if (!isKnownKind(msg.kind)) break;
        await mesh.handleAnswer(msg.from, msg.sdp, msg.kind);
        if (currentSession !== session) return;
        mesh.applyEncoding(qualityFor(msg.kind), msg.kind);
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
        if (!isKnownKind(msg.kind)) break;
        const track = trackForKind(msg.kind);
        if (mesh.setPeerDemand(msg.from, msg.kind, Boolean(msg.watching), track)) {
          renderMembersPanel();
          // A lista de "quem esta assistindo" e da ORIGEM. Num kind
          // composto quem suspendeu foi um filho NOSSO, e nos somos relay,
          // nao origem -- nao ha tile local pra atualizar nem lista pra
          // anunciar. O que muda rio acima vai no broadcastViewState.
          if (!parseKind(msg.kind).sourceId) broadcastWatchers(msg.kind);
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
        // `msg.from` e carimbado pelo servidor (signaling-core.js) e nao da
        // pra forjar; `msg.origem` vem do cliente e deveria ser identico.
        // Usar o carimbado como CHAVE do estado impede que uma origem
        // (mesmo por engano) mexa no papel que outra nos deu.
        const origem = msg.from;
        if (origem == null) break;
        const state = roleFor(kind, origem);
        // epoch e por-origem: cada origem tem seu proprio contador, entao a
        // comparacao so faz sentido contra o ultimo visto DAQUELA origem.
        if (msg.epoch < state.epoch) break;
        const filhosIds = Array.isArray(msg.filhos) ? msg.filhos : [];
        // `relayed` NAO e zerado aqui. Ele registra pra quais filhos ja
        // existe uma conexao de repasse viva, e um 'tree' novo nao mata
        // essas conexoes -- zerar fazia o flush abaixo chamar relayTo de
        // novo pros MESMOS filhos, e cada chamada empilha um transceiver
        // (um encoder) a mais na conexao que ja existe. Sai do conjunto
        // quem realmente perdeu a conexao: os filhos removidos logo abaixo,
        // e todos eles quando a stream da origem se vai (ver onPeerState).
        //
        // Filhos que saem da nossa lista precisam ter o repasse FECHADO --
        // seja porque a arvore mudou, seja porque ela foi dissolvida (o
        // interruptor desligado manda todo mundo pra 'direct'). Sem isto o
        // relay segue pagando um encoder por um filho que a origem ja
        // reassumiu, e o filho recebe o mesmo video por dois caminhos
        // brigando pelo mesmo tile.
        const dropped = state.filhosIds.filter((id) => !filhosIds.includes(id));
        for (const childId of dropped) {
          mesh.closeOut(childId, relayKindFor(kind, origem));
          state.relayed.delete(childId);
        }

        state.epoch = msg.epoch;
        state.paiId = msg.paiId;
        state.filhosIds = filhosIds;
        state.role = filhosIds.length
          ? 'relay'
          : msg.paiId === origem ? 'direct' : 'folha';

        if (state.role === 'relay') await flushPendingRelay(session, kind, origem);
        break;
      }
    }
    } catch (err) {
      // Qualquer await acima pode rejeitar (setRemoteDescription com SDP
      // inesperado, createAnswer numa conexao ja fechada, etc). Sem este
      // catch a rejeicao virava unhandledrejection sem contexto nenhum de
      // qual mensagem causou -- so o texto solto do erro no log. Ver a
      // auditoria de 2026-08-27, item A6.
      console.error(`[signaling] falha processando '${msg.type}' de #${msg.from ?? '?'} (kind=${msg.kind ?? '-'}):`, err);
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
        showToast(`Não consegui capturar a tela: ${err.message}`);
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
    forgetOriginTree('screen');
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
        showToast(`Não consegui acessar a câmera: ${err.message}`);
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
    forgetOriginTree('camera');
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
    const { baseKind, sourceId } = parseKind(kind);
    // Kind composto: quem voltou a assistir e um filho NOSSO, e o que
    // devolvemos ao sender e a track que RECEBEMOS da origem -- nao a
    // captura local, que num relay pode nem existir.
    if (sourceId) {
      const inbound = currentSession?.mesh?.peers.get(sourceId)?.inStreams?.[baseKind];
      return inbound?.getVideoTracks()[0] || null;
    }
    const stream = baseKind === 'camera' ? cameraStream : localStream;
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
      const { baseKind, sourceId } = parseKind(kind);
      if (!KINDS.includes(baseKind)) continue;
      // Num kind composto quem esta rio acima e o RELAY que nos serve, e
      // nos somos folha: nao ha sub-arvore nossa pra agregar. Numa conexao
      // direta, `peerId` E a origem -- que e exatamente a chave do estado
      // por-origem, entao a pergunta "sou relay DESTE peer?" vira uma
      // consulta direta.
      const state = sourceId ? null : myRole[baseKind].get(peerId);
      // As out-conns pros nossos filhos vivem sob o kind COMPOSTO (foi
      // assim que relayTo as criou) -- consultar isPeerSuspended com o
      // kind cru olharia o slot errado e nunca acharia ninguem assistindo.
      const childKind = relayKindFor(baseKind, peerId);
      const anyFolhaWatching = state?.role === 'relay'
        && state.filhosIds.some((id) => !session.mesh.isPeerSuspended(id, childKind));
      const watching = isAppVisible() || Boolean(anyFolhaWatching);
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

  /** Fecha todo repasse do conteudo de `sourcePeerId` naquele kind e
   * esquece que ele existiu. Chamado quando a stream que alimentava esses
   * repasses acabou. */
  function dropRelaysOf(session, kind, sourcePeerId) {
    if (!KINDS.includes(kind)) return;
    const state = myRole[kind].get(sourcePeerId);
    if (!state?.relayed.size) return;
    const childKind = relayKindFor(kind, sourcePeerId);
    for (const childId of state.relayed) session.mesh.closeOut(childId, childKind);
    state.relayed = new Set();
  }

  // Tenta repassar (relayTo) pros filhos que ainda nao temos servindo.
  // Chamado ao receber 'tree' (o caso comum), depois de processar uma
  // 'offer' daquela origem, e -- o gatilho mais confiavel -- quando a
  // stream da origem de fato chega (onTrack): a 'tree' pode ganhar a
  // corrida da 'offer', e nesse caso relayTo devolve false na hora. Ver
  // Task 3. 'relayed' evita repassar duas vezes pro mesmo filho.
  async function flushPendingRelay(session, kind, sourcePeerId) {
    // `kind` chega da rede (msg.kind de uma 'offer') -- sem esta guarda,
    // um kind malformado indexaria myRole em undefined e estouraria uma
    // promise rejeitada sem dono.
    if (!KINDS.includes(kind) || sourcePeerId == null) return;
    // O estado e por-origem: so repassamos o que veio DAQUELA origem, e
    // `paiId === sourcePeerId` e implicito na chave (um relay tem sempre a
    // origem como pai -- profundidade maxima 2).
    const state = myRole[kind].get(sourcePeerId);
    if (!state || state.role !== 'relay') return;
    const quality = qualityFor(kind);
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

  // Quanto tempo um relay que acabou de falhar fica fora da lista de
  // candidatos. Precisa cobrir com folga a deteccao de falha do ICE (o
  // Chromium leva alguns segundos entre 'disconnected' e 'failed'), senao a
  // re-eleicao imediata reelege o mesmo no -- ele continua na sala, nao
  // transmitindo, e com o MELHOR RTT lembrado justamente porque esteve
  // conectado -- e a arvore fica batendo entre os mesmos dois estados. E
  // precisa ser curto o bastante pra que uma queda passageira nao exile o
  // melhor candidato da sala por muito tempo: o veto expira sozinho e ele
  // volta a concorrer no proximo evento discreto (alguem entra ou sai).
  // 8s atende os dois lados; nao vale um ajuste em Configuracoes.
  const RELAY_FAILURE_COOLDOWN_MS = 8000;

  function isRelayOnCooldown(kind, peerId) {
    const at = recentRelayFailures[kind].get(peerId);
    if (at == null) return false;
    if (Date.now() - at >= RELAY_FAILURE_COOLDOWN_MS) {
      recentRelayFailures[kind].delete(peerId); // expirou: volta a concorrer
      return false;
    }
    return true;
  }

  /** Parar de transmitir desmonta a arvore daquele kind (closeAllOut ja
   * fechou todas as conexoes). O registro precisa sumir junto: guardado, a
   * comparacao de recomputeTree acharia a topologia "inalterada" na
   * proxima transmissao e nao aplicaria nada -- ninguem receberia papel. */
  function forgetOriginTree(kind) {
    originTree[kind].assignments = new Map();
  }

  /** Ha alguma arvore montada agora naquele kind (alguem que nao seja
   * 'direct')? Usado pra decidir se vale dissolver quando o interruptor
   * e desligado no meio da sessao. */
  function hasActiveTree(kind) {
    for (const assignment of originTree[kind].assignments.values()) {
      if (assignment.role !== 'direct') return true;
    }
    return false;
  }

  // `force` pula a comparacao com a topologia anterior: usado na
  // recuperacao de falha, onde a conexao morta precisa ser re-ofertada
  // mesmo que o resultado do calculo tenha dado igual.
  function recomputeTree(kind, { force = false } = {}) {
    const session = currentSession;
    if (!session?.mesh) return;
    const stream = kind === 'camera' ? cameraStream : localStream;
    if (!stream) return;
    // Com o interruptor desligado nao ha nada a calcular -- EXCETO quando
    // ele acabou de ser desligado com uma arvore no ar: ai precisamos
    // dissolve-la (todo mundo 'direct'), senao as folhas ficam cortadas da
    // origem e sem relay. Quando nunca houve arvore, isto e zero-op e o
    // comportamento de malha segue igual ao de sempre.
    if (!cfg.network.tree && !hasActiveTree(kind)) return;

    const candidates = [];
    for (const [id, peer] of session.mesh.peers) {
      candidates.push({
        id,
        // LIMITACAO CONHECIDA (F2): `peer.rtt[kind]` so e alimentado por
        // updateStats, que le statsFor -- e statsFor exige uma out-conn
        // CONECTADA daquele kind. Assim que um peer vira 'folha', a origem
        // fecha essa out-conn (closeOut) e para de medir: o RTT dele
        // congela no ultimo valor visto (ou fica null, se ele virou folha
        // antes da primeira amostra). Uma re-eleicao futura, portanto,
        // julga as folhas por dado velho. Reotimizacao continua esta
        // explicitamente fora de escopo no plano ("Fora de escopo:
        // recomputo continuo por RTT"), e nao ha outra fonte de RTT
        // origem->folha disponivel aqui (o caminho passa pelo relay). Fica
        // registrado pra nao ser redescoberto como bug.
        rtt: peer.rtt?.[kind] ?? null,
        joinedAt: peer.joinedAt || 0,
        transmitting: Boolean(peer.live),
        suspended: session.mesh.isPeerSuspended(id, kind),
        relayIneligible: isRelayOnCooldown(kind, id),
      });
    }
    if (!candidates.length) return;

    const assignments = cfg.network.tree
      ? tree.computeTree(myId, candidates)
      : tree.allDirect(myId, candidates);

    // Topologia identica a que ja esta no ar: nao mexe em nada. Antes o
    // epoch subia de qualquer jeito e o 'tree' resultante mandava cada
    // relay repassar de novo pros MESMOS filhos -- um transceiver (um
    // encoder) a mais por evento de sala, e uma renegociacao (tela preta)
    // em cada folha a cada entra-e-sai que nao tinha nada a ver com ela.
    if (!force && tree.sameAssignments(assignments, originTree[kind].assignments)) return;

    const epoch = ++originTree[kind].epoch;
    originTree[kind].assignments = assignments;
    applyOriginAssignments(session, kind, assignments, epoch);
  }

  // Um relay saiu da sala (ou a conexao origem->relay caiu): as folhas dele
  // ficam orfas. Reconecta direto (malha) PRIMEIRO -- o video volta rapido
  // -- e SO DEPOIS recalcula a arvore (que pode escolher um relay novo).
  // Ver a spec de 2026-08-23, tabela de Recuperacao em F2.
  function recoverFromRelayLoss(kind, relayId) {
    const session = currentSession;
    const stream = kind === 'camera' ? cameraStream : localStream;
    if (!session?.mesh || !stream) return;

    // PRIMEIRA coisa, antes de qualquer outra: zerar o slot da out-conn pro
    // relay. Quando a causa e falha de CONEXAO (e nao o relay ter saido da
    // sala), ninguem chamou removePeer -- a RTCPeerConnection morta continua
    // em outConns[kind]. applyOriginAssignments so oferta pra quem NAO tem
    // out-conn, entao, com o cadaver ali, uma re-eleicao que mantivesse este
    // mesmo relay nunca mais lhe mandaria uma oferta, e as folhas que
    // acabamos de reconectar seriam cortadas de novo pelo papel 'folha'.
    // Resultado: todo mundo sem video, e nenhum evento restante pra
    // consertar. closeOut aqui e o oposto de setPeerDemand: a conexao morre
    // de verdade porque ela ja esta morta.
    session.mesh.closeOut(relayId, kind);
    // E veta este no como relay por um tempo, senao a re-eleicao logo abaixo
    // o escolhe de novo (ver RELAY_FAILURE_COOLDOWN_MS).
    recentRelayFailures[kind].set(relayId, Date.now());

    const orphans = originTree[kind].assignments.get(relayId)?.filhosIds || [];
    if (!orphans.length) {
      recomputeTree(kind, { force: true });
      return;
    }
    // Reconecta as orfas direto (malha) PRIMEIRO -- o video volta rapido --
    // e so depois recalcula. `force` porque a conexao com o relay acabou de
    // ser fechada: mesmo que a topologia calculada saia igual, ela precisa
    // ser reaplicada pra que a oferta seja refeita.
    const quality = qualityFor(kind);
    Promise.all(orphans.map((id) => session.mesh.offerTo(id, stream, quality, kind).catch(() => {})))
      .then(() => recomputeTree(kind, { force: true }));
  }

  // Distribui os papeis calculados: manda 'tree' pra todo mundo (protocolo
  // exato da spec: { type, to, kind, origem, paiId, filhos, epoch }), e
  // ajusta as outConns desta sessao pra bater com o papel de cada um.
  // 'direct' e 'relay' recebem oferta direta (se ainda nao tiverem); quem
  // virou 'folha' e cortado daqui -- quem vai mandar pra ele e o relay, via
  // relayTo (Task 5).
  function applyOriginAssignments(session, kind, assignments, epoch) {
    const stream = kind === 'camera' ? cameraStream : localStream;
    const quality = qualityFor(kind);

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
      // null (nao 0) porque "nenhum candidate-pair reportou RTT" e
      // "reportou 0 ms" sao coisas diferentes -- 0 ms acontece de verdade
      // em loopback/mesma maquina, e trata-lo como ausente descartaria a
      // medida e ainda faria a eleicao de relay cair no desempate por
      // joinedAt em vez de usar o melhor RTT que existe.
      rtt: null,
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
        sample.rtt = Math.max(sample.rtt ?? 0, stat.currentRoundTripTime * 1000);
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
        // `??`, nao `||`: um RTT de 0 ms e uma medida valida (loopback /
        // mesma maquina) e nao pode ser confundido com "sem amostra".
        (peer.rtt ||= {})[kind] = sample.rtt ?? peer.rtt?.[kind] ?? null;
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
          <td>${r.rtt != null ? `${Math.round(r.rtt)} ms` : '-'}</td>
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
