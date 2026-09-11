'use strict';

// Formata e limita a linha de diagnostico de encode que vai pro log em
// arquivo (console do renderer -> main.js console-message -> arquivo). Puro
// de proposito: a linha e o UNICO artefato que a gente pede pra quem esta
// com o problema, entao o formato dela e testado e nao pode mudar por
// acidente num refactor.
(function (root) {
  // Heartbeat: mesmo sem nada mudar, uma linha a cada 15s serve de "ainda
  // vivo, ainda assim". Sem isso um encode preso em SOFTWARE por 20min
  // deixaria so uma linha no log inteiro.
  const HEARTBEAT_MS = 15000;

  // Campos CATEGORICOS. Mudanca em qualquer um forca linha nova (NVENC caiu
  // pra OpenH264, limitacao virou 'cpu', a escada mexeu). Numeros -- fps,
  // kbps, ms/frame -- ficam de fora: variam a cada tick e so importam junto
  // de uma mudanca categorica ou no heartbeat.
  function signature(row, ctx) {
    const steps = ctx.steps || {};
    return [
      row.encoder || 'desconhecido',
      !row.encoder ? 'unknown' : (ctx.software ? 'sw' : 'hw'),
      row.powerEfficient === false ? 'ineff' : 'eff',
      row.limitation || 'none',
      `g${steps.global || 0}`,
      `p${steps.peer || 0}`,
      `s${ctx.scaleDownBy || 1}`,
      `r${ctx.resolutionHeight || 0}`,
    ].join('|');
  }

  /** prev e { sig, atMs } da ultima linha emitida pra este sender, ou null. */
  function shouldLog(prev, sig, nowMs, heartbeatMs) {
    if (!prev) return true;
    if (prev.sig !== sig) return true;
    return nowMs - prev.atMs >= (heartbeatMs ?? HEARTBEAT_MS);
  }

  function line(row, ctx) {
    const steps = ctx.steps || {};
    const marca = ctx.changed ? 'MUDOU ' : '';
    const encoder = row.encoder || 'desconhecido';
    const tipoEncoder = !row.encoder ? 'desconhecido' : (ctx.software ? 'SOFTWARE(CPU)' : 'hardware');
    // ctx.relayOf (sourceId de quem e a tela ORIGINAL) so vem preenchido
    // quando este sender e um repasse (F2), nao a captura direta. Sem isto
    // "tela->gg" nao dizia se gg via a nossa captura ou uma stream de
    // outro peer que so estamos revendendo -- e depurar a falha de
    // negociacao de saida de 2026-09-05 exigiu cruzar 3 logs de 2 maquinas
    // so pra descobrir que "screen" ali era "screen@4" por baixo.
    const repasse = ctx.relayOf != null ? ` (repasse de #${ctx.relayOf})` : '';
    return `[diag] ${marca}tela->${row.name}${repasse} enc=${encoder} ${tipoEncoder}`
      + ` efic=${row.powerEfficient === false ? 'nao' : 'sim'}`
      + ` cap=${row.captureFps != null ? Math.round(row.captureFps) : '?'}fps`
      + ` out=${row.width || 0}x${row.height || 0}@${Math.round(row.fps || 0)}fps`
      + ` limite=${row.limitation || 'nenhum'}`
      + ` alvoKbps=${Math.round((ctx.targetBitrate || 0) / 1000)}`
      + ` escala=${ctx.scaleDownBy || 1}`
      + ` res=${ctx.resolutionHeight || '?'}`
      + ` bwe=${ctx.bweBps != null ? Math.round(ctx.bweBps / 1000) : '?'}`
      + ` realKbps=${Math.round((row.mbps || 0) * 1000)}`
      + ` msFrame=${row.msPerFrame != null ? row.msPerFrame.toFixed(1) : '-'}`
      + ` degraus=g${steps.global || 0}/p${steps.peer || 0}`;
  }

  const api = { signature, shouldLog, line, HEARTBEAT_MS };

  root.GoLive = root.GoLive || {};
  root.GoLive.encodediag = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
