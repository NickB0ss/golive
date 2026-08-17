/*
 * GoLive LAN - renderer.
 *
 * Topologia: malha (mesh). Nao existe servidor de midia. Quem transmite abre
 * uma RTCPeerConnection separada pra cada espectador e envia o video direto
 * pela LAN virtual. Isso mantem a latencia baixa, mas o upload de quem
 * transmite e multiplicado pelo numero de espectadores -- e o limite real
 * deste desenho. Veja o README antes de chamar 8 pessoas pra sala.
 */

'use strict';

// --- Estado global -----------------------------------------------------

let ws = null;
let myId = null;

/** peerId -> { id, name, live, outConn, inConn } */
const peers = new Map();

/** MediaStream da minha tela, quando estou transmitindo. */
let localStream = null;

/** Sem STUN/TURN: dentro da VPN os candidatos "host" ja se enxergam. */
const RTC_CONFIG = { iceServers: [], iceTransportPolicy: 'all' };

// --- Atalhos de DOM ----------------------------------------------------

const $ = (id) => document.getElementById(id);

const el = {
  setup: $('setup'),
  main: $('main'),
  server: $('in-server'),
  room: $('in-room'),
  name: $('in-name'),
  connect: $('btn-connect'),
  setupError: $('setup-error'),
  connDot: $('conn-dot'),
  connText: $('conn-text'),
  peerList: $('peer-list'),
  res: $('sel-res'),
  fps: $('sel-fps'),
  bitrate: $('in-bitrate'),
  bitrateLabel: $('lbl-bitrate'),
  codec: $('sel-codec'),
  audio: $('chk-audio'),
  share: $('btn-share'),
  stop: $('btn-stop'),
  stats: $('stats'),
  grid: $('grid'),
  picker: $('picker'),
  pickerGrid: $('picker-grid'),
  pickerCancel: $('picker-cancel'),
};

// Lembra as configuracoes entre sessoes.
const saved = JSON.parse(localStorage.getItem('golive') || '{}');
el.server.value = saved.server || '';
el.name.value = saved.name || '';
el.room.value = saved.room || 'geral';

function persist() {
  localStorage.setItem(
    'golive',
    JSON.stringify({ server: el.server.value, name: el.name.value, room: el.room.value })
  );
}

// --- Configuracao de qualidade -----------------------------------------

function quality() {
  const [width, height] = el.res.value.split('x').map(Number);
  return {
    width,
    height,
    fps: Number(el.fps.value),
    bitrate: Number(el.bitrate.value) * 1_000_000,
    codec: el.codec.value,
  };
}

el.bitrate.addEventListener('input', () => {
  el.bitrateLabel.textContent = `${el.bitrate.value} Mbps`;
  // Aplica ao vivo, sem renegociar.
  if (localStream) applyEncoding();
});

// Trocar resolucao/fps ao vivo tambem funciona via applyConstraints.
[el.res, el.fps].forEach((input) =>
  input.addEventListener('change', async () => {
    if (!localStream) return;
    const q = quality();
    const track = localStream.getVideoTracks()[0];
    if (track) {
      await track.applyConstraints({
        width: { ideal: q.width, max: q.width },
        height: { ideal: q.height, max: q.height },
        frameRate: { ideal: q.fps, max: q.fps },
      });
    }
    applyEncoding();
  })
);

// --- Sinalizacao -------------------------------------------------------

function signal(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function setConnState(state, text) {
  el.connDot.className = `dot ${state}`;
  el.connText.textContent = text;
}

el.connect.addEventListener('click', () => {
  let url = el.server.value.trim();
  if (!url) return (el.setupError.textContent = 'Informe o endereco do servidor.');
  if (!/^wss?:\/\//.test(url)) url = `ws://${url}`;
  if (!/:\d+$/.test(url)) url += ':9000';

  el.setupError.textContent = '';
  el.connect.disabled = true;
  el.connect.textContent = 'Conectando...';

  try {
    ws = new WebSocket(url);
  } catch {
    el.setupError.textContent = 'Endereco invalido.';
    el.connect.disabled = false;
    el.connect.textContent = 'Conectar';
    return;
  }

  ws.addEventListener('open', () => {
    persist();
    signal({ type: 'join', room: el.room.value.trim() || 'geral', name: el.name.value.trim() || 'anonimo' });
    el.setup.classList.add('hidden');
    el.main.classList.remove('hidden');
    setConnState('ok', 'conectado');
  });

  ws.addEventListener('message', (event) => handleSignal(JSON.parse(event.data)));

  ws.addEventListener('error', () => {
    el.setupError.textContent =
      'Nao consegui conectar. Confira o IP, se o servidor esta rodando e se a porta 9000 esta liberada no firewall.';
    el.connect.disabled = false;
    el.connect.textContent = 'Conectar';
  });

  ws.addEventListener('close', () => {
    setConnState('bad', 'desconectado');
    el.connect.disabled = false;
    el.connect.textContent = 'Conectar';
    for (const peer of peers.values()) {
      peer.outConn?.close();
      peer.inConn?.close();
    }
    peers.clear();
    renderPeers();
  });
});

async function handleSignal(msg) {
  switch (msg.type) {
    case 'welcome': {
      myId = msg.id;
      for (const p of msg.peers) addPeer(p.id, p.name);
      renderPeers();
      break;
    }

    case 'peer-joined': {
      addPeer(msg.id, msg.name);
      renderPeers();
      // Se ja estou transmitindo, mando meu video pro recem-chegado.
      if (localStream) await offerTo(msg.id);
      break;
    }

    case 'peer-left': {
      const peer = peers.get(msg.id);
      if (peer) {
        peer.outConn?.close();
        peer.inConn?.close();
        peers.delete(msg.id);
        removeTile(msg.id);
        renderPeers();
      }
      break;
    }

    case 'offer': {
      const pc = ensureInConn(msg.from);
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signal({ type: 'answer', to: msg.from, sdp: pc.localDescription });
      break;
    }

    case 'answer': {
      const peer = peers.get(msg.from);
      if (!peer?.outConn) return;
      await peer.outConn.setRemoteDescription(msg.sdp);
      // So da pra fixar bitrate depois que a negociacao fechou.
      applyEncoding();
      break;
    }

    case 'ice': {
      const peer = peers.get(msg.from);
      if (!peer || !msg.candidate) return;
      // Candidato da outConn do remetente chega na minha inConn, e vice-versa.
      const target = msg.dir === 'out' ? peer.inConn : peer.outConn;
      if (!target) return;
      try {
        await target.addIceCandidate(msg.candidate);
      } catch {
        /* candidato tardio, ignorar */
      }
      break;
    }

    case 'broadcast-state': {
      const peer = peers.get(msg.id);
      if (peer) {
        peer.live = msg.live;
        // Quem parou de transmitir fechou a conexao do lado dele. Fecha aqui
        // tambem, senao a proxima offer cai numa PeerConnection zumbi.
        if (!msg.live && peer.inConn) {
          peer.inConn.close();
          peer.inConn = null;
        }
      }
      if (!msg.live) removeTile(msg.id);
      renderPeers();
      break;
    }
  }
}

// --- Peers e conexoes --------------------------------------------------

function addPeer(id, name) {
  if (!peers.has(id)) peers.set(id, { id, name, live: false, outConn: null, inConn: null });
}

/** Cria uma RTCPeerConnection nova pro papel dado ('out' = eu envio, 'in' = eu recebo). */
function makeConnection(peerId, dir) {
  const pc = new RTCPeerConnection(RTC_CONFIG);

  pc.addEventListener('icecandidate', (event) => {
    if (event.candidate) signal({ type: 'ice', to: peerId, dir, candidate: event.candidate });
  });

  if (dir === 'in') {
    pc.addEventListener('track', (event) => {
      // O mesmo stream traz video e audio; o tile lida com os dois.
      const peer = peers.get(peerId);
      showTile(peerId, peer ? peer.name : peerId, event.streams[0]);
    });
  }

  pc.addEventListener('connectionstatechange', () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState) && dir === 'in') {
      removeTile(peerId);
    }
    renderPeers();
  });

  return pc;
}

/** Conexao pela qual EU envio minha tela pra este peer. */
function ensureOutConn(peerId) {
  let peer = peers.get(peerId);
  if (!peer) {
    addPeer(peerId, `#${peerId}`);
    peer = peers.get(peerId);
  }
  if (!peer.outConn) peer.outConn = makeConnection(peerId, 'out');
  return peer.outConn;
}

/** Conexao pela qual EU recebo a tela deste peer. Sempre recriada numa
 * offer nova, porque cada sessao de transmissao usa credenciais ICE novas. */
function ensureInConn(peerId) {
  let peer = peers.get(peerId);
  if (!peer) {
    addPeer(peerId, `#${peerId}`);
    peer = peers.get(peerId);
  }
  if (peer.inConn) {
    peer.inConn.close();
    removeTile(peerId);
  }
  peer.inConn = makeConnection(peerId, 'in');
  return peer.inConn;
}

/** Envia minha tela pra um peer especifico. */
async function offerTo(peerId) {
  const pc = ensureOutConn(peerId);
  const q = quality();

  for (const track of localStream.getTracks()) {
    const transceiver = pc.addTransceiver(track, {
      direction: 'sendonly',
      streams: [localStream],
      sendEncodings: track.kind === 'video'
        ? [{ maxBitrate: q.bitrate, maxFramerate: q.fps }]
        : undefined,
    });
    if (track.kind === 'video') preferCodec(transceiver, q.codec);
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signal({ type: 'offer', to: peerId, sdp: pc.localDescription });
}

/**
 * Coloca o codec desejado no topo da lista de preferencias. Se a maquina nao
 * suportar, a lista continua valida e o WebRTC escolhe outro.
 */
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

/**
 * Aplica bitrate, framerate e — o mais importante — degradationPreference.
 *
 * 'maintain-framerate' e o que faz o compartilhamento parecer suave: quando a
 * banda aperta, o encoder derruba a resolucao e segura os 60 fps, em vez do
 * padrao que congela a imagem pra manter os pixels.
 */
function applyEncoding() {
  const q = quality();
  for (const peer of peers.values()) {
    if (!peer.outConn) continue;
    for (const sender of peer.outConn.getSenders()) {
      if (!sender.track || sender.track.kind !== 'video') continue;
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = q.bitrate;
      params.encodings[0].maxFramerate = q.fps;
      params.degradationPreference = 'maintain-framerate';
      sender.setParameters(params).catch(() => {});
    }
  }
}

// --- Captura de tela ---------------------------------------------------

el.share.addEventListener('click', openPicker);

async function openPicker() {
  const sources = await window.golive.listSources();
  el.pickerGrid.innerHTML = '';

  for (const source of sources) {
    const card = document.createElement('button');
    card.className = 'source-card';
    card.innerHTML = `
      <img src="${source.thumbnail}" alt="" />
      <span class="source-name">${escapeHtml(source.name)}</span>
      <span class="source-meta">${source.isScreen ? 'Tela' : 'Janela'}${
        source.resolution ? ` &middot; ${source.resolution}` : ''
      }</span>`;
    card.addEventListener('click', () => startShare(source.id));
    el.pickerGrid.appendChild(card);
  }

  el.picker.classList.remove('hidden');
}

el.pickerCancel.addEventListener('click', () => el.picker.classList.add('hidden'));

async function startShare(sourceId) {
  el.picker.classList.add('hidden');
  const q = quality();

  await window.golive.selectSource(sourceId, el.audio.checked);

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: q.width, max: q.width },
        height: { ideal: q.height, max: q.height },
        frameRate: { ideal: q.fps, max: q.fps },
      },
      audio: el.audio.checked,
    });
  } catch (err) {
    alert(`Nao consegui capturar a tela: ${err.message}`);
    return;
  }

  const track = localStream.getVideoTracks()[0];
  if (track) {
    // Diz ao encoder que isto e video em movimento (jogo/video), nao um
    // slide parado. Sem isto o Chromium prioriza nitidez e derruba o fps.
    track.contentHint = 'motion';
    // Reforca o pedido: alguns caminhos de captura ignoram as constraints
    // iniciais e entregam 30 fps caladamente.
    track.applyConstraints({ frameRate: { ideal: q.fps, max: q.fps } }).catch(() => {});
    // Se o usuario parar pela notificacao do sistema, encerramos junto.
    track.addEventListener('ended', stopShare);
  }
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) audioTrack.contentHint = 'music';

  showTile('me', 'Voce (previa)', localStream, true);

  for (const peerId of peers.keys()) await offerTo(peerId);

  signal({ type: 'broadcast-state', live: true });
  el.share.classList.add('hidden');
  el.stop.classList.remove('hidden');
  startStatsLoop();
}

function stopShare() {
  if (!localStream) return;
  localStream.getTracks().forEach((t) => t.stop());
  localStream = null;

  for (const peer of peers.values()) {
    if (!peer.outConn) continue;
    peer.outConn.close();
    peer.outConn = null;
  }

  removeTile('me');
  signal({ type: 'broadcast-state', live: false });
  el.share.classList.remove('hidden');
  el.stop.classList.add('hidden');
  stopStatsLoop();
}

el.stop.addEventListener('click', stopShare);

// --- Grade de video ----------------------------------------------------

function showTile(id, label, stream, muted = false) {
  el.grid.querySelector('.empty')?.remove();

  let tile = document.getElementById(`tile-${id}`);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'tile';
    tile.id = `tile-${id}`;
    tile.innerHTML = `<video autoplay playsinline></video><span class="tile-label"></span>`;
    tile.addEventListener('dblclick', () => tile.classList.toggle('fullscreen'));
    el.grid.appendChild(tile);
  }

  const video = tile.querySelector('video');
  // Evita reatribuir o mesmo stream (causa piscada na imagem).
  if (video.srcObject !== stream) video.srcObject = stream;
  video.muted = muted;
  tile.querySelector('.tile-label').textContent = label;
}

function removeTile(id) {
  document.getElementById(`tile-${id}`)?.remove();
  if (!el.grid.children.length) {
    el.grid.innerHTML = '<div class="empty">Ninguem transmitindo ainda.</div>';
  }
}

function renderPeers() {
  el.peerList.innerHTML = '';
  if (!peers.size) {
    el.peerList.innerHTML = '<li class="muted">so voce por aqui</li>';
    return;
  }
  for (const peer of peers.values()) {
    const li = document.createElement('li');
    const state = peer.inConn?.connectionState || peer.outConn?.connectionState;
    li.innerHTML = `
      <span class="dot ${state === 'connected' ? 'ok' : state ? 'warn' : ''}"></span>
      ${escapeHtml(peer.name)}
      ${peer.live ? '<em>ao vivo</em>' : ''}`;
    el.peerList.appendChild(li);
  }
}

// --- Estatisticas ------------------------------------------------------

let statsTimer = null;
let lastBytes = 0;
let lastAt = 0;

function startStatsLoop() {
  stopStatsLoop();
  statsTimer = setInterval(updateStats, 1000);
}

function stopStatsLoop() {
  clearInterval(statsTimer);
  statsTimer = null;
  el.stats.innerHTML = '';
}

async function updateStats() {
  let fps = 0;
  let bytes = 0;
  let rtt = 0;
  let width = 0;
  let height = 0;
  let codec = '';
  let limitation = '';
  let connections = 0;

  for (const peer of peers.values()) {
    if (!peer.outConn || peer.outConn.connectionState !== 'connected') continue;
    connections++;
    const report = await peer.outConn.getStats();
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

  const now = performance.now();
  let mbps = 0;
  if (lastAt) mbps = ((bytes - lastBytes) * 8) / ((now - lastAt) / 1000) / 1_000_000;
  lastBytes = bytes;
  lastAt = now;

  // qualityLimitationReason e o diagnostico mais util aqui: diz se quem esta
  // te segurando e a CPU, a banda da rede ou o proprio encoder.
  const motivo = {
    bandwidth: 'banda da rede insuficiente',
    cpu: 'CPU no limite',
    other: 'limite do encoder',
  }[limitation];

  el.stats.innerHTML = `
    <div class="stat"><span>enviando pra</span><b>${connections} peer(s)</b></div>
    <div class="stat"><span>resolucao</span><b>${width}x${height}</b></div>
    <div class="stat"><span>fps real</span><b class="${fps >= 50 ? 'good' : 'warn-text'}">${Math.round(fps)}</b></div>
    <div class="stat"><span>saida total</span><b>${mbps.toFixed(1)} Mbps</b></div>
    <div class="stat"><span>latencia</span><b>${rtt ? Math.round(rtt) + ' ms' : '-'}</b></div>
    <div class="stat"><span>codec</span><b>${codec || '-'}</b></div>
    ${motivo ? `<div class="stat-warn">Limitado por: ${motivo}</div>` : ''}`;
}

// --- Utilidades --------------------------------------------------------

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
