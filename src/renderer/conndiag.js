// src/renderer/conndiag.js
'use strict';

// Diagnostico de conexao a partir do getStats: por qual ROTA cada conexao
// anda (H7) e, quando uma tela assistida congela, de quem e a culpa (H10).
// Ver docs/2026-09-23-analise-transmissao-hipoteses.md.
//
// Puro (so numeros e strings do relatorio), pra ficar testavel sem WebRTC.
// Quem mede e loga e o app.js.
(function (root) {
  // ---------- Rota (H7) ----------

  function ipv4Parts(address) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
    if (!m) return null;
    const parts = m.slice(1).map(Number);
    return parts.every((n) => n <= 255) ? parts : null;
  }

  /** Rede de um endereco de candidato, sem o endereco. O log de quem assiste
   * nao carrega IP (mesma regra do log do servidor), mas "a conexao anda
   * pela Radmin ou pela internet" e justamente o que a H7 precisa saber. */
  function networkOf(address) {
    const a = String(address || '').trim().toLowerCase();
    if (!a) return 'oculto';
    if (a.endsWith('.local')) return 'mdns';
    const v4 = ipv4Parts(a);
    if (v4) {
      const [o1, o2] = v4;
      if (o1 === 26) return 'radmin';
      if (o1 === 100 && o2 >= 64 && o2 <= 127) return 'tailscale';
      if (o1 === 127) return 'loopback';
      if (o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168)) return 'lan';
      if (o1 === 169 && o2 === 254) return 'link-local';
      return 'internet';
    }
    if (a.includes(':')) {
      if (a.startsWith('fd7a:115c:a1e0:')) return 'tailscale';
      if (a === '::1') return 'loopback';
      if (a.startsWith('fe80:')) return 'link-local';
      if (/^f[cd]/.test(a)) return 'lan';
      return 'internet';
    }
    return 'oculto';
  }

  function candidateSummary(stat) {
    if (!stat) return null;
    return {
      type: stat.candidateType || '?',
      protocol: stat.protocol || '?',
      // relayProtocol so existe em candidato TURN; o app nao usa TURN hoje,
      // mas se um dia usar, "relay por tcp" e o que importa no log.
      relayProtocol: stat.relayProtocol || null,
      net: networkOf(stat.address ?? stat.ip),
    };
  }

  /** O par de candidatos que esta carregando a midia. O `transport` diz qual
   * e (`selectedCandidatePairId`); sem ele, cai no par nomeado que deu certo. */
  function readSelectedPair(report) {
    if (!report) return null;
    const byId = new Map();
    let selectedId = null;
    report.forEach((stat) => {
      byId.set(stat.id, stat);
      if (stat.type === 'transport' && stat.selectedCandidatePairId) selectedId = stat.selectedCandidatePairId;
    });
    let pair = selectedId ? byId.get(selectedId) : null;
    if (!pair) {
      report.forEach((stat) => {
        if (!pair && stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded') pair = stat;
      });
    }
    if (!pair) return null;
    return {
      state: pair.state || '',
      bytesReceived: pair.bytesReceived || 0,
      bytesSent: pair.bytesSent || 0,
      responsesReceived: pair.responsesReceived || 0,
      // Idade do ultimo pacote no relogio do proprio relatorio: os dois
      // timestamps vem do mesmo lugar, a conta nao depende do nosso relogio.
      lastPacketAgeMs: pair.lastPacketReceivedTimestamp && pair.timestamp
        ? Math.max(0, pair.timestamp - pair.lastPacketReceivedTimestamp)
        : null,
      rttMs: pair.currentRoundTripTime != null ? pair.currentRoundTripTime * 1000 : null,
      availableOutgoingBps: pair.availableOutgoingBitrate ?? null,
      local: candidateSummary(byId.get(pair.localCandidateId)),
      remote: candidateSummary(byId.get(pair.remoteCandidateId)),
    };
  }

  function sideText(c) {
    if (!c) return '?';
    const relay = c.relayProtocol ? `/turn-${c.relayProtocol}` : '';
    return `${c.type}/${c.net}${relay}`;
  }

  /** Chave estavel da rota: muda so quando o caminho muda, nao a cada
   * amostra de RTT -- e o que decide se vale uma linha nova no log. */
  function routeKey(pair) {
    if (!pair) return '';
    return `${sideText(pair.local)} ${pair.local?.protocol || '?'} -> ${sideText(pair.remote)}`;
  }

  /** "host/radmin udp -> host/radmin, rtt 12 ms, banda estimada 38,5 Mbps" */
  function describeRoute(pair) {
    if (!pair) return 'sem par de candidatos selecionado';
    const parts = [routeKey(pair)];
    if (pair.rttMs != null) parts.push(`rtt ${Math.round(pair.rttMs)} ms`);
    if (pair.availableOutgoingBps != null) {
      parts.push(`banda estimada ${(pair.availableOutgoingBps / 1e6).toFixed(1).replace('.', ',')} Mbps`);
    }
    return parts.join(', ');
  }

  // ---------- Congelamento (H10) ----------

  /** Uma amostra do que chega por UMA conexao de entrada. `pcState` e o
   * connectionState da RTCPeerConnection: numa rede morta o relatorio ainda
   * sai, mas o estado ja diz boa parte da historia. */
  function readStallSample(report, pcState = '') {
    const sample = {
      pcState: pcState || '',
      rtpBytes: 0,
      packetsReceived: 0,
      packetsLost: 0,
      framesDecoded: 0,
      keyFramesDecoded: 0,
      pliCount: 0,
      nackCount: 0,
      freezeCount: 0,
      pair: null,
    };
    if (!report) return sample;
    report.forEach((stat) => {
      if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
        sample.rtpBytes += stat.bytesReceived || 0;
        sample.packetsReceived += stat.packetsReceived || 0;
        sample.packetsLost += stat.packetsLost || 0;
        sample.framesDecoded += stat.framesDecoded || 0;
        sample.keyFramesDecoded += stat.keyFramesDecoded || 0;
        sample.pliCount += stat.pliCount || 0;
        sample.nackCount += stat.nackCount || 0;
        sample.freezeCount += stat.freezeCount || 0;
      }
    });
    sample.pair = readSelectedPair(report);
    return sample;
  }

  // Contadores do WebRTC podem andar pra tras (conexao refeita no meio da
  // janela): delta negativo vira 0, que e o que "nada chegou" significa.
  function delta(cur, prev, field) {
    return Math.max(0, (cur?.[field] || 0) - (prev?.[field] || 0));
  }

  const DEAD_PC_STATES = new Set(['disconnected', 'failed', 'closed']);
  // Sem amostra anterior, so a idade do ultimo pacote separa rede de resto.
  // O Chromium manda checagem de consentimento STUN a cada ~5 s mesmo sem
  // midia: mais que isso sem NENHUM pacote e rede.
  const NETWORK_SILENCE_MS = 6000;

  /** Classifica um congelamento comparando duas amostras da mesma entrada
   * (`prev` a mais antiga que se tem da janela do congelamento).
   *
   *   - rede:     nada chega (nem RTP, nem RTCP, nem resposta STUN), ou a
   *               PeerConnection ja saiu de `connected`;
   *   - origem:   o caminho esta vivo (RTCP/STUN chegando) mas nao vem RTP
   *               de video -- quem transmite parou de codificar/enviar;
   *   - decoder:  RTP chegando e nenhum quadro decodificado -- esperando
   *               quadro-chave, ou decoder travado;
   *   - pintura:  quadros sendo decodificados e o <video> sem exibir.
   *
   * Devolve { cause, deltas } com os numeros que sustentam o veredicto, pro
   * log mostrar o porque. */
  function classifyStall(prev, cur) {
    if (!cur) return { cause: 'desconhecido', deltas: null };
    const pair = cur.pair;
    const deltas = {
      rtpBytes: delta(cur, prev, 'rtpBytes'),
      framesDecoded: delta(cur, prev, 'framesDecoded'),
      keyFramesDecoded: delta(cur, prev, 'keyFramesDecoded'),
      pliCount: delta(cur, prev, 'pliCount'),
      nackCount: delta(cur, prev, 'nackCount'),
      freezeCount: delta(cur, prev, 'freezeCount'),
      packetsLost: delta(cur, prev, 'packetsLost'),
      pairBytes: delta(pair, prev?.pair, 'bytesReceived'),
      pairResponses: delta(pair, prev?.pair, 'responsesReceived'),
    };
    if (DEAD_PC_STATES.has(cur.pcState) || pair?.state === 'failed') return { cause: 'rede', deltas };
    if (!prev) {
      if (pair?.lastPacketAgeMs != null && pair.lastPacketAgeMs >= NETWORK_SILENCE_MS) return { cause: 'rede', deltas };
      return { cause: 'desconhecido', deltas };
    }
    if (deltas.rtpBytes > 0) {
      return { cause: deltas.framesDecoded > 0 ? 'pintura' : 'decoder', deltas };
    }
    // So o que chegou DENTRO da janela prova que o caminho esta vivo: com a
    // origem parada o RTCP continua (medido no laboratorio: +540 B em 6 s).
    // A idade do ultimo pacote nao serve aqui -- o vigia pode agir poucos
    // segundos depois da queda, com o ultimo pacote ainda "recente".
    const pathAlive = deltas.pairBytes > 0 || deltas.pairResponses > 0;
    return { cause: pathAlive ? 'origem' : 'rede', deltas };
  }

  /** Texto do aviso no tile (D5). `nome` e quem transmite. Com `gaveUp`
   * o vigia ja esgotou as tentativas: prometer "tentando de novo" seria
   * mentira. */
  function stallNotice(cause, nome, { gaveUp = false } = {}) {
    if (gaveUp) {
      return cause === 'rede' ? `Sem contato com o PC de ${nome}.` : `A imagem de ${nome} não voltou.`;
    }
    switch (cause) {
      case 'rede': return `Sem contato com o PC de ${nome}. Tentando de novo…`;
      case 'origem': return `${nome} parou de enviar imagem. Tentando de novo…`;
      case 'decoder':
      case 'pintura': return 'Recuperando a imagem…';
      default: return 'A imagem parou. Tentando de novo…';
    }
  }

  const CAUSE_LOG = {
    rede: 'rede (nada chegando)',
    origem: 'origem parou de enviar video (caminho vivo)',
    decoder: 'video chegando sem decodificar (quadro-chave/decoder)',
    pintura: 'quadros decodificados sem aparecer na tela',
    desconhecido: 'sem estatistica suficiente',
  };

  /** Linha de log com o veredicto e os numeros que o sustentam. */
  function describeStall({ cause, deltas }, cur, windowMs) {
    const parts = [CAUSE_LOG[cause] || cause];
    if (deltas) {
      const s = windowMs ? ` em ${Math.round(windowMs / 1000)}s` : '';
      parts.push(`RTP +${deltas.rtpBytes} B${s}, par ICE +${deltas.pairBytes} B / +${deltas.pairResponses} respostas STUN`);
      parts.push(`quadros +${deltas.framesDecoded} (chave +${deltas.keyFramesDecoded}), PLI +${deltas.pliCount}, NACK +${deltas.nackCount}, perdidos +${deltas.packetsLost}, congelamentos +${deltas.freezeCount}`);
    }
    if (cur) {
      const age = cur.pair?.lastPacketAgeMs;
      parts.push(`pc ${cur.pcState || '?'}, par ${cur.pair?.state || 'ausente'}${age != null ? `, ultimo pacote ha ${(age / 1000).toFixed(1)}s` : ''}`);
      // Amostra de ENTRADA: a banda estimada do par seria a de subida de
      // quem assiste, que nao explica congelamento nenhum.
      parts.push(`rota ${describeRoute(cur.pair && { ...cur.pair, availableOutgoingBps: null })}`);
    }
    return parts.join(' | ');
  }

  const api = {
    networkOf,
    readSelectedPair,
    routeKey,
    describeRoute,
    readStallSample,
    classifyStall,
    stallNotice,
    describeStall,
    NETWORK_SILENCE_MS,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.conndiag = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
