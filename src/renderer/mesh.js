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

  // Payloads auxiliares (retransmissao e correcao de erro) nao sao codecs de
  // verdade -- x-google-start-bitrate neles nao faz nada.
  const NON_CODEC_ENCODINGS = new Set(['rtx', 'red', 'ulpfec', 'flexfec-03']);

  // Metade do teto, dentro de limites sensatos. O padrao do Chromium e comecar
  // em ~300 kbps e subir conforme o congestion control ganha confianca, o que
  // deixa os primeiros segundos de qualquer compartilhamento borrados mesmo
  // com banda de sobra. Comecar direto no maximo tambem nao serve: se a rede
  // nao aguentar, a rajada vira perda e o GCC derruba tudo. Metade e um
  // palpite inicial -- ele continua livre pra subir ate maxBitrate ou descer.
  function startBitrateKbps(maxBitrateBps) {
    const half = Math.round((maxBitrateBps || 0) / 2000);
    return Math.min(Math.max(half, 300), 10000);
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

  function createMesh({ send, onTrack, onPeerState }) {
    const peers = new Map();

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
          onTrack(peerId, peer ? peer.name : peerId, event.streams[0], kind);
        });
      }

      pc.addEventListener('connectionstatechange', () => {
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState) && dir === 'in') {
          onPeerState(peerId, { removedTile: true, kind });
        } else {
          onPeerState(peerId, { kind });
        }
      });

      return pc;
    }

    function ensureOutConn(peerId, kind) {
      const peer = addPeer(peerId, peers.get(peerId)?.name || `#${peerId}`);
      if (!peer.outConns[kind]) peer.outConns[kind] = makeConnection(peerId, 'out', kind);
      return peer.outConns[kind];
    }

    function ensureInConn(peerId, kind) {
      const peer = addPeer(peerId, peers.get(peerId)?.name || `#${peerId}`);
      if (peer.inConns[kind]) {
        peer.inConns[kind].close();
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
          // 'maintain-framerate' se o usuario mexer na qualidade (o que chama
          // applyEncoding). Pra tela em movimento, derrubar resolucao e menos
          // ruim do que engasgar os frames.
          setDegradationPreference(transceiver.sender);
        }
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription({
        type: offer.type,
        sdp: withStartBitrate(offer.sdp, startBitrateKbps(quality.bitrate)),
      });
      send({ type: 'offer', to: peerId, sdp: pc.localDescription, kind });
    }

    async function handleOffer(fromId, sdp, kind) {
      const pc = ensureInConn(fromId, kind);
      await pc.setRemoteDescription(sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      return pc.localDescription;
    }

    async function handleAnswer(fromId, sdp, kind) {
      const peer = peers.get(fromId);
      if (!peer?.outConns[kind]) return;
      await peer.outConns[kind].setRemoteDescription(sdp);
    }

    async function handleIce(fromId, dir, candidate, kind) {
      const peer = peers.get(fromId);
      if (!peer || !candidate) return;
      const target = dir === 'out' ? peer.inConns[kind] : peer.outConns[kind];
      if (!target) return;
      try {
        await target.addIceCandidate(candidate);
      } catch {
        /* candidato tardio, ignorar */
      }
    }

    function setDegradationPreference(sender, pref = 'maintain-framerate') {
      if (!sender) return;
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
          params.degradationPreference = 'maintain-framerate';
          sender.setParameters(params).catch(() => {});
        }
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
        send({ type: 'offer', to: peerId, sdp: pc.localDescription, kind });
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
    async function relayTo(childId, sourcePeerId, kind, quality) {
      const inbound = peers.get(sourcePeerId)?.inStreams?.[kind];
      if (!inbound) return false;
      const track = inbound.getVideoTracks()[0];
      // Heranca do contentHint da origem nao e garantida pelo Chromium na
      // recodificacao -- reaplicar aqui.
      if (track) track.contentHint = 'motion';
      await offerTo(childId, inbound, quality, kind);
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
      closeAllOut,
      closeOut,
      relayTo,
      statsFor,
      setPeerDemand,
      isPeerSuspended,
      receivingFrom,
      watchersOf,
    };
  }

  const api = { createMesh, withStartBitrate, startBitrateKbps, RTC_CONFIG };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesh = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
