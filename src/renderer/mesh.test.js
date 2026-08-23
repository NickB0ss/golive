'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMesh, withStartBitrate, startBitrateKbps, RTC_CONFIG } = require('./mesh');

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
