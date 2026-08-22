'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withStartBitrate, startBitrateKbps, RTC_CONFIG } = require('./mesh');

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
