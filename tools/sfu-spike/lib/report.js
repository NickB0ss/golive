'use strict';

/*
 * Relatorio JSON e codigo de saida. Puro: o main passa os fatos, aqui so se
 * decide o status. Cenario planejado que nao produziu resultado NUNCA conta
 * como aprovado nem como pulado: o conjunto vira `error`.
 */

const SCHEMA = 'golive-sfu-spike/1';

const EXIT = { OK: 0, FAILED: 1, TIMEOUT: 2, USAGE: 3, PREREQ: 4 };

/** Afirmacao de arquitetura: o que o desenho garante, sem prometer medicao de CPU/hardware. */
const ARCHITECTURE = [
  'O producer envia UMA vez a SFU (um RTCRtpSender, uma codificacao, sem simulcast/SVC).',
  'A SFU (router do mediasoup) encaminha pacotes RTP aos consumers sem decodificar nem recodificar: o worker nao contem codec/encoder de video para este caminho. Isto e propriedade da arquitetura, nao resultado de medicao.',
  'Cada consumer recebe a MESMA representacao (camada unica): um consumidor lento nao tem qualidade propria; o limite de banda dele e o do caminho unico.',
  'O relay WebRTC legado do app (decode + re-encode no intermediario) e outra modalidade e continua sendo o transporte de producao; esta prova nao o substitui.',
];

const LIMITATIONS = [
  'Loopback no mesmo PC e no mesmo processo Electron para cliente e SFU: sem perda, jitter ou banda reais.',
  'Camada unica: nao ha qualidade independente por consumidor, nem simulcast, nem SVC.',
  'Cena sintetica em canvas, nao captura real de tela/jogo (nao reproduz o defeito de contentHint=motion da captura).',
  'O tempo de CPU do worker (ru_utime+ru_stime) e um dado do processo da SFU; nao inclui o encoder/decoder do navegador nem a GPU, e NAO prova custo zero.',
  'O encoder/decoder do navegador (hardware ou software) so aparece se o Chromium expuser encoderImplementation; ausente = desconhecido. Capabilities nao provam hardware.',
  'Janelas curtas (--quick) sao ruidosas; para comparar use os padroes e repita.',
  'Rede: a SFU escuta so em 127.0.0.1/UDP, mas o cliente (Chromium) abre sockets UDP efemeros em 0.0.0.0 (comportamento do WebRTC; nao existe politica que o faca ligar so no loopback). Eles ficam restritos a uma faixa propria por setWebRTCUDPPortRange e o par ICE selecionado e registrado por cenario; nao ha promessa de "nenhuma porta fora do loopback".',
  'O worker do mediasoup e baixado de GitHub Releases pelo script oficial do pacote e so e validado por executar (nao ha checksum nem hash travado); sem binario para a plataforma o script cai sozinho em build local (Python + toolchain C++).',
  'Nao substitui o benchmark multi-PC: rede real, varios receptores com banda diferente e PCs reais ainda precisam ser medidos.',
];

function statusOf(scenarios, { timedOut = false, fatal = null, planned = 0 } = {}) {
  if (timedOut) return 'timeout';
  if (fatal) return 'error';
  if (scenarios.length < planned) return 'error'; // cenario ausente nunca vira ok
  if (scenarios.some((s) => s.status === 'failed')) return 'partial';
  if (scenarios.some((s) => s.status === 'warning')) return 'warning';
  return 'ok';
}

function exitCodeFor(report) {
  if (!report || typeof report !== 'object') return EXIT.FAILED;
  if (report.status === 'ok' || report.status === 'warning') return EXIT.OK;
  if (report.status === 'timeout') return EXIT.TIMEOUT;
  return EXIT.FAILED;
}

/** true se algum cenario exerceu o fechamento de um consumidor no meio e passou (--consumers=1 sozinho = false). */
function midCloseCovered(scenarios) {
  return scenarios.some((s) => (s.checks || []).some((c) => c.id === 'mid-close' && c.status === 'passed'));
}

function networkSummary(clientUdpPortRange) {
  const faixa = clientUdpPortRange ? `${clientUdpPortRange.min}-${clientUdpPortRange.max}` : 'nao configurada';
  return 'SFU: UDP somente em 127.0.0.1 (listenInfos), sem TCP, iceServers vazio. '
    + `Cliente: o Chromium abre sockets UDP efemeros em 0.0.0.0 (comportamento do WebRTC, fora do controle do mediasoup), confinados a faixa ${faixa} por setWebRTCUDPPortRange; `
    + 'o par ICE selecionado de cada transport do cliente e registrado (remoto sempre 127.0.0.1) e a faixa e verificada livre ao fim.';
}

function buildReport(facts) {
  const scenarios = facts.scenarios || [];
  const planned = facts.planned ?? scenarios.length;
  const status = statusOf(scenarios, { timedOut: facts.timedOut, fatal: facts.fatal, planned });
  const missing = Math.max(0, planned - scenarios.length);
  return {
    schema: SCHEMA,
    status,
    midCloseCovered: midCloseCovered(scenarios), // false: nenhum cenario fechou um consumidor no meio (ex.: so --consumers=1)
    startedAt: facts.startedAt,
    finishedAt: facts.finishedAt,
    label: facts.label || '',
    args: facts.args || {},
    fatal: facts.fatal || null,
    planned,
    completed: scenarios.length,
    missingScenarios: missing, // explicito: se > 0, o status e error
    runtime: facts.runtime || null,
    versions: facts.versions || null,
    flags: facts.flags || null,
    profile: facts.profile || null,
    network: networkSummary(facts.clientUdpPortRange),
    clientUdpPortRange: facts.clientUdpPortRange || null,
    architecture: ARCHITECTURE,
    limitations: LIMITATIONS,
    scenarios,
  };
}

function reportFileName(date, label) {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  const suffix = label ? `-${String(label).replace(/[^\w.-]+/g, '_')}` : '';
  return `sfu-spike-${stamp}${suffix}.json`;
}

module.exports = { midCloseCovered, SCHEMA, EXIT, ARCHITECTURE, LIMITATIONS, statusOf, exitCodeFor, buildReport, reportFileName };
