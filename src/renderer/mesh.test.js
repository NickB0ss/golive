'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createMesh, withStartBitrate, startBitrateKbps, relayKindFor, parseKind, RTC_CONFIG,
} = require('./mesh');

// SDP reduzido, mas com as armadilhas reais: secao de audio antes da de video
// (nao pode ser tocada), payload de video sem a=fmtp (VP8), payload com fmtp
// (H264) e payload auxiliar de retransmissao (rtx).
const SDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98',
  'a=rtpmap:96 VP8/90000',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rtpmap:98 H264/90000',
  'a=fmtp:98 level-asymmetry-allowed=1;profile-level-id=42e01f',
].join('\r\n');

test('start bitrate entra no fmtp existente do codec de video', () => {
  const out = withStartBitrate(SDP, 6000);
  assert.match(out, /a=fmtp:98 level-asymmetry-allowed=1;profile-level-id=42e01f;x-google-start-bitrate=6000/);
});

test('start bitrate cria fmtp pro codec que nao tem (VP8)', () => {
  const out = withStartBitrate(SDP, 6000).split('\r\n');
  const i = out.indexOf('a=rtpmap:96 VP8/90000');
  assert.equal(out[i + 1], 'a=fmtp:96 x-google-start-bitrate=6000');
});

test('nao mexe em audio nem em payload auxiliar', () => {
  const out = withStartBitrate(SDP, 6000);
  assert.match(out, /a=fmtp:111 minptime=10;useinbandfec=1(\r\n|$)/);
  assert.match(out, /a=fmtp:97 apt=96(\r\n|$)/);
  assert.doesNotMatch(out, /a=fmtp:111 .*x-google-start-bitrate/);
  assert.doesNotMatch(out, /a=fmtp:97 .*x-google-start-bitrate/);
});

test('preserva a quebra de linha do SDP original', () => {
  assert.ok(withStartBitrate(SDP, 6000).includes('\r\n'));
  assert.ok(!withStartBitrate(SDP.replace(/\r\n/g, '\n'), 6000).includes('\r'));
});

test('aplicar duas vezes nao duplica o parametro', () => {
  const once = withStartBitrate(SDP, 6000);
  assert.equal(withStartBitrate(once, 6000), once);
});

test('sdp vazio ou bitrate zero passam intactos', () => {
  assert.equal(withStartBitrate('', 6000), '');
  assert.equal(withStartBitrate(SDP, 0), SDP);
});

test('start bitrate e metade do teto, preso entre 300 kbps e 10 Mbps', () => {
  assert.equal(startBitrateKbps(12_000_000), 6000);
  assert.equal(startBitrateKbps(2_000_000), 1000);
  assert.equal(startBitrateKbps(40_000_000), 10000); // teto
  assert.equal(startBitrateKbps(100_000), 300); // piso
  assert.equal(startBitrateKbps(undefined), 300);
});

test('RTC_CONFIG tem STUN pra tentar rota direta antes de cair pra VPN', () => {
  assert.ok(RTC_CONFIG.iceServers.length > 0);
  assert.equal(RTC_CONFIG.iceTransportPolicy, 'all');
});

// --- setPeerDemand (encode sob demanda, spec de 2026-08-23 F1.3) ---
//
// Nao precisa de RTCPeerConnection: `peers` e exposto, entao da pra plantar
// um peer com uma pc falsa e exercitar so a logica de suspensao.
function fakeSender(track) {
  return {
    track,
    replaceTrack(next) {
      this.track = next;
      return Promise.resolve();
    },
  };
}

function meshWithPeer(senders) {
  const mesh = createMesh({ send() {}, onTrack() {}, onPeerState() {} });
  mesh.addPeer('7', 'Bruno');
  mesh.peers.get('7').outConns.screen = { getSenders: () => senders };
  return mesh;
}

test('suspender libera o encoder de video e nao toca no audio', () => {
  const video = fakeSender({ kind: 'video' });
  const audio = fakeSender({ kind: 'audio' });
  const mesh = meshWithPeer([video, audio]);

  assert.equal(mesh.setPeerDemand('7', 'screen', false), true);
  assert.equal(video.track, null, 'video suspenso');
  assert.notEqual(audio.track, null, 'quem minimizou ainda quer ouvir');
  assert.equal(mesh.isPeerSuspended('7', 'screen'), true);
});

test('religar devolve a track ao mesmo sender', () => {
  const video = fakeSender({ kind: 'video' });
  const mesh = meshWithPeer([video]);
  const track = { kind: 'video' };

  mesh.setPeerDemand('7', 'screen', false);
  assert.equal(mesh.setPeerDemand('7', 'screen', true, track), true);
  assert.equal(video.track, track);
  assert.equal(mesh.isPeerSuspended('7', 'screen'), false);
});

test('pedir o estado em que ja esta nao faz nada', () => {
  const video = fakeSender({ kind: 'video' });
  const mesh = meshWithPeer([video]);

  assert.equal(mesh.setPeerDemand('7', 'screen', true, { kind: 'video' }), false);
  assert.equal(mesh.setPeerDemand('7', 'screen', false), true);
  assert.equal(mesh.setPeerDemand('7', 'screen', false), false);
});

test('peer sem conexao daquele kind e ignorado, sem lancar', () => {
  const mesh = meshWithPeer([]);
  assert.equal(mesh.setPeerDemand('7', 'camera', false), false);
  assert.equal(mesh.setPeerDemand('999', 'screen', false), false);
  assert.equal(mesh.isPeerSuspended('999', 'screen'), false);
});

// --- watchersOf (lista de "quem esta assistindo" pro overlay do tile) ---

test('watchersOf exclui quem suspendeu e quem nao tem outConn daquele kind', () => {
  const mesh = createMesh({ send() {}, onTrack() {}, onPeerState() {} });
  mesh.addPeer('7', 'Bruno');
  mesh.addPeer('8', 'Carla');
  mesh.addPeer('9', 'Diego'); // sem outConn de screen -- nunca recebeu oferta
  mesh.peers.get('7').outConns.screen = { getSenders: () => [fakeSender({ kind: 'video' })] };
  mesh.peers.get('8').outConns.screen = { getSenders: () => [fakeSender({ kind: 'video' })] };

  mesh.setPeerDemand('8', 'screen', false); // Carla minimizou

  const watchers = mesh.watchersOf('screen');
  assert.deepEqual(watchers.map((w) => w.id).sort(), ['7']);
  assert.equal(watchers[0].name, 'Bruno');
});

test('watchersOf de um kind sem nenhum outConn e lista vazia', () => {
  const mesh = createMesh({ send() {}, onTrack() {}, onPeerState() {} });
  mesh.addPeer('7', 'Bruno');
  assert.deepEqual(mesh.watchersOf('camera'), []);
});

// --- F2: inStreams, relayTo, closeOut ---

test('addPeer registra joinedAt', () => {
  const mesh = createMesh({ send() {}, onTrack() {}, onPeerState() {} });
  const before = Date.now();
  mesh.addPeer('7', 'Bruno');
  const peer = mesh.peers.get('7');
  assert.ok(typeof peer.joinedAt === 'number');
  assert.ok(peer.joinedAt >= before);
});

test('closeOut fecha so a outConn daquele peer/kind, sem afetar outros', () => {
  const mesh = createMesh({ send() {}, onTrack() {}, onPeerState() {} });
  mesh.addPeer('7', 'Bruno');
  let screenClosed = false;
  let cameraClosed = false;
  mesh.peers.get('7').outConns.screen = { close: () => { screenClosed = true; } };
  mesh.peers.get('7').outConns.camera = { close: () => { cameraClosed = true; } };

  mesh.closeOut('7', 'screen');

  assert.equal(screenClosed, true);
  assert.equal(cameraClosed, false);
  assert.equal(mesh.peers.get('7').outConns.screen, null);
  assert.ok(mesh.peers.get('7').outConns.camera); // intacta
});

test('closeOut em peer ou kind sem conexao e ignorado, sem lancar', () => {
  const mesh = createMesh({ send() {}, onTrack() {}, onPeerState() {} });
  mesh.addPeer('7', 'Bruno');
  assert.doesNotThrow(() => mesh.closeOut('7', 'camera'));
  assert.doesNotThrow(() => mesh.closeOut('999', 'screen'));
});

test('relayTo sem stream recebida ainda (corrida tree x offer) devolve false, sem lancar', async () => {
  const mesh = createMesh({ send() {}, onTrack() {}, onPeerState() {} });
  mesh.addPeer('origem', 'Ana');
  const ok = await mesh.relayTo('folha', 'origem', 'screen', { bitrate: 1_000_000, fps: 30, codec: 'video/H264' });
  assert.equal(ok, false);
});

// Fake minimo de RTCPeerConnection: so o suficiente pra offerTo (chamado
// por relayTo) rodar sem lancar. RTCRtpSender.getCapabilities devolvendo
// null faz preferCodec voltar cedo (ver mesh.js), entao nao precisa
// simular codecs de verdade.
function installFakeWebRTC() {
  global.RTCRtpSender = { getCapabilities: () => null };
  global.RTCPeerConnection = class {
    constructor() {
      this.senders = [];
      this.localDescription = null;
    }
    addEventListener() {}
    close() {
      this.closed = true;
    }
    addTransceiver(track) {
      const sender = { track, getParameters: () => ({}), setParameters: () => Promise.resolve() };
      this.senders.push(sender);
      return { sender, setCodecPreferences: undefined };
    }
    createOffer() {
      return Promise.resolve({ type: 'offer', sdp: 'v=0' });
    }
    setLocalDescription(desc) {
      this.localDescription = desc;
      return Promise.resolve();
    }
    setRemoteDescription(desc) {
      this.remoteDescription = desc;
      return Promise.resolve();
    }
    createAnswer() {
      return Promise.resolve({ type: 'answer', sdp: 'v=0' });
    }
    getSenders() {
      return this.senders;
    }
  };
}

test('relayTo com stream recebida chama offerTo e manda offer pro filho', async () => {
  installFakeWebRTC();
  const sent = [];
  const mesh = createMesh({ send: (msg) => sent.push(msg), onTrack() {}, onPeerState() {} });
  mesh.addPeer('origem', 'Ana');
  mesh.addPeer('folha', 'Bruno');

  const videoTrack = { kind: 'video' };
  const fakeStream = { getTracks: () => [videoTrack], getVideoTracks: () => [videoTrack] };
  mesh.peers.get('origem').inStreams = { screen: fakeStream };

  const ok = await mesh.relayTo('folha', 'origem', 'screen', { bitrate: 1_000_000, fps: 30, codec: 'video/H264' });

  assert.equal(ok, true);
  assert.equal(videoTrack.contentHint, 'motion');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'offer');
  assert.equal(sent[0].to, 'folha');
  // Kind COMPOSTO, nao 'screen' cru: e o que impede a conexao de repasse de
  // brigar pelo slot (relayId, 'screen') com o compartilhamento proprio do
  // relay, e o que diz a folha de quem e de verdade o video.
  assert.equal(sent[0].kind, 'screen@origem');
  assert.equal(mesh.peers.get('folha').outConns['screen@origem'] != null, true);
  assert.equal(mesh.peers.get('folha').outConns.screen, undefined);

  delete global.RTCPeerConnection;
  delete global.RTCRtpSender;
});

test('relayKindFor/parseKind sao inversos, e kind cru nao tem origem', () => {
  assert.equal(relayKindFor('screen', '42'), 'screen@42');
  assert.deepEqual(parseKind('screen@42'), { baseKind: 'screen', sourceId: '42' });
  assert.deepEqual(parseKind('camera@7'), { baseKind: 'camera', sourceId: '7' });
  // Conexao direta (o caminho de sempre, com a arvore desligada): sem origem.
  assert.deepEqual(parseKind('screen'), { baseKind: 'screen', sourceId: null });
  assert.deepEqual(parseKind('camera'), { baseKind: 'camera', sourceId: null });
});

test('repasse e compartilhamento proprio do relay convivem em slots distintos (#1)', async () => {
  installFakeWebRTC();
  const sent = [];
  const mesh = createMesh({ send: (msg) => sent.push(msg), onTrack() {}, onPeerState() {} });
  mesh.addPeer('origem', 'Ana');
  mesh.addPeer('folha', 'Bruno');

  const relayedTrack = { kind: 'video' };
  mesh.peers.get('origem').inStreams = {
    screen: { getTracks: () => [relayedTrack], getVideoTracks: () => [relayedTrack] },
  };
  const ownTrack = { kind: 'video' };
  const ownStream = { getTracks: () => [ownTrack], getVideoTracks: () => [ownTrack] };
  const quality = { bitrate: 1_000_000, fps: 30, codec: 'video/H264' };

  // O relay tambem compartilha a PROPRIA tela pro mesmo filho.
  await mesh.offerTo('folha', ownStream, quality, 'screen');
  await mesh.relayTo('folha', 'origem', 'screen', quality);

  const conns = mesh.peers.get('folha').outConns;
  assert.notEqual(conns.screen, conns['screen@origem']);
  assert.deepEqual(conns.screen.getSenders().map((s) => s.track), [ownTrack]);
  assert.deepEqual(conns['screen@origem'].getSenders().map((s) => s.track), [relayedTrack]);

  delete global.RTCPeerConnection;
  delete global.RTCRtpSender;
});

test('relayTo recusa repassar uma stream cuja track ja encerrou (#9)', async () => {
  installFakeWebRTC();
  const sent = [];
  const mesh = createMesh({ send: (msg) => sent.push(msg), onTrack() {}, onPeerState() {} });
  mesh.addPeer('origem', 'Ana');
  mesh.addPeer('folha', 'Bruno');

  const dead = { kind: 'video', readyState: 'ended' };
  mesh.peers.get('origem').inStreams = {
    screen: { getTracks: () => [dead], getVideoTracks: () => [dead] },
  };

  const ok = await mesh.relayTo('folha', 'origem', 'screen', { bitrate: 1, fps: 30, codec: 'video/H264' });
  assert.equal(ok, false);
  assert.equal(sent.length, 0);

  delete global.RTCPeerConnection;
  delete global.RTCRtpSender;
});

test('trocar a inConn de um kind descarta a inStream que era dela (#9)', async () => {
  installFakeWebRTC();
  const mesh = createMesh({ send() {}, onTrack() {}, onPeerState() {} });
  mesh.addPeer('origem', 'Ana');

  await mesh.handleOffer('origem', { type: 'offer', sdp: 'v=0' }, 'screen');
  const stale = { getTracks: () => [], getVideoTracks: () => [] };
  mesh.peers.get('origem').inStreams = { screen: stale };

  // Segunda oferta do mesmo peer/kind: ensureInConn fecha a anterior. A
  // stream guardada pertencia aquela conexao e nao vale mais.
  await mesh.handleOffer('origem', { type: 'offer', sdp: 'v=0' }, 'screen');
  assert.equal(mesh.peers.get('origem').inStreams.screen, null);

  delete global.RTCPeerConnection;
  delete global.RTCRtpSender;
});

test('onPeerState recebe dir e failed no payload (F2: distinguir falha de out-conn pra relay)', () => {
  // makeConnection nao e exportado -- exercita via ensureOutConn/ensureInConn,
  // que criam RTCPeerConnection de verdade. Sem RTCPeerConnection no
  // ambiente Node, isto so roda com o fake instalado (mesmo do teste
  // anterior de relayTo).
  installFakeWebRTC();
  global.RTCPeerConnection.prototype.connectionState = 'failed';
  // Estende o fake com addEventListener que guarda o listener de
  // connectionstatechange pra disparar manualmente.
  const listeners = [];
  const OriginalCtor = global.RTCPeerConnection;
  global.RTCPeerConnection = class extends OriginalCtor {
    addEventListener(event, fn) {
      if (event === 'connectionstatechange') listeners.push(fn);
    }
  };

  const events = [];
  const mesh = createMesh({
    send() {},
    onTrack() {},
    onPeerState: (peerId, payload) => events.push({ peerId, ...payload }),
  });
  mesh.addPeer('7', 'Bruno');
  mesh.peers.get('7'); // garante que o peer existe antes de abrir a conexao
  const pc = mesh.peers.get('7').outConns.screen; // ainda nao existe -- ensureOutConn cria abaixo

  // ensureOutConn nao e exportado; usa offerTo indiretamente via relayTo
  // seria mais indireto -- em vez disso, cria a conexao via handleOffer
  // (dir 'in') que E exportado, e cobre o mesmo trecho de connectionstatechange.
  mesh.handleOffer('7', { type: 'offer', sdp: 'v=0' }, 'screen');

  assert.equal(listeners.length, 1);
  listeners[0](); // dispara connectionstatechange com pc.connectionState = 'failed'

  assert.equal(events.length, 1);
  assert.equal(events[0].dir, 'in');
  assert.equal(events[0].failed, true);
  assert.equal(events[0].removedTile, true);

  delete global.RTCPeerConnection;
  delete global.RTCRtpSender;
});
