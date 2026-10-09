'use strict';

(function (root) {
  const numeric = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const video = (s) => (s.kind || s.mediaType) === 'video';
  const primaryCodec = (s) => /^video\//i.test(s.mimeType || '')
    && !/^video\/(rtx|red|ulpfec|flexfec)/i.test(s.mimeType);

  // Referencia explicita manda. Sem referencia, somente um candidato e
  // inequivoco; pegar o ultimo codec/par de um Map mistura streams.
  function referenced(stats, rtp, field, predicate) {
    const refs = rtp.map((s) => s[field]).filter((id) => id != null);
    if (refs.length) {
      const found = stats.filter((s) => refs.includes(s.id) && predicate(s));
      return found.length === 1 ? found[0] : null;
    }
    const found = stats.filter(predicate);
    return found.length === 1 ? found[0] : null;
  }

  // Soma somente se todos os RTPs observados oferecem o campo: um parcial
  // nao e o total da conexao. Zero reportado continua sendo zero.
  function aggregate(rtp, field, mode = 'sum') {
    const values = rtp.map((s) => numeric(s[field]));
    if (!values.length || values.some((v) => v == null)) return null;
    return mode === 'max' ? Math.max(...values) : values.reduce((a, b) => a + b, 0);
  }

  function readSenderReport(report) {
    const stats = [];
    report?.forEach((s) => stats.push(s));
    const rtp = stats.filter((s) => s.type === 'outbound-rtp' && video(s) && !s.isRemote);
    const codec = referenced(stats, rtp, 'codecId', (s) => s.type === 'codec' && primaryCodec(s));
    const transport = referenced(stats, rtp, 'transportId', (s) => s.type === 'transport');
    const selected = stats.filter((s) => s.type === 'candidate-pair' && s.selected === true);
    const hasTransportRef = rtp.some((s) => s.transportId != null);
    const pair = transport?.selectedCandidatePairId != null
      ? stats.find((s) => s.id === transport.selectedCandidatePairId && s.type === 'candidate-pair')
      : hasTransportRef && !transport ? null
        : selected.length ? selected.length === 1 ? selected[0] : null
          : referenced(stats, [], '', (s) => s.type === 'candidate-pair'
            && s.nominated && (!s.state || s.state === 'succeeded'));
    const remote = referenced(stats, rtp, 'remoteId', (s) => s.type === 'remote-inbound-rtp' && video(s));
    const source = referenced(stats, rtp, 'mediaSourceId', (s) => s.type === 'media-source' && video(s));
    const impls = [...new Set(rtp.map((s) => s.encoderImplementation).filter(Boolean))];
    const reasons = rtp.map((s) => s.qualityLimitationReason).filter((s) => s && s !== 'none');
    const efficiency = rtp.map((s) => s.powerEfficientEncoder);
    return {
      fps: aggregate(rtp, 'framesPerSecond', 'max'),
      captureFps: numeric(source?.framesPerSecond),
      bytesSent: aggregate(rtp, 'bytesSent'),
      width: aggregate(rtp, 'frameWidth', 'max'), height: aggregate(rtp, 'frameHeight', 'max'),
      codec: codec?.mimeType.split('/')[1] || null,
      limitation: reasons.includes('cpu') ? 'cpu' : reasons[0] || null,
      encoder: impls.length === 1 ? impls[0] : null,
      powerEfficient: efficiency.length && efficiency.every((v) => typeof v === 'boolean')
        ? efficiency.every(Boolean) : null,
      totalEncodeTime: aggregate(rtp, 'totalEncodeTime'), framesEncoded: aggregate(rtp, 'framesEncoded'),
      framesSent: aggregate(rtp, 'framesSent'),
      rtt: numeric(pair?.currentRoundTripTime) == null ? null : pair.currentRoundTripTime * 1000,
      availableBps: numeric(pair?.availableOutgoingBitrate),
      packetsLostNet: numeric(remote?.packetsLost), fractionLost: numeric(remote?.fractionLost),
      rtpIds: rtp.map((s) => s.id || s.ssrc || '').sort().join('|'),
    };
  }

  function delta(cur, prev, field) {
    const a = numeric(cur?.[field]), b = numeric(prev?.[field]);
    return a == null || b == null || a < b ? null : a - b;
  }

  function deriveRates(cur, prev, dtMs) {
    const empty = { mbps: null, msPerFrame: null };
    if (!prev || !cur || !Number.isFinite(dtMs) || !(dtMs > 0) || cur.rtpIds !== prev.rtpIds) return empty;
    const fields = ['bytesSent', 'framesEncoded', 'totalEncodeTime'];
    if (fields.some((k) => numeric(cur[k]) != null && numeric(prev[k]) != null && cur[k] < prev[k])) return empty;
    const bytes = delta(cur, prev, 'bytesSent');
    const frames = delta(cur, prev, 'framesEncoded');
    const time = delta(cur, prev, 'totalEncodeTime');
    return {
      mbps: bytes == null ? null : bytes * 8 / dtMs / 1000,
      msPerFrame: frames > 0 && time != null ? time * 1000 / frames : null,
    };
  }

  // A identidade real da PC e a geracao. Uma reconexao com a mesma chave
  // textual nunca herda acumulados; WeakMap libera PCs encerradas.
  function createTracker() {
    let connections = new WeakMap();
    return {
      rates(key, pc, sample, atMs) {
        if (!pc) return { mbps: null, msPerFrame: null };
        let kinds = connections.get(pc);
        if (!kinds) connections.set(pc, kinds = new Map());
        const prev = kinds.get(key);
        kinds.set(key, { sample, atMs });
        return deriveRates(sample, prev?.sample, atMs - prev?.atMs);
      },
      clear() { connections = new WeakMap(); },
    };
  }
  const api = { readSenderReport, deriveRates, createTracker, referenced, aggregate, numeric, delta, primaryCodec };
  root.GoLive = root.GoLive || {};
  root.GoLive.txstats = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
