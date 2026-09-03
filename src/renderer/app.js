// src/renderer/app.js
'use strict';

(function () {
  const { config, signaling, mesh: meshModule, ui, sound, tree, queue, status, autoquality, rxstats, peerquality, encodehealth } = window.GoLive;

  let cfg = config.load(localStorage.getItem('golive'));
  localStorage.setItem('golive', config.serialize(cfg)); // grava de imediato -- garante que um clientId novo sobrevive ao proximo reinicio
  sound.setEnabled(cfg.soundsEnabled); // aplica a preferencia salva antes de qualquer som tocar
  // `currentSession` is the single source of truth for "the session that is
  // live right now". Every async callback (WS messages, WebRTC events,
  // capture promises) captures the specific `session` object it belongs to
  // and checks `currentSession !== session` before touching anything — that
  // way a late event from a torn-down or superseded session is a no-op
  // instead of throwing on stale/null state.
  let currentSession = null; // { sig, mesh } | null
  // Sessao orfa (H1): a sinalizacao caiu, mas as RTCPeerConnection P2P
  // seguem vivas entregando video. A sinalizacao so e necessaria pra
  // ESTABELECER conexao -- depois pode sumir por minutos sem consequencia.
  // Enquanto `orphanSession` existe, `currentSession` e null (todo `mesh.send`
  // e callback tardio vira no-op, entao a orfa e muda por construcao e nunca
  // ha duas sessoes transmitindo), mas os tiles e o mesh dela continuam.
  // Descartada em exatamente tres pontos: onOpen de uma reconexao que abre
  // (teardownPeers -- preserva a captura), leaveRoom e troca de sala (ambos
  // teardownSession completo).
  let orphanSession = null;
  // So pode haver UM retry de reconexao pendente por vez (o timer que
  // dispara joinRoom da tentativa n+1 e agendado no onClose da tentativa n,
  // que ja e sequencial). Modulo-level porque quem precisa cancela-lo --
  // leaveRoom, um joinRoom deliberado, o onOpen de uma reconexao que abriu
  // -- nao tem acesso ao objeto `session` que o agendou (pode ser a sessao
  // B, C... de uma cadeia de tentativas que ninguem mais referencia). Sem
  // cancelar, um Desconectar durante o "Reconectando…" era desfeito pelo
  // timer, que so testa `if (currentSession)`.
  let retryTimer = null;
  let myId = null;
  let ownerId = null; // 'me' quando EU sou o dono, ou o id do peer marcado owner:true

  const KINDS = ['screen', 'camera'];
  const { relayKindFor, parseKind } = meshModule;
  const { isSoftwareEncoder, summarizeScreenEncodeHealth } = encodehealth;
  const { encodediag } = window.GoLive;

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

  // Modo malha degradada, por kind (auditoria H3): true quando QUERIAMOS
  // arvore (cfg.network.tree ligado) e computeTree so devolveu 'direct' por
  // falta de relay elegivel. `qualityFor` consulta isto pra somar UM degrau
  // ao que a Task 3 ja degrada -- sem isso a malha volta em qualidade cheia,
  // os N encoders da origem derrubam o NVENC pra software, o jitter veta
  // mais relays e a malha se realimenta. So muda de valor pela transicao
  // (ver setMeshFallback): ligar-desligar-ligar a cada recalculo viraria
  // spam de toast e de setParameters.
  const meshFallback = { screen: false, camera: false };

  // Histerese da re-eleicao, por kind (Parte B): instante da ultima
  // re-eleicao aplicada e o handle de um recalculo comum que caiu dentro da
  // janela e foi adiado. Ver REELECTION_HYSTERESIS_MS e recomputeTree.
  const reelectionAt = { screen: 0, camera: 0 };
  const deferredRecompute = { screen: null, camera: null };

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
      // Estado degradado e histerese morrem com a sessao pelo mesmo motivo
      // que o resto: carregados pra sala seguinte, aplicariam um preset
      // baixo (ou adiariam o primeiro recalculo) sem causa nenhuma. Zera
      // direto, sem setMeshFallback: nao ha conexao pra retunar nem toast a
      // dar num teardown.
      meshFallback[kind] = false;
      reelectionAt[kind] = 0;
      if (deferredRecompute[kind]) {
        clearTimeout(deferredRecompute[kind]);
        deferredRecompute[kind] = null;
      }
    }
    // myId so tem sentido dentro de UMA sessao (e o id que o servidor nos
    // deu no 'welcome' daquela sala). Zerar aqui junto com o resto do
    // estado de arvore -- ele nao e usado fora de contexto de sessao ativa
    // hoje, mas deixa-lo sobreviver seria exatamente o tipo de estado
    // fantasma que esta funcao existe pra evitar.
    myId = null;
    ownerId = null;
  }
  let localStream = null;
  // Pausa da transmissao: a tela continua capturada e as conexoes de pe, so
  // param de receber quadro. Diferente de parar de compartilhar, que fecha
  // tudo e obriga a escolher a fonte de novo.
  let sharePaused = false;
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
  // Resumo da NOSSA saude de encode ({ softwareEncoder, msPerFrame }), o
  // ultimo derivado por updateStats. Sobe junto do 'view-state' pra que a
  // origem nao eleja relay quem ja esta com o encoder afogado (H2). null
  // enquanto nao estivermos codificando nada -- reportar valor inventado e
  // pior que reportar ausencia.
  let myEncodeHealth = null;
  // Menor availableOutgoingBitrate visto entre os nossos senders, em bits/s
  // (null enquanto nao ha amostra). E o orcamento de UPLINK deste no --
  // usado pra limitar o preset de repasse (config.qualityForRelay).
  let myAvailableBps = null;
  // receiveHealth mais recente que CADA peer reportou sobre o stream que
  // mandamos pra ele. Chave 'peerId:kind'. Alimenta a escada por-peer
  // (Task 5). Espelha o papel de peer.encodeHealth, mas por-conexao porque
  // um peer pode receber tela e camera com saudes diferentes.
  const rxHealthByPeer = new Map();
  // Escada de degradacao POR CONEXAO. Chave 'peerId:baseKind'. Parte do
  // piso global (qualityFor) e desce mais para quem esta sofrendo sozinho.
  // Zerada ao parar de compartilhar: os degraus descrevem uma conexao, nao
  // a nossa maquina.
  const peerQuality = new Map();
  // Amostra anterior de readReceiverReport por 'peerId:kind', pra derivar a
  // taxa da janela (freezeCount e cumulativo).
  const rxPrevSample = new Map();
  let rxPrevAtMs = 0;
  const RX_HEALTH_TTL_MS = 6000;
  /** receiveHealth do peer pra um baseKind, ou null se velha demais -- um
   * stream congelado para de reportar, e o valor velho faria a escada
   * "recuperar" um peer travado. */
  function freshReceiveHealth(peer, baseKind) {
    const e = peer?.receiveHealth?.[baseKind];
    if (!e || Date.now() - e.atMs > RX_HEALTH_TTL_MS) return null;
    const { atMs, ...rh } = e;
    return rh;
  }
  // Escada de degradacao automatica da TELA, alimentada pela telemetria de
  // encode em updateStats. Zerada ao parar de compartilhar: os degraus
  // descrevem uma transmissao especifica, nao a maquina.
  let autoQuality = autoquality.initialState();
  // Ultima linha [diag] emitida por sender de tela ({ sig, atMs }), pra nao
  // repetir a mesma no log a 1 linha/s. Zerada junto do loop de stats.
  const diagPrev = new Map();
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

  function clearCooldown(address) {
    if (address) roomCooldowns.delete(address);
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

  /** Quantas pessoas ha na sala alem de nos.
   *
   * E o tamanho da SALA, nao a contagem de out-conns: com a arvore de
   * retransmissao ligada a origem tem so 1-2 out-conns por kind, entao
   * contar conexoes faria a degradacao nunca disparar. O custo que importa
   * e o total de encoders na sala -- os nossos mais os 2 de cada relay --
   * e esse escala com o tamanho da sala, nao com os nossos vizinhos. */
  function audienceSize() {
    return currentSession?.mesh.peers.size ?? 0;
  }

  /** Qualidade de encode daquele kind. Usa o kind BASE, pra que uma
   * conexao de repasse ('camera@<origem>') nao caia no preset de tela.
   *
   * A tela degrada com o tamanho da sala (H4): 1080p60 e o preset certo pra
   * 1 espectador e o preset errado pra 3 -- a medicao do projeto mostrou 4
   * espectadores a 1080p60 quebrando o NVENC sem jogo nenhum aberto.
   * Ninguem escolhe nada, a sala so nao entra no regime onde quebra. O
   * relay tambem re-codifica com esta funcao, entao os 2 encoders dele
   * herdam o preset degradado de graca.
   *
   * A camera fica como esta: 720p30 a 2 Mbps ja e o piso, degradar nao
   * resolve nada. */
  function qualityFor(kind) {
    const baseKind = parseKind(kind).baseKind;
    if (baseKind === 'camera') return { ...cfg.camera, codec: 'video/VP8' };
    const effective = config.qualityForAudience(cfg.quality.preset, audienceSize());
    // Dois degraus somam sobre o que o tamanho da sala ja pediu:
    //  - malha degradada (H3): a origem paga N encoders em vez de 1;
    //  - escada automatica: a telemetria disse que nao esta dando conta.
    // degradePreset para no piso e nunca lanca, entao isto e seguro no
    // caminho de encode.
    const extraSteps = (meshFallback[baseKind] ? 1 : 0) + autoQuality.steps;
    if (!extraSteps) return effective;
    return config.qualityFromPreset(config.degradePreset(effective.preset, extraSteps));
  }

  /** Qualidade efetiva para UM destinatario: o piso menos os degraus que a
   * conexao DELE pediu. Pra um FILHO de relay, o piso e o MENOR entre o piso
   * global e o teto de uplink do relay (config.qualityForRelay) -- o relay
   * sobe uma copia por filho e nao pode passar do proprio orcamento. */
  function qualityForPeer(peerId, kind) {
    const { baseKind, sourceId } = parseKind(kind);
    let floor = qualityFor(kind);

    if (sourceId) {
      // kind composto -> somos relay desta origem. Limita pelo uplink.
      const state = myRole[baseKind].get(sourceId);
      const filhos = state?.filhosIds.length || 1;
      const relayCap = config.qualityForRelay(floor.preset, filhos, myAvailableBps);
      // menor preset entre os dois (comparar pelo bitrate da cadeia)
      if (relayCap.bitrate < floor.bitrate) floor = relayCap;
    }

    const st = peerQuality.get(`${peerId}:${baseKind}`);
    const steps = st?.steps || 0;
    if (!steps) return floor;
    return config.qualityFromPreset(config.degradePreset(floor.preset, steps));
  }

  /** Reaplica o teto de encode E o formato da captura nas conexoes abertas
   * daquele kind. `applyEncoding` mexe em maxBitrate/maxFramerate via
   * setParameters; `applyConstraints` reconfigura o proprio capturador --
   * os dois sem renegociacao e sem tela preta.
   *
   * Sem a parte da captura, degradar so fazia o encoder DESCARTAR quadros
   * que a captura continuava produzindo a 1080p60: o custo de capturar e
   * escalar ficava pago inteiro, na maquina que ja nao esta dando conta.
   *
   * lastCaptureKey existe porque recomputeTree chama isto varias vezes por
   * evento de sala, e reconfigurar o capturador com o MESMO formato pode
   * custar um solavanco de imagem a toa. */
  let lastCaptureKey = '';

  /** Estamos repassando video pra alguem agora? Um relay paga 2 encodes e
   * um decode sem necessariamente transmitir nada proprio -- entao ainda
   * precisa do loop de estatisticas ligado. */
  function isRelaying() {
    for (const kind of KINDS) {
      for (const state of myRole[kind].values()) {
        if (state.role === 'relay' && state.filhosIds.length) return true;
      }
    }
    return false;
  }

  function reapplyAudienceQuality() {
    if (!currentSession) return;
    const mesh = currentSession.mesh;
    const floor = qualityFor('screen'); // piso global -- nao depende de localStream

    if (localStream) {
      // Espectadores diretos: uma escada por conexao.
      for (const peerId of mesh.peers.keys()) {
        const q = qualityForPeer(peerId, 'screen');
        mesh.applyEncodingToPeer(peerId, q, 'screen', config.scaleFactorFor(floor.width, q.width));
      }

      // A CAPTURA continua guiada pelo piso global -- ela e comum a todas as
      // conexoes, entao segue o denominador comum.
      const key = `${floor.width}x${floor.height}@${floor.fps}`;
      const track = localStream.getVideoTracks()[0];
      if (track && track.readyState === 'live' && key !== lastCaptureKey) {
        lastCaptureKey = key;
        track.applyConstraints(config.videoConstraints(floor)).catch((err) => {
          console.error('[qualidade] applyConstraints na captura falhou:', err);
        });
      }
    }

    // Filhos de relay: valem MESMO sem localStream (relay puro). Os filhos
    // vivem sob kind composto e o encode deles e pago aqui de qualquer jeito.
    for (const [sourceId, state] of myRole.screen) {
      if (state.role !== 'relay') continue;
      const ck = relayKindFor('screen', sourceId);
      for (const childId of state.filhosIds) {
        const q = qualityForPeer(childId, ck);
        mesh.applyEncodingToPeer(childId, q, ck, config.scaleFactorFor(floor.width, q.width));
      }
    }

    if (cameraStream) mesh.applyEncoding(qualityFor('camera'), 'camera');
  }

  /** Liga/desliga o modo malha degradada de um kind. So faz algo na
   * TRANSICAO: fora dela seria um setParameters e um toast a cada recalculo
   * da arvore (varios por evento de sala). Na transicao: retune das conexoes
   * ja abertas pra seguirem o preset novo, e -- so quando ENTRA no modo
   * degradado -- um toast. Sair do modo nao interrompe ninguem: e boa
   * noticia e o encode ja subiu sozinho via applyEncoding. */
  function setMeshFallback(kind, value) {
    if (meshFallback[kind] === value) return;
    meshFallback[kind] = value;
    // qualityFor le meshFallback[kind], entao ja devolve o preset certo aqui.
    // Unico ponto de retune: preserva bitrate/fps/scale por-peer em vez de
    // varrer todos os senders com o piso global.
    reapplyAudienceQuality();
    if (value && kind === 'screen') {
      // So a tela tem cadeia de degradacao; a camera ja esta no piso, entao
      // avisar que "baixei a qualidade" dela seria mentira.
      showToast('Sem ninguém pra retransmitir: baixei a qualidade pra sala aguentar.');
    }
    renderRoomStatus();
  }

  // Sessao "efetiva" pra UI (painel de membros, mensagem de grade vazia): a
  // que tem tiles na tela agora. Numa reconexao automatica `currentSession`
  // ja existe (e criada antes de o socket abrir) mas ainda esta com zero
  // peers, enquanto a orfa da queda anterior segue com video na tela.
  // Preferir a que abriu de verdade -- e so cair na nova quando ela abrir --
  // evita um "so voce por aqui" desenhado sob uma tela cheia de video durante
  // a janela do retry.
  function displaySession() {
    if (currentSession?.opened) return currentSession;
    return orphanSession || currentSession;
  }

  function emptyMessage() {
    // Sessao efetiva: com a orfa viva (sinalizacao caida, video P2P
    // rodando) os tiles dos peers continuam na tela -- a mensagem de grade
    // vazia tem de dizer "ainda estou vendo gente", nao "entre numa sala".
    return displaySession()
      ? 'Ninguém transmitindo ainda.'
      : 'Entre ou crie uma sala pra começar.';
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
        if (cameraStream) {
          restartCamera().catch((err) => console.error('[camera] troca de dispositivo falhou:', err));
        }
      },
      onNetworkChange: (network) => {
        cfg = { ...cfg, network };
        persist();
        window.golive.setAdvertise(network.advertise);
      },
      onSoundsChange: (enabled) => {
        cfg = { ...cfg, soundsEnabled: enabled };
        persist();
        sound.setEnabled(enabled);
      },
    });
  });

  async function applyLiveQuality() {
    const track = localStream.getVideoTracks()[0];
    if (track) {
      await track.applyConstraints(config.videoConstraints(cfg.quality)).catch(() => {});
    }
    // A captura vai no preset que a pessoa escolheu, mas o encode passa por
    // qualityFor -- senao trocar de preset no meio de uma sala cheia
    // escaparia da degradacao por tamanho da sala ate o proximo
    // peer-joined/peer-left. Retune por-peer: nao orfana o scaleResolutionDownBy.
    reapplyAudienceQuality();
  }

  // Escolhida no dialogo de compartilhar (ver ui.picker.open, no clique de
  // "Compartilhar tela"), nao mais nas Configuracoes -- e a qualidade que
  // vai valer pra transmissao que esta prestes a comecar.
  function onQualityPresetChange(quality) {
    cfg = { ...cfg, quality };
    persist();
    if (localStream) applyLiveQuality().catch((err) => console.error('[qualidade] applyLiveQuality falhou:', err));
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
        // Sala com PIN (B3): em vez de conectar e tomar 'join-denied', abre
        // o formulario de entrar-por-endereco ja preenchido, com o foco no
        // campo de PIN. Quem criou a sala passa o PIN por fora (voz, chat).
        if (room.protected) {
          ui.dialogs.openJoinRoom({ address: room.address, showPinField: true, onConnect: handleJoinConnect });
          $('setup-error').textContent = 'Essa sala pede um PIN — peça pra quem criou.';
          return;
        }
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

  // Corpo compartilhado do "Conectar" do dialogo de entrar numa sala -- usado
  // pelo botao do lobby, pela sala protegida da lista e pela reabertura do
  // dialogo apos um 'join-denied'. O #btn-connect do dialogo e ligado dentro
  // de ui.js, que chama este onConnect.
  function handleJoinConnect({ address, pin }) {
    const addr = (address || '').trim();
    if (!addr) {
      $('setup-error').textContent = 'Informe o endereço do servidor.';
      return;
    }
    hostInfo = null;
    renderHostWarning();
    ui.dialogs.closeJoinRoom();
    const url = addr.startsWith('ws://') || addr.startsWith('wss://') ? addr : `ws://${addr}`;
    joinRoom(url, cfg.name, undefined, undefined, 0, pin || null);
  }

  $('btn-join-address').addEventListener('click', () => {
    ui.dialogs.openJoinRoom({ onConnect: handleJoinConnect });
  });

  // Sobe (ou re-sobe) o servidor embutido e entra nele como host. Usada tanto
  // pelo botao "Criar sala" quanto ao reconectar numa sala propria que estava
  // salva em "Recentes" (ver isOwn em onSelect, acima).
  async function hostRoomFlow() {
    $('setup-error').textContent = '';
    const protect = $('chk-protect-room').checked;
    let result;
    try {
      result = await window.golive.hostRoom({ name: cfg.name || 'anônimo', advertise: cfg.network.advertise, protect });
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
    hostInfo = { port: result.port, address: result.address, pin: result.pin || null, ownerToken: result.ownerToken || null, firewall: result.firewall, addressWarning: result.addressWarning };
    renderHostWarning();
    joinRoom(`ws://127.0.0.1:${result.port}`, cfg.name, hostInfo.address, undefined, 0, result.pin || null);
  }

  $('btn-create-room').addEventListener('click', () => {
    ui.dialogs.openCreateRoom({
      onConfirm: async ({ protect }) => {
        $('chk-protect-room').checked = protect;
        ui.dialogs.closeCreateRoom();
        await hostRoomFlow();
      },
    });
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
  // Derruba SO a captura local (tela + camera). Separada de teardownSession
  // por causa do A3: a reconexao automatica precisa desmontar a sessao morta
  // sem matar o que a pessoa estava transmitindo -- so a saida deliberada e a
  // desistencia do retry chamam isto.
  function teardownMedia() {
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
    $('btn-toggle-share').classList.remove('active');
    resetShareState();
  }

  // Derruba as conexoes P2P e o estado de tiles dos peers dessa sessao. A
  // captura local NAO e tocada aqui.
  function teardownPeers(session) {
    if (session?.mesh) {
      for (const peerId of Array.from(session.mesh.peers.keys())) {
        session.mesh.removePeer(peerId);
        dropTile(peerId);
        dropTile(`cam-${peerId}`);
      }
    }
    tileSource.clear();
  }

  function teardownSession(session) {
    stopStatsLoop();
    resetTreeState();
    teardownMedia();
    teardownPeers(session);
    renderMembersPanel();
  }

  // ---------- Painel "Na sala" (membros + eu) ----------

  // `currentSession` so passa a existir com id/nome depois do 'welcome' (ver
  // handleSignal), mas mostramos o proprio usuario assim que a sessao existe
  // -- sem isso a coluna direita fica em branco enquanto o handshake nao
  // termina, e ele nunca aparece pra si mesmo mesmo depois.
  function currentSelfInfo() {
    // currentSession || orphanSession: enquanto a sinalizacao esta caida e o
    // video P2P continua, o painel segue mostrando voce e a sala -- some so
    // quando nao ha nem sessao viva nem orfa.
    if (!currentSession && !orphanSession) return null;
    return { name: cfg.name || 'anônimo', avatar: cfg.avatar || null, live: !!localStream };
  }

  // Chamada pelo menu de moderacao das linhas de membro (ui.js). "Silenciar"
  // NAO passa por aqui -- e resolvido inteiramente dentro do ui.js (GainNode
  // local). So chega 'stop-share', 'kick' ou 'ban'. 'ban' pede confirmacao;
  // os outros dois vao direto pro servidor.
  function sendModerate(action, targetId, targetName) {
    if (!currentSession) return;
    if (action === 'ban') {
      ui.dialogs.openBan({
        name: targetName,
        onConfirm: () => currentSession.sig.send({ type: 'moderate', action: 'ban', target: targetId }),
      });
      return;
    }
    currentSession.sig.send({ type: 'moderate', action, target: targetId });
  }

  function renderMembersPanel() {
    const session = displaySession();
    // Mapa peerId -> preset efetivo, so pra quem esta recebendo um preset
    // degradado (steps > 0). Sem isso a degradacao por-peer nao tem sinal
    // nenhum no lado de quem transmite.
    const tags = new Map();
    // Vale tambem pro relay puro (sem tela nossa): ele degrada os filhos e a
    // tag e o unico sinal disso no painel dele. isRelaying() cobre TODOS os
    // kinds, entao pode abrir o bloco pra quem so repassa camera -- nesse
    // caso os dois lacos abaixo simplesmente nao acham nada de tela.
    if (session && (localStream || isRelaying())) {
      // Espectadores diretos: so quem tem out-conn de tela nossa (quem
      // servimos via relay nao tem escada nossa -- a tag seria mentira).
      if (localStream) {
        for (const [peerId, peer] of session.mesh.peers) {
          if (!peer.outConns?.screen) continue;
          if (peerQuality.get(`${peerId}:screen`)?.steps > 0) {
            tags.set(peerId, qualityForPeer(peerId, 'screen').preset);
          }
        }
      }
      // Filhos de relay: sempre que retransmitimos, com ou sem tela propria.
      for (const [sourceId, state] of myRole.screen) {
        if (state.role !== 'relay') continue;
        for (const childId of state.filhosIds) {
          if (peerQuality.get(`${childId}:screen`)?.steps > 0) {
            tags.set(childId, qualityForPeer(childId, relayKindFor('screen', sourceId)).preset);
          }
        }
      }
    }
    ui.members.render(session ? session.mesh.peers : new Map(), currentSelfInfo(), tags, {
      ownerId,
      myId: 'me',
      onModerate: (action, targetId, targetName) => sendModerate(action, targetId, targetName),
    });
    renderRoomStatus();
  }

  /** Traduz o estado espalhado do app pro { level, label } do cabecalho.
   * Ponto unico: qualquer coisa que mude transmissao, sala ou qualidade
   * termina chamando isto. */
  function renderRoomStatus() {
    const session = displaySession();
    const live = Boolean(localStream)
      || Array.from(session?.mesh.peers.values() ?? []).some((p) => p.live);
    const effective = qualityFor('screen');
    ui.stageHeader.setStatus(status.roomStatus({
      inRoom: Boolean(session),
      // orphanSession so existe quando a sinalizacao caiu com a midia
      // viva -- e exatamente o estado "reconectando" (H1).
      reconnecting: Boolean(orphanSession),
      weAreLive: Boolean(localStream),
      anyoneLive: live,
      paused: sharePaused,
      presetDegraded: effective.preset !== cfg.quality.preset,
      autoDegraded: autoQuality.steps > 0,
      meshFallback: Boolean(meshFallback.screen),
      softwareEncoder: Boolean(myEncodeHealth?.softwareEncoder),
      effectivePreset: effective.preset,
    }));
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

  function joinRoom(rawUrl, name, publicAddress, onSettled, reconnectAttempt = 0, pin = null) {
    if (!reconnectAttempt) $('setup-error').textContent = '';
    // Join deliberado do usuario: qualquer retry pendente de uma queda
    // anterior morre aqui (esta chamada e por si so a nova intencao). O
    // retry automatico (reconnectAttempt > 0) e a propria continuacao do
    // timer -- ele nao se cancela.
    if (!reconnectAttempt) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
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

    // H1, descarte da orfa gatilho 3: entrar noutra sala e saida deliberada
    // da anterior -- teardownSession completo (mesh, PCs, captura, arvore).
    // So numa chamada do usuario (reconnectAttempt 0): a reconexao automatica
    // tambem passa por aqui com a orfa viva, e nesse caso ela e desmontada
    // no onOpen (teardownPeers, que preserva a captura), nao agora.
    if (orphanSession && !reconnectAttempt) {
      teardownSession(orphanSession);
      orphanSession = null;
      renderRoomStatus();
    }

    // Sessao nova, arvore nova: nenhum epoch, papel ou atribuicao da sala
    // anterior pode sobreviver ate aqui (teardownSession ja limpa quando
    // havia sessao; isto cobre a primeira entrada e o caminho em que a
    // conexao anterior nunca chegou a abrir).
    //
    // EXCETO com uma orfa viva (reconexao automatica): o epoch/papel dela
    // ainda descreve peers reais recebendo video agora, e onPeerState segue
    // ativo pra orfa. Zera so quando a orfa for desmontada -- no onOpen desta
    // sessao, logo antes do 'welcome' reconstruir tudo.
    if (!orphanSession) resetTreeState();

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

          // H1, descarte da orfa gatilho 1: a reconexao abriu DE VERDADE.
          // Do outro lado as conexoes P2P antigas ja estao mortas (o
          // servidor nos deu um id novo, os outros nos viram sair e entrar),
          // entao fecha os peers da orfa -- mas NAO a captura local
          // (teardownPeers, nao teardownMedia: a Task 5 preserva a captura
          // pro 'welcome' re-ofertar). resetTreeState roda AGORA, nao antes:
          // enquanto a orfa vivia, seu epoch/papel ainda descrevia peers
          // reais, e zera-lo cedo deixaria onPeerState sem como fechar
          // repasses. Aqui a orfa ja saiu e o 'welcome' ainda nao chegou.
          // Esta reconexao abriu: nao ha mais retry a disparar.
          clearTimeout(retryTimer);
          retryTimer = null;
          if (orphanSession) {
            teardownPeers(orphanSession);
            resetTreeState();
            orphanSession = null;
            renderMembersPanel();
          }

          activeRoomAddress = roomAddress;
          markCooldown(activeRoomAddress);
          updateDisconnectButtonState();
          renderRoomList();
          session.sig.send({
            type: 'join', room: 'geral', name: name || 'anônimo', avatar: cfg.avatar || null,
            pin: pin || undefined, clientId: cfg.clientId, ownerToken: hostInfo?.ownerToken || undefined,
          });
          ui.stageHeader.set({ name: `sala de ${name || 'anônimo'}`, address: roomAddress, pin: hostInfo?.pin || null });
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

          // B3: a sala recusou a entrada por PIN. Nunca chegamos a entrar --
          // sem video a preservar, sem reconexao (o PIN errado seria o mesmo
          // na proxima). Volta pro lobby com o aviso, e libera o cooldown
          // que o onOpen marcou pra que a pessoa possa tentar de novo na
          // hora com o PIN certo.
          if (session.joinDenied) {
            clearTimeout(retryTimer);
            retryTimer = null;
            currentSession = null;
            activeRoomAddress = null;
            clearCooldown(roomAddress);
            teardownSession(session);
            if (!orphanSession) ui.stageHeader.clear();
            const reason = session.joinDenied;
            // #dialog-join-room substituiu o #join-address-form inline (Task 8) --
            // reabre ja preenchido com o endereco pra pessoa nao redigitar.
            ui.dialogs.openJoinRoom({
              address: roomAddress,
              showPinField: reason === 'pin',
              onConnect: handleJoinConnect,
            });
            $('setup-error').textContent =
              reason === 'pin' ? 'PIN incorreto ou ausente. Confira o PIN da sala e tente de novo.'
              : reason === 'banned' ? 'Você foi banido desta sala.'
              : 'A sala recusou a entrada.';
            renderMembersPanel();
            renderRoomList();
            onSettled?.();
            return;
          }

          // A sala acabou (o host saiu): nao ha reconexao possivel nem video
          // a preservar de forma util -- teardown completo e de volta pro
          // lobby, em vez do modo orfao do H1 (que e pra queda da NOSSA
          // conexao numa sala que segue viva). Reconhecido tanto pela
          // mensagem 'room-closed' ja processada quanto pelo close limpo
          // 1001 'host-left', caso o socket caia antes da fila drenar.
          const roomClosed = session.roomClosed
            || (detail?.code === 1001 && detail?.reason === 'host-left');
          if (roomClosed) {
            clearTimeout(retryTimer);
            retryTimer = null;
            currentSession = null;
            activeRoomAddress = null;
            const wasHostingRoom = !!hostInfo;
            hostInfo = null;
            if (orphanSession) {
              teardownSession(orphanSession);
              orphanSession = null;
            }
            renderRoomStatus();
            if (wasHostingRoom) window.golive.stopHosting?.().catch(() => {});
            teardownSession(session);
            stopStatsLoop();
            ui.stageHeader.clear();
            renderHostWarning();
            $('setup-error').textContent = 'O host encerrou a sala.';
            renderMembersPanel();
            renderRoomList();
            onSettled?.();
            return;
          }
          // O code/reason do WebSocket diz se foi um close limpo (1000/1001,
          // ex: o proprio host fechando o app) ou uma queda anormal de
          // rede/processo (1006, sem handshake de close) -- tipico de NAT de
          // LAN virtual descartando um fluxo ocioso.
          console.error(`[signaling] conexao fechada: code=${detail?.code} reason="${detail?.reason}" wasClean=${detail?.wasClean}`);

          const abnormal = detail?.code === 1006 || detail?.wasClean === false;
          const canRetry = abnormal && (session.opened || attempts > 0) && attempts < MAX_RECONNECT;

          currentSession = null;
          activeRoomAddress = null;

          // H1: perder a sinalizacao NAO pode matar a midia. A sinalizacao so
          // e necessaria pra ESTABELECER conexao; as RTCPeerConnection P2P ja
          // abertas continuam entregando video sem ela. Antes, este onClose
          // chamava teardownPeers/teardownSession e fechava todas as conexoes
          // -- o host fechando o app derrubava o video de todo mundo com os
          // links P2P intactos. Agora a sessao vira ORFA: mesh e conexoes
          // preservados, tiles ficam na tela. `currentSession` ja foi pra
          // null acima, entao `mesh.send` e todo callback tardio viram no-op
          // -- a orfa e muda por construcao, nunca ha duas sessoes mandando
          // coisa. Vale tanto pro retry quanto pra desistencia: o retry
          // desistiu da SINALIZACAO, nao da midia.
          //
          // resetTreeState NAO roda aqui: enquanto a orfa vive, seu
          // epoch/papel ainda descreve peers reais recebendo video, e
          // onPeerState (que segue ativo pra orfa) precisa deles pra fechar
          // repasses de um peer que morra. Ele roda no descarte da orfa.
          //
          // Loop de stats: PARA. updateStats ja e guardado por
          // currentSession === session e viraria no-op de qualquer forma;
          // manter o timer vivo so queima ciclo. Levar a telemetria pra orfa
          // esta fora do escopo do H1 (manter o VIDEO no ar, nao as metricas).
          //
          // Se ESTA conexao nunca abriu (session.opened falso, ex: tentativa
          // de reconexao com o servidor ainda fora do ar), nao ha nada a
          // orfanizar -- e uma orfa ANTERIOR, se houver, fica de pe (a
          // cadeia de retry continua tentando por ela). So uma sessao que
          // chegou a abrir vira orfa.
          if (session.opened) {
            orphanSession = session;
            stopStatsLoop();
            renderRoomStatus();
          }

          if (canRetry) {
            // Queda anormal, nao saida deliberada (leaveRoom zera
            // currentSession antes de fechar, entao nunca chega aqui):
            // volta pra mesma sala sozinho, com backoff. `retryTimer` e
            // modulo-level: e o UNICO retry pendente (o proximo so e agendado
            // no onClose da tentativa seguinte), e leaveRoom / um join
            // deliberado / o onOpen de uma reconexao que abriu o cancelam.
            const next = attempts + 1;
            $('setup-error').textContent =
              `Conexão com a sala caiu. O vídeo continua enquanto durar. Reconectando… (${next}/${MAX_RECONNECT})`;
            renderMembersPanel();
            renderRoomList();
            retryTimer = setTimeout(() => {
              retryTimer = null;
              if (currentSession) return; // usuario ja entrou noutra sala/saiu
              joinRoom(rawUrl, name, publicAddress, undefined, next, pin);
            }, 1000 * 2 ** attempts);
            return;
          }

          if (abnormal && attempts >= MAX_RECONNECT) {
            $('setup-error').textContent =
              'Perdi a conexão com a sala e não consegui reconectar. O vídeo continua enquanto os outros seguirem na sala — use Desconectar pra encerrar.';
          } else if (session.opened && !abnormal) {
            // Fecho limpo (1000/1001) -- o proprio host fechando o app, que e
            // o cenario tipico do H1. Sem retry, mas a sessao virou orfa
            // acima: o video segue e o usuario precisa saber disso e que o
            // botao Desconectar e a saida.
            $('setup-error').textContent =
              'A conexão com a sala foi encerrada. O vídeo continua enquanto os outros seguirem na sala — use Desconectar pra encerrar.';
          }

          // Cabecalho da sala: limpa SO quando nao sobrou orfa nenhuma. Se
          // esta sessao virou orfa (retry ou desistencia), ou se uma orfa
          // ANTERIOR segue viva (esta tentativa fechou sem abrir mas a queda
          // de antes ainda tem video na tela), o cabecalho fica -- peers e
          // video continuam visiveis. So limpa quando esta e uma tentativa
          // que nunca abriu E nao ha orfa anterior: ai nao ha sala nenhuma.
          if (!orphanSession) ui.stageHeader.clear();
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
        // Orfa incluida (H1): os tiles vivem do P2P direto enquanto a
        // sinalizacao esta caida, e uma stream nova/substituida ainda
        // precisa pintar. mesh.send segue mudo (guardado por
        // currentSession === session), entao nenhum sinal vaza daqui.
        if (session !== currentSession && session !== orphanSession) return;
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
        //
        // Numa orfa nao ha repasse a fazer: sem sinalizacao o relayTo nunca
        // negocia. Deixa a sub-arvore como esta -- so a sessao viva repassa.
        if (!sourceId && currentSession === session) {
          flushPendingRelay(session, baseKind, peerId).catch(() => {});
        }
      },
      onPeerState: (peerId, { removedTile, kind, dir, failed }) => {
        // Orfa incluida (H1): e ESTE callback que tira da tela um peer cujo
        // connectionstatechange disse que morreu de verdade (mesh.js reporta
        // com failed:true apos a carencia de 5s de A2) -- o unico gatilho que
        // derruba peer numa sessao orfa. Sem isto, um peer que some de
        // verdade ficaria congelado na tela pra sempre.
        if (session !== currentSession && session !== orphanSession) return;
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
        //
        // `session === currentSession`: recoverFromRelayLoss faz
        // `const session = currentSession` e opera na sessao VIVA. Numa orfa
        // (currentSession ja e a sessao NOVA da reconexao), isso rodaria
        // closeOut/offerTo contra a mesh nova pra ids que ela nunca ouviu --
        // offerTo -> ensureOutConn -> addPeer fabricaria peers fantasma e
        // abriria RTCPeerConnection de verdade. So a sessao viva recupera
        // relay; a orfa nao tem sinalizacao pra reeleger nada.
        if (failed && dir === 'out' && !sourceId && session === currentSession
            && originTree[baseKind]?.assignments.get(peerId)?.role === 'relay') {
          recoverFromRelayLoss(baseKind, peerId);
        }
        // Sem sinalizacao (orfa) nunca chega um 'peer-left'. Uma falha de
        // conexao direta (base kind, passada a carencia de 5s de A2) e o
        // unico aviso possivel de que um peer se foi -- mas so conta como
        // "saiu da sala" se NENHUMA outra conexao com ele ainda estiver de
        // pe. Durante a orfa um peer pode ter a tela (out) caindo enquanto a
        // camera (in) segue entregando video; remove-lo ali fecharia a
        // conexao boa e mataria video vivo -- o oposto do que o H1 protege.
        // Com conexao sobrevivente, o `removedTile` acima ja cuida do tile
        // do kind que caiu e o peer fica. Sem o removePeer num peer que
        // sumiu de vez, o cadaver ficaria no painel de membros pra sempre.
        if (failed && !sourceId && session === orphanSession) {
          const peer = session.mesh.peers.get(peerId);
          const stillConnected = peer && [
            ...Object.values(peer.inConns),
            ...Object.values(peer.outConns),
          ].some((pc) => pc && pc.connectionState === 'connected');
          if (!stillConnected) {
            session.mesh.removePeer(peerId);
            dropTile(peerId);
            dropTile(`cam-${peerId}`);
          }
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

  // Compose do chat: manda 'chat' pela sessao ativa (server ecoa pra sala
  // inteira, inclusive pra nos -- por isso nao damos append local aqui).
  ui.chat.render({
    onSend: (text) => currentSession?.sig.send({ type: 'chat', text }),
  });

  // Recolher a coluna direita (membros + banidos + chat).
  $('btn-toggle-side').addEventListener('click', () => {
    $('room-side').classList.toggle('collapsed');
  });

  // Segundo botao de configuracoes (no rodape do lobby) -- reusa o handler do primeiro.
  $('btn-open-settings-2')?.addEventListener('click', () => $('btn-open-settings').click());

  // ---------- Desconectar ----------

  function leaveRoom() {
    // Desconectar e a intencao final do usuario: qualquer retry de
    // reconexao pendente (o "Reconectando… (n/4)") morre aqui, seja qual for
    // a sessao que o agendou. Sem isto o timer dispararia depois, passaria
    // pelo seu unico guard `if (currentSession)` (null apos o teardown) e
    // re-entraria a sala que o usuario acabou de deixar.
    clearTimeout(retryTimer);
    retryTimer = null;

    // H1, descarte da orfa gatilho 2: a sinalizacao caiu, sobrou uma sessao
    // orfa com video no ar e `currentSession` e null -- o botao Desconectar
    // ainda tem de encerrar tudo. teardownSession completo (mesh, PCs,
    // captura, arvore): agora sim e o fim de verdade.
    if (!currentSession && orphanSession) {
      const orphan = orphanSession;
      orphanSession = null;
      renderRoomStatus();
      sound.playLeaveSound();
      const wasHosting = !!hostInfo;
      hostInfo = null;
      orphan.sig?.close();
      if (wasHosting) window.golive.stopHosting?.().catch(() => {});
      ui.stageHeader.clear();
      $('setup-error').textContent = '';
      renderHostWarning();
      teardownSession(orphan);
      // Sem markCooldown: `activeRoomAddress` ja e null na orfa (o onClose
      // zerou), nao ha endereco pra marcar -- e sair de um estado quebrado
      // nao deve ficar em cooldown.
      renderRoomList();
      return;
    }
    if (!currentSession) return;
    if (cooldownRemaining(activeRoomAddress) > 0) return;
    // Reconexao ja em curso (currentSession e a sessao NOVA, ainda
    // conectando) mas a orfa da queda anterior segue viva: Desconectar
    // encerra as duas.
    if (orphanSession) {
      teardownSession(orphanSession);
      orphanSession = null;
      renderRoomStatus();
    }
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
        ownerId = msg.owner ? 'me' : (msg.peers.find((p) => p.owner)?.id ?? null);
        for (const p of msg.peers) mesh.addPeer(p.id, p.name, p.avatar);
        renderMembersPanel();
        // Historico do chat (ate 50 linhas) + lista de banidos (so pro dono).
        ui.chat.setHistory((msg.chat || []).map((entry) => (entry.system
          ? entry
          : { ...entry, avatar: mesh.peers.get(entry.from)?.avatar || (entry.from === myId ? cfg.avatar : null) })));
        if (msg.owner) {
          ui.members.renderBanned(msg.banned || [], {
            onUnban: (key) => currentSession?.sig.send({ type: 'moderate', action: 'unban', target: key }),
          });
        }
        // A3: numa reconexao automatica a captura local sobreviveu (o retry
        // do onClose nao chama mais teardownMedia), mas as conexoes P2P foram
        // refeitas do zero. Sem re-ofertar aqui, quem reconectou fica "ao
        // vivo" pra si mesmo e mudo pra sala inteira. Espelha o 'peer-joined',
        // so que pra cada peer do welcome. Numa entrada normal localStream e
        // cameraStream sao nulos e nada disto roda.
        if (localStream) {
          for (const p of msg.peers) {
            if (currentSession !== session) return; // sinalizacao morreu no meio do welcome: para de erguer pcs mortas
            try {
              await mesh.offerTo(p.id, localStream, qualityFor('screen'), 'screen');
            } catch (err) {
              // uma oferta isolada que falha (peer que ja sumiu, glare) nao
              // pode abortar as demais nem o resto do handshake do welcome
              console.error(`[reconexao] re-oferta de tela para ${p.id} falhou:`, err);
            }
            enforceSharePauseFor(mesh, p.id);
          }
          broadcastWatchers('screen');
          recomputeTree('screen');
        }
        if (cameraStream) {
          for (const p of msg.peers) {
            if (currentSession !== session) return;
            try {
              await mesh.offerTo(p.id, cameraStream, qualityFor('camera'), 'camera');
            } catch (err) {
              console.error(`[reconexao] re-oferta de camera para ${p.id} falhou:`, err);
            }
          }
          broadcastWatchers('camera');
          recomputeTree('camera');
        }
        // Reconexao automatica: startStatsLoop so e chamado por startShare. Aqui
        // a captura sobreviveu ao retry (Task 5) e os blocos acima re-ofertaram
        // -- estamos transmitindo de novo -- mas o loop de stats foi parado no
        // onClose que orfanou a sessao anterior. Sem religa-lo: myEncodeHealth
        // fica null (todo view-state passa a carregar encodeHealth null e a
        // eleicao de relay da origem degenera pra este no), peer.rtt para de ser
        // escrito (a ordenacao por RTT some), a aba Estatisticas fica vazia e
        // updateEncoderWarning nunca mais dispara. startStatsLoop chama
        // stopStatsLoop antes, entao e seguro chamar mesmo ja parado.
        if (localStream || cameraStream) startStatsLoop();
        break;
      }
      case 'peer-joined': {
        mesh.addPeer(msg.id, msg.name, msg.avatar);
        if (msg.owner) ownerId = msg.id;
        renderMembersPanel();
        sound.playJoinSound();
        // A sala cresceu: as conexoes ja abertas precisam do teto novo, e a
        // oferta abaixo ja sai com ele (qualityFor le o tamanho da sala,
        // que o addPeer acima acabou de atualizar).
        reapplyAudienceQuality();
        if (localStream) {
          try {
            await mesh.offerTo(msg.id, localStream, qualityFor('screen'), 'screen');
          } catch (err) {
            // uma oferta de tela que rejeita (peer que ja saiu, glare) nao pode
            // pular a oferta de camera, o broadcastWatchers nem o recomputeTree
            // -- mesmo racional do try/catch por-peer do welcome (Task 5).
            console.error(`[peer-joined] oferta de tela para ${msg.id} falhou:`, err);
          }
          enforceSharePauseFor(mesh, msg.id);
          broadcastWatchers('screen'); // novo espectador -- entra "assistindo" por padrao
          recomputeTree('screen');
        }
        if (cameraStream) {
          try {
            await mesh.offerTo(msg.id, cameraStream, qualityFor('camera'), 'camera');
          } catch (err) {
            console.error(`[peer-joined] oferta de camera para ${msg.id} falhou:`, err);
          }
          broadcastWatchers('camera');
          recomputeTree('camera');
        }
        // A sala cresceu com a tela ja no ar: o 'broadcast-state {live:true}'
        // so foi mandado uma vez, la no startShare. Quem acabou de entrar
        // recebeu o 'welcome' com peer.live=false pra todos -- sem reenviar
        // aqui, o "AO VIVO" nunca acende ao nosso lado pra ele. Idempotente
        // pra quem ja sabia (broadcast-state so regrava peer.live).
        if (localStream && sig.isOpen()) sig.send({ type: 'broadcast-state', live: true });
        break;
      }
      case 'peer-left': {
        mesh.removePeer(msg.id);
        for (const k of rxHealthByPeer.keys()) if (k.startsWith(msg.id + ':')) rxHealthByPeer.delete(k);
        for (const k of rxPrevSample.keys()) if (k.startsWith(msg.id + ':')) rxPrevSample.delete(k);
        for (const k of peerQuality.keys()) if (k.startsWith(msg.id + ':')) peerQuality.delete(k);
        dropTile(msg.id);
        dropTile(`cam-${msg.id}`);
        renderMembersPanel();
        sound.playLeaveSound();
        broadcastWatchers('screen'); // quem saiu pode ter sido um espectador na lista
        broadcastWatchers('camera');
        // A sala encolheu: quem ficou pode voltar pro preset de cima.
        reapplyAudienceQuality();
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
        // msg.renegotiate (A8): oferta na conexao que ja existe, nao uma
        // conexao nova. Peer em versao antiga nao manda o campo, e ai
        // handleOffer segue recriando, como sempre fez.
        const answerSdp = await mesh.handleOffer(msg.from, msg.sdp, msg.kind, msg.renegotiate === true);
        if (currentSession !== session) return; // sessao caiu enquanto negociava
        sig.send({ type: 'answer', to: msg.from, sdp: answerSdp, kind: msg.kind });
        // Comecamos a receber com a janela ja oculta: o transmissor assume
        // "assistindo" por padrao, entao precisa ser corrigido na hora --
        // do contrario ele paga um encode que ninguem esta vendo ate a
        // proxima mudanca de visibilidade.
        if (!isAppVisible()) sig.send({ type: 'view-state', to: msg.from, kind: msg.kind, watching: false, encodeHealth: myEncodeHealth, receiveHealth: rxHealthByPeer.get(`${msg.from}:${msg.kind}`) || null });
        // So uma oferta DIRETA da origem destrava um repasse pendente: a
        // stream que vamos repassar e a que acabou de chegar por ela.
        if (!parseKind(msg.kind).sourceId) await flushPendingRelay(session, msg.kind, msg.from);
        break;
      }
      case 'answer': {
        if (!isKnownKind(msg.kind)) break;
        await mesh.handleAnswer(msg.from, msg.sdp, msg.kind);
        if (currentSession !== session) return;
        // Retune por-peer (tela e camera): nao orfana o scaleResolutionDownBy.
        reapplyAudienceQuality();
        break;
      }
      case 'ice': {
        await mesh.handleIce(msg.from, msg.dir, msg.candidate, msg.kind);
        break;
      }
      // O host encerrou a sala (fechou o app ou clicou em Desconectar). O
      // servidor de sinalizacao morre com o processo dele: nao ha pra onde
      // reconectar nem como entrar mais ninguem. Diferente de uma queda da
      // NOSSA conexao (H1, que preserva o video P2P e tenta reconectar) --
      // aqui a sala acabou. Marca a sessao pra que o onClose faca teardown
      // completo e volte pro lobby, em vez de orfanizar. O onClose tambem
      // reconhece o close limpo (1001 'host-left') caso ele chegue antes
      // desta mensagem ser processada pela fila.
      case 'room-closed': {
        session.roomClosed = true;
        break;
      }
      // B3: a sala pediu PIN e o nosso nao bateu (ou nao mandamos). O
      // servidor fecha o socket logo depois (1008 'pin'); o onClose le esta
      // marca pra voltar pro lobby com o aviso certo, sem tentar reconectar
      // e sem orfanizar -- nunca chegamos a entrar.
      case 'join-denied': {
        session.joinDenied = msg.reason || 'pin';
        break;
      }
      // Chat: mensagem de texto de um peer OU linha de sistema (entrada/saida,
      // moderacao). O servidor manda pra sala inteira, inclusive quem enviou.
      case 'chat': {
        if (msg.system) {
          // Kick/ban/stop-share ja sao tratados do lado do ALVO via
          // 'moderated' (abaixo) -- esta linha de sistema e so o registro
          // visivel pra sala inteira, sem acao adicional aqui.
          ui.chat.append(msg);
          break;
        }
        // msg.from e o id de conexao carimbado pelo SERVIDOR -- compara com o
        // myId de modulo, nao com a chave local fixa 'me'.
        const isMine = msg.from === myId;
        const chatPeer = isMine ? null : mesh.peers.get(msg.from);
        ui.chat.append({ ...msg, avatar: isMine ? cfg.avatar : (chatPeer?.avatar || null) });
        // playChatSound() ja verifica sozinha o foco da janela e o teto de
        // 1x/2s (Task 7) -- aqui so falta nao tocar pra propria mensagem.
        if (!isMine) sound.playChatSound();
        break;
      }
      // Chegou uma acao de moderacao contra NOS (o dono da sala agiu).
      case 'moderated': {
        if (msg.action === 'stop-share') {
          if (localStream) stopShare(); // reusa o caminho que ja para de compartilhar
          sound.playStoppedSound();
          showToast(`${msg.by} parou sua transmissão.`);
        } else {
          sound.playRemovedSound();
          // 'kick'/'ban': o servidor fecha o socket em seguida (1008) -- o
          // onClose padrao (room-closed) cuida de voltar pro lobby.
          showToast(msg.action === 'ban' ? `${msg.by} baniu você da sala.` : `${msg.by} expulsou você da sala.`);
        }
        break;
      }
      // Lista de banidos atualizada (so o dono recebe).
      case 'banned-list': {
        ui.members.renderBanned(msg.list, {
          onUnban: (key) => currentSession?.sig.send({ type: 'moderate', action: 'unban', target: key }),
        });
        break;
      }
      case 'broadcast-state': {
        const peer = mesh.peers.get(msg.id);
        const wasLive = peer?.live;
        if (peer) peer.live = msg.live;
        if (!msg.live) ui.grid.removeTile(msg.id, emptyMessage());
        else if (peer && !wasLive) sound.playLiveSound();
        renderMembersPanel();
        break;
      }
      // Um espectador avisando que parou (ou voltou) de assistir. Suspender
      // o encode dele libera um encoder inteiro no PC de quem transmite.
      // Ver a spec de 2026-08-23, F1.3.
      case 'view-state': {
        if (!isKnownKind(msg.kind)) break;
        // H2: guarda a saude de encode que o peer anexou (ausente ==> null,
        // o caso neutro de tree.js). E por-peer, nao por-kind: e a maquina
        // dele que codifica. recomputeTree le isto ao montar os candidatos.
        const vsPeer = mesh.peers.get(msg.from);
        if (vsPeer) vsPeer.encodeHealth = normalizeEncodeHealth(msg.encodeHealth);
        // Slot por baseKind: um viewer que recebe tela E camera nao pode
        // deixar a saude de um kind sobrescrever a do outro (last-write-wins).
        if (vsPeer) {
          const rh = normalizeReceiveHealth(msg.receiveHealth);
          (vsPeer.receiveHealth ||= {})[parseKind(msg.kind).baseKind] =
            rh ? { ...rh, atMs: Date.now() } : null;
        }
        const track = trackForKind(msg.kind);
        // Pausa manual manda mais que a demanda do espectador: enquanto
        // pausado, 'watching: true' nao pode religar o encode da tela.
        // So a NOSSA tela (kind 'screen' exato) -- nao os kinds compostos
        // 'screen@<origem>' que retransmitimos pra outro: pausar a propria
        // transmissao nao pode congelar o que a gente so repassa.
        const wanted = Boolean(msg.watching) && !(sharePaused && msg.kind === 'screen');
        if (mesh.setPeerDemand(msg.from, msg.kind, wanted, track)) {
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

        // Virar (ou deixar de ser) relay muda se ha algo nosso codificando
        // -- o loop de estatisticas e quem mede isso.
        syncStatsLoop();

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

    refresh().catch((err) => console.error('[audio-incluir] varredura inicial falhou:', err));
    const pollTimer = setInterval(
      () => refresh().catch((err) => console.error('[audio-incluir] varredura falhou:', err)),
      INCLUDE_LIST_POLL_MS
    );

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
      lastCaptureKey = `${cfg.quality.width}x${cfg.quality.height}@${cfg.quality.fps}`;
      stopNativeAudioFns = startedNativeStops;
      const track = localStream.getVideoTracks()[0];
      if (track) {
        track.contentHint = 'motion';
        track.applyConstraints({ frameRate: { ideal: cfg.quality.fps, max: cfg.quality.fps } }).catch(() => {});
        track.addEventListener('ended', stopShare);
        // Diagnostico: uma track de captura que entra em 'mute' para de
        // entregar quadros (fonte sumiu, GPU perdeu o contexto, WGC
        // engasgou) -- o encoder fica em 0 fps sem erro nenhum.
        const s = track.getSettings();
        console.log(`[diag] captura de tela: ${s.width || '?'}x${s.height || '?'}@${s.frameRate ? Math.round(s.frameRate) : '?'} surface=${s.displaySurface || '?'}`);
        track.addEventListener('mute', () => console.warn('[diag] captura de tela: MUTE -- parou de entregar quadros'));
        track.addEventListener('unmute', () => console.log('[diag] captura de tela: UNMUTE -- voltou a entregar quadros'));
      }
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) audioTrack.contentHint = 'music';

      ui.grid.showTile('me', 'Você (prévia)', localStream, { muted: true, avatar: cfg.avatar || null, kind: 'screen', displayName: cfg.name || 'anônimo' });

      // qualityFor, nao cfg.quality: este e o cenario principal do H4 --
      // voce entra numa sala que ja tem 4 pessoas e clica "Compartilhar
      // tela". Corrigir depois com applyEncoding nao basta, porque offerTo
      // grava o x-google-start-bitrate no SDP (ver withStartBitrate em
      // mesh.js) e setParameters nao reescreve SDP: o alvo de ramp-up
      // ficaria nos 12 Mbps nao degradados pelo resto da conexao.
      const quality = qualityFor('screen');
      for (const peerId of session.mesh.peers.keys()) {
        await session.mesh.offerTo(peerId, localStream, quality, 'screen');
      }
      if (currentSession !== session) return;
      broadcastWatchers('screen'); // lista inicial: todo mundo conta como assistindo
      recomputeTree('screen');

      session.sig.send({ type: 'broadcast-state', live: true });
      $('btn-toggle-share').classList.add('active');
      $('btn-pause-share').classList.remove('hidden');
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
    // Alcancavel durante uma orfa: o check de localStream la em cima vem antes
    // do de !currentSession, e o listener 'ended' da track dispara sem checar
    // sessao. Nesse caso currentSession e null e o closeAllOut acima e no-op,
    // deixando as out-conns da orfa abertas com senders mortos -- fecha as dela
    // tambem.
    orphanSession?.mesh?.closeAllOut('screen');
    forgetOriginTree('screen');
    ui.grid.removeTile('me', emptyMessage());
    if (currentSession?.sig?.isOpen()) currentSession.sig.send({ type: 'broadcast-state', live: false });
    $('btn-toggle-share').classList.remove('active');
    renderMembersPanel();
    // syncStatsLoop, nao stopStatsLoop: parar de compartilhar nao quer dizer
    // parar de codificar -- este no pode seguir sendo relay de outra pessoa.
    syncStatsLoop();
    resetShareState();
  }

  /** Estado da transmissao que tem de zerar em QUALQUER fim de captura --
   * saida deliberada (teardownMedia) ou parar de compartilhar (stopShare).
   * Ficava so no stopShare e vazava pela outra porta. */
  function resetShareState() {
    autoQuality = autoquality.initialState();
    lastCaptureKey = '';
    sharePaused = false;
    $('btn-pause-share').classList.remove('active');
    $('btn-pause-share').classList.add('hidden');
    rxHealthByPeer.clear();
    rxPrevSample.clear();
    rxPrevAtMs = 0;
    peerQuality.clear();
  }

  /** Pausa manual so suspende os senders que existiam no instante do clique.
   * Quem entra depois (peer-joined) ou reconecta (welcome) recebe uma oferta
   * nova com a track viva -- sem reimpor aqui, a tela "pausada" volta a
   * sair, e no reconnect pra sala inteira de uma vez. */
  function enforceSharePauseFor(m, peerId) {
    if (!sharePaused || !localStream) return;
    m.setPeerDemand(peerId, 'screen', false, localStream.getVideoTracks()[0] || null);
  }

  function setSharePaused(paused) {
    if (!localStream || sharePaused === paused) return;
    sharePaused = paused;
    const track = localStream.getVideoTracks()[0] || null;
    const session = currentSession || orphanSession;
    for (const peerId of session?.mesh.peers.keys() ?? []) {
      // `!paused` como demanda: religar entrega a track de volta pros
      // MESMOS senders que foram suspensos (ver setPeerDemand).
      session.mesh.setPeerDemand(peerId, 'screen', !paused, track);
    }
    $('btn-pause-share').classList.toggle('active', paused);
    showToast(paused ? 'Transmissão pausada — ninguém está vendo sua tela.' : 'Transmissão retomada.');
    renderMembersPanel();
    renderRoomStatus();
  }

  $('btn-pause-share').addEventListener('click', () => setSharePaused(!sharePaused));
  window.golive.onShortcut?.(() => setSharePaused(!sharePaused));

  // ---------- Câmera ----------

  $('btn-toggle-camera').addEventListener('click', () => {
    if (cameraStream) return stopCamera();
    if (cameraStarting) return; // ja tem um startCamera() em andamento, ignora o duplo clique
    startCamera().catch((err) => console.error('[camera] startCamera falhou:', err));
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
        // Hoje isto e identico a `{ ...cfg.camera, codec: 'video/VP8' }`,
        // mas nada bruto de `cfg` deve chegar na mesh: qualityFor e a unica
        // porta. Foi passando por fora dela que o startShare acima ficou
        // sem degradacao.
        const quality = qualityFor('camera');
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
      // H2: carona no canal que ja existe -- a origem daquele kind usa isto
      // pra eleger relay por saude de encode, nao so por RTT. null quando
      // nao estamos codificando nada.
      session.sig.send({ type: 'view-state', to: peerId, kind, watching, encodeHealth: myEncodeHealth, receiveHealth: rxHealthByPeer.get(`${peerId}:${kind}`) || null });
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
    // Kind COMPOSTO no qualityForPeer, nao o cru: e o sourceId dele que faz
    // qualityForPeer aplicar o teto de uplink do relay (config.qualityForRelay).
    // Com o kind cru, parseKind devolve sourceId null, o teto nao entra, e o
    // encoder do filho novo ja nasce no preset cheio da origem -- exatamente
    // a rajada de sobre-assinatura que o orcamento existe pra evitar. A chave
    // da escada por-peer nao muda: ela usa baseKind.
    const childKind = relayKindFor(kind, sourcePeerId);
    for (const childId of state.filhosIds) {
      if (state.relayed.has(childId)) continue;
      const ok = await session.mesh.relayTo(childId, sourcePeerId, kind, qualityForPeer(childId, childKind));
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

  // Janela de histerese da re-eleicao (Parte B). Precisa ser MAIOR que a
  // carencia de 'disconnected' do mesh (DISCONNECT_GRACE_MS = 5000, mesh.js):
  // dentro dessa carencia um soluco de ICE ainda pode se resolver sozinho
  // sem virar falha, entao re-eleger antes disso troca de relay por causa de
  // uma queda que ia passar -- e cada troca custa uma renegociacao nas
  // folhas. 8s da folga sobre os 5s sem deixar a topologia velha no ar tempo
  // demais. So freia o recalculo COMUM; `force` (recoverFromRelayLoss)
  // passa reto -- ver abaixo.
  const REELECTION_HYSTERESIS_MS = 8000;

  // `force` pula a comparacao com a topologia anterior: usado na
  // recuperacao de falha, onde a conexao morta precisa ser re-ofertada
  // mesmo que o resultado do calculo tenha dado igual.
  function recomputeTree(kind, { force = false } = {}) {
    const session = currentSession;
    if (!session?.mesh) return;
    const stream = kind === 'camera' ? cameraStream : localStream;
    if (!stream) return;

    // Histerese: um recalculo comum dentro da janela da ultima re-eleicao
    // nao roda agora -- agenda UM recalculo pro fim da janela (adiar, nao
    // descartar: descartar perderia a ultima mudanca de topologia, que e a
    // que vale). O guard do handle impede empilhar um segundo timer. `force`
    // nunca cai aqui: e o caminho que reconecta orfas, atrasa-lo deixa gente
    // sem video.
    if (!force) {
      const since = Date.now() - reelectionAt[kind];
      if (since < REELECTION_HYSTERESIS_MS) {
        if (!deferredRecompute[kind]) {
          deferredRecompute[kind] = setTimeout(() => {
            deferredRecompute[kind] = null;
            recomputeTree(kind);
          }, REELECTION_HYSTERESIS_MS - since);
        }
        return;
      }
    }
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
        // H2: ultimo resumo de encode que o peer subiu no 'view-state'.
        // Ausente ate ele reportar -- tree.js trata undefined/null como
        // neutro (nem veto, nem favorecimento).
        encodeHealth: peer.encodeHealth ?? null,
      });
    }
    if (!candidates.length) return;

    const assignments = cfg.network.tree
      ? tree.computeTree(myId, candidates)
      : tree.allDirect(myId, candidates);

    // H3: a malha degenerada e o modo de FALHA, nao um estado neutro. So
    // conta como fallback quando QUERIAMOS arvore (cfg.network.tree) e mesmo
    // assim todo mundo saiu 'direct' -- malha por escolha (interruptor
    // desligado) nao degrada nada. Roda ANTES do short-circuit de
    // sameAssignments: o estado precisa seguir o ultimo calculo mesmo quando
    // a topologia em si nao mudou. setMeshFallback so age na transicao.
    //
    // Guarda de espectadores: all-direct so e o modo de FALHA quando uma
    // arvore PODERIA ter ajudado, e ela so ajuda com 2+ espectadores reais --
    // a origem pagaria N encoders em vez de 1. Com 0 ou 1 espectador (ex: um
    // compartilhamento 1-a-1) nenhum relay pouparia encoder nenhum: ali
    // all-direct e o estado normal, nao degradacao, e baixar o preset +
    // mostrar toast seria mentira. `transmitting` marca quem ja e origem
    // (nao codificariamos pra ele); o resto e espectador daquele kind.
    const espectadores = candidates.filter((c) => !c.transmitting).length;
    setMeshFallback(kind, cfg.network.tree && espectadores >= 2 && tree.isAllDirect(assignments));

    // Topologia identica a que ja esta no ar: nao mexe em nada. Antes o
    // epoch subia de qualquer jeito e o 'tree' resultante mandava cada
    // relay repassar de novo pros MESMOS filhos -- um transceiver (um
    // encoder) a mais por evento de sala, e uma renegociacao (tela preta)
    // em cada folha a cada entra-e-sai que nao tinha nada a ver com ela.
    if (!force && tree.sameAssignments(assignments, originTree[kind].assignments)) return;

    // Aplicamos uma topologia nova: e ISTO uma re-eleicao. Marca o instante
    // pra que os recalculos comuns dos proximos REELECTION_HYSTERESIS_MS
    // sejam adiados em vez de trocarem o relay de novo. `force` tambem marca:
    // recoverFromRelayLoss ja elegeu, nao faz sentido reeleger logo atras.
    reelectionAt[kind] = Date.now();
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
      .then(() => recomputeTree(kind, { force: true }))
      .catch((err) => console.error('[arvore] reconexao das orfas do relay falhou:', err));
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

  // isSoftwareEncoder e summarizeScreenEncodeHealth vivem em encodehealth.js
  // (com testes). O resumo e SO da tela: a camera e sempre VP8/libvpx e
  // contaminava a escada global e a eleicao de relay -- ver o comentario la.

  // 'view-state' de cliente antigo nao traz encodeHealth: ausencia (ou lixo)
  // vira null -- o caso NEUTRO de tree.js -- nunca zero nem "saudavel".
  function normalizeEncodeHealth(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const ms = typeof raw.msPerFrame === 'number' && Number.isFinite(raw.msPerFrame) && raw.msPerFrame >= 0
      ? raw.msPerFrame
      : null;
    return { softwareEncoder: raw.softwareEncoder === true, msPerFrame: ms };
  }

  // 'view-state' de cliente antigo nao traz receiveHealth: ausencia (ou
  // lixo) vira null -- o caso neutro da escada por-peer, nunca "saudavel".
  function normalizeReceiveHealth(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    return {
      lossPct: num(raw.lossPct),
      freezeRate: num(raw.freezeRate),
      softwareDecoder: raw.softwareDecoder === true,
    };
  }

  // Joga uma linha compacta por sender de TELA no log em arquivo (via
  // console -> main.js console-message). So quando algo categorico muda
  // (encoder, eficiencia, limitacao, degraus) ou a cada ~15s -- ver
  // encodediag.js. E o artefato que a gente pede pra quem esta com
  // "fps baixo / encoder em software" e nao da pra reproduzir aqui.
  function logEncodeDiag(rows, nowMs) {
    for (const r of rows) {
      if (parseKind(r.kind).baseKind !== 'screen') continue;
      const ctx = {
        software: isSoftwareEncoder(r.encoder),
        targetBitrate: qualityFor(r.kind).bitrate,
        steps: {
          global: autoQuality.steps,
          peer: peerQuality.get(`${r.peerId}:screen`)?.steps || 0,
        },
      };
      const key = `${r.peerId}:${r.kind}`;
      const sig = encodediag.signature(r, ctx);
      const prev = diagPrev.get(key);
      if (!encodediag.shouldLog(prev, sig, nowMs)) continue;
      ctx.changed = Boolean(prev) && prev.sig !== sig;
      diagPrev.set(key, { sig, atMs: nowMs });
      (ctx.software ? console.warn : console.log)(encodediag.line(r, ctx));
    }
  }

  // Com a janela oculta o painel de estatisticas nao esta na tela de
  // ninguem, mas getStats() + reescrita do innerHTML continuavam rodando a
  // cada segundo -- durante o jogo. Ver a spec de 2026-08-23, F1.4-c.
  const STATS_POLL_VISIBLE_MS = 1000;
  const STATS_POLL_HIDDEN_MS = 5000;

  function startStatsLoop() {
    stopStatsLoop();
    statsPrev.clear();
    diagPrev.clear();
    rxPrevAtMs = 0;
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
    myEncodeHealth = null; // paramos de medir: nao ha saude a reportar
    // Mesmo motivo: uma estimativa de uplink de uma sessao anterior limitaria
    // (ou afrouxaria) o teto de repasse da proxima sem ter medido nada dela.
    myAvailableBps = null;
    if (encoderWarning) {
      encoderWarning = '';
      renderHostWarning();
    }
    ui.settings.setStatsHtml('');
  }

  /** Liga o loop de estatisticas se ele ja nao estiver rodando, e desliga
   * quando nao ha mais nada nosso sendo codificado (nem transmissao propria,
   * nem repasse de relay).
   *
   * Ate aqui o loop so subia com localStream/cameraStream -- quem era SO
   * relay nunca media nada: nao reportava saude de encode (a eleicao do H2
   * recebia null), nao rodava a escada por-filho (Task 5.5), nao mandava
   * cadencia de view-state. startStatsLoop chama stopStatsLoop antes (zera
   * statsPrev), entao a guarda por statsTimer evita apagar a amostra
   * anterior a cada 'tree' recebida. */
  function syncStatsLoop() {
    const precisa = Boolean(localStream) || Boolean(cameraStream) || isRelaying();
    if (precisa && !statsTimer) startStatsLoop();
    else if (!precisa && statsTimer) stopStatsLoop();
  }

  // Le um relatorio de getStats de UM sender e devolve os campos que
  // interessam pro diagnostico de encode. encoderImplementation e
  // INFORMATIVO (aparece no painel e no log [diag]); o gatilho da escada e
  // totalEncodeTime/framesEncoded -> msPerFrame. O Chromium cai pro encoder
  // de software sem erro nenhum quando o NVENC afoga -- e nesse caso o
  // msPerFrame estoura o orcamento, que e o que a escada le. Ver o log de
  // 2026-08-29: OpenH264 a 1,7 ms numa RTX 3060 sem aceleracao de GPU nao
  // e sofrimento, e degradar por causa dele so prendia a transmissao em
  // 720p sem volta.
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
      // "sem amostra" != "0 bits disponiveis" -- e o numero que separa
      // gargalo de banda de gargalo de encode.
      availableBps: null,
      // Perda REAL da rede (remote-inbound-rtp), distinta dos quadros
      // descartados no encode que a tabela ja mostra.
      packetsLostNet: null,
      fractionLost: null,
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
      if (stat.type === 'candidate-pair' && stat.nominated && stat.availableOutgoingBitrate != null) {
        sample.availableBps = Math.max(sample.availableBps ?? 0, stat.availableOutgoingBitrate);
      }
      // remote-inbound-rtp e o eco RTCP do outro lado -- pode faltar num
      // intervalo isolado sem significar "sem perda".
      if (stat.type === 'remote-inbound-rtp' && stat.kind === 'video') {
        if (stat.packetsLost != null) sample.packetsLostNet = stat.packetsLost;
        if (stat.fractionLost != null) sample.fractionLost = stat.fractionLost;
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

    // Repasses. As conexoes de relay usam kind COMPOSTO ('screen@<origem>'),
    // que o laco acima -- fixo em ['screen','camera'] -- nunca consultava.
    // Sem isto o painel de um relay puro fica vazio, myEncodeHealth sobe
    // null pra origem, e o senderBandwidthLimited do filho de relay nunca
    // dispara.
    for (const kind of KINDS) {
      for (const [sourceId, state] of myRole[kind]) {
        if (state.role !== 'relay') continue;
        const childKind = relayKindFor(kind, sourceId);
        for (const childId of state.filhosIds) {
          if (currentSession !== session) return;
          const report = await activeMesh.statsFor(childId, childKind);
          if (!report) continue;
          const sample = readSenderReport(report);
          if (!sample.framesEncoded && !sample.bytesSent) continue;
          const rates = deriveRates(`${childId}:${childKind}`, sample, now);
          const childName = activeMesh.peers.get(childId)?.name || `#${childId}`;
          rows.push({ peerId: childId, kind: childKind, name: childName, ...sample, ...rates });
        }
      }
    }

    if (currentSession !== session) return; // sessao caiu enquanto aguardavamos as stats

    // H2: guarda o resumo pra proxima subida de 'view-state'. Fora do laco
    // acima porque some todos os senders num numero so.
    myEncodeHealth = summarizeScreenEncodeHealth(rows);

    // Menor availableBps entre os senders: todos dividem o mesmo uplink,
    // entao a estimativa mais apertada e a que descreve o que sobra.
    //
    // Este caminho e OPORTUNISTA de proposito: ninguem chama
    // reapplyAudienceQuality quando este numero muda, entao a metade "banda
    // medida" do config.qualityForRelay so entra em vigor no proximo evento
    // que ja provoca um reapply (escada mexeu, arvore mudou, novo filho).
    // Quem de fato garante o orcamento e a regra DETERMINISTICA do
    // qualityForRelay (bitrate do preset / nº de filhos), que nao depende de
    // medida nenhuma; myAvailableBps so aperta mais o teto quando ha reapply.
    // Reagir a cada variacao exigiria histerese propria (senao vira troca de
    // preset a cada segundo) -- decisao de design, fora deste conserto.
    const bws = rows.filter((r) => r.availableBps != null).map((r) => r.availableBps);
    myAvailableBps = bws.length ? Math.min(...bws) : null;

    if (localStream && !sharePaused) {
      // Pausado nao codifica nada: myEncodeHealth e null e cada tick contaria
      // como folga observada, "recuperando" um degrau de graca. Pular o tick
      // enquanto pausado preserva o estado da escada.
      //
      // M3: a escada GLOBAL reage so a NOSSA saude de encode. Antes ela
      // fundia a saude dos relays -- mas isso derrubava os espectadores
      // DIRETOS da origem quando era o relay que sofria. A saude ruim de um
      // relay chega pela escada POR-PEER abaixo e degrada so a conexao
      // origem->relay: como receiveHealth do view-state dele e, desde a
      // Task 9, tambem como peerEncodeSaturated (encodeHealth reportado no
      // view-state), que cobre o relay que afoga o encoder mas decodifica em
      // hardware -- caso que antes so a eleicao de relay (tree.js) via.
      const before = autoQuality.steps;
      autoQuality = autoquality.next(autoQuality, {
        atMs: now,
        health: autoquality.worstHealth([myEncodeHealth]),
      });
      if (autoQuality.steps !== before) {
        console.log(`[qualidade] escada global: ${before} -> ${autoQuality.steps} degraus`);
        reapplyAudienceQuality();
      }
    }

    // Escada POR CONEXAO -- vale pra quem origina E pra relay puro. Um relay
    // sem tela propria ainda paga encode por filho, entao ainda precisa da
    // escada por filho movida pela receiveHealth deles. isRelaying() cobre
    // TODOS os kinds: quem so repassa camera tambem entra e nao acha alvo de
    // tela nenhum -- o bloco inteiro roda em vazio, sem custo.
    if (localStream || isRelaying()) {
      // Sinais: banda (das nossas proprias stats de envio) e a receiveHealth
      // que o peer reportou.
      const limByPeer = new Map();
      for (const r of rows) limByPeer.set(`${r.peerId}:${r.kind}`, r.limitation);

      let anyPeerChanged = false;
      const targets = new Set();
      // Diretos: so quando originamos (um relay puro nao manda 'screen' cru
      // pra ninguem). Filhos de relay: sempre.
      // So peers com uma out-conn de tela DIRETA nossa: quem servimos via
      // relay nao tem escada nossa (applyEncodingToPeer seria no-op) e nao
      // pode ganhar a tag de "preset menor" no painel.
      if (localStream) for (const [peerId, peer] of activeMesh.peers) {
        if (peer.outConns?.screen) targets.add(`${peerId}:screen`);
      }
      // Filhos que servimos como RELAY. A chave do alvo e igual a do direto
      // ('peerId:screen'), entao guardamos o conjunto pra distinguir os dois
      // adiante -- pausar a NOSSA tela nao para o repasse.
      const relayChildIds = new Set();
      for (const [, state] of myRole.screen) {
        if (state.role !== 'relay') continue;
        for (const childId of state.filhosIds) {
          targets.add(`${childId}:screen`);
          relayChildIds.add(String(childId));
        }
      }

      for (const key of targets) {
        const [peerId] = key.split(':');
        const peer = activeMesh.peers.get(peerId);
        const isRelayChild = relayChildIds.has(peerId);
        // Sem nenhuma linha de sender de TELA pra este peer nao ha encode
        // acontecendo, entao nao ha "folga observada" -- pular o tick
        // preserva o estado (nem sobe nem desce). So linhas de baseKind
        // 'screen' (direta ou 'screen@origem') contam: uma linha de camera
        // nao diz nada sobre a tela que esta escada regula.
        //
        // sharePaused so silencia o alvo DIRETO: pausar a propria tela nao
        // interrompe o repasse (ver a carve-out no 'view-state'), entao o
        // filho de relay segue recebendo encode nosso e tem de continuar
        // adaptando.
        const hasSenderRow = rows.some((r) => r.peerId === peerId && parseKind(r.kind).baseKind === 'screen');
        if ((sharePaused && !isRelayChild) || !hasSenderRow) continue;
        const st = peerQuality.get(key) || peerquality.initialState();
        const nextSt = peerquality.next(st, {
          atMs: now,
          // O laco de repasses acima ja empurra linhas com kind composto
          // ('screen@<origem>') pro `rows`, entao `limByPeer` tem tanto
          // 'peerId:screen' (envio direto) quanto 'peerId:screen@x' (filho
          // de relay). Olhamos os dois pra que o filho de relay tambem
          // receba o sinal de banda, nao so a receiveHealth.
          senderBandwidthLimited: limByPeer.get(`${peerId}:screen`) === 'bandwidth'
            || [...limByPeer].some(([k, v]) => k.startsWith(`${peerId}:screen@`) && v === 'bandwidth'),
          // receiveHealth agora e por baseKind; a chave do tick e sempre
          // 'peerId:screen' (o composto 'screen@x' de filho de relay tambem
          // tem baseKind 'screen'), entao le o sub-slot 'screen'.
          receiveHealth: freshReceiveHealth(peer, 'screen'),
          // Encoder do relay afogado: a saude de encode que ELE reportou no
          // 'view-state', na mesma escala do autoquality. null (nao
          // reportou) nao e ruim.
          //
          // Vale SO pra quem e relay na NOSSA arvore. peer.encodeHealth e
          // por-MAQUINA, nao por-conexao: um espectador comum com a webcam
          // ligada ja reporta softwareEncoder (camera VP8 -> libvpx, que o
          // resumo classifica como software), entao autoquality.isBad daria
          // true pra sempre e a escada de tela dele desceria ate o piso sem
          // nunca voltar. Encode saturado so e problema NOSSO quando aquele
          // peer re-codifica o que mandamos pra ele.
          peerEncodeSaturated: originTree.screen.assignments.get(peerId)?.role === 'relay'
            && autoquality.isBad(peer?.encodeHealth, autoquality.LIMITS.BUDGET_MS_60),
        });
        if (nextSt.steps !== st.steps) {
          anyPeerChanged = true;
          console.log(`[qualidade] escada de ${peer?.name || peerId}: ${st.steps} -> ${nextSt.steps} degraus`);
        }
        peerQuality.set(key, nextSt);
      }
      if (anyPeerChanged) reapplyAudienceQuality();
    }

    // Do outro lado do fio: o que estamos RECEBENDO. receivingFrom ja
    // enumera os pares (peerId, kind) das conexoes de entrada.
    const rxRows = [];
    for (const { peerId, kind } of activeMesh.receivingFrom()) {
      if (currentSession !== session) return;
      const report = await activeMesh.inStatsFor(peerId, kind);
      if (!report) continue;
      const sample = rxstats.readReceiverReport(report);
      if (!sample.framesDecoded) continue;
      const rxKey = `${peerId}:${kind}`;
      const dt = rxPrevAtMs ? now - rxPrevAtMs : 0;
      const health = rxstats.receiveHealth(sample, rxPrevSample.get(rxKey), dt);
      rxPrevSample.set(rxKey, sample);
      // Sem medida nesta janela (framesDelta <= 0: o stream congelou de vez)
      // o valor VELHO tem de sair. Guardado, broadcastViewState o reenviaria
      // a cada tick com carimbo novo -- e o freshReceiveHealth do outro lado,
      // que so expira quando o view-state PARA de chegar, nunca veria nada
      // vencer: a origem "recuperaria" um peer travado achando que ele vai
      // bem. Ausencia e a informacao correta aqui.
      if (health) rxHealthByPeer.set(rxKey, health);
      else rxHealthByPeer.delete(rxKey);
      rxRows.push({
        peerId,
        kind,
        name: activeMesh.peers.get(peerId)?.name || `#${peerId}`,
        ...sample,
        loss: rxstats.lossPercent(sample),
        bufferMs: rxstats.jitterBufferMs(sample),
      });
    }

    rxPrevAtMs = now;
    logEncodeDiag(rows, now);
    renderStats(rows, rxRows);
    // Cadencia que fecha a escada por-peer: sem isto o 'view-state' so sai
    // em mudanca de visibilidade e a receiveHealth computada a cada segundo
    // nunca sai da maquina. updateStats ja roda 1s visivel / 5s oculto --
    // a mesma janela de amostragem. Auto-guarda em !session.mesh.
    broadcastViewState();
    updateEncoderWarning(rows);
    renderRoomStatus();
  }

  // O orcamento de encode a 60 fps e 16,6 ms POR QUADRO, somando todos os
  // senders -- eles disputam o mesmo encoder. Por isso o resumo soma
  // ms/frame em vez de tirar media.
  function renderStats(rows, rxRows = []) {
    const esc = ui.escapeHtml;

    // A tabela "Recebendo" existe mesmo sem nenhum sender nosso: um espectador
    // puro tem rows vazio e e justamente quem precisa deste painel.
    const rxHtml = !rxRows.length ? '' : `
      <h4 class="stats-subtitle">Recebendo</h4>
      <table class="stats-table">
        <tr><th>de</th><th>fps</th><th>resolução</th><th>perda</th><th>travadas</th><th>buffer</th></tr>
        ${rxRows.map((r) => `
          <tr>
            <td>${esc(r.name)}</td>
            <td>${r.fps}</td>
            <td>${r.width}x${r.height}</td>
            <td class="${r.loss != null && r.loss > 1 ? 'warn-text' : ''}">${r.loss != null ? `${r.loss.toFixed(2)}%` : '-'}</td>
            <td class="${r.freezeCount > 0 ? 'warn-text' : ''}">${r.freezeCount}</td>
            <td>${r.bufferMs != null ? `${r.bufferMs.toFixed(0)} ms` : '-'}</td>
          </tr>`).join('')}
      </table>`;

    if (!rows.length) {
      ui.settings.setStatsHtml(
        rxHtml || '<div class="stat"><span>enviando pra</span><b>0 peer(s)</b></div>'
      );
      return;
    }

    const totalMbps = rows.reduce((sum, r) => sum + r.mbps, 0);
    const encodeMsRows = rows.filter((r) => r.msPerFrame != null);
    const totalEncodeMs = encodeMsRows.reduce((sum, r) => sum + r.msPerFrame, 0);
    const anySoftware = rows.some((r) => isSoftwareEncoder(r.encoder));
    const budget = rows[0].fps >= 50 ? 16.6 : 33.3;
    const first = rows[0];

    const bwRows = rows.filter((r) => r.availableBps != null);
    const minAvailableBps = bwRows.length ? Math.min(...bwRows.map((r) => r.availableBps)) : null;
    const targetBitrate = qualityFor(rows[0].kind).bitrate;

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
      }">${encodeMsRows.length ? `${totalEncodeMs.toFixed(1)} / ${budget} ms` : '-'}</b></div>
      <div class="stat"><span>banda disponível</span><b class="${
        minAvailableBps != null && minAvailableBps < targetBitrate ? 'warn-text' : ''
      }">${minAvailableBps != null ? `${(minAvailableBps / 1_000_000).toFixed(1)} Mbps` : '-'}</b></div>`;

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
          <td class="${r.fractionLost != null && r.fractionLost > 0.01 ? 'warn-text' : ''}">${
            r.fractionLost != null ? `${(r.fractionLost * 100).toFixed(2)}%` : '-'
          }</td>
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
        <thead><tr><th>peer</th><th>fps</th><th>encode</th><th>encoder</th><th>Mbps</th><th>rtt</th><th>perda rede</th><th>perdidos</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      ${limitWarn}
      ${rxHtml}`);
  }

  // O aviso so aparece com mais de um sender de TELA ativo: com um sender so,
  // encoder de software e desconfortavel mas nao e o problema que a spec
  // persegue -- e a queda silenciosa por estouro do limite de sessoes do
  // NVENC. Linhas de camera ficam de fora: a camera e sempre VP8/libvpx,
  // entao conta-la faria o aviso aparecer pra qualquer um com a webcam
  // ligada e um espectador so.
  function updateEncoderWarning(rows) {
    const screen = rows.filter((r) => parseKind(r.kind).baseKind === 'screen');
    const software = screen.filter((r) => isSoftwareEncoder(r.encoder));
    const next =
      software.length && screen.length > 1
        ? 'Encoder em software — o vídeo está sendo codificado pela CPU. Reduza a qualidade ou o número de espectadores.'
        : '';
    if (next === encoderWarning) return;
    encoderWarning = next;
    renderHostWarning();
  }
})();
