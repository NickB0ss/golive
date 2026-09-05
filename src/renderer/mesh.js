'use strict';

(function (root) {
  // Sem STUN o ICE so junta candidatos host, entao a unica rota possivel
  // entre dois peers fora da mesma LAN e o adaptador virtual da VPN -- todo
  // o video passa dentro do tunel, que costuma ser o gargalo (jitter e perda
  // derrubam o bitrate bem abaixo do teto configurado). Com STUN o ICE
  // tambem coleta o candidato srflx e tenta conexao direta pela internet; o
  // candidato host da VPN continua na lista e assume se o NAT nao deixar.
  const STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

  const RTC_CONFIG = { iceServers: [{ urls: STUN_URLS }], iceTransportPolicy: 'all' };

  // 'disconnected' e o estado TRANSITORIO do ICE -- perdeu conectividade e
  // esta tentando reconectar sozinho, o que acontece o tempo todo num
  // tunel de VPN (Radmin) com jitter, e na maioria das vezes se resolve em
  // poucos segundos sem intervencao nenhuma. Tratar 'disconnected' como
  // falha na hora (o comportamento antigo) faz um soluco de rede disparar
  // a maquina inteira de recuperacao -- fechar repasses, vetar o relay,
  // recalcular a arvore -- por algo que ia se curar sozinho. Ver a
  // auditoria de 2026-08-27, item A2.
  const DISCONNECT_GRACE_MS = 5000;

  // Estados de sinalizacao em que uma pc de ENTRADA ainda pode receber uma
  // oferta remota: 'stable' (a negociacao anterior fechou) e
  // 'have-remote-offer' (reenvio da mesma oferta, antes de respondermos).
  // Em qualquer outro estado -- 'have-local-offer', 'closed' -- reusar
  // daria InvalidStateError, e recomecar do zero e o caminho seguro.
  const RENEGOTIABLE_STATES = new Set(['stable', 'have-remote-offer']);

  // Teto de candidatos guardados por conexao enquanto ela nao tem
  // remoteDescription. Numa negociacao sa o buffer vive alguns
  // milissegundos e junta poucos candidatos host; o limite existe so pra que
  // um peer defeituoso (ou malicioso) despejando 'ice' sem nunca mandar a
  // SDP nao faca a memoria crescer sem teto. Ao estourar, o mais ANTIGO cai:
  // os candidatos mais recentes sao os que ainda tem chance de servir.
  const MAX_PENDING_ICE = 64;

  // Payloads auxiliares (retransmissao e correcao de erro) nao sao codecs de
  // verdade -- x-google-start-bitrate neles nao faz nada.
  const NON_CODEC_ENCODINGS = new Set(['rtx', 'red', 'ulpfec', 'flexfec-03']);

  // Alvo de buffer de jitter dos receptores, em ms. O padrao do Chromium e
  // dimensionado pra internet aberta e custa ~100-200ms por hop -- com a
  // arvore, a folha paga isso DUAS vezes (origem->relay->folha). Isto e um
  // ALVO, nao um teto: se a rede exigir, o Chromium sobe sozinho.
  const JITTER_BUFFER_TARGET_MS = 50;

  // ---------- Chave de conexao de retransmissao (F2) ----------
  //
  // Toda RTCPeerConnection e indexada por (peerId, kind). Quando um RELAY
  // repassa a tela da ORIGEM pra um filho, quem manda a oferta e o relay --
  // entao, com `kind` cru, essa conexao cairia no MESMO slot
  // (relayId, 'screen') que a conexao do proprio compartilhamento do relay,
  // se ele tambem estiver transmitindo. ensureInConn FECHA o que estiver no
  // slot antes de criar o novo: as duas se destruiriam alternadamente,
  // dependendo de qual oferta chegasse por ultimo.
  //
  // Por isso a conexao de repasse usa um kind composto, 'screen@<origemId>':
  // nunca colide com o 'screen' proprio do relay, e carrega, ate o outro
  // lado, de QUEM e o conteudo -- e o que deixa a folha desenhar o tile com
  // o nome e o avatar da ORIGEM em vez dos do relay. O kind composto viaja
  // identico nas mensagens offer/answer/ice/view-state, entao os dois lados
  // concordam na chave sem estado extra.
  //
  // So aparece em conexoes de repasse: com `cfg.network.tree` desligado
  // relayTo nunca e chamado e todo kind continua sendo 'screen'/'camera'
  // cru, exatamente como antes.
  const RELAY_KIND_SEP = '@';

  function relayKindFor(kind, sourcePeerId) {
    return `${kind}${RELAY_KIND_SEP}${sourcePeerId}`;
  }

  /** Devolve { baseKind, sourceId }. sourceId e null pra kind cru (conexao
   * direta) e o id da ORIGEM pra conexao de repasse. */
  function parseKind(kind) {
    const raw = String(kind ?? '');
    const at = raw.indexOf(RELAY_KIND_SEP);
    if (at < 0) return { baseKind: raw, sourceId: null };
    return { baseKind: raw.slice(0, at), sourceId: raw.slice(at + 1) || null };
  }

  // Um quarto do teto, dentro de limites sensatos. Comecar em ~300 kbps
  // (padrao do Chromium) deixa os primeiros segundos borrados; comecar no
  // maximo faz a rajada inicial virar perda e derrubar o GCC. O custo dos
  // dois lados NAO e simetrico: subir a estimativa e rapido, um colapso de
  // congestion control por rajada inicial demora muito mais -- e em VPN de
  // LAN virtual (Radmin/Tailscale) o teto de banda real fica bem abaixo do
  // preset escolhido. Por isso 1/4, e o teto superior caiu de 10000 pra
  // 2500: mesmo com presets de topo (12 Mbps) a rajada fica pequena o
  // bastante pra nao afogar um tunel de VPN.
  function startBitrateKbps(maxBitrateBps) {
    const quarter = Math.round((maxBitrateBps || 0) / 4000);
    return Math.min(Math.max(quarter, 300), 2500);
  }

  // x-google-start-bitrate e uma extensao do Chromium (a unica engine que roda
  // aqui, ja que e Electron) e so existe via SDP -- nao ha equivalente em
  // setParameters, dai a edicao na mao. Mexe apenas na secao de video.
  function withStartBitrate(sdp, kbps) {
    if (!sdp || !kbps) return sdp;
    const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
    const lines = sdp.split(/\r?\n/);

    // Primeira passada: descobre quais payloads sao codecs e quais ja tem uma
    // linha a=fmtp (VP8, por exemplo, costuma nao ter -- ai precisamos criar).
    const codecPts = new Set();
    const withFmtp = new Set();
    let inVideo = false;
    for (const line of lines) {
      if (line.startsWith('m=')) inVideo = line.startsWith('m=video');
      if (!inVideo) continue;
      const rtpmap = /^a=rtpmap:(\d+) ([^/]+)\//.exec(line);
      if (rtpmap && !NON_CODEC_ENCODINGS.has(rtpmap[2].toLowerCase())) codecPts.add(rtpmap[1]);
      const fmtp = /^a=fmtp:(\d+) /.exec(line);
      if (fmtp) withFmtp.add(fmtp[1]);
    }

    const out = [];
    inVideo = false;
    for (const line of lines) {
      if (line.startsWith('m=')) inVideo = line.startsWith('m=video');
      if (!inVideo) {
        out.push(line);
        continue;
      }

      const fmtp = /^a=fmtp:(\d+) /.exec(line);
      if (fmtp && codecPts.has(fmtp[1]) && !line.includes('x-google-start-bitrate')) {
        out.push(`${line};x-google-start-bitrate=${kbps}`);
        continue;
      }

      out.push(line);

      const rtpmap = /^a=rtpmap:(\d+) /.exec(line);
      if (rtpmap && codecPts.has(rtpmap[1]) && !withFmtp.has(rtpmap[1])) {
        out.push(`a=fmtp:${rtpmap[1]} x-google-start-bitrate=${kbps}`);
      }
    }

    return out.join(eol);
  }

  // Bitrate medio de audio, em bits/s. 160 kbps e transparente o bastante
  // pra som de jogo e musica em estereo, e e ruido perto dos 12 Mbps de
  // video do preset de topo.
  const OPUS_MAX_AVERAGE_BITRATE = 160000;

  // O Chromium so manda Opus em estereo se o fmtp declarar -- e declarar
  // vale pros DOIS lados: `stereo` diz o que aceitamos receber,
  // `sprop-stereo` diz o que vamos mandar. Sem isto o audio sai mono no
  // padrao, mesmo com a captura nativa entregando estereo de verdade
  // (ver pcm-injector-worklet.js). Como relayTo repassa a stream inteira,
  // a folha paga o mono duas vezes: ha um transcode Opus->Opus no relay.
  //
  // Idempotente de proposito: a mesma SDP pode passar por aqui duas vezes
  // e nao pode acumular parametro.
  function withOpusParams(sdp, opts) {
    if (!sdp) return sdp;
    const maxAverageBitrate = opts?.maxAverageBitrate ?? OPUS_MAX_AVERAGE_BITRATE;
    const wanted = [
      ['stereo', '1'],
      ['sprop-stereo', '1'],
      ['maxaveragebitrate', String(maxAverageBitrate)],
    ];

    const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
    const lines = sdp.split(/\r?\n/);

    // Primeira passada: quais payloads sao opus, e quais ja tem a=fmtp.
    const opusPts = new Set();
    const withFmtp = new Set();
    let inAudio = false;
    for (const line of lines) {
      if (line.startsWith('m=')) inAudio = line.startsWith('m=audio');
      if (!inAudio) continue;
      const rtpmap = /^a=rtpmap:(\d+) opus\//i.exec(line);
      if (rtpmap) opusPts.add(rtpmap[1]);
      const fmtp = /^a=fmtp:(\d+) /.exec(line);
      if (fmtp) withFmtp.add(fmtp[1]);
    }
    if (!opusPts.size) return sdp;

    const out = [];
    inAudio = false;
    for (const line of lines) {
      if (line.startsWith('m=')) inAudio = line.startsWith('m=audio');
      if (!inAudio) {
        out.push(line);
        continue;
      }

      const fmtp = /^a=fmtp:(\d+) /.exec(line);
      if (fmtp && opusPts.has(fmtp[1])) {
        let updated = line;
        for (const [key, value] of wanted) {
          if (!new RegExp(`[; ]${key}=`, 'i').test(updated)) updated += `;${key}=${value}`;
        }
        out.push(updated);
        continue;
      }

      out.push(line);

      const rtpmap = /^a=rtpmap:(\d+) opus\//i.exec(line);
      if (rtpmap && !withFmtp.has(rtpmap[1])) {
        out.push(`a=fmtp:${rtpmap[1]} ${wanted.map(([k, v]) => `${k}=${v}`).join(';')}`);
      }
    }

    return out.join(eol);
  }

  function createMesh({ send, onTrack, onPeerState }) {
    const peers = new Map();

    // Candidatos ICE que chegaram ANTES de a conexao ter remoteDescription.
    //
    // A sinalizacao entrega 'offer' e 'ice' em sequencia, mas tratar a
    // 'offer' passa por awaits: entre criar a RTCPeerConnection (sincrono) e
    // terminar setRemoteDescription cabe uma mensagem 'ice' inteira. Nessa
    // janela a conexao JA existe, entao handleIce a encontrava e chamava
    // addIceCandidate com remoteDescription nulo -- o que a spec do WebRTC
    // manda rejeitar com InvalidStateError. O catch engolia o erro como
    // "candidato tardio": nao era tardio, era adiantado, e perder o
    // candidato host da VPN significa ICE que nunca fecha (o peer aparece na
    // lista e o video nunca vem). Ver a auditoria de 2026-08-27, item A1.
    //
    // WeakMap indexada pela propria pc pra que o buffer seja coletado junto
    // com a conexao quando ela e fechada e descartada -- nada fica pendurado
    // por peer que saiu.
    const pendingIce = new WeakMap();

    // Esvazia, na ordem de chegada, os candidatos guardados pra `pc`. Uma
    // falha individual (candidato malformado do outro lado) nao pode
    // impedir a entrega dos demais -- basta UM candidato bom pra rota fechar.
    async function drainIce(pc) {
      const queued = pendingIce.get(pc);
      if (!queued) return;
      pendingIce.delete(pc);
      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          /* candidato invalido; os outros ainda podem servir */
        }
      }
    }

    function addPeer(id, name, avatar) {
      if (!peers.has(id)) {
        peers.set(id, {
          id, name, avatar: avatar || null, live: false,
          outConns: {}, inConns: {}, joinedAt: Date.now(),
        });
      } else if (avatar) {
        peers.get(id).avatar = avatar;
      }
      return peers.get(id);
    }

    function removePeer(id) {
      const peer = peers.get(id);
      if (!peer) return;
      Object.values(peer.outConns).forEach((pc) => pc?.close());
      Object.values(peer.inConns).forEach((pc) => pc?.close());
      peers.delete(id);
    }

    // `kind` distingue tela ('screen') de camera ('camera') -- cada uma tem
    // sua propria RTCPeerConnection por peer, pra nao atropelar a track uma
    // da outra quando as duas estao ativas ao mesmo tempo (ver showTile no
    // ui.js, que agora usa ids diferentes por kind).
    function makeConnection(peerId, dir, kind) {
      const pc = new RTCPeerConnection(RTC_CONFIG);

      pc.addEventListener('icecandidate', (event) => {
        if (event.candidate) send({ type: 'ice', to: peerId, dir, kind, candidate: event.candidate });
      });

      if (dir === 'in') {
        pc.addEventListener('track', (event) => {
          const peer = peers.get(peerId);
          if (peer) (peer.inStreams ||= {})[kind] = event.streams[0];
          // Nem toda versao do Chromium expoe isto; sem a propriedade, o
          // padrao continua valendo e nada quebra.
          try {
            if (event.receiver && 'jitterBufferTarget' in event.receiver) {
              event.receiver.jitterBufferTarget = JITTER_BUFFER_TARGET_MS;
            }
          } catch {
            /* receptor ja fechado, ou propriedade somente-leitura nesta versao */
          }
          onTrack(peerId, peer ? peer.name : peerId, event.streams[0], kind);
        });
      }

      // `settled` garante que a falha desta conexao seja reportada UMA vez
      // so, nao importa por qual caminho ela chegou (imediato via
      // 'failed'/'closed', ou depois da carencia de 'disconnected'). Sem
      // isto, um `pc.close()` explicito enquanto a carencia de disconnected
      // ainda esta correndo dispararia dois eventos de falha pra mesma
      // conexao: um na hora (o close vira 'closed' sincrono) e outro
      // quando o timer da carencia checasse o estado depois.
      let settled = false;
      let disconnectTimer = null;

      function clearDisconnectTimer() {
        if (disconnectTimer) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
      }

      function reportFailure() {
        if (settled) return;
        settled = true;
        clearDisconnectTimer();
        if (dir === 'in') {
          // A stream guardada morre junto com a conexao que a trouxe --
          // sem limpar aqui, relayTo repassaria adiante uma stream cujas
          // tracks ja estao 'ended' e o filho ficaria com tela preta sem
          // nenhum evento pra corrigir depois.
          clearInStream(peerId, kind);
          onPeerState(peerId, { removedTile: true, kind, dir, failed: true });
        } else {
          onPeerState(peerId, { kind, dir, failed: true });
        }
      }

      pc.addEventListener('connectionstatechange', () => {
        const state = pc.connectionState;

        // 'failed' e 'closed' sao terminais -- reportar na hora continua
        // certo pros dois.
        if (state === 'failed' || state === 'closed') {
          reportFailure();
          return;
        }

        if (state === 'disconnected') {
          clearDisconnectTimer();
          disconnectTimer = setTimeout(() => {
            disconnectTimer = null;
            // So vira falha de verdade se, passada a carencia, AINDA nao
            // tiver voltado a 'connected' sozinho.
            if (pc.connectionState !== 'connected') reportFailure();
          }, DISCONNECT_GRACE_MS);
          onPeerState(peerId, { kind, dir, failed: false });
          return;
        }

        if (state === 'connected') clearDisconnectTimer();
        onPeerState(peerId, { kind, dir, failed: false });
      });

      return pc;
    }

    function ensureOutConn(peerId, kind) {
      const peer = addPeer(peerId, peers.get(peerId)?.name || `#${peerId}`);
      if (!peer.outConns[kind]) peer.outConns[kind] = makeConnection(peerId, 'out', kind);
      return peer.outConns[kind];
    }

    function clearInStream(peerId, kind) {
      const peer = peers.get(peerId);
      if (peer?.inStreams) peer.inStreams[kind] = null;
    }

    // `renegotiate` vem da propria mensagem de sinalizacao: o ofertante
    // avisou que reofertou NA MESMA pc (removeTrack ao desligar a camera, ou
    // um offerTo numa outConn que ja existia). Trocar a conexao aqui, nesse
    // caso, responderia com ufrag ICE e fingerprint DTLS novos -- que a pc
    // dele nao espera como resposta da oferta que mandou -- e a renegociacao
    // nunca fecharia. Um peer em versao antiga nao manda o flag, e um flag
    // que chega sem conexao viva (ou com ela em estado que nao aceita
    // oferta) nao tem o que reusar: os dois caem no caminho de sempre,
    // recriar. Ver a auditoria de 2026-08-27, item A8.
    function ensureInConn(peerId, kind, renegotiate) {
      const peer = addPeer(peerId, peers.get(peerId)?.name || `#${peerId}`);
      const existing = peer.inConns[kind];
      if (renegotiate && existing && RENEGOTIABLE_STATES.has(existing.signalingState)) return existing;
      if (existing) {
        existing.close();
        // A stream antiga pertence a conexao que acabou de fechar; a nova
        // so existe quando o evento 'track' da nova conexao chegar.
        clearInStream(peerId, kind);
        onPeerState(peerId, { removedTile: true, kind });
      }
      peer.inConns[kind] = makeConnection(peerId, 'in', kind);
      return peer.inConns[kind];
    }

    function preferCodec(transceiver, mimeType) {
      if (!transceiver.setCodecPreferences) return;
      const caps = RTCRtpSender.getCapabilities('video');
      if (!caps) return;
      const wanted = caps.codecs.filter((c) => c.mimeType.toLowerCase() === mimeType.toLowerCase());
      if (!wanted.length) return;
      const rest = caps.codecs.filter((c) => c.mimeType.toLowerCase() !== mimeType.toLowerCase());
      try {
        transceiver.setCodecPreferences([...wanted, ...rest]);
      } catch {
        /* combinacao nao suportada, segue com o padrao */
      }
    }

    async function offerTo(peerId, stream, quality, kind) {
      // Ofertar numa outConn que JA existia e renegociacao (religar a camera
      // logo depois de stopCamera, por exemplo): sem avisar, o outro lado
      // derrubaria a conexao que continua de pe deste lado. Ver ensureInConn.
      const renegotiate = Boolean(peers.get(peerId)?.outConns[kind]);
      const pc = ensureOutConn(peerId, kind);
      // Transceivers novos nascem com track: qualquer suspensao anterior
      // (F1.3) deixou de valer, e manter o registro faria o proximo
      // 'view-state: watching' virar no-op.
      const peerRef = peers.get(peerId);
      if (peerRef?.suspended) peerRef.suspended[kind] = false;
      if (peerRef?.suspendedSenders) peerRef.suspendedSenders[kind] = [];

      for (const track of stream.getTracks()) {
        const transceiver = pc.addTransceiver(track, {
          direction: 'sendonly',
          streams: [stream],
          sendEncodings: track.kind === 'video'
            ? [{ maxBitrate: quality.bitrate, maxFramerate: quality.fps }]
            : undefined,
        });
        if (track.kind === 'video') {
          preferCodec(transceiver, quality.codec);
          // degradationPreference nao existe no RTCRtpTransceiverInit, so em
          // setParameters -- sem isto a conexao nasce em 'balanced' e so vira
          // outra coisa se o usuario mexer na qualidade (o que chama
          // applyEncoding). A preferencia agora depende do kind (tela em
          // 'balanced', camera em 'maintain-framerate') -- ver
          // setDegradationPreference.
          setDegradationPreference(transceiver.sender, kind);
        }
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription({
        type: offer.type,
        sdp: withOpusParams(withStartBitrate(offer.sdp, startBitrateKbps(quality.bitrate))),
      });
      send({ type: 'offer', to: peerId, sdp: pc.localDescription, kind, renegotiate });
    }

    /** Negociacao que morreu no meio: derruba a conexao e AVISA, pra que a
     * recuperacao que ja existe (onPeerState com failed:true) rode.
     *
     * Sem isto a pc ficava aberta e vazia -- sem remoteDescription, sem
     * nunca conectar. Como ela nunca chega em 'failed' no
     * connectionstatechange (ela nao falhou: ela nunca comecou), nada
     * disparava a maquina de recuperacao, e o unico rastro era uma linha no
     * log. Pra quem estava na sala, "a tela de alguem sumiu e nao voltou".
     * Ver o log de 2026-09-05, 04:57:21-22. */
    function failNegotiation(peerId, kind, dir, err) {
      const peer = peers.get(peerId);
      const slot = dir === 'in' ? peer?.inConns : peer?.outConns;
      const pc = slot?.[kind];
      if (pc) {
        try {
          pc.close();
        } catch {
          /* ja fechada */
        }
        slot[kind] = null;
      }
      if (dir === 'in') clearInStream(peerId, kind);
      console.error(
        `[mesh] negociacao de ${dir} com #${peerId} (kind=${kind}) falhou, derrubando a conexao:`,
        `${err?.name || 'Erro'}: ${err?.message || err}`
      );
      onPeerState(peerId, { removedTile: dir === 'in', kind, dir, failed: true });
    }

    async function handleOffer(fromId, sdp, kind, renegotiate) {
      const pc = ensureInConn(fromId, kind, renegotiate);
      try {
        await pc.setRemoteDescription(sdp);
        await drainIce(pc);
        const answer = await pc.createAnswer();
        // Estereo se negocia dos dois lados: sem declarar aqui tambem, o par
        // cai pra mono mesmo com a oferta pedindo estereo.
        await pc.setLocalDescription({ type: answer.type, sdp: withOpusParams(answer.sdp) });
      } catch (err) {
        failNegotiation(fromId, kind, 'in', err);
        throw err; // quem chamou ainda loga a mensagem original
      }
      return pc.localDescription;
    }

    async function handleAnswer(fromId, sdp, kind) {
      const peer = peers.get(fromId);
      const pc = peer?.outConns[kind];
      if (!pc) return;
      // Uma 'answer' so pode ser aplicada numa pc que esta ESPERANDO por
      // ela. Em qualquer outro estado -- resposta duplicada, resposta
      // atrasada de uma oferta que ja foi substituida, pc fechada no meio
      // do caminho -- setRemoteDescription lanca InvalidStateError. E era
      // uma conexao SA sendo morta por uma mensagem tardia: ignorar e o
      // certo, nao derrubar.
      if (pc.signalingState !== 'have-local-offer') {
        console.warn(
          `[mesh] 'answer' de #${fromId} (kind=${kind}) ignorada:`
          + ` a conexao esta em '${pc.signalingState}', nao esperava resposta`
        );
        return;
      }
      try {
        await pc.setRemoteDescription(sdp);
        await drainIce(pc);
      } catch (err) {
        failNegotiation(fromId, kind, 'out', err);
        throw err;
      }
    }

    async function handleIce(fromId, dir, candidate, kind) {
      const peer = peers.get(fromId);
      if (!peer || !candidate) return;
      const target = dir === 'out' ? peer.inConns[kind] : peer.outConns[kind];
      if (!target) return;

      // Adiantado: a conexao existe mas a SDP remota ainda esta a caminho
      // (ou no meio do await). Guarda e entrega em drainIce, logo depois do
      // setRemoteDescription -- ver o comentario de pendingIce.
      if (!target.remoteDescription) {
        const queued = pendingIce.get(target) || [];
        queued.push(candidate);
        if (queued.length > MAX_PENDING_ICE) queued.shift();
        pendingIce.set(target, queued);
        return;
      }

      try {
        await target.addIceCandidate(candidate);
      } catch {
        /* candidato invalido ou conexao ja fechando; nao ha o que fazer */
      }
    }

    function setDegradationPreference(sender, kind) {
      if (!sender) return;
      // Tela em 'balanced': sob banda severamente restrita (VPN saturada)
      // 'maintain-framerate' so obedece destruindo a resolucao. Camera fica
      // 'maintain-framerate' -- rosto travando incomoda mais que perder
      // nitidez. parseKind cobre o kind de repasse (screen@<origem>).
      const pref = parseKind(kind).baseKind === 'screen' ? 'balanced' : 'maintain-framerate';
      try {
        const params = sender.getParameters();
        params.degradationPreference = pref;
        sender.setParameters(params).catch(() => {});
      } catch {
        /* sender pode ter sido fechado no meio da negociacao */
      }
    }

    function applyEncoding(quality, kind) {
      for (const peer of peers.values()) {
        const pc = peer.outConns[kind];
        if (!pc) continue;
        for (const sender of pc.getSenders()) {
          if (!sender.track || sender.track.kind !== 'video') continue;
          const params = sender.getParameters();
          if (!params.encodings || !params.encodings.length) params.encodings = [{}];
          params.encodings[0].maxBitrate = quality.bitrate;
          params.encodings[0].maxFramerate = quality.fps;
          // Mesma regra do setDegradationPreference: tela em 'balanced'
          // (banda restrita nao deve destruir a resolucao), camera em
          // 'maintain-framerate'. parseKind cobre o kind de repasse.
          params.degradationPreference =
            parseKind(kind).baseKind === 'screen' ? 'balanced' : 'maintain-framerate';
          sender.setParameters(params).catch(() => {});
        }
      }
    }

    /** Igual a applyEncoding, mas resolve UMA conexao (peerId + kind) e
     * tambem empurra a resolucao pra baixo no encoder via
     * scaleResolutionDownBy -- o piso global controla a captura, esta
     * funcao afina por-espectador a partir dele. `scaleDownBy` vem pronto
     * de quem chama (config.scaleFactorFor), pra este modulo nao depender
     * do config. */
    function applyEncodingToPeer(peerId, quality, kind, scaleDownBy) {
      const pc = peers.get(peerId)?.outConns[kind];
      if (!pc) return;
      for (const sender of pc.getSenders()) {
        if (!sender.track || sender.track.kind !== 'video') continue;
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = quality.bitrate;
        params.encodings[0].maxFramerate = quality.fps;
        params.encodings[0].scaleResolutionDownBy = Number(scaleDownBy) > 0 ? Number(scaleDownBy) : 1;
        // Ver applyEncoding: tela em 'balanced', camera em 'maintain-framerate'.
        params.degradationPreference =
          parseKind(kind).baseKind === 'screen' ? 'balanced' : 'maintain-framerate';
        sender.setParameters(params).catch(() => {});
      }
    }

    // Remove uma track especifica (ex: camera) da outConn daquele kind sem
    // mexer na outConn de outro kind do mesmo peer (ex: tela, que agora vive
    // numa RTCPeerConnection separada -- ver comentario acima de
    // makeConnection). Renegocia com uma nova oferta pra avisar o lado
    // remoto -- do contrario a track para de mandar frames mas a conexao
    // continua "viva" e o peer remoto fica vendo o ultimo frame congelado
    // indefinidamente.
    async function removeTrack(peerId, track, kind) {
      const peer = peers.get(peerId);
      const pc = peer?.outConns[kind];
      if (!pc) return;
      const sender = pc.getSenders().find((s) => s.track === track);
      if (!sender) return;
      try {
        pc.removeTrack(sender);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        // Renegociacao pura: a pc, o ICE e o DTLS continuam de pe deste
        // lado, so a track saiu. Ver ensureInConn.
        send({ type: 'offer', to: peerId, sdp: pc.localDescription, kind, renegotiate: true });
      } catch {
        /* conexao pode ja ter fechado (peer saiu durante a renegociacao) */
      }
    }

    // Fecha so a outConn de um peer/kind especifico, sem mexer no outro
    // kind do mesmo peer nem nos demais peers. Usado na troca de PAPEL na
    // arvore (F2): a origem para de mandar direto pra um peer que passou a
    // ser folha de um relay. Diferente de setPeerDemand (F1.3): aqui a
    // conexao fecha de verdade, porque quem vai mandar video pra esse peer
    // e outro no (o relay), nao mais a origem.
    function closeOut(peerId, kind) {
      const peer = peers.get(peerId);
      const pc = peer?.outConns[kind];
      if (!pc) return;
      pc.close();
      peer.outConns[kind] = null;
    }

    // Repassa uma track JA RECEBIDA (peers.get(sourcePeerId).inStreams[kind])
    // pra um peer abaixo na arvore (F2). O Chromium recodifica -- nao existe
    // passagem direta de frame codificado entre RTCPeerConnections -- entao
    // isto custa 1 decode + 1 encode a mais no relay. Ver a spec de
    // 2026-08-23, secao F2.
    //
    // Devolve false sem lancar se a stream ainda nao chegou (a mensagem
    // 'tree' pode chegar antes da 'offer' da origem terminar de negociar --
    // ver o retry em app.js, Task 5).
    //
    // A conexao criada pro filho usa o kind COMPOSTO ('screen@<origem>'),
    // nao o cru -- ver relayKindFor no topo deste arquivo pro porque.
    async function relayTo(childId, sourcePeerId, kind, quality) {
      const inbound = peers.get(sourcePeerId)?.inStreams?.[kind];
      if (!inbound) return false;
      const track = inbound.getVideoTracks()[0];
      // Track ja encerrada (a conexao com a origem caiu e a stream guardada
      // ficou pra tras): repassar isto so entrega tela preta.
      if (track?.readyState === 'ended') return false;
      // Heranca do contentHint da origem nao e garantida pelo Chromium na
      // recodificacao -- reaplicar aqui.
      if (track) track.contentHint = 'motion';
      await offerTo(childId, inbound, quality, relayKindFor(kind, sourcePeerId));
      return true;
    }

    // ---------- Encode sob demanda (spec de 2026-08-23, F1.3) ----------
    //
    // Ninguem deve pagar encode por um espectador que nao esta olhando. Cada
    // RTCRtpSender do Chromium instancia SEU PROPRIO encoder -- com 3
    // espectadores sao 3 encodes de 1080p60 saindo da mesma captura, na
    // mesma GPU que o jogo usa.
    //
    // replaceTrack(null) libera o encoder na hora e NAO exige renegociacao:
    // a PeerConnection, o ICE e o DTLS continuam de pe, entao religar custa
    // um frame. Fechar a pc faria o oposto -- ICE + DTLS + SDP de novo,
    // segundos de tela preta ao voltar.
    //
    // So a track de VIDEO suspende: quem minimizou provavelmente ainda quer
    // ouvir, e encode de audio e irrelevante perto do de video.
    //
    // Devolve true quando houve mudanca de estado (pra quem chama saber se
    // precisa redesenhar), false quando ja estava no estado pedido ou nao ha
    // conexao daquele kind.
    function setPeerDemand(peerId, kind, wanted, track) {
      const peer = peers.get(peerId);
      const pc = peer?.outConns[kind];
      if (!pc) return false;

      peer.suspended ||= {};
      peer.suspendedSenders ||= {};
      if (Boolean(peer.suspended[kind]) === !wanted) return false;

      if (wanted) {
        // Religa nos MESMOS senders que foram suspensos -- depois do
        // replaceTrack(null) o sender fica sem track, entao nao da pra
        // reencontra-lo por sender.track.kind.
        for (const sender of peer.suspendedSenders[kind] || []) {
          sender.replaceTrack(track || null).catch(() => {});
        }
        peer.suspendedSenders[kind] = [];
        peer.suspended[kind] = false;
      } else {
        const senders = pc.getSenders().filter((s) => s.track?.kind === 'video');
        peer.suspendedSenders[kind] = senders;
        for (const sender of senders) sender.replaceTrack(null).catch(() => {});
        peer.suspended[kind] = true;
      }
      return true;
    }

    function isPeerSuspended(peerId, kind) {
      return Boolean(peers.get(peerId)?.suspended?.[kind]);
    }

    /** Quem, entre os peers pra quem estamos ENVIANDO aquele kind, esta de
     * fato assistindo agora (nao suspenso por F1.3). E a lista que o
     * transmissor broadcasta pra sala poder desenhar "quem esta assistindo"
     * no proprio tile -- ver app.js broadcastWatchers. */
    function watchersOf(kind) {
      const out = [];
      for (const peer of peers.values()) {
        if (!peer.outConns[kind]) continue;
        if (peer.suspended?.[kind]) continue;
        out.push({ id: peer.id, name: peer.name, avatar: peer.avatar || null });
      }
      return out;
    }

    /** Pares { peerId, kind } de quem estamos RECEBENDO video agora. E a
     * lista de destinatarios do nosso proprio 'view-state'. */
    function receivingFrom() {
      const out = [];
      for (const [peerId, peer] of peers) {
        for (const kind of Object.keys(peer.inConns)) {
          if (peer.inConns[kind]) out.push({ peerId, kind });
        }
      }
      return out;
    }

    function closeAllOut(kind) {
      for (const peer of peers.values()) {
        const pc = peer.outConns[kind];
        if (!pc) continue;
        pc.close();
        peer.outConns[kind] = null;
      }
    }

    async function statsFor(peerId, kind = 'screen') {
      const pc = peers.get(peerId)?.outConns[kind];
      if (!pc || pc.connectionState !== 'connected') return null;
      return pc.getStats();
    }

    /** Igual a statsFor, mas da conexao de ENTRADA daquele kind -- e por
     * onde o espectador enxerga a propria recepcao. */
    async function inStatsFor(peerId, kind = 'screen') {
      const pc = peers.get(peerId)?.inConns[kind];
      if (!pc || pc.connectionState !== 'connected') return null;
      return pc.getStats();
    }

    return {
      peers,
      addPeer,
      removePeer,
      handleOffer,
      handleAnswer,
      handleIce,
      offerTo,
      removeTrack,
      applyEncoding,
      applyEncodingToPeer,
      closeAllOut,
      closeOut,
      relayTo,
      statsFor,
      inStatsFor,
      setPeerDemand,
      isPeerSuspended,
      receivingFrom,
      watchersOf,
    };
  }

  const api = { createMesh, withStartBitrate, withOpusParams, startBitrateKbps, relayKindFor, parseKind, RTC_CONFIG };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesh = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
