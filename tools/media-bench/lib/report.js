'use strict';

/*
 * Montagem do relatorio JSON e do codigo de saida. Puro: o main Electron e o
 * launcher passam os fatos, aqui so se decide status e formato.
 */

const SCHEMA = 'golive-media-bench/1';

/** Limites que TODO relatorio carrega, pra ninguem ler numero fora de contexto. */
const LIMITATIONS = [
  'source=synthetic desenha num canvas: NAO e captura WGC real. O defeito "captura direta + contentHint=motion cai no OpenH264" e especifico da track de captura e nao se reproduz com canvas.',
  'rtpSenders conta RTCRtpSender com video, nao sessoes de encoder de hardware: o Chromium nao expoe esse numero.',
  'rttMs e o RTT do transporte ICE, nao a latencia ponta a ponta do video.',
  'CPU vem de app.getAppMetrics (processos do proprio Electron); nao inclui GPU/encoder de hardware nem o resto da maquina.',
  'Loopback no mesmo processo/maquina: sem perda, jitter ou banda reais de rede.',
  'Um PC so; nao substitui o teste multi-PC.',
];

/** Codigos de saida do launcher. */
const EXIT = { OK: 0, FAILED: 1, TIMEOUT: 2, USAGE: 3 };

function statusOf(scenarios, { timedOut = false, fatal = null, planned = 0 } = {}) {
  if (timedOut) return 'timeout';
  if (fatal) return 'error';
  if (scenarios.length < planned) return 'error';
  if (scenarios.some((s) => s.status !== 'ok')) return 'partial';
  return 'ok';
}

function exitCodeFor(report) {
  if (!report || typeof report !== 'object') return EXIT.FAILED;
  if (report.status === 'ok') return EXIT.OK;
  if (report.status === 'timeout') return EXIT.TIMEOUT;
  return EXIT.FAILED;
}

/** Relatorio final. `facts` vem do main; nada aqui le o ambiente. */
function buildReport(facts) {
  const scenarios = facts.scenarios || [];
  const status = statusOf(scenarios, {
    timedOut: facts.timedOut, fatal: facts.fatal, planned: facts.planned ?? scenarios.length,
  });
  return {
    schema: SCHEMA,
    status,
    startedAt: facts.startedAt,
    finishedAt: facts.finishedAt,
    label: facts.label || '',
    args: facts.args || {},
    fatal: facts.fatal || null,
    planned: facts.planned ?? scenarios.length,
    runtime: facts.runtime || null,
    flags: facts.flags || null,
    profile: facts.profile || null,
    network: 'loopback no mesmo processo; iceServers vazio (nenhum STUN/TURN externo)',
    limitations: LIMITATIONS,
    scenarios,
  };
}

/** Nome estavel do arquivo: data UTC + rotulo. */
function reportFileName(date, label) {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  const suffix = label ? `-${String(label).replace(/[^\w.-]+/g, '_')}` : '';
  return `media-bench-${stamp}${suffix}.json`;
}

module.exports = { SCHEMA, LIMITATIONS, EXIT, buildReport, exitCodeFor, reportFileName, statusOf };
