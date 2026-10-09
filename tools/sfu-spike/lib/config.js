'use strict';

/*
 * Argumentos do usuario e plano de cenarios da prova de conceito de SFU.
 * Puro: nao toca disco nem Electron.
 */

const HELP_TEXT = `sfu-spike: prova de conceito de SFU local (mediasoup), em loopback.

Uso:
  node tools/sfu-spike/run.js [opcoes]

Opcoes:
  --help                 mostra esta ajuda
  --list                 mostra os cenarios que rodariam, sem abrir o Electron
  --quick                janela curta (640x360, aquece 2 s, mede 5 s)
  --consumers=1,4        quantos consumidores por cenario (lista; padrao 1,4)
  --codec=h264|vp8       codec preferido (padrao h264; vp8 so se pedido)
  --duration-ms=N        janela de medida (padrao 10000)
  --warmup-ms=N          aquecimento antes da medida (padrao 3000)
  --timeout-ms=N         limite do conjunto inteiro (padrao calculado)
  --out=PASTA            pasta do relatorio (padrao lab-out/sfu-spike)
  --label=TEXTO          sufixo do nome do relatorio
  --show                 mostra a janela da bancada

Pre-requisitos (uma vez, em tools/sfu-spike):
  npm ci --ignore-scripts && npm run prepare-worker && npm run bundle

Codigos de saida: 0 ok (ou ok com avisos), 1 falha de cenario/runtime,
2 timeout, 3 uso invalido, 4 pre-requisito ausente.
Veja tools/sfu-spike/README.md.
`;

const CODECS = ['h264', 'vp8'];
const MAX_CONSUMERS = 8;

const DEFAULTS = {
  width: 960, height: 540, fps: 30, bitrateKbps: 2500, warmupMs: 3000, durationMs: 10000, sampleMs: 500,
};
const QUICK = {
  width: 640, height: 360, fps: 30, bitrateKbps: 1200, warmupMs: 2000, durationMs: 5000, sampleMs: 500,
};

function parseIntStrict(text) {
  return /^\d+$/.test(text) ? Number(text) : NaN;
}

function parseArgv(argv) {
  const options = { consumers: [1, 4], codec: 'h264' };
  const errors = [];
  const unknown = [];
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--quick') options.quick = true;
    else if (arg === '--show') options.show = true;
    else if (arg.startsWith('--consumers=')) {
      const parts = arg.slice('--consumers='.length).split(',').map((s) => parseIntStrict(s.trim()));
      if (!parts.length || parts.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_CONSUMERS)) errors.push(`--consumers deve ser lista de inteiros de 1 a ${MAX_CONSUMERS}`);
      else options.consumers = [...new Set(parts)];
    } else if (arg.startsWith('--codec=')) {
      const c = arg.slice('--codec='.length).toLowerCase();
      if (!CODECS.includes(c)) errors.push(`--codec deve ser ${CODECS.join(' ou ')}`);
      else options.codec = c;
    } else if (arg.startsWith('--duration-ms=')) options.durationMs = parseIntStrict(arg.slice(14));
    else if (arg.startsWith('--warmup-ms=')) options.warmupMs = parseIntStrict(arg.slice(12));
    else if (arg.startsWith('--timeout-ms=')) options.timeoutMs = parseIntStrict(arg.slice(13));
    else if (arg.startsWith('--out=')) options.out = arg.slice(6);
    else if (arg.startsWith('--label=')) options.label = arg.slice(8);
    else unknown.push(arg);
  }
  if (unknown.length) errors.push(`argumento desconhecido: ${unknown.join(' ')}`);
  for (const key of ['durationMs', 'warmupMs', 'timeoutMs']) {
    if (key in options && !Number.isInteger(options[key])) errors.push(`valor invalido em ${key}`);
  }
  return { options, errors };
}

/** Erros de um cenario (lista vazia = valido). Tambem usado pelo main, que nao confia no arquivo. */
function validateConfig(cfg) {
  const errors = [];
  const num = (name, min, max) => {
    if (!Number.isInteger(cfg?.[name]) || cfg[name] < min || cfg[name] > max) errors.push(`${name} fora de ${min}..${max}`);
  };
  if (!cfg || typeof cfg !== 'object') return ['config ausente'];
  num('consumers', 1, MAX_CONSUMERS);
  num('width', 160, 1920);
  num('height', 90, 1080);
  num('fps', 1, 60);
  num('bitrateKbps', 100, 20000);
  num('warmupMs', 0, 60000);
  num('durationMs', 1000, 120000);
  num('sampleMs', 100, 5000);
  if (!CODECS.includes(cfg.codec)) errors.push('codec invalido');
  if (cfg.listenIp !== '127.0.0.1') errors.push('listenIp deve ser 127.0.0.1');
  return errors;
}

/** Folga para subir worker/transports e fechar tudo, alem de aquecimento + medida. */
const SCENARIO_SLACK_MS = 45000;

function buildPlan(options) {
  const errors = [];
  const base = { ...(options.quick ? QUICK : DEFAULTS) };
  if (Number.isInteger(options.durationMs)) base.durationMs = options.durationMs;
  if (Number.isInteger(options.warmupMs)) base.warmupMs = options.warmupMs;
  const scenarios = [];
  for (const consumers of options.consumers || []) {
    const config = { ...base, consumers, codec: options.codec || 'h264', listenIp: '127.0.0.1' };
    const bad = validateConfig(config);
    if (bad.length) errors.push(`consumidores=${consumers}: ${bad.join('; ')}`);
    scenarios.push({
      key: `sfu-loopback@c${consumers}`,
      id: 'sfu-loopback',
      label: `SFU local, 1 envio, ${consumers} consumidor(es)`,
      config,
    });
  }
  if (!scenarios.length) errors.push('nenhum cenario planejado');
  const total = scenarios.reduce((sum, s) => sum + s.config.warmupMs + s.config.durationMs + SCENARIO_SLACK_MS, 20000);
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : total;
  if (timeoutMs < 10000 || timeoutMs > 3600000) errors.push('timeout-ms fora de 10000..3600000');
  return { errors, scenarios, timeoutMs, out: options.out || null, label: options.label || '', show: options.show === true };
}

module.exports = { HELP_TEXT, CODECS, MAX_CONSUMERS, DEFAULTS, QUICK, SCENARIO_SLACK_MS, parseArgv, validateConfig, buildPlan };
