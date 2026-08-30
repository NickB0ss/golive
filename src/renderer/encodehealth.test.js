'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSoftwareEncoder, summarizeScreenEncodeHealth } = require('./encodehealth');

// Uma linha de sender como updateStats monta: peer x kind + amostra + taxas.
function row(kind, encoder, msPerFrame, limitation) {
  return { peerId: '2', kind, name: '#2', encoder, msPerFrame, limitation: limitation || '' };
}

test('isSoftwareEncoder: nomes de CPU do Chromium', () => {
  assert.equal(isSoftwareEncoder('libvpx'), true);
  assert.equal(isSoftwareEncoder('SimulcastEncoderAdapter (libvpx, libvpx)'), true);
  assert.equal(isSoftwareEncoder('OpenH264'), true);
  assert.equal(isSoftwareEncoder('ExternalEncoder'), false);
  assert.equal(isSoftwareEncoder('NvCodecH264Encoder'), false);
  assert.equal(isSoftwareEncoder(''), false);
  assert.equal(isSoftwareEncoder(null), false);
});

// A regressao: a camera e sempre VP8/libvpx (qualityFor em app.js a forca),
// entao ela NAO pode arrastar softwareEncoder da tela pra true -- era isso
// que derrubava a escada global pra 720p30 e nao deixava recuperar.
test('camera libvpx nao contamina a saude de encode da tela', () => {
  const health = summarizeScreenEncodeHealth([
    row('screen', 'NvCodecH264Encoder', 6),
    row('camera', 'libvpx', 3),
  ]);
  assert.equal(health.softwareEncoder, false);
  assert.equal(health.msPerFrame, 6);
});

test('tela em software e reportada como software', () => {
  const health = summarizeScreenEncodeHealth([row('screen', 'openh264', 22)]);
  assert.equal(health.softwareEncoder, true);
});

test('sem linha de tela (so camera) e null -- nao "saudavel"', () => {
  assert.equal(summarizeScreenEncodeHealth([row('camera', 'libvpx', 3)]), null);
  assert.equal(summarizeScreenEncodeHealth([]), null);
});

test('conexao de repasse (screen@origem) conta como tela', () => {
  const health = summarizeScreenEncodeHealth([row('screen@9', 'libvpx', 20)]);
  assert.equal(health.softwareEncoder, true);
  assert.equal(health.msPerFrame, 20);
});

test('msPerFrame e o MAX entre os senders de tela, nao a soma', () => {
  const health = summarizeScreenEncodeHealth([
    row('screen', 'openh264', 9),
    row('screen', 'openh264', 8),
    row('screen@9', 'openh264', 10),
    row('camera', 'libvpx', 99),
  ]);
  assert.equal(health.msPerFrame, 10);
});

test('cpuLimited quando algum sender de tela tem qualityLimitationReason=cpu', () => {
  assert.equal(summarizeScreenEncodeHealth([row('screen', 'openh264', 9, 'bandwidth')]).cpuLimited, false);
  assert.equal(summarizeScreenEncodeHealth([
    row('screen', 'openh264', 9, 'bandwidth'),
    row('screen@9', 'openh264', 30, 'cpu'),
  ]).cpuLimited, true);
});

test('linha de tela sem msPerFrame -> msPerFrame null, mas ainda classifica encoder', () => {
  const health = summarizeScreenEncodeHealth([row('screen', 'libvpx', null)]);
  assert.equal(health.softwareEncoder, true);
  assert.equal(health.msPerFrame, null);
});
