'use strict';

(function (root) {
  const RTC_CONFIG = { iceServers: [], iceTransportPolicy: 'all' };

  function createMesh({ send, onTrack, onPeerState }) {
    const peers = new Map();

    function addPeer(id, name, avatar) {
      if (!peers.has(id)) {
        peers.set(id, { id, name, avatar: avatar || null, live: false, outConn: null, inConn: null });
      } else if (avatar) {
        peers.get(id).avatar = avatar;
      }
      return peers.get(id);
    }

    function removePeer(id) {
      const peer = peers.get(id);
      if (!peer) return;
      peer.outConn?.close();
      peer.inConn?.close();
      peers.delete(id);
    }

    function makeConnection(peerId, dir) {
      const pc = new RTCPeerConnection(RTC_CONFIG);

      pc.addEventListener('icecandidate', (event) => {
        if (event.candidate) send({ type: 'ice', to: peerId, dir, candidate: event.candidate });
      });

      if (dir === 'in') {
        pc.addEventListener('track', (event) => {
          const peer = peers.get(peerId);
          onTrack(peerId, peer ? peer.name : peerId, event.streams[0]);
        });
      }

      pc.addEventListener('connectionstatechange', () => {
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState) && dir === 'in') {
          onPeerState(peerId, { removedTile: true });
        } else {
          onPeerState(peerId, {});
        }
      });

      return pc;
    }

    function ensureOutConn(peerId) {
      const peer = addPeer(peerId, peers.get(peerId)?.name || `#${peerId}`);
      if (!peer.outConn) peer.outConn = makeConnection(peerId, 'out');
      return peer.outConn;
    }

    function ensureInConn(peerId) {
      const peer = addPeer(peerId, peers.get(peerId)?.name || `#${peerId}`);
      if (peer.inConn) {
        peer.inConn.close();
        onPeerState(peerId, { removedTile: true });
      }
      peer.inConn = makeConnection(peerId, 'in');
      return peer.inConn;
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

    async function offerTo(peerId, stream, quality) {
      const pc = ensureOutConn(peerId);

      for (const track of stream.getTracks()) {
        const transceiver = pc.addTransceiver(track, {
          direction: 'sendonly',
          streams: [stream],
          sendEncodings: track.kind === 'video'
            ? [{ maxBitrate: quality.bitrate, maxFramerate: quality.fps }]
            : undefined,
        });
        if (track.kind === 'video') preferCodec(transceiver, quality.codec);
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: 'offer', to: peerId, sdp: pc.localDescription });
    }

    async function handleOffer(fromId, sdp) {
      const pc = ensureInConn(fromId);
      await pc.setRemoteDescription(sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      return pc.localDescription;
    }

    async function handleAnswer(fromId, sdp) {
      const peer = peers.get(fromId);
      if (!peer?.outConn) return;
      await peer.outConn.setRemoteDescription(sdp);
    }

    async function handleIce(fromId, dir, candidate) {
      const peer = peers.get(fromId);
      if (!peer || !candidate) return;
      const target = dir === 'out' ? peer.inConn : peer.outConn;
      if (!target) return;
      try {
        await target.addIceCandidate(candidate);
      } catch {
        /* candidato tardio, ignorar */
      }
    }

    function applyEncoding(quality) {
      for (const peer of peers.values()) {
        if (!peer.outConn) continue;
        for (const sender of peer.outConn.getSenders()) {
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

    // Remove uma track especifica (ex: camera) da outConn de um peer sem
    // mexer nas outras tracks que possam estar ativas na mesma conexao (ex:
    // compartilhamento de tela, que usa a mesma outConn via ensureOutConn).
    // Renegocia com uma nova oferta pra avisar o lado remoto — do contrario
    // a track para de mandar frames mas a conexao continua "viva" e o peer
    // remoto fica vendo o ultimo frame congelado indefinidamente.
    //
    // Do lado receptor, essa renegociacao entra por handleOffer -> ensureInConn,
    // que HOJE fecha e recria o inConn inteiro a cada nova oferta (comportamento
    // existente, intencional). Isso ja remove o tile antigo (via onPeerState
    // removedTile) e recria a partir das tracks que sobrarem no novo SDP —
    // entao se so a camera for removida, o tile some; se tela+camera estavam
    // ativas juntas, o tile reaparece com a tela assim que o evento `track`
    // disparar de novo. Limitacao conhecida (pre-existente, fora do escopo
    // desta funcao): a UI usa UM tile por peer (ui.grid.showTile(peerId, ...)),
    // entao tela e camera do MESMO peer simultaneas se atropelam no mesmo
    // tile — nao ha como distinguir qual stream esta sendo mostrada.
    async function removeTrack(peerId, track) {
      const peer = peers.get(peerId);
      if (!peer?.outConn) return;
      const pc = peer.outConn;
      const sender = pc.getSenders().find((s) => s.track === track);
      if (!sender) return;
      try {
        pc.removeTrack(sender);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({ type: 'offer', to: peerId, sdp: pc.localDescription });
      } catch {
        /* conexao pode ja ter fechado (peer saiu durante a renegociacao) */
      }
    }

    function closeAllOut() {
      for (const peer of peers.values()) {
        if (!peer.outConn) continue;
        peer.outConn.close();
        peer.outConn = null;
      }
    }

    async function statsFor(peerId) {
      const peer = peers.get(peerId);
      if (!peer?.outConn || peer.outConn.connectionState !== 'connected') return null;
      return peer.outConn.getStats();
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
      statsFor,
    };
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.mesh = { createMesh };
})(window);
