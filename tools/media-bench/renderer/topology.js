'use strict';

/*
 * Topologias de loopback. Cada "enlace" e um par de RTCPeerConnection no
 * mesmo processo, sem servidor de ICE (iceServers vazio: so candidatos host)
 * e com a negociacao feita por chamada direta.
 *
 *   p2p    origem --> viewer_i                       (um sender novo por viewer)
 *   relay  origem --> relay --> viewer_i             (o relay RECEBE a track e a
 *                                                     reenvia por senders novos:
 *                                                     decode + encode de verdade,
 *                                                     como mesh.relayTo)
 *
 * A origem NUNCA e enviada duas vezes no relay: so o no intermediario fala
 * com os viewers. Retorna os "nos medidos" (sender/receiver) pro sampler.
 *
 * Contrato pra topologias futuras (ex.: 'sfu'): devolver { nodes, rtpSenders,
 * close } no mesmo formato; o resto da bancada nao muda.
 */
(function (root) {
  const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

  function withTimeout(promise, ms, what) {
    let t;
    const limite = new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`timeout (${ms} ms): ${what}`)), ms);
    });
    return Promise.race([promise, limite]).finally(() => clearTimeout(t));
  }

  const MIME = { h264: 'video/H264', vp8: 'video/VP8', vp9: 'video/VP9', av1: 'video/AV1' };
  const AUX = /^video\/(rtx|red|ulpfec|flexfec)/i;

  /** Codecs do sender com o preferido, mais os auxiliares (rtx/red/fec). */
  function codecPreferences(codec) {
    const caps = root.RTCRtpSender.getCapabilities('video')?.codecs || [];
    const wanted = MIME[codec];
    const main = caps.filter((c) => c.mimeType.toLowerCase() === wanted.toLowerCase());
    if (!main.length) throw new Error(`codec ${codec} indisponivel neste runtime`);
    return [...main, ...caps.filter((c) => AUX.test(c.mimeType))];
  }

  function waitConnected(pcs, ms) {
    return withTimeout(Promise.all(pcs.map((pc) => new Promise((resolve, reject) => {
      const check = () => {
        if (pc.connectionState === 'connected') resolve();
        else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          reject(new Error(`conexao ${pc.connectionState}`));
        }
      };
      pc.addEventListener('connectionstatechange', check);
      check();
    }))), ms, 'conexao WebRTC de loopback');
  }

  /** Um enlace sender -> receiver com negociacao local. */
  async function link({ track, stream, codec, bitrateKbps, fps, label, timeoutMs }) {
    const send = new root.RTCPeerConnection({ iceServers: [] });
    const recv = new root.RTCPeerConnection({ iceServers: [] });
    const closeAll = () => {
      try { send.close(); } catch { /* ja fechado */ }
      try { recv.close(); } catch { /* ja fechado */ }
    };
    try {
      send.onicecandidate = (e) => { if (e.candidate) recv.addIceCandidate(e.candidate).catch(() => {}); };
      recv.onicecandidate = (e) => { if (e.candidate) send.addIceCandidate(e.candidate).catch(() => {}); };
      const remote = new Promise((resolve) => { recv.ontrack = (ev) => resolve(ev.track); });

      const transceiver = send.addTransceiver(track, { direction: 'sendonly', streams: stream ? [stream] : [] });
      transceiver.setCodecPreferences(codecPreferences(codec));
      const offer = await send.createOffer();
      await send.setLocalDescription(offer);
      await recv.setRemoteDescription(offer);
      const answer = await recv.createAnswer();
      await recv.setLocalDescription(answer);
      await send.setRemoteDescription(answer);

      await waitConnected([send, recv], timeoutMs);
      const params = transceiver.sender.getParameters();
      if (params.encodings?.length) {
        params.encodings[0].maxBitrate = bitrateKbps * 1000;
        params.encodings[0].maxFramerate = fps;
        await transceiver.sender.setParameters(params);
      }
      const remoteTrack = await withTimeout(remote, timeoutMs, `track remota de ${label}`);
      return { send, recv, remoteTrack, close: closeAll };
    } catch (err) {
      closeAll();
      throw new Error(`${label}: ${err.message || err}`);
    }
  }

  /** Atrela a track remota a um <video> mudo (o espectador de verdade). */
  function attachViewer(remoteTrack, doc) {
    const video = doc.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = new root.MediaStream([remoteTrack]);
    video.style.cssText = 'width:160px;height:90px';
    doc.getElementById('viewers').appendChild(video);
    video.play().catch(() => {});
    return video;
  }

  /**
   * @param cfg configuracao do cenario
   * @param sourceTrack track ja pronta (direta ou do relay por canvas)
   * @returns {{ nodes, rtpSenders, close }}
   */
  async function build(cfg, sourceTrack, doc = root.document) {
    const nodes = [];
    const links = [];
    const videos = [];
    const common = { codec: cfg.codec, bitrateKbps: cfg.bitrateKbps, fps: cfg.fps, timeoutMs: 15000 };
    const rtpSenders = { origin: 0, relay: 0 };
    const close = () => {
      for (const v of videos) {
        try { v.srcObject = null; v.remove(); } catch { /* ja removido */ }
      }
      for (const l of links) {
        l.close();
        try { l.remoteTrack.stop(); } catch { /* ja parada */ }
      }
    };
    try {
      if (cfg.topology === 'p2p') {
        for (let i = 0; i < cfg.viewers; i++) {
          const label = `origem->viewer${i + 1}`;
          const l = await link({ ...common, track: sourceTrack, label });
          links.push(l);
          rtpSenders.origin += 1;
          nodes.push({ role: 'origin-sender', label, kind: 'sender', pc: l.send });
          nodes.push({ role: 'viewer-receiver', label: `viewer${i + 1}`, kind: 'receiver', pc: l.recv });
          videos.push(attachViewer(l.remoteTrack, doc));
        }
      } else if (cfg.topology === 'relay') {
        const up = await link({ ...common, track: sourceTrack, label: 'origem->relay' });
        links.push(up);
        rtpSenders.origin += 1;
        nodes.push({ role: 'origin-sender', label: 'origem->relay', kind: 'sender', pc: up.send });
        nodes.push({ role: 'relay-receiver', label: 'relay (entrada)', kind: 'receiver', pc: up.recv });
        // Como mesh.relayTo: a track recebida volta a ser 'motion' antes de reenviar.
        if (cfg.hint) up.remoteTrack.contentHint = cfg.hint;
        const stream = new root.MediaStream([up.remoteTrack]);
        for (let i = 0; i < cfg.viewers; i++) {
          const label = `relay->viewer${i + 1}`;
          const l = await link({ ...common, track: up.remoteTrack, stream, label });
          links.push(l);
          rtpSenders.relay += 1;
          nodes.push({ role: 'relay-sender', label, kind: 'sender', pc: l.send });
          nodes.push({ role: 'viewer-receiver', label: `viewer${i + 1}`, kind: 'receiver', pc: l.recv });
          videos.push(attachViewer(l.remoteTrack, doc));
        }
      } else {
        throw new Error(`topologia nao implementada: ${cfg.topology}`);
      }
    } catch (err) {
      close();
      throw err;
    }
    return { nodes, rtpSenders: { ...rtpSenders, total: rtpSenders.origin + rtpSenders.relay }, close };
  }

  root.MediaBench.topology = { build, link, codecPreferences, sleep, withTimeout };
})(globalThis);
