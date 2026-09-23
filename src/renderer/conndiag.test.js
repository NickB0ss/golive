'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const conndiag = require('./conndiag');

/** Monta um relatorio de getStats (um Map por id, como o do navegador). */
function report(stats) {
  return new Map(stats.map((s) => [s.id, s]));
}

function parSelecionado({ local = '26.1.2.3', remote = '26.4.5.6', localType = 'host', remoteType = 'host', ...pair } = {}) {
  return [
    { id: 'T1', type: 'transport', selectedCandidatePairId: 'CP1' },
    { id: 'CP1', type: 'candidate-pair', localCandidateId: 'L1', remoteCandidateId: 'R1', nominated: true, state: 'succeeded', timestamp: 100000, ...pair },
    { id: 'L1', type: 'local-candidate', candidateType: localType, protocol: 'udp', address: local },
    { id: 'R1', type: 'remote-candidate', candidateType: remoteType, protocol: 'udp', address: remote },
  ];
}

test('networkOf classifica a rede sem devolver o endereco', () => {
  assert.equal(conndiag.networkOf('26.10.20.30'), 'radmin');
  assert.equal(conndiag.networkOf('100.64.0.1'), 'tailscale');
  assert.equal(conndiag.networkOf('100.127.255.254'), 'tailscale');
  assert.equal(conndiag.networkOf('100.128.0.1'), 'internet', 'fora do 100.64/10 nao e CGNAT');
  assert.equal(conndiag.networkOf('fd7a:115c:a1e0::1'), 'tailscale');
  assert.equal(conndiag.networkOf('192.168.0.10'), 'lan');
  assert.equal(conndiag.networkOf('172.20.1.1'), 'lan');
  assert.equal(conndiag.networkOf('172.32.1.1'), 'internet');
  assert.equal(conndiag.networkOf('10.0.0.1'), 'lan');
  assert.equal(conndiag.networkOf('127.0.0.1'), 'loopback');
  assert.equal(conndiag.networkOf('187.10.20.30'), 'internet');
  assert.equal(conndiag.networkOf('2804:14c::1'), 'internet');
  assert.equal(conndiag.networkOf('abc123.local'), 'mdns');
  assert.equal(conndiag.networkOf(''), 'oculto');
  assert.equal(conndiag.networkOf(undefined), 'oculto');
  assert.equal(conndiag.networkOf('999.1.1.1'), 'oculto');
});

test('readSelectedPair segue o transport ate o par e resume os dois lados', () => {
  const pair = conndiag.readSelectedPair(report([
    // Um par nomeado que NAO e o selecionado: o transport manda.
    { id: 'CP0', type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'L0', remoteCandidateId: 'R0' },
    { id: 'L0', type: 'local-candidate', candidateType: 'srflx', protocol: 'udp', address: '187.1.1.1' },
    ...parSelecionado({ remote: '100.70.1.2', remoteType: 'host', currentRoundTripTime: 0.012, availableOutgoingBitrate: 38_500_000, bytesReceived: 5000, responsesReceived: 7, lastPacketReceivedTimestamp: 99800 }),
  ]));
  assert.deepEqual(pair.local, { type: 'host', protocol: 'udp', relayProtocol: null, net: 'radmin' });
  assert.equal(pair.remote.net, 'tailscale');
  assert.equal(pair.rttMs, 12);
  assert.equal(pair.lastPacketAgeMs, 200);
  assert.equal(pair.bytesReceived, 5000);
  assert.equal(pair.responsesReceived, 7);
  assert.equal(conndiag.routeKey(pair), 'host/radmin udp -> host/tailscale');
  assert.equal(conndiag.describeRoute(pair), 'host/radmin udp -> host/tailscale, rtt 12 ms, banda estimada 38,5 Mbps');
  assert.ok(!JSON.stringify(pair).includes('26.1.2.3'), 'nenhum IP sai daqui');
});

test('sem transport, cai no par nomeado que deu certo; sem par, null', () => {
  const pair = conndiag.readSelectedPair(report([
    { id: 'CPx', type: 'candidate-pair', nominated: true, state: 'in-progress', localCandidateId: 'L1', remoteCandidateId: 'R1' },
    { id: 'CPy', type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'L1', remoteCandidateId: 'R1' },
    { id: 'L1', type: 'local-candidate', candidateType: 'srflx', protocol: 'udp', address: '187.1.1.1' },
    { id: 'R1', type: 'remote-candidate', candidateType: 'prflx', protocol: 'udp', address: '200.1.1.1' },
  ]));
  assert.equal(pair.state, 'succeeded');
  assert.equal(conndiag.routeKey(pair), 'srflx/internet udp -> prflx/internet');
  assert.equal(conndiag.readSelectedPair(report([])), null);
  assert.equal(conndiag.readSelectedPair(null), null);
  assert.equal(conndiag.describeRoute(null), 'sem par de candidatos selecionado');
});

test('a chave da rota nao muda com o RTT, so com o caminho', () => {
  const a = conndiag.readSelectedPair(report(parSelecionado({ currentRoundTripTime: 0.01 })));
  const b = conndiag.readSelectedPair(report(parSelecionado({ currentRoundTripTime: 0.2 })));
  const c = conndiag.readSelectedPair(report(parSelecionado({ local: '187.1.1.1', localType: 'srflx' })));
  assert.equal(conndiag.routeKey(a), conndiag.routeKey(b));
  assert.notEqual(conndiag.routeKey(a), conndiag.routeKey(c));
});

function amostra({ pcState = 'connected', rtp = 0, frames = 0, key = 0, pli = 0, nack = 0, pairBytes = 0, responses = 0, lastPacketAgo = 100, pairState = 'succeeded' } = {}) {
  return conndiag.readStallSample(report([
    { id: 'IN', type: 'inbound-rtp', kind: 'video', bytesReceived: rtp, packetsReceived: rtp / 1000, framesDecoded: frames, keyFramesDecoded: key, pliCount: pli, nackCount: nack, freezeCount: 0, packetsLost: 0 },
    { id: 'AU', type: 'inbound-rtp', kind: 'audio', bytesReceived: 99999 },
    ...parSelecionado({ state: pairState, bytesReceived: pairBytes, responsesReceived: responses, lastPacketReceivedTimestamp: 100000 - lastPacketAgo, availableOutgoingBitrate: 3e6 }),
  ]), pcState);
}

test('readStallSample soma so o video e traz o par junto', () => {
  const s = amostra({ rtp: 5000, frames: 30, key: 1, pli: 2, nack: 3 });
  assert.equal(s.rtpBytes, 5000, 'audio nao conta como imagem chegando');
  assert.equal(s.framesDecoded, 30);
  assert.equal(s.keyFramesDecoded, 1);
  assert.equal(s.pliCount, 2);
  assert.equal(s.nackCount, 3);
  assert.equal(s.pcState, 'connected');
  assert.equal(s.pair.state, 'succeeded');
  const vazio = conndiag.readStallSample(null, 'failed');
  assert.equal(vazio.pair, null);
  assert.equal(vazio.pcState, 'failed');
});

test('nada chegando no par (nem STUN) e rede', () => {
  const prev = amostra({ rtp: 1000, frames: 10, pairBytes: 2000, responses: 3 });
  const cur = amostra({ rtp: 1000, frames: 10, pairBytes: 2000, responses: 3, lastPacketAgo: 7000 });
  assert.equal(conndiag.classifyStall(prev, cur).cause, 'rede');
});

test('PeerConnection fora de connected ou par falho e rede, mesmo sem amostra anterior', () => {
  assert.equal(conndiag.classifyStall(null, amostra({ pcState: 'disconnected' })).cause, 'rede');
  assert.equal(conndiag.classifyStall(null, amostra({ pairState: 'failed' })).cause, 'rede');
  assert.equal(conndiag.classifyStall(null, amostra({ lastPacketAgo: 9000 })).cause, 'rede');
  assert.equal(conndiag.classifyStall(null, amostra({ lastPacketAgo: 500 })).cause, 'desconhecido');
  assert.equal(conndiag.classifyStall(null, null).cause, 'desconhecido');
});

test('caminho vivo sem RTP de video e a origem que parou', () => {
  const prev = amostra({ rtp: 1000, frames: 10, pairBytes: 2000, responses: 3 });
  const soRtcp = amostra({ rtp: 1000, frames: 10, pairBytes: 2600, responses: 3, lastPacketAgo: 7000 });
  assert.equal(conndiag.classifyStall(prev, soRtcp).cause, 'origem');
  const soStun = amostra({ rtp: 1000, frames: 10, pairBytes: 2000, responses: 4, lastPacketAgo: 7000 });
  assert.equal(conndiag.classifyStall(prev, soStun).cause, 'origem');
});

test('RTP chegando sem quadro decodificado e decoder; decodificando e pintura', () => {
  const prev = amostra({ rtp: 1000, frames: 10 });
  assert.equal(conndiag.classifyStall(prev, amostra({ rtp: 90000, frames: 10, pli: 4 })).cause, 'decoder');
  assert.equal(conndiag.classifyStall(prev, amostra({ rtp: 90000, frames: 200 })).cause, 'pintura');
});

test('contador que andou pra tras (conexao refeita) conta como nada chegou', () => {
  const prev = amostra({ rtp: 90000, frames: 500, pairBytes: 99999, responses: 50 });
  const cur = amostra({ rtp: 0, frames: 0, pairBytes: 0, responses: 0, lastPacketAgo: 8000 });
  const r = conndiag.classifyStall(prev, cur);
  assert.equal(r.cause, 'rede');
  assert.equal(r.deltas.rtpBytes, 0);
  assert.equal(r.deltas.framesDecoded, 0);
});

test('o aviso do tile diz de quem e a culpa, e o log carrega os numeros', () => {
  assert.equal(conndiag.stallNotice('rede', 'Ana'), 'Sem contato com o PC de Ana. Tentando de novo…');
  assert.equal(conndiag.stallNotice('origem', 'Ana'), 'Ana parou de enviar imagem. Tentando de novo…');
  assert.equal(conndiag.stallNotice('decoder', 'Ana'), 'Recuperando a imagem…');
  assert.equal(conndiag.stallNotice('pintura', 'Ana'), 'Recuperando a imagem…');
  assert.equal(conndiag.stallNotice('desconhecido', 'Ana'), 'A imagem parou. Tentando de novo…');
  assert.equal(conndiag.stallNotice('rede', 'Ana', { gaveUp: true }), 'Sem contato com o PC de Ana.');
  assert.equal(conndiag.stallNotice('decoder', 'Ana', { gaveUp: true }), 'A imagem de Ana não voltou.');

  const prev = amostra({ rtp: 1000, frames: 10 });
  const cur = amostra({ rtp: 90000, frames: 10, pli: 4, key: 0 });
  const linha = conndiag.describeStall(conndiag.classifyStall(prev, cur), cur, 6000);
  assert.match(linha, /^video chegando sem decodificar/);
  assert.match(linha, /RTP \+89000 B em 6s/);
  assert.match(linha, /PLI \+4/);
  assert.match(linha, /pc connected, par succeeded, ultimo pacote ha 0\.1s/);
  assert.match(linha, /rota host\/radmin udp -> host\/radmin$/, 'sem a banda de subida de quem assiste');
  assert.ok(!linha.includes('26.'), 'nenhum IP no log');
});
