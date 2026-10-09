'use strict';

/*
 * Avaliacao de um cenario: transforma os dados BRUTOS do cliente (passos,
 * amostras, stats do servidor) e o fechamento da SFU em uma lista de
 * verificacoes explicitas. Puro: roda no main, nos testes e em qualquer Node.
 *
 * Estados de uma verificacao:
 *   passed          criterio cumprido
 *   failed          criterio nao cumprido
 *   warning         cumprido com ressalva explicita (ex.: fallback VP8)
 *   not-applicable  nao se aplica a este cenario, com o motivo escrito
 * Nenhuma verificacao e omitida: cenario sem dado vira failed, nao passed.
 */

const M = require('../renderer/metrics');

const LOOPBACK = ['127.0.0.1', '::1'];

function check(id, status, detail) {
  return { id, status, detail };
}

function round(v, digits = 2) {
  return typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(digits)) : null;
}

function lastNonNull(list) {
  for (let i = list.length - 1; i >= 0; i -= 1) if (list[i]) return list[i];
  return null;
}

function mimeKey(mime) {
  return String(mime || '').toLowerCase();
}

/** Resumo de um consumidor entre os indices de amostra [from, to]. */
function consumerWindow(samples, index, from, to) {
  const pts = [];
  for (let i = from; i <= to && i < samples.length; i += 1) {
    const c = samples[i].consumers[index];
    if (c) pts.push({ t: samples[i].t, v: c.v, meta: c });
  }
  if (pts.length < 2) return null;
  const w = M.windowBetween(pts[0], pts[pts.length - 1], M.RECEIVER_FIELDS);
  if (!w) return null;
  const last = pts[pts.length - 1].meta;
  return {
    seconds: round(w.seconds),
    framesDecoded: w.deltas.framesDecoded,
    framesReceived: w.deltas.framesReceived,
    framesDropped: w.deltas.framesDropped,
    packetsReceived: w.deltas.packetsReceived,
    packetsLost: w.deltas.packetsLost,
    keyFramesDecoded: w.deltas.keyFramesDecoded,
    freezeCount: w.deltas.freezeCount,
    bytesReceived: w.deltas.bytesReceived,
    fps: round(w.perSec.framesDecoded),
    kbps: w.perSec.bytesReceived === null ? null : round((w.perSec.bytesReceived * 8) / 1000, 1),
    frameWidth: last.frameWidth,
    frameHeight: last.frameHeight,
    codec: last.codec,
    decoderImplementation: last.decoderImplementation ?? null,
    jitterMs: last.jitter === null || last.jitter === undefined ? null : round(last.jitter * 1000),
  };
}

function senderWindow(samples) {
  const pts = samples.filter((s) => s.sender).map((s) => ({ t: s.t, v: s.sender.v, meta: s.sender }));
  if (pts.length < 2) return null;
  const w = M.windowBetween(pts[0], pts[pts.length - 1], M.SENDER_FIELDS);
  if (!w) return null;
  const last = pts[pts.length - 1].meta;
  return {
    seconds: round(w.seconds),
    framesEncoded: w.deltas.framesEncoded,
    packetsSent: w.deltas.packetsSent,
    fps: round(w.perSec.framesEncoded),
    kbps: w.perSec.bytesSent === null ? null : round((w.perSec.bytesSent * 8) / 1000, 1),
    frameWidth: last.frameWidth,
    frameHeight: last.frameHeight,
    qualityLimitationReason: last.qualityLimitationReason,
    // Sem captura ativa o Chromium costuma omitir isto; null = desconhecido, NAO "software".
    encoderImplementation: last.encoderImplementation ?? null,
    codec: last.codec,
    maxStreams: Math.max(...pts.map((p) => p.meta.streams || 0)),
  };
}

/** Contadores RTP do servidor (producer: inbound; consumer: outbound). */
function serverCounters(snapshot) {
  if (!snapshot) return null;
  const prodStat = Array.isArray(snapshot.producer?.stats) ? snapshot.producer.stats[0] : null;
  const consumers = {};
  for (const c of snapshot.consumers || []) {
    const out = (c.stats || []).find((s) => s.type === 'outbound-rtp') || c.stats?.[0];
    if (out) consumers[c.peerId] = { id: c.id, packetCount: out.packetCount ?? null, byteCount: out.byteCount ?? null, type: c.type };
  }
  return {
    producer: prodStat ? { packetCount: prodStat.packetCount ?? null, byteCount: prodStat.byteCount ?? null } : null,
    consumers,
    counts: snapshot.counts,
    cpuMs: snapshot.workerResourceUsage && typeof snapshot.workerResourceUsage.ru_utime === 'number'
      ? snapshot.workerResourceUsage.ru_utime + snapshot.workerResourceUsage.ru_stime : null,
    at: snapshot.at,
  };
}

function stepIndex(steps, name, index) {
  return steps.findIndex((s) => s.step === name && s.index === index);
}

/**
 * @param {object} cfg  config do cenario
 * @param {object} r    resultado bruto de flow.runScenario
 * @param {object} close  { shutdown: resultado de LocalSfu.close(), verify: resultado de verifyClosed(),
 *                          clientRange: { min, max, busyBefore[], verify } (faixa UDP do WebRTC do cliente) }
 * @param {object} context { expectedClientVersion }  versao do pacote mediasoup-client instalado
 */
function evaluateScenario(cfg, r, close, context = {}) {
  const checks = [];
  const notes = [];
  const samples = r.samples || [];
  const lastIdx = samples.length - 1;

  // 1) erro de execucao
  if (r.error) checks.push(check('run', 'failed', `execucao interrompida: ${r.error}`));
  else checks.push(check('run', 'passed', 'sequencia completa executada'));
  if ((r.cleanupErrors || []).length) checks.push(check('client-cleanup', 'failed', r.cleanupErrors.join(' | ')));
  else checks.push(check('client-cleanup', 'passed', 'consumers, producer e transports fechados no cliente sem erro'));

  // 2) loopback
  const ips = (r.candidates || []).map((c) => c.ip);
  const listenIp = r.server?.end?.listen?.ip ?? r.server?.start?.listen?.ip ?? null;
  if (!ips.length) checks.push(check('listen-loopback', 'failed', 'nenhum candidato ICE registrado'));
  else if (ips.every((ip) => LOOPBACK.includes(ip)) && LOOPBACK.includes(listenIp) && (r.candidates || []).every((c) => c.protocol === 'udp')) {
    checks.push(check('listen-loopback', 'passed', `${ips.length} candidatos, todos UDP em ${[...new Set(ips)].join(',')}; listenInfos ${listenIp}`));
  } else checks.push(check('listen-loopback', 'failed', `candidatos fora do loopback ou nao UDP: ${JSON.stringify(r.candidates)}`));

  // 2b) o cliente roda a MESMA versao do mediasoup-client que o pacote instalado (bundle desatualizado reprova)
  const runningVersion = r.device?.clientVersion ?? null;
  if (!context.expectedClientVersion) checks.push(check('client-version', 'failed', 'versao esperada do mediasoup-client nao informada'));
  else if (!runningVersion) checks.push(check('client-version', 'failed', 'a pagina nao informou a versao do mediasoup-client em execucao'));
  else if (runningVersion !== context.expectedClientVersion) {
    checks.push(check('client-version', 'failed', `bundle desatualizado: a pagina roda mediasoup-client ${runningVersion}, o pacote instalado e ${context.expectedClientVersion}; rode npm run bundle`));
  } else checks.push(check('client-version', 'passed', `mediasoup-client ${runningVersion} no bundle = pacote instalado`));

  // 2c) lado do cliente: o Chromium abre sockets UDP proprios (em 0.0.0.0, comportamento do WebRTC). Aqui se
  //     registra o par selecionado (remoto precisa ser loopback) e se o socket local ficou na faixa configurada.
  const range = close?.clientRange || null;
  const ice = Array.isArray(r.clientIce) ? r.clientIce : [];
  const aliveConsumers = cfg.consumers - (r.midClose?.executed ? 1 : 0);
  const expectedPairs = 1 + aliveConsumers;
  const pairProblems = [];
  const pairSummary = [];
  for (const p of ice) {
    if (p.error || !p.remote || !p.local) { pairProblems.push(`${p.label}: ${p.error || 'par incompleto'}`); continue; }
    pairSummary.push(`${p.label}: local ${p.local.address}:${p.local.port}/${p.local.protocol} -> remoto ${p.remote.address}:${p.remote.port}`);
    if (!LOOPBACK.includes(p.remote.address) || p.remote.protocol !== 'udp') pairProblems.push(`${p.label}: remoto ${p.remote.address}/${p.remote.protocol} fora de UDP em loopback`);
    if (range && Number.isFinite(p.local.port) && (p.local.port < range.min || p.local.port > range.max)) pairProblems.push(`${p.label}: socket local ${p.local.port} fora da faixa ${range.min}-${range.max}`);
    if (!Number.isFinite(p.local.port)) pairProblems.push(`${p.label}: porta local ausente no getStats`);
  }
  if (ice.length < expectedPairs) pairProblems.push(`esperava ${expectedPairs} par(es) selecionado(s), registrados ${ice.length}`);
  checks.push(check('client-ice-pair', pairProblems.length ? 'failed' : 'passed',
    pairProblems.length ? pairProblems.join('; ') : `${ice.length} par(es) selecionado(s), remoto sempre UDP em loopback${range ? `, socket local sempre dentro de ${range.min}-${range.max}` : ''}: ${pairSummary.join(' | ')}`));
  if (!range) checks.push(check('client-udp-range', 'failed', 'faixa UDP do cliente nao verificada'));
  else {
    const leaked = (range.verify?.ports || []).filter((x) => !x.free && !(range.busyBefore || []).includes(x.port)).map((x) => x.port);
    const total = (range.verify?.ports || []).length;
    if (!total) checks.push(check('client-udp-range', 'failed', 'nenhuma porta da faixa do cliente foi verificada'));
    else if (leaked.length) checks.push(check('client-udp-range', 'failed', `portas da faixa ${range.min}-${range.max} ainda ocupadas depois de fechar os transports do cliente: ${leaked.join(',')}`));
    else checks.push(check('client-udp-range', 'passed', `faixa do cliente ${range.min}-${range.max}: ${total} porta(s) verificadas, todas livres ao fim${(range.busyBefore || []).length ? ` (${range.busyBefore.length} ja ocupada(s) por terceiros antes, ignorada(s))` : ''}`));
  }

  // 3) um unico envio
  const sw = senderWindow(samples);
  const serverProducers = r.server?.end?.counts?.producers ?? null;
  const single = r.producer && r.producer.produceEvents === 1 && r.producer.rtpSenders === 1 && r.producer.encodings === 1
    && sw && sw.maxStreams === 1 && serverProducers === 1;
  checks.push(check('single-send', single ? 'passed' : 'failed',
    `produce=${r.producer?.produceEvents ?? '?'} rtpSenders=${r.producer?.rtpSenders ?? '?'} streamsRTP=${sw?.maxStreams ?? '?'} producersNoServidor=${serverProducers ?? '?'}`));

  // 4) consumers pausados ate o cliente estar pronto
  const orderProblems = [];
  const consumersInfo = r.consumers || [];
  if (consumersInfo.length !== cfg.consumers) orderProblems.push(`esperava ${cfg.consumers} consumidores, ha ${consumersInfo.length}`);
  for (let i = 0; i < cfg.consumers; i += 1) {
    const a = stepIndex(r.steps || [], 'server-consume', i);
    const b = stepIndex(r.steps || [], 'client-consume', i);
    const c = stepIndex(r.steps || [], 'server-resume', i);
    const created = (r.steps || [])[a];
    if (a < 0 || b < 0 || c < 0 || !(a < b && b < c)) orderProblems.push(`consumidor ${i}: ordem consume-servidor < consume-cliente < resume ausente`);
    else if (created.paused !== true) orderProblems.push(`consumidor ${i}: criado sem paused:true`);
  }
  checks.push(check('consumers-paused-then-resumed', orderProblems.length ? 'failed' : 'passed',
    orderProblems.length ? orderProblems.join('; ') : `${cfg.consumers} consumidor(es): criados paused:true, resumidos so depois do consume do cliente`));

  // 5) codec REAL negociado
  const senderCodec = lastNonNull(samples.map((s) => s.sender?.codec));
  const rtpCodec = r.producer?.rtpParametersCodec || null;
  const serverCodec = r.server?.end?.producer?.codec || null;
  const real = senderCodec?.mimeType || rtpCodec?.mimeType || null;
  const consumerCodecs = [];
  for (let i = 0; i < cfg.consumers; i += 1) {
    const c = lastNonNull(samples.map((s) => s.consumers[i]?.codec));
    if (c?.mimeType) consumerCodecs.push(c.mimeType);
  }
  const mimes = [senderCodec?.mimeType, rtpCodec?.mimeType, serverCodec?.mimeType, ...consumerCodecs, ...(consumersInfo.map((c) => c.rtpParametersCodec?.mimeType))].filter(Boolean).map(mimeKey);
  const consistent = mimes.length > 0 && mimes.every((m) => m === mimes[0]);
  const codecInfo = {
    requested: r.codec?.requested ?? null,
    selectedByClient: r.codec?.selected?.mimeType ?? null,
    realSender: senderCodec,
    producerRtpParameters: rtpCodec,
    server: serverCodec,
    consumers: consumerCodecs,
    fellBack: r.codec?.fellBack === true,
    fallbackReason: r.codec?.reason ?? null,
  };
  if (!real) checks.push(check('codec', 'failed', 'nao foi possivel ler o codec negociado (nem getStats nem rtpParameters)'));
  else if (!consistent) checks.push(check('codec', 'failed', `codec diferente entre pontas: ${[...new Set(mimes)].join(' / ')}`));
  else if (codecInfo.fellBack) checks.push(check('codec', 'warning', `fallback explicito: ${codecInfo.fallbackReason}; codec real ${real}`));
  else if (mimeKey(real) !== mimeKey(codecInfo.requested)) checks.push(check('codec', 'failed', `pedido ${codecInfo.requested}, negociado ${real}`));
  else checks.push(check('codec', 'passed', `${real} negociado e igual em envio, servidor e ${consumerCodecs.length} consumidor(es)`));
  if (!sw?.encoderImplementation) notes.push('encoderImplementation ausente no getStats: encoder do navegador DESCONHECIDO (nao e "software" nem "hardware")');

  // 6) quadros chegando a todos
  const midIdx = r.midClose?.executed ? r.midClose.atSample : null;
  const consumerSummaries = [];
  const frameProblems = [];
  for (let i = 0; i < cfg.consumers; i += 1) {
    const closed = r.midClose?.executed && r.midClose.index === i;
    const to = closed ? midIdx : lastIdx;
    const win = consumerWindow(samples, i, 0, to);
    const need = win ? Math.max(5, Math.floor(0.3 * cfg.fps * win.seconds)) : null;
    consumerSummaries.push({ index: i, closedMidTest: Boolean(closed), window: win, minFramesRequired: need });
    if (!win || win.framesDecoded === null || win.framesDecoded < need) frameProblems.push(`consumidor ${i}: ${win?.framesDecoded ?? 'sem dados'} quadros (min ${need ?? '?'})`);
  }
  checks.push(check('frames-flow', frameProblems.length ? 'failed' : 'passed',
    frameProblems.length ? frameProblems.join('; ')
      : consumerSummaries.map((c) => `c${c.index}:${c.window.framesDecoded}q/${c.window.fps}fps`).join(' ')));

  // 7) fechamento de um consumidor no meio
  let midClose = { applicable: cfg.consumers >= 2, executed: false };
  if (cfg.consumers < 2) {
    checks.push(check('mid-close', 'not-applicable', 'com 1 consumidor nao ha "os demais"; o fechamento no meio so roda com 2 ou mais'));
  } else if (!r.midClose?.executed) {
    checks.push(check('mid-close', 'failed', 'o fechamento no meio nao foi executado'));
  } else {
    const idx = r.midClose.index;
    const problems = [];
    const survivors = [];
    for (let i = 0; i < cfg.consumers; i += 1) {
      if (i === idx) continue;
      // atSample e a amostra tirada ANTES do fechamento: a janela "apos" comeca na seguinte.
      const after = consumerWindow(samples, i, midIdx + 1, lastIdx);
      const need = after ? Math.max(3, Math.floor(0.3 * cfg.fps * after.seconds)) : null;
      survivors.push({ index: i, afterClose: after, minFramesRequired: need });
      if (!after || after.framesDecoded === null || after.framesDecoded < need) problems.push(`consumidor ${i} nao seguiu recebendo apos o fechamento (${after?.framesDecoded ?? 'sem dados'} quadros, min ${need ?? '?'})`);
      else if (after.freezeCount > 0) problems.push(`consumidor ${i} congelou ${after.freezeCount} vez(es) apos o fechamento`);
    }
    const sBefore = r.server?.start?.counts;
    const sAfter = r.server?.afterMidClose?.counts;
    const serverClosed = sBefore && sAfter && sAfter.consumers === sBefore.consumers - 1 && sAfter.transports === sBefore.transports - 1;
    if (!serverClosed) problems.push(`servidor nao liberou consumer+transport do fechado (antes ${JSON.stringify(sBefore)}, depois ${JSON.stringify(sAfter)})`);
    const stillListed = (r.server?.end?.consumers || []).some((c) => c.peerId === consumersInfo[idx]?.peerId);
    if (stillListed) problems.push('consumer fechado ainda aparece nas stats finais do servidor');
    midClose = { applicable: true, executed: true, closedIndex: idx, tMs: round(r.midClose.tMs), survivors, serverCountsBefore: sBefore ?? null, serverCountsAfter: sAfter ?? null };
    checks.push(check('mid-close', problems.length ? 'failed' : 'passed',
      problems.length ? problems.join('; ') : `consumidor ${idx} fechado aos ${round(r.midClose.tMs / 1000)} s; ${survivors.length} restante(s) seguiram recebendo; servidor liberou consumer e transport`));
  }

  // 8) encaminhamento: o que o servidor recebe ~ o que envia a cada consumidor
  const c0 = serverCounters(r.server?.start);
  const c1 = serverCounters(r.server?.end);
  let forwarding = null;
  if (!c0 || !c1 || !c0.producer || !c1.producer) {
    checks.push(check('server-forwarding', 'failed', 'stats do servidor ausentes'));
  } else {
    const dProd = (c1.producer.packetCount ?? NaN) - (c0.producer.packetCount ?? NaN);
    const ratios = [];
    const prob = [];
    for (const [peerId, end] of Object.entries(c1.consumers)) {
      const start = c0.consumers[peerId];
      if (!start) continue;
      const dCons = (end.packetCount ?? NaN) - (start.packetCount ?? NaN);
      const ratio = dProd > 0 ? dCons / dProd : null;
      ratios.push({ peerId, packetsConsumer: dCons, packetsProducer: dProd, ratio: round(ratio, 3), type: end.type });
      if (!(ratio >= 0.7 && ratio <= 1.3)) prob.push(`consumer ${peerId.slice(0, 8)}: razao ${round(ratio, 3)}`);
    }
    if (!(dProd > 0)) prob.push('o servidor nao recebeu pacotes do producer na janela');
    if (!ratios.length) prob.push('nenhum consumer vivo durante toda a janela para comparar');
    forwarding = {
      windowMs: c1.at - c0.at,
      producerPackets: dProd,
      producerBytes: (c1.producer.byteCount ?? NaN) - (c0.producer.byteCount ?? NaN),
      consumers: ratios,
      workerCpuMs: c0.cpuMs !== null && c1.cpuMs !== null ? round(c1.cpuMs - c0.cpuMs, 1) : null,
    };
    forwarding.workerCpuPercentOfOneCore = forwarding.workerCpuMs !== null && forwarding.windowMs > 0 ? round((forwarding.workerCpuMs / forwarding.windowMs) * 100, 1) : null;
    checks.push(check('server-forwarding', prob.length ? 'failed' : 'passed',
      prob.length ? prob.join('; ') : `pacotes enviados a cada consumer ~ pacotes recebidos do producer (razoes ${ratios.map((x) => x.ratio).join(', ')}); tipo ${[...new Set(ratios.map((x) => x.type))].join(',')}`));
  }

  // 9) limpeza do servidor
  const sd = close?.shutdown || null;
  const vf = close?.verify || null;
  if (!sd || !vf) checks.push(check('server-cleanup', 'failed', 'fechamento da SFU nao verificado'));
  else {
    const problems = [];
    if (sd.subprocessClosed !== true) problems.push('evento subprocessclose nao confirmado');
    if (sd.timedOut) problems.push(`timeout ao fechar o worker (kill forcado: ${sd.forcedKill})`);
    if (sd.died) problems.push(`worker morreu: ${sd.diedError}`);
    if (vf.workerAlive) problems.push(`processo ${vf.workerPid} ainda vivo`);
    const busy = (vf.ports || []).filter((p) => !p.free).map((p) => p.port);
    if (busy.length) problems.push(`portas UDP ainda ocupadas: ${busy.join(',')}`);
    if (!(vf.ports || []).length) problems.push('nenhuma porta registrada para verificar');
    checks.push(check('server-cleanup', problems.length ? 'failed' : 'passed',
      problems.length ? problems.join('; ') : `subprocessclose recebido, pid ${sd.workerPid} encerrado, ${vf.ports.length} porta(s) UDP livres`));
  }

  const failed = checks.some((c) => c.status === 'failed');
  const warned = checks.some((c) => c.status === 'warning');
  return {
    status: failed ? 'failed' : warned ? 'warning' : 'ok',
    checks,
    notes,
    codec: codecInfo,
    sender: sw,
    consumers: consumerSummaries,
    midClose,
    forwarding,
  };
}

module.exports = { evaluateScenario, consumerWindow, senderWindow, serverCounters, check };
