'use strict';

/*
 * Configuracao da bancada: argumentos de linha de comando, limites,
 * validacao e a matriz de cenarios. Modulo puro (sem Electron, sem disco),
 * usado pelo launcher (run.js) e revalidado pelo main Electron.
 *
 * Contrato de UM cenario:
 *   { source: 'synthetic' | 'owned-window',
 *     pipeline: 'direct' | 'canvas',     // canvas = src/renderer/screenrelay.js de producao
 *     hint: '' | 'motion',               // contentHint da track enviada
 *     topology: 'p2p' | 'relay',         // relay = decode + encode num no intermediario
 *     width, height, fps, viewers, codec,
 *     bitrateKbps, warmupMs, durationMs, sampleMs }
 *
 * `topology` aceita no futuro 'sfu' sem mudar o resto: a bancada so exige que
 * o no novo entregue o mesmo formato de nos medidos (ver README).
 */

const LIMITS = {
  width: [320, 3840],
  height: [240, 2160],
  fps: [1, 120],
  viewers: [1, 16],
  bitrateKbps: [100, 100000],
  warmupMs: [0, 60000],
  durationMs: [1000, 600000],
  sampleMs: [250, 10000],
  timeoutMs: [5000, 7200000],
};

const SOURCES = ['synthetic', 'owned-window'];
const PIPELINES = ['direct', 'canvas'];
const HINTS = ['', 'motion'];
const TOPOLOGIES = ['p2p', 'relay'];
const CODECS = ['h264', 'vp8', 'vp9', 'av1'];

const DEFAULTS = {
  source: 'synthetic',
  width: 1920,
  height: 1080,
  fps: 60,
  viewers: [1, 4],
  codec: 'h264',
  bitrateKbps: 12000,
  warmupMs: 3000,
  durationMs: 15000,
  sampleMs: 1000,
};

/** Perfil curto: 8 cenarios em ~1 minuto. Argumentos explicitos vencem. */
const QUICK = {
  width: 1280, height: 720, fps: 30, bitrateKbps: 4000, warmupMs: 1000, durationMs: 3000, sampleMs: 1000,
};

/**
 * Matriz comparavel. `relay-motion` usa a origem com canvas (como o app) e um
 * no intermediario que recebe, decodifica e reenvia aos espectadores.
 */
const SCENARIOS = [
  { id: 'direct-nohint', label: 'direta, sem contentHint', pipeline: 'direct', hint: '', topology: 'p2p' },
  { id: 'direct-motion', label: 'direta, contentHint=motion', pipeline: 'direct', hint: 'motion', topology: 'p2p' },
  { id: 'canvas-motion', label: 'canvas (screenrelay), motion', pipeline: 'canvas', hint: 'motion', topology: 'p2p' },
  { id: 'relay-motion', label: 'canvas + relay (decode+encode), motion', pipeline: 'canvas', hint: 'motion', topology: 'relay' },
];

const HELP_TEXT = `GoLive media-bench: bancada de captura/encode/relay (Windows).

Uso: node tools/media-bench/run.js [opcoes]     (ou: npm run bench:media -- [opcoes])

Cenarios (use --list para ver):
  direct-nohint  direct-motion  canvas-motion  relay-motion   x  viewers (padrao 1 e 4)

Opcoes gerais:
  --help                 mostra esta ajuda e sai
  --list                 lista os cenarios que seriam executados e sai (nao abre o Electron)
  --quick                perfil curto: 1280x720@30, 1s de aquecimento + 3s de medida
  --only=ID[,ID]         so estes cenarios da matriz (ids acima)
  --viewers=N[,N]        quantidades de espectadores (padrao 1,4; maximo 16)
  --pipeline=P --hint=H --topology=T
                         cenario unico personalizado (P: direct|canvas, H: motion ou vazio, T: p2p|relay)
  --width=N --height=N --fps=N          formato da fonte (padrao 1920x1080@60)
  --codec=h264|vp8|vp9|av1              codec preferido (padrao h264)
  --bitrate-kbps=N                      maxBitrate de cada sender (padrao 12000)
  --warmup-ms=N --duration-ms=N         aquecimento e janela de medida (padrao 3000 / 15000)
  --sample-ms=N                         intervalo de getStats (padrao 1000)
  --timeout-ms=N                        limite do conjunto inteiro (padrao: calculado)
  --out=DIR                             pasta do relatorio (padrao lab-out/media-bench)
  --label=TEXTO                         rotulo gravado no relatorio e no nome do arquivo
  --show                                mostra a janela da bancada (depuracao)

Fonte:
  --source=synthetic     (padrao) cena animada deterministica num canvas. NAO e captura WGC real.
  --source=owned-window  captura uma janela CRIADA pela propria bancada via getDisplayMedia.
                         Exige --allow-own-window-capture (opt-in explicito). Nunca captura sua
                         tela, outras janelas nem microfone.

Saida: relatorio JSON em lab-out/media-bench/ (ignorado no git). Codigos de saida:
  0 ok   1 falha de cenario/runtime   2 timeout   3 uso invalido`;

const VALUE_FLAGS = {
  '--only': 'only', '--viewers': 'viewers', '--pipeline': 'pipeline', '--hint': 'hint', '--topology': 'topology',
  '--width': 'width', '--height': 'height', '--fps': 'fps', '--codec': 'codec', '--bitrate-kbps': 'bitrateKbps',
  '--warmup-ms': 'warmupMs', '--duration-ms': 'durationMs', '--sample-ms': 'sampleMs', '--timeout-ms': 'timeoutMs',
  '--out': 'out', '--label': 'label', '--source': 'source',
};
const BOOL_FLAGS = {
  '--help': 'help', '--list': 'list', '--quick': 'quick', '--show': 'show',
  '--allow-own-window-capture': 'allowOwnWindowCapture',
};
const NUMERIC = new Set(['width', 'height', 'fps', 'bitrateKbps', 'warmupMs', 'durationMs', 'sampleMs', 'timeoutMs']);

/** Le argv (sem node/script). Nunca lanca: erros vao em `errors`. */
function parseArgv(argv) {
  const options = {};
  const errors = [];
  const list = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < list.length; i++) {
    const raw = String(list[i]);
    const eq = raw.indexOf('=');
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    let value = eq === -1 ? undefined : raw.slice(eq + 1);
    if (BOOL_FLAGS[flag]) {
      if (value !== undefined) errors.push(`${flag} nao recebe valor`);
      else options[BOOL_FLAGS[flag]] = true;
    } else if (VALUE_FLAGS[flag]) {
      if (value === undefined) {
        const next = list[i + 1];
        if (next === undefined || String(next).startsWith('--')) {
          // --hint sem valor significa "sem hint"; os demais exigem valor.
          if (flag === '--hint') value = '';
          else { errors.push(`${flag} exige um valor`); continue; }
        } else { value = String(next); i++; }
      }
      options[VALUE_FLAGS[flag]] = value;
    } else {
      errors.push(`argumento desconhecido: ${raw}`);
    }
  }
  return { options, errors };
}

function parseIntStrict(text) {
  if (typeof text === 'number') return Number.isInteger(text) ? text : NaN;
  return /^-?\d+$/.test(String(text).trim()) ? Number(text) : NaN;
}

function inRange(name, value, errors) {
  const [min, max] = LIMITS[name];
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${name} deve ser inteiro entre ${min} e ${max} (recebido: ${value})`);
    return false;
  }
  return true;
}

/** Valida um cenario COMPLETO (o mesmo contrato que o main recebe). */
function validateConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') return ['configuracao ausente'];
  if (!SOURCES.includes(cfg.source)) errors.push(`source deve ser ${SOURCES.join(' ou ')}`);
  if (!PIPELINES.includes(cfg.pipeline)) errors.push(`pipeline deve ser ${PIPELINES.join(' ou ')}`);
  if (!HINTS.includes(cfg.hint)) errors.push('hint deve ser "motion" ou vazio');
  if (!TOPOLOGIES.includes(cfg.topology)) errors.push(`topology deve ser ${TOPOLOGIES.join(' ou ')}`);
  if (!CODECS.includes(cfg.codec)) errors.push(`codec deve ser ${CODECS.join(', ')}`);
  for (const k of ['width', 'height', 'fps', 'viewers', 'bitrateKbps', 'warmupMs', 'durationMs', 'sampleMs']) {
    inRange(k, cfg[k], errors);
  }
  if (cfg.pipeline === 'canvas' && cfg.hint !== 'motion') {
    errors.push('pipeline canvas sempre envia contentHint=motion (o screenrelay de producao o fixa); use hint=motion');
  }
  if (cfg.width % 2 || cfg.height % 2) errors.push('width e height devem ser pares (H.264 recusa impar)');
  if (cfg.durationMs < cfg.sampleMs * 2) errors.push('durationMs deve cobrir ao menos 2 intervalos de sampleMs');
  if (cfg.source === 'owned-window' && cfg.allowOwnWindowCapture !== true) {
    errors.push('source=owned-window exige --allow-own-window-capture (opt-in explicito)');
  }
  return errors;
}

function parseViewers(text, errors) {
  const parts = String(text).split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) { errors.push('--viewers vazio'); return []; }
  const out = [];
  for (const p of parts) {
    const n = parseIntStrict(p);
    if (inRange('viewers', n, errors) && !out.includes(n)) out.push(n);
  }
  return out;
}

function scenarioConfig(base, def, viewers) {
  return {
    source: base.source,
    pipeline: def.pipeline,
    hint: def.hint,
    topology: def.topology,
    width: base.width,
    height: base.height,
    fps: base.fps,
    viewers,
    codec: base.codec,
    bitrateKbps: base.bitrateKbps,
    warmupMs: base.warmupMs,
    durationMs: base.durationMs,
    sampleMs: base.sampleMs,
    allowOwnWindowCapture: base.allowOwnWindowCapture === true,
  };
}

/**
 * Argumentos -> plano executavel. `plan.errors` nao vazio = uso invalido.
 * `plan.scenarios[i]` = { key, id, label, config } com `key` = `${id}@v${viewers}`.
 */
function buildPlan(options = {}) {
  const errors = [];
  const base = {
    ...DEFAULTS,
    ...(options.quick ? QUICK : {}),
    allowOwnWindowCapture: options.allowOwnWindowCapture === true,
  };
  if (options.source !== undefined) base.source = options.source;
  if (options.codec !== undefined) base.codec = String(options.codec).toLowerCase();
  for (const k of NUMERIC) {
    if (options[k] === undefined || k === 'timeoutMs') continue;
    const n = parseIntStrict(options[k]);
    if (Number.isNaN(n)) errors.push(`--${k} precisa ser um inteiro (recebido: ${options[k]})`);
    else base[k] = n;
  }
  const viewers = options.viewers !== undefined ? parseViewers(options.viewers, errors) : DEFAULTS.viewers;

  let defs;
  const custom = options.pipeline !== undefined || options.hint !== undefined || options.topology !== undefined;
  if (custom) {
    if (options.only !== undefined) errors.push('--only nao combina com --pipeline/--hint/--topology');
    const pipeline = options.pipeline ?? 'direct';
    const topology = options.topology ?? 'p2p';
    const hint = options.hint ?? (pipeline === 'canvas' ? 'motion' : '');
    defs = [{ id: `custom-${pipeline}-${hint || 'nohint'}-${topology}`, label: 'personalizado', pipeline, hint, topology }];
  } else if (options.only !== undefined) {
    const wanted = String(options.only).split(',').map((s) => s.trim()).filter(Boolean);
    defs = [];
    for (const id of wanted) {
      const def = SCENARIOS.find((s) => s.id === id);
      if (!def) errors.push(`cenario desconhecido: ${id} (validos: ${SCENARIOS.map((s) => s.id).join(', ')})`);
      else if (!defs.includes(def)) defs.push(def);
    }
    if (!defs.length && !errors.length) errors.push('--only vazio');
  } else {
    defs = SCENARIOS;
  }

  const scenarios = [];
  const perScenario = new Map(); // mensagem -> chaves que a produziram
  for (const def of defs) {
    for (const v of viewers) {
      const config = scenarioConfig(base, def, v);
      const key = `${def.id}@v${v}`;
      for (const e of validateConfig(config)) perScenario.set(e, [...(perScenario.get(e) || []), key]);
      scenarios.push({ key, id: def.id, label: def.label, config });
    }
  }
  // Erro que vale pra todos os cenarios aparece uma vez, sem prefixo.
  for (const [message, keys] of perScenario) {
    errors.push(keys.length === scenarios.length ? message : `${keys.join(', ')}: ${message}`);
  }

  let timeoutMs;
  if (options.timeoutMs !== undefined) {
    timeoutMs = parseIntStrict(options.timeoutMs);
    inRange('timeoutMs', timeoutMs, errors);
  } else {
    // Por cenario: aquecimento + medida + tempo de negociar/fechar.
    timeoutMs = scenarios.reduce((t, s) => t + s.config.warmupMs + s.config.durationMs + 20000, 60000);
  }
  return {
    errors: [...new Set(errors)],
    base,
    scenarios,
    timeoutMs,
    out: options.out,
    label: options.label ? String(options.label).replace(/[^\w.-]+/g, '_').slice(0, 40) : '',
    show: options.show === true,
  };
}

module.exports = {
  LIMITS, DEFAULTS, QUICK, SCENARIOS, SOURCES, PIPELINES, HINTS, TOPOLOGIES, CODECS, HELP_TEXT,
  parseArgv, validateConfig, buildPlan,
};
