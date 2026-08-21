'use strict';

(function (root) {
  const RTC_CONFIG = { iceServers: [], iceTransportPolicy: 'all' };

  function createMesh({ send, onTrack, onPeerState }) {
    const peers = new Map();

    function addPeer(id, name, avatar) {
      if (!peers.has(id)) {
        peers.set(id, { id, name, avatar: avatar || null, live: false, outConns: {}, inConns: {} });
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
      statsFor,
    };
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.mesh = { createMesh };
})(window);
