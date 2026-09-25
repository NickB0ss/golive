/*
 * Servidor de sinalizacao do GoLive LAN (nucleo reutilizavel).
 *
 * Nao passa video nenhum por aqui. A unica funcao dele e apresentar os peers
 * uns aos outros e repassar as mensagens de negociacao do WebRTC (offer,
 * answer, candidatos ICE). Depois que dois peers se acham, o video vai
 * direto de um pro outro pela LAN virtual.
 */

const { WebSocketServer } = require('ws');
const { randomUUID, randomBytes, timingSafeEqual } = require('node:crypto');
const { chooseSuccessor, chooseNewOwner } = require('../src/renderer/succession.js');
// Mesa (spec 2026-09-24, contrato em
// docs/superpowers/plans/2026-09-24-mesa-contrato.md): o MESMO modelo puro e
// os MESMOS modulos de janela que o renderer carrega. O servidor valida,
// carimba `seq` e aplica com `applyMessage`; cada cliente aplica a mesma
// mensagem com a mesma funcao.
const mesaModel = require('../src/renderer/mesa.js');
const mesaRegistry = require('../src/renderer/mesa-modules/index.js');

// O servidor de sinalizacao roda no MESMO processo do app de quem criou a
// sala. O `maxPayload` padrao do `ws` e 100 MB: um cliente hostil (ou com
// bug) poderia estourar a memoria desse processo com um unico frame. A
// maior mensagem legitima e o avatar (64 KB, validado no 'join'); 512 KB da
// folga pra base64 + envelope JSON sem abrir espaco pra abuso.
const MAX_PAYLOAD_BYTES = 512 * 1024;

// Teto de mensagens por segundo por socket. A sinalizacao e ociosa quase o
// tempo todo, MAS e bursty por natureza (ICE trickle) e tem uma rajada real
// no reingresso: quando um cliente reconecta, o handler de 'welcome' re-oferta
// pra sala inteira de uma vez -- ate `peers x kinds` RTCPeerConnection novas
// no mesmo instante, cada uma emitindo os candidatos ICE que junta.
//
// Pior caso realista (sala de 6, tela + camera):
//   pcs novas:        5 peers x 2 kinds                       = 10
//   ice/pc:           Ethernet + adaptador VPN + IPv6 + 2 srflx ~ 6-8
//   ice total:        10 x 8                                   = 80
//   offer + answer:   10 + 10                                  = 20
//   tree + watchers + view-state                               ~ 15
//   -----------------------------------------------------------------
//   ~115 frames no segundo de gathering
//
// 300/s cobre isso com folga de ~2.5x e ainda corta na hora um cliente em
// loop de verdade (um `while(true) ws.send()` faz dezenas de milhares/s).
const MAX_MSGS_PER_SECOND = 300;
const RATE_WINDOW_MS = 1000;

// Imagem no chat. O servidor de sinalizacao roda no PC de quem criou a
// sala, e o historico de chat vive na memoria desse processo -- por isso
// tem DOIS tetos, e nao um:
//
//  - MAX_IMAGE_CHARS: tamanho de UMA imagem (caracteres do data URL, ou
//    seja ~3/4 disso em bytes). O cliente ja reduz e reencoda ate caber
//    (ver chatmedia.js); este e o teto que nao depende de o cliente ser
//    o nosso.
//  - CHAT_IMAGE_HISTORY_MAX: quantas mensagens COM imagem o historico
//    guarda. 50 x 200 KB seriam 10 MB pendurados no host so pra quem
//    entrar depois ver print de meia hora atras; 8 poe o teto real em
//    ~1,6 MB. Quem ja esta na sala continua vendo tudo -- o corte e so
//    no que se conta pra quem chega.
const MAX_IMAGE_CHARS = 200 * 1024;
const CHAT_IMAGE_HISTORY_MAX = 8;

// Anotacao na tela (rabisco/escrita). Limitador SEPARADO do de sinalizacao
// e do de chat de proposito: desenhar rapido nao pode fechar o socket (o
// de sinalizacao fecha em 1008) nem gastar a cota de chat, e uma
// renegociacao acontecendo junto nao pode ser derrubada por quem esta
// rabiscando. O cliente manda um lote de pontos por quadro de animacao
// (~17/s no pior caso), entao 60/s e ~3x de folga.
const MAX_ANNOTATE_PER_SECOND = 60;
const MAX_ANNOTATE_POINTS = 200; // pontos por mensagem (lote de um quadro)
const MAX_ANNOTATE_TEXT = 120; // caracteres de uma escrita
const MAX_ANNOTATE_SYNC_ITEMS = 400; // itens de um snapshot pra quem chegou depois
const MAX_CONNECTIONS = 16;
const MAX_PENDING_CONNECTIONS = MAX_CONNECTIONS * 2;
const MAX_AVATAR_CHARS = 64 * 1024;
// Mesmo teto do campo `room` no join (linha 828 abaixo) -- nome de sala e
// nome de peer sao a mesma classe de texto curto de interface.
const MAX_ROOM_NAME_CHARS = 40;
const PIN_FAILURE_LIMIT = 5;
const PIN_FAILURE_WINDOW_MS = 60 * 1000;
const PIN_BLOCK_MS = 60 * 1000;
const MAX_PIN_FAILURE_ENTRIES = 1024;

// Sonda dirigida (P2, auditoria 2026-09-18 -- anexo 5-produto.md): um
// cliente no lobby manda 'probe' pra perguntar "essa sala existe e esta
// aberta?" sem entrar nela. Uso legitimo e no maximo 1 por conexao (o
// servidor fecha o socket logo depois de responder); a cota so segura o
// caso de alguem mandar varias antes do close ter efeito.
const MAX_PROBE_PER_SECOND = 3;
const MAX_PROBE_LIMITER_ENTRIES = 1024;

// Ids de conexao nascem em `String(nextId++)`: decimal positivo, sem zeros
// a esquerda. Number conserva inteiros exatos ate 16 algarismos; o teto
// tambem impede um kind composto de virar uma chave gigante no renderer.
const CONNECTION_ID_RE = /^[1-9]\d{0,15}$/;
const REOFFER_KINDS_RE = /^(screen|camera)(?:@([1-9]\d{0,15}))?$/;
const SURFACE_RE = /^([1-9]\d{0,15}):(screen|camera)$/;
const MAX_REOFFER_PER_SECOND = 2;

function parseReofferKind(kind) {
  if (typeof kind !== 'string') return null;
  const match = REOFFER_KINDS_RE.exec(kind);
  if (!match) return null;
  return { kind, sourceId: match[2] || null };
}

function parseSurface(surface) {
  if (typeof surface !== 'string') return null;
  const match = SURFACE_RE.exec(surface);
  if (!match || !CONNECTION_ID_RE.test(match[1])) return null;
  return { surface, ownerId: match[1] };
}

/** Contador de taxa por conexao, isolado pra ser testavel sem subir socket.
 * `hit(now)` registra uma mensagem e devolve `true` enquanto a conexao
 * estiver dentro do teto na janela corrente; `false` no primeiro estouro. */
function createRateLimiter({ limit = MAX_MSGS_PER_SECOND, windowMs = RATE_WINDOW_MS } = {}) {
  let windowStart = 0;
  let count = 0;
  return {
    hit(now) {
      if (now - windowStart >= windowMs) {
        windowStart = now;
        count = 0;
      }
      count += 1;
      return count <= limit;
    },
  };
}

function normalizeRemoteIp(ip) {
  return typeof ip === 'string' ? ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1') : null;
}

/** Cota de probe por IP, nao por socket. O Map tem ordem LRU e teto: cada
 * sonda abre e fecha uma conexao, portanto uma chave por conexao nao limita
 * nada e um Map sem teto vira alvo de exaustao de memoria. */
function createProbeLimiter({ limit = MAX_PROBE_PER_SECOND, windowMs = 1000, maxEntries = MAX_PROBE_LIMITER_ENTRIES } = {}) {
  const entries = new Map();
  return {
    hit(ip, now) {
      const key = normalizeRemoteIp(ip);
      if (!key) return false;
      let limiter = entries.get(key);
      if (!limiter) limiter = createRateLimiter({ limit, windowMs });
      // Apagar e reinserir move a entrada usada para o fim (LRU).
      entries.delete(key);
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      entries.set(key, limiter);
      return limiter.hit(now);
    },
  };
}

/** Limita tentativas de PIN por endereco remoto, nao por socket. */
function createPinFailureLimiter({ limit = PIN_FAILURE_LIMIT, windowMs = PIN_FAILURE_WINDOW_MS, blockMs = PIN_BLOCK_MS, maxEntries = MAX_PIN_FAILURE_ENTRIES } = {}) {
  const entries = new Map();
  const normalizeIp = (ip) => typeof ip === 'string' ? ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1') : null;
  function prune(now) {
    for (const [ip, entry] of entries) {
      if (entry.blockedUntil <= now && now - entry.windowStart >= windowMs) entries.delete(ip);
    }
  }
  return {
    blocked(ip, now) {
      prune(now);
      const key = normalizeIp(ip);
      return Boolean(key && entries.get(key)?.blockedUntil > now);
    },
    fail(ip, now) {
      prune(now);
      const key = normalizeIp(ip);
      if (!key) return false;
      let entry = entries.get(key);
      if (!entry || now - entry.windowStart >= windowMs) entry = { windowStart: now, failures: 0, blockedUntil: 0 };
      entry.failures += 1;
      if (entry.failures >= limit) entry.blockedUntil = now + blockMs;
      // A ordem do Map e LRU: ao atingir o teto, IPs que nao tentaram PIN
      // ha mais tempo saem antes de criar outra entrada.
      entries.delete(key);
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      entries.set(key, entry);
      return entry.blockedUntil > now;
    },
  };
}

// Reacoes precisam de rajada curta e depois cadencia constante, algo que
// uma janela fixa de "N por segundo" nao representa.
function createBurstLimiter({ capacity = 5, refillMs = 300 } = {}) {
  let tokens = capacity;
  let lastRefill = null;
  return {
    hit(now) {
      if (lastRefill === null) {
        lastRefill = now;
      } else {
        const refill = Math.floor((now - lastRefill) / refillMs);
        if (refill > 0) {
          tokens = Math.min(capacity, tokens + refill);
          lastRefill += refill * refillMs;
        }
      }
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

/** Dimensao de imagem vinda do cliente, so pra reservar a altura da linha
 * do chat. Qualquer coisa que nao seja um numero util vira `null` -- quem
 * desenha cai no tamanho natural da imagem. */
function clampDim(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), 10000);
}

/** Coordenada normalizada de anotacao: 0..1, tres casas. Fora disso (NaN,
 * negativo, 12, string) vira `null`, e a op inteira e descartada. */
function normPoint(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return Math.round(n * 1000) / 1000;
}

// Superficies de anotacao sao indexadas por '<dono>:<kind>' desde a 0.11.0
// (ver surfaceKey/parseSurface em src/renderer/annotate.js) -- a tela e a
// camera da MESMA pessoa sao duas lousas. Aqui o servidor so precisa de uma
// coisa da chave: DE QUEM e a superficie, pra conferir que essa pessoa esta
// nesta sala.
//
// Esta funcao e o espelho de `parseSurface` do cliente e tem de continuar
// sendo: chave sem kind vale como tela (formato de um cliente antigo), e
// sufixo desconhecido devolve a chave INTEIRA como dono -- inventar um
// corte ali daria um dono que nao existe, e a checagem de sala passaria a
// aprovar uma superficie forjada.
const SURFACE_KINDS = new Set(['screen', 'camera']);

function surfaceOwner(surfaceId) {
  const raw = String(surfaceId == null ? '' : surfaceId);
  const at = raw.lastIndexOf(':');
  if (at < 0) return raw;
  return SURFACE_KINDS.has(raw.slice(at + 1)) ? raw.slice(0, at) : raw;
}

// Cor do pincel: ou e um #rrggbb, ou o campo nao existe e o traco cai na cor
// derivada de quem desenhou (colorOf em annotate.js). Nada de "consertar" o
// que veio torto -- valor invalido some, nunca vira um valor inventado.
const ANNOTATE_COLOR_RE = /^#[0-9a-f]{6}$/;

function normColor(raw) {
  if (typeof raw !== 'string') return null;
  const c = raw.trim().toLowerCase();
  return ANNOTATE_COLOR_RE.test(c) ? c : null;
}

/** Valida e recorta uma op de anotacao vinda da rede, devolvendo SO os
 * campos que aquela op usa (ou `null` se ela nao for aproveitavel). Fora
 * do createSignalingServer pra poder ser testada sem subir socket.
 *
 * Reconstruir campo a campo e o que barra lixo -- e tambem o que faz um
 * campo NOVO desaparecer em silencio se ninguem o adicionar aqui. Foi o que
 * aconteceu com `annotate` no broadcast-state (0.10.2) e de novo com
 * `color` (0.11.0): quem desenhava via a propria cor, a sala via outra. */
function sanitizeAnnotateOp(msg) {
  const id = typeof msg.id === 'string' && msg.id ? msg.id.slice(0, 64) : null;
  switch (msg.op) {
    case 'begin': {
      const x = normPoint(msg.x);
      const y = normPoint(msg.y);
      if (!id || x === null || y === null) return null;
      const width = Number(msg.width);
      const op = { op: 'begin', id, x, y, width: Number.isFinite(width) ? Math.min(Math.max(width, 1), 20) : 4 };
      // A cor viaja no 'begin' e vale pro traco inteiro -- os 'points'
      // seguintes so estendem, entao ela nao se repete neles.
      const color = normColor(msg.color);
      if (color) op.color = color;
      return op;
    }
    case 'points': {
      if (!id || !Array.isArray(msg.points)) return null;
      const points = [];
      for (const p of msg.points.slice(0, MAX_ANNOTATE_POINTS)) {
        if (!Array.isArray(p)) continue;
        const x = normPoint(p[0]);
        const y = normPoint(p[1]);
        if (x === null || y === null) continue;
        points.push([x, y]);
      }
      if (!points.length) return null;
      return { op: 'points', id, points };
    }
    case 'end':
      return id ? { op: 'end', id } : null;
    case 'text': {
      const x = normPoint(msg.x);
      const y = normPoint(msg.y);
      const text = typeof msg.text === 'string' ? msg.text.slice(0, MAX_ANNOTATE_TEXT) : '';
      if (!id || x === null || y === null || !text.trim()) return null;
      const size = Number(msg.size);
      const op = { op: 'text', id, x, y, text, size: Number.isFinite(size) ? Math.min(Math.max(size, 8), 96) : 20 };
      const color = normColor(msg.color);
      if (color) op.color = color;
      return op;
    }
    case 'undo':
      return { op: 'undo' };
    case 'clear':
      return { op: 'clear', scope: msg.scope === 'all' ? 'all' : 'mine' };
    default:
      return null;
  }
}

/** Reconstrui um item de snapshot no mesmo formato de annotate.js#snapshot.
 * Snapshots nao sao ops incrementais: carregam `kind` e `from`, alem de todos
 * os pontos ja acumulados em um traco. */
function sanitizeAnnotateSnapshotItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : null;
  const from = raw.from == null ? null : String(raw.from).slice(0, 64);
  if (!id || !from) return null;
  if (raw.kind === 'stroke') {
    if (!Array.isArray(raw.points)) return null;
    const points = [];
    // O snapshot pode conter um traco inteiro (annotate.js: 2.000 pontos),
    // maior que um lote incremental (200 pontos).
    for (const point of raw.points.slice(0, 2000)) {
      if (!Array.isArray(point)) continue;
      const x = normPoint(point[0]);
      const y = normPoint(point[1]);
      if (x !== null && y !== null) points.push([x, y]);
    }
    if (!points.length) return null;
    const width = Number(raw.width);
    const item = { kind: 'stroke', id, from, width: Number.isFinite(width) ? Math.min(Math.max(width, 1), 20) : 4, points };
    const color = normColor(raw.color);
    if (color) item.color = color;
    return item;
  }
  if (raw.kind === 'text') {
    const x = normPoint(raw.x);
    const y = normPoint(raw.y);
    const text = typeof raw.text === 'string' ? raw.text.slice(0, MAX_ANNOTATE_TEXT) : '';
    if (x === null || y === null || !text.trim()) return null;
    const size = Number(raw.size);
    const item = { kind: 'text', id, from, text, x, y, size: Number.isFinite(size) ? Math.min(Math.max(size, 8), 96) : 20 };
    const color = normColor(raw.color);
    if (color) item.color = color;
    return item;
  }
  return null;
}

function sanitizeAvatar(avatar) {
  return typeof avatar === 'string'
    && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)
    && Buffer.byteLength(avatar, 'utf8') <= MAX_AVATAR_CHARS
    ? avatar
    : null;
}

// P4 (auditoria 2026-09-18, anexo 5-produto.md): o UNICO campo novo do
// 'broadcast-state' -- a origem anuncia a propria limitacao de encode
// (qualityLimitationReason do WebRTC, ja resumido em
// summarizeScreenEncodeHealth) pra quem assiste poder nomear o culpado
// quando a tela trava. Enum fechado: qualquer outra coisa (campo ausente,
// lixo de cliente hostil, versao futura com valor novo) vira null -- o
// mesmo tratamento de ausencia neutra que o resto do protocolo ja usa pra
// campo opcional (`annotate`/`paused` sao booleanos e caem em `false`; este
// e tri-estado e cair em `false` inventaria uma limitacao que nao existe).
const BROADCAST_LIMIT_VALUES = new Set(['bandwidth', 'cpu', 'other']);

function sanitizeLimit(raw) {
  return typeof raw === 'string' && BROADCAST_LIMIT_VALUES.has(raw) ? raw : null;
}

function sanitizeLaserOp(msg) {
  if (typeof msg.x !== 'number' || typeof msg.y !== 'number') return null;
  const x = normPoint(msg.x);
  const y = normPoint(msg.y);
  return x === null || y === null ? null : { x, y };
}

// Lista fechada de emojis permitidos. Espelho de REACTIONS de reactions.js:
// um emoji arbitrario de cliente hostil nunca atravessa a sala inteira.
const REACTION_EMOJI = new Set(['👍', '😂', '😮', '🔥', '👏', '❤️']);

// Eventos que o servidor emite e o renderer sabe apresentar no historico.
const SYSTEM_CHAT_EVENTS = new Set(['join', 'leave', 'stop-share', 'kick', 'ban', 'unban', 'transfer-owner']);

function sanitizeReactionOp(msg) {
  return typeof msg.emoji === 'string' && REACTION_EMOJI.has(msg.emoji) ? { emoji: msg.emoji } : null;
}

// ---------------------------------------------------------------------------
// Mesa
// ---------------------------------------------------------------------------

// Operacoes guardadas (mesa, mesa-grab). Humano mexendo nao passa de poucas
// por segundo; 20/s segura um cliente em loop sem fechar o socket (a recusa
// volta como mesa-denied 'rate').
const MESA_OPS_PER_SECOND = 20;
// mesa-drag e cursor, cada um com a sua cota: o cliente manda a 20 Hz
// (mesa.shouldEmit); 30/s da a folga do jitter sem virar amplificador.
const MESA_STREAM_PER_SECOND = 30;
// Uma acao de janela (jogada, play, texto da nota). A nota, a maior de
// hoje, cabe em ~6 KB no pior escape JSON; 8 KB e o teto do fio.
const MAX_MESA_ACTION_BYTES = 8 * 1024;

/** Janela da semente de migracao: so o que e da sala sobrevive.
 *
 * - Tipo desconhecido, tamanho fora do minimo do tipo ou estado acima do
 *   teto do tipo saem.
 * - Tela e camera saem: os ids das pessoas mudam no servidor novo, e o
 *   proprio servidor novo as poe de volta quando cada um reanuncia o
 *   broadcast-state/camera-state.
 * - `owner` vira null pelo mesmo motivo (o id antigo pode ser de outra
 *   pessoa agora). */
function acceptSeedWindow(win) {
  const mod = mesaRegistry.get(win.type);
  if (!mod || mod.media) return null;
  if (mesaModel.checkRect(win, mod.size) !== true) return null;
  if (mesaModel.jsonBytes(win.state) > mod.maxStateBytes) return null;
  return { ...win, owner: null };
}

/** Semente `initialMesa` (migracao) -> retrato limpo, igual o
 * initialChatHistory: nada de fora entra sem ser refeito campo a campo. */
function sanitizeInitialMesa(raw) {
  return mesaModel.sanitizeMesa(raw, { accept: acceptSeedWindow });
}

/** Primeiro id que o servidor novo pode dar sem repetir um id da sala que
 * caiu. Estado de jogo guarda ids de pessoas (cadeiras); se o servidor novo
 * recomecasse do 1, a cadeira de quem saiu seria de quem entrou. O servidor
 * antigo manda `mesa.idFloor` no room-migrating; sem ele (queda abrupta), o
 * maior id visto no chat e nas janelas e o piso. */
function seedIdFloor(initialMesa, initialChatHistory) {
  let floor = 1;
  const bump = (v) => {
    if (typeof v === 'string' && CONNECTION_ID_RE.test(v) && v.length <= 12) floor = Math.max(floor, Number(v) + 1);
  };
  const hint = initialMesa && typeof initialMesa === 'object' ? initialMesa.idFloor : null;
  if (Number.isSafeInteger(hint) && hint > 0 && hint < 1e12) floor = Math.max(floor, hint);
  for (const e of Array.isArray(initialChatHistory) ? initialChatHistory.slice(0, 50) : []) {
    bump(e?.from);
    bump(e?.id);
  }
  for (const w of Array.isArray(initialMesa?.windows) ? initialMesa.windows.slice(0, mesaModel.MAX_WINDOWS * 2) : []) bump(w?.owner);
  return floor;
}

function sanitizeInitialBan(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const { key, name } = entry;
  if (typeof key !== 'string' || key.length > 128 || !/^(client|ip):.+$/.test(key)) return null;
  if (typeof name !== 'string') return null;
  return { key, name: name.slice(0, 40) };
}

function sanitizeInitialChatEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.type !== 'chat') return null;
  if (entry.system === true) {
    if (typeof entry.event !== 'string' || !SYSTEM_CHAT_EVENTS.has(entry.event)) return null;
    const safe = { type: 'chat', system: true, event: entry.event };
    if (typeof entry.actor === 'string') safe.actor = entry.actor.slice(0, 40);
    if (typeof entry.target === 'string') safe.target = entry.target.slice(0, 40);
    if (typeof entry.ts === 'number' && Number.isFinite(entry.ts)) safe.ts = entry.ts;
    return safe;
  }
  if (typeof entry.text !== 'string') return null;
  const safe = { type: 'chat', text: entry.text.slice(0, 500) };
  if (typeof entry.id === 'string') safe.id = entry.id.slice(0, 64);
  if (typeof entry.from === 'string') safe.from = entry.from.slice(0, 64);
  if (typeof entry.name === 'string') safe.name = entry.name.slice(0, 40);
  if (typeof entry.ts === 'number' && Number.isFinite(entry.ts)) safe.ts = entry.ts;
  // Mantida igual a validacao no renderer (src/renderer/chatmedia.js) e a
  // segunda validacao de chat abaixo: servidor e renderer nao compartilham modulo.
  if (typeof entry.image === 'string'
    && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(entry.image)
    && entry.image.length <= MAX_IMAGE_CHARS) {
    safe.image = entry.image;
    safe.w = clampDim(entry.w);
    safe.h = clampDim(entry.h);
  }
  return safe;
}

// Destino padrao do log: o console, como sempre foi (o CLI em
// server/signaling.js usa este). O app embutido passa o proprio logger via
// `createSignalingServer({ log })` -- sem isso nada do que acontece no host
// (entrada, saida, heartbeat) chegava ao arquivo de log do usuario.
function consoleLog(...args) {
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...args);
}

// Nome e sala vem do cliente: JSON.stringify escapa quebra de linha e
// controle (uma linha forjada nao se passa por outra no arquivo de log), e o
// corte em 24 mantem a linha legivel sem perder quem e quem.
function logName(name) {
  return JSON.stringify(String(name).slice(0, 24));
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

// P1 (auditoria 2026-09-18, anexo 5-produto.md): nome da sala escolhido por
// quem a cria. Vem do main.js (room:host) hoje, mas normalizado aqui com a
// mesma disciplina de qualquer campo de texto de entrada -- o CLI
// (server/signaling.js) tambem chama createSignalingServer diretamente, sem
// passar pelo dialogo do renderer que ja normaliza a digitacao.
//
// Loop em vez de regex com classe de controle: o eslint deste projeto trava
// (no-control-regex) em qualquer intervalo de controle literal na regex.
function isControlChar(codePoint) {
  return codePoint <= 0x1f || codePoint === 0x7f;
}

/** Caracteres de controle viram espaco (nao somem: "a\nb" nao pode colar em
 * "ab"), espacos repetidos colapsam, e as pontas sao aparadas. Vazio depois
 * disso (ou tipo errado, ou maior que o teto) volta null -- quem usa cai no
 * nome padrao "sala de <host>", montado por effectiveRoomName(). */
function normalizeRoomName(raw) {
  if (typeof raw !== 'string') return null;
  let semControle = '';
  for (const ch of raw) semControle += isControlChar(ch.codePointAt(0)) ? ' ' : ch;
  const colapsado = semControle.replace(/\s+/g, ' ').trim().slice(0, MAX_ROOM_NAME_CHARS);
  return colapsado || null;
}

/** Cria o servidor de sinalizacao. Resolve quando a porta esta escutando,
 * rejeita (com err.code === 'EADDRINUSE' se for o caso) se nao conseguir.
 *
 * `heartbeatMs`: intervalo do ping keep-alive. A conexao de sinalizacao
 * fica ociosa quase o tempo todo (so a negociacao WebRTC passa por aqui);
 * numa LAN virtual (Radmin/Tailscale) uma conexao TCP ociosa por
 * 60-120s tem o estado de NAT descartado e o cliente "cai da sala"
 * sozinho, com close code 1006. O ping periodico mantem o fluxo vivo e
 * ainda deixa o servidor derrubar quem parou de responder.
 *
 * `log`: funcao variadica `(...args) => void` que recebe as linhas de
 * diagnostico (nunca IP, PIN, token ou clientId). Padrao: o console.
 *
 * `livenessMs`: intervalo do `{type:'hb'}` que o servidor manda a cada
 * membro. O ping acima e invisivel pro cliente (o navegador responde o pong
 * sozinho e nao expoe o frame), entao sozinho ele nao deixa o cliente saber
 * que a sinalizacao morreu: no log de 21/09 levou ~25 s. Com o hb, o vigia
 * de silencio do cliente (src/renderer/signaling.js) fecha e reconecta
 * depois de SILENCE_TIMEOUT_MS sem nenhuma mensagem.
 *
 * `resumeGraceMs`: quanto um peer com close anormal continua membro antes
 * de sair de verdade. `getPeerCount()` inclui esses peers suspensos.
 *
 * `initialMesa`: semente da mesa na migracao (ver sanitizeInitialMesa).
 * `mesaGrabMs`: quanto dura a vez por janela sem mesa-drag (padrao
 * GRAB_MS, 5 s; os testes encurtam). */
function createSignalingServer({ port, heartbeatMs = 25000, livenessMs = 5000, resumeGraceMs = 20000, pin = null, ownerToken = null, appVersion = null, log: logSink = consoleLog, roomId, roomName = null, initialTransferredTo = null, initialBans, initialChatHistory, initialMesa, mesaGrabMs = mesaModel.GRAB_MS }) {
  if (pin != null && String(pin) !== '' && !/^\d{6}$/.test(String(pin))) {
    return Promise.reject(new Error('PIN da sala deve ter exatamente 6 dígitos.'));
  }
  // O servidor roda no processo de quem hospeda: um logger que lance (disco
  // cheio, arquivo travado) dentro de um handler do ws subiria como uncaught
  // e derrubaria a sala inteira por causa de uma linha de diagnostico. A
  // falha vai pro console em vez de sumir.
  const sink = typeof logSink === 'function' ? logSink : consoleLog;
  const log = (...args) => {
    try {
      sink(...args);
    } catch (err) {
      console.error('[signaling] falha ao gravar log:', err?.message || err);
    }
  };
  // PIN opcional da sala (B3 da auditoria). Nao e cripto: so corta o
  // entrar-por-acidente numa rede Radmin/Tailscale compartilhada, onde o
  // beacon anuncia a sala pra todo mundo. `null`/'' => sala aberta, igual
  // a sempre. Normalizado pra string pra comparar com o que vem do cliente.
  const roomPin = pin != null && String(pin) !== '' ? String(pin) : null;
  const stableRoomId = typeof roomId === 'string' && roomId !== '' && roomId.length <= 100 ? roomId : randomUUID();
  // Nome da sala (P1), ja normalizado -- null quando quem criou nao digitou
  // nada (ou digitou so espaco/controle). effectiveRoomName() decide o
  // padrao na hora de montar welcome/room-migrating, ali onde ha acesso ao
  // peer do host pra montar "sala de <nome dele>".
  const stableRoomName = normalizeRoomName(roomName);
  // Token de dono (opcional). Gerado pelo main.js e devolvido so pro
  // renderer de quem criou a sala -- nunca sai da maquina. Comparado por
  // igualdade estrita: string vazia/null nunca marca dono.
  const ownerTok = typeof ownerToken === 'string' && ownerToken !== '' ? ownerToken : null;
  // Versao do app de quem hospeda. Quando definida, TODO mundo que entrar
  // tem de estar exatamente nela: o protocolo de sinalizacao, o formato da
  // arvore e a negociacao P2P mudam entre releases sem nenhum acordo de
  // compatibilidade, e uma sala com versoes misturadas quebra de um jeito
  // que parece problema de rede (tile que nunca abre, arvore que nao fecha).
  // `null` (o default, usado pelos testes de protocolo) desliga a checagem.
  const hostVersion = typeof appVersion === 'string' && appVersion.trim() !== '' ? appVersion.trim() : null;
  const sameVersion = (v) => typeof v === 'string' && v.trim() !== '' && v.trim().replace(/^v/, '') === hostVersion.replace(/^v/, '');
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port, maxPayload: MAX_PAYLOAD_BYTES });

    /** @type {Map<string, {ws: import('ws').WebSocket, name: string, room: string, avatar: string | null, owner: boolean, clientId: string | null, resumeToken: string, address: string | null}>} */
    const peers = new Map();
    let nextId = 1;
    let closingRoom = false;

    // Quem recebeu a lideranca da sala (clientId), ou null enquanto ela
    // nunca saiu de quem criou a sala. E o que decide `owner` no join --
    // ver a spec de 2026-09-04, secao 4.1: sem isto, o host que passa a
    // lideranca e depois reconecta voltaria como dono (o ownerToken dele
    // continua valido) e a sala teria duas coroas.
    let transferredTo = typeof initialTransferredTo === 'string' && initialTransferredTo !== '' && initialTransferredTo.length <= 100
      ? initialTransferredTo
      : null;

    const CHAT_HISTORY_MAX = 50;
    const chatHistory = []; // ring buffer -- mensagens de texto e linhas de sistema juntas
    const chatRateLimiters = new Map(); // peerId -> limiter, 5 msg/s
    const chatImageLimiters = new Map(); // peerId -> limiter, 3 imagens / 5s
    const annotateLimiters = new Map(); // peerId -> limiter, 60 msg/s
    const laserLimiters = new Map(); // peerId -> limiter, 30 msg/s
    const reactionLimiters = new Map(); // peerId -> limiter, rajada 5, 1 / 300ms
    const reofferLimiters = new Map(); // peerId -> limiter, 2 reofertas/s
    const annotateSyncLimiters = new Map(); // peerId -> limiter, snapshots sao caros
    const pinFailures = createPinFailureLimiter();
    // 'watchers' e reenviado pra sala inteira com os avatares (data URL de
    // ate 64 KB cada): sem teto proprio, um cliente em loop faria o host
    // replicar megabytes por mensagem. Uso legitimo e rajada curta em
    // mudanca de topologia (tela + camera + cada origem repassada).
    const MAX_WATCHERS_PER_SECOND = 20;
    const watchersLimiters = new Map(); // peerId -> limiter, 20 msg/s
    // 'probe' e o unico tipo aceito de socket que nunca chegou a entrar.
    // Como ele fecha o socket apos responder, a chave precisa ser o IP.
    const probeLimiter = createProbeLimiter();

    function pushChatEntry(entry) {
      chatHistory.push(entry);
      if (chatHistory.length > CHAT_HISTORY_MAX) chatHistory.shift();
      if (entry.image) trimImageHistory();
    }

    /** Mantem no maximo CHAT_IMAGE_HISTORY_MAX mensagens com imagem no
     * historico, descartando a mais antiga inteira. Roda so quando uma
     * imagem entra -- mensagem de texto nao mexe nisso. */
    function trimImageHistory() {
      let extras = chatHistory.filter((e) => e.image).length - CHAT_IMAGE_HISTORY_MAX;
      while (extras > 0) {
        const i = chatHistory.findIndex((e) => e.image);
        if (i < 0) return;
        chatHistory.splice(i, 1);
        extras -= 1;
      }
    }

    for (const entry of Array.isArray(initialChatHistory) ? initialChatHistory.slice(0, CHAT_HISTORY_MAX) : []) {
      const safe = sanitizeInitialChatEntry(entry);
      if (safe) pushChatEntry(safe);
    }

    // A mesa da sala. Guardada aqui como o historico do chat: sempre existe,
    // quem esta na vista Transmissao so nao recebe nada dela. Semente de
    // migracao em `initialMesa`, limpa como o initialChatHistory.
    let mesaState = mesaModel.createState({ mesa: initialMesa }, { accept: acceptSeedWindow });
    nextId = Math.max(nextId, seedIdFloor(initialMesa, initialChatHistory));
    const mesaGrabs = mesaModel.createGrabs({ ms: mesaGrabMs }); // vez por janela
    const mesaLimiters = new Map(); // peerId -> { ops, drag, cursor, sync, time }

    /** Linha de sistema (entrada/saida/moderacao). `target` e omitido pra
     * join/leave -- o `actor` JA e quem entrou ou saiu. Guardada no historico
     * (pra quem entrar depois ver o que passou) e broadcast pra sala.
     * `exceptId` pula um peer no broadcast ao vivo: o proprio recem-chegado
     * nao precisa da linha "fulano entrou" sobre si (o welcome dele ja
     * estabeleceu que ele entrou), igual o `peer-joined` tambem o pula. */
    function pushSystemLine(room, event, actor, target, exceptId = null) {
      const entry = { type: 'chat', system: true, event, actor, ...(target ? { target } : {}), ts: Date.now() };
      pushChatEntry(entry);
      broadcastToRoom(room, exceptId, entry);
    }

    // Segredo de migracao por sala (item C da auditoria 2026-09-18). E o que
    // autentica o beacon UDP de migracao: o sucessor assina com ele e cada
    // sobrevivente confere antes de seguir o endereco. Rotaciona a cada
    // entrada/retomada (welcome) e a cada saida definitiva, e so vai pra
    // quem esta dentro -- quem saiu, foi expulso ou banido fica com um
    // segredo velho que nao prova mais nada. NUNCA vai pro log.
    const migrationSecrets = new Map(); // room -> segredo atual
    function rotateMigrationSecret(room) {
      const secret = randomBytes(32).toString('base64url');
      migrationSecrets.set(room, secret);
      return secret;
    }

    // IP de cada membro como ESTE servidor o ve (item B): e por ele que os
    // pares ja se alcancam na LAN virtual, e e nele que os sobreviventes
    // procuram o sucessor direto quando o lider cai -- sem broadcast.
    function peerAddressesOf(room) {
      const out = {};
      for (const [id, peer] of peers) {
        if (peer.room !== room) continue;
        const addr = normalizeAddress(peer.address);
        if (addr) out[id] = addr;
      }
      return out;
    }

    /** Segredo novo + enderecos pra todo mundo da sala menos `exceptId` (o
     * recem-chegado recebe os dois no proprio welcome). */
    function announceMigrationInfo(room, secret, exceptId = null) {
      broadcastToRoom(room, exceptId, { type: 'migration-info', migrationSecret: secret, peerAddresses: peerAddressesOf(room) });
    }

    function roomPeers(room, exceptId) {
      const out = [];
      for (const [id, peer] of peers) {
        if (peer.room === room && id !== exceptId) out.push({ id, name: peer.name, avatar: peer.avatar, owner: peer.owner });
      }
      return out;
    }

    function broadcastToRoom(room, exceptId, payload) {
      for (const [id, peer] of peers) {
        if (peer.room === room && id !== exceptId) send(peer.ws, payload);
      }
    }

    // Chave(s) de ban pra um peer: client:<clientId> sempre que houver
    // clientId (o caso comum), e ip:<endereco> so quando o endereco NAO for
    // loopback -- o dono conecta em 127.0.0.1, e banir por loopback baniria
    // o proprio dono no proximo reconnect. Ver a spec, secao 9.3.
    function normalizeAddress(address) {
      if (typeof address !== 'string') return null;
      return address.replace(/^::ffff:/, '');
    }
    function isLoopback(address) {
      return address === '127.0.0.1' || address === '::1';
    }
    function findHostPeerId(room = null) {
      for (const [id, peer] of peers) {
        if ((room === null || peer.room === room) && isLoopback(normalizeAddress(peer.address))) return id;
      }
      return null;
    }
    // P1: nome de exibicao da sala. Quando ninguem escolheu um (stableRoomName
    // null), cai no mesmo texto que o cabecalho sempre mostrou -- so que
    // montado com o nome de quem REALMENTE hospeda (o peer do loopback),
    // nao com o nome de quem esta perguntando.
    function effectiveRoomName(room = null) {
      if (stableRoomName) return stableRoomName;
      const hostPeerId = findHostPeerId(room);
      const hostPeer = hostPeerId ? peers.get(hostPeerId) : null;
      return `sala de ${hostPeer?.name || 'anônimo'}`;
    }
    function banKeysFor({ address, clientId }) {
      const keys = [];
      const ip = normalizeAddress(address);
      if (ip && !isLoopback(ip)) keys.push(`ip:${ip}`);
      if (typeof clientId === 'string' && clientId) keys.push(`client:${clientId}`);
      return keys;
    }

    const bans = new Map(); // qualquer chave (ip: ou client:) -> { primaryKey, name }

    for (const entry of Array.isArray(initialBans) ? initialBans.slice(0, 200) : []) {
      const safe = sanitizeInitialBan(entry);
      if (safe) bans.set(safe.key, { primaryKey: safe.key, name: safe.name });
    }

    function findBan(keys) {
      for (const k of keys) if (bans.has(k)) return bans.get(k);
      return null;
    }
    function addBan(keys, name) {
      if (!keys.length) return null;
      const primaryKey = keys.find((k) => k.startsWith('client:')) || keys[0];
      for (const k of keys) bans.set(k, { primaryKey, name });
      return primaryKey;
    }
    function removeBan(primaryKey) {
      for (const [k, rec] of bans) if (rec.primaryKey === primaryKey) bans.delete(k);
    }
    function listBans() {
      const seen = new Set();
      const out = [];
      for (const rec of bans.values()) {
        if (seen.has(rec.primaryKey)) continue;
        seen.add(rec.primaryKey);
        out.push({ key: rec.primaryKey, name: rec.name });
      }
      return out;
    }
    function sendBannedListToOwner(room) {
      for (const [, peer] of peers) {
        if (peer.room === room && peer.owner) send(peer.ws, { type: 'banned-list', list: listBans() });
      }
    }

    // ---- Mesa ---------------------------------------------------------
    //
    // Quem recebe o que: so quem mandou `mesa-view {on:true}` (esta com a
    // vista Mesa aberta) recebe mesa, mesa-grab/release, mesa-drag e cursor.
    // Quem esta na Transmissao nao paga nada pela mesa; ao abrir a Mesa
    // recebe o retrato (mesa-sync) e dai em diante as mudancas.
    //
    // Telas e cameras: quem POE e TIRA as janelas `tela`/`camera` e o
    // servidor, pelo broadcast-state/camera-state que ele ja repassa. Quem
    // vai ao vivo pode estar na vista Transmissao (sem mesa nenhuma na
    // tela), e quem sai da sala nao manda mais nada -- o servidor e o unico
    // que ve os dois casos. O cliente nao pode pedir `add` de tela/camera.

    function mesaHit(pid, kind) {
      let set = mesaLimiters.get(pid);
      if (!set) {
        set = {
          ops: createRateLimiter({ limit: MESA_OPS_PER_SECOND, windowMs: 1000 }),
          drag: createRateLimiter({ limit: MESA_STREAM_PER_SECOND, windowMs: 1000 }),
          cursor: createRateLimiter({ limit: MESA_STREAM_PER_SECOND, windowMs: 1000 }),
          // Cada mesa-view on / mesa-sync manda o retrato inteiro (ate
          // ~512 KB): rajada curta, reposicao lenta.
          sync: createBurstLimiter({ capacity: 4, refillMs: 1000 }),
          time: createBurstLimiter({ capacity: 10, refillMs: 500 }),
        };
        mesaLimiters.set(pid, set);
      }
      return set[kind].hit(Date.now());
    }

    function mesaViewerIds(room) {
      const out = [];
      for (const [pid, peer] of peers) if (peer.room === room && peer.mesaView) out.push(pid);
      return out.sort((a, b) => Number(a) - Number(b));
    }

    function broadcastToMesa(room, exceptId, payload) {
      for (const [pid, peer] of peers) {
        if (peer.room === room && peer.mesaView && pid !== exceptId) send(peer.ws, payload);
      }
    }

    function announceMesaViewers(room) {
      broadcastToRoom(room, null, { type: 'mesa-viewers', peers: mesaViewerIds(room) });
    }

    function releaseMesaGrabsOf(room, pid) {
      for (const wid of mesaGrabs.dropPeer(pid)) broadcastToMesa(room, null, { type: 'mesa-release', id: wid });
    }

    /** A pessoa abriu (on) ou fechou a vista Mesa. Abrir sempre manda o
     * retrato, mesmo para quem ja estava (serve de "me manda de novo"). */
    /** O retrato que vai para quem abre a Mesa (ou pede sync): a mesa e as
     * vezes em andamento. Sem as vezes, quem abre a Mesa no meio de um
     * arraste so saberia do "Bia esta movendo" no proximo mesa-drag, e podia
     * pegar a janela e levar um `held` sem aviso nenhum antes. As vezes
     * ficam FORA de `mesa` de proposito: nao sao estado da sala (nao migram,
     * nao tem seq), so o que esta acontecendo agora. */
    function mesaSyncMsg() {
      const grabs = mesaGrabs.list(Date.now()).map(({ id, by }) => ({ id, by }));
      return { type: 'mesa-sync', mesa: mesaModel.snapshot(mesaState), grabs };
    }

    function setMesaView(pid, on) {
      const peer = peers.get(pid);
      if (!peer) return;
      const was = peer.mesaView === true;
      peer.mesaView = on;
      if (on) send(peer.ws, mesaSyncMsg());
      else releaseMesaGrabsOf(peer.room, pid);
      if (was !== on) announceMesaViewers(peer.room);
    }

    function mesaPeersCtx(room) {
      return roomPeers(room).map((p) => ({ id: p.id, name: p.name }));
    }

    function newWindowId() {
      let wid;
      do {
        wid = randomBytes(6).toString('base64url');
      } while (mesaState.mesa.windows.some((w) => w.id === wid));
      return wid;
    }

    /** Monta a mensagem aceita (com o proximo seq) e o estado que ela daria,
     * pelo mesmo applyMessage dos clientes. Nada muda ate o commitMesa. */
    function mesaCandidate(msg) {
      const full = { ...msg, type: 'mesa', seq: mesaState.mesa.seq + 1 };
      const res = mesaModel.applyMessage(mesaState, full, { getModule: mesaRegistry.get });
      if (res.needSync || res.stale || res.state === mesaState) return null;
      return { full, state: res.state };
    }

    /** Aplica a mudanca aceita e manda o eco para quem esta na Mesa.
     *
     * Quem esta na Transmissao nao recebe a mesa, mas o seletor de vista dele
     * mostra se a mesa tem janelas: quando a QUANTIDADE muda (add/remove),
     * vai um `mesa-count` para a sala inteira -- uma mensagem de 30 bytes,
     * so quando a conta muda (mover, redimensionar e agir nao mandam nada).
     *
     * `author` (opcional): quem pediu. Se ele esta na Transmissao nao ve o
     * eco, entao ganha um `mesa-ack` so para ele (o "Por na mesa" do chat
     * precisa saber que deu certo e qual id a janela ganhou). */
    function commitMesa(room, cand, author = null) {
      const before = mesaState.mesa.windows.length;
      mesaState = cand.state;
      broadcastToMesa(room, null, cand.full);
      const count = mesaState.mesa.windows.length;
      if (count !== before) broadcastToRoom(room, null, { type: 'mesa-count', count });
      const who = author ? peers.get(author) : null;
      if (who && !who.mesaView) {
        const f = cand.full;
        send(who.ws, { type: 'mesa-ack', op: f.op, id: f.op === 'add' ? f.win.id : (f.id ?? null), seq: f.seq });
      }
      return cand.full;
    }

    function denyMesa(ws, op, wid, reason, extra = {}) {
      send(ws, { type: 'mesa-denied', op, id: wid ?? null, reason, ...extra });
    }

    function findMediaWindow(pid, type) {
      return mesaState.mesa.windows.find((w) => w.type === type && w.state?.peerId === pid) || null;
    }

    /** Poe a tela (ou camera) de quem acabou de ir ao vivo no lugar livre
     * mais perto do meio da mesa. Mesa cheia: fica sem janela, e a pessoa
     * continua na Transmissao de todo mundo como sempre. */
    function addMediaWindow(room, pid, type) {
      if (findMediaWindow(pid, type)) return;
      const mod = mesaRegistry.get(type);
      if (!mod || mesaState.mesa.windows.length >= mesaModel.MAX_WINDOWS) return;
      const { w, h } = mod.size;
      const want = { x: Math.round((mesaModel.WORLD.w - w) / 2), y: Math.round((mesaModel.WORLD.h - h) / 2), w, h };
      const rect = mesaModel.nearestFree(mesaState.mesa.windows, want, { gap: mesaModel.GAP });
      if (!rect) return;
      const state = mod.init({ by: pid, from: pid, now: Date.now(), peers: mesaPeersCtx(room), isLeader: peers.get(pid)?.owner === true, random: Math.random });
      const cand = mesaCandidate({ op: 'add', by: pid, win: { id: newWindowId(), type, owner: pid, ...rect, state } });
      if (cand) commitMesa(room, cand);
    }

    function removeMediaWindows(room, pid, types) {
      for (const win of mesaState.mesa.windows.filter((w) => types.includes(w.type) && w.state?.peerId === pid)) {
        const cand = mesaCandidate({ op: 'remove', id: win.id, by: pid });
        if (!cand) continue;
        commitMesa(room, cand);
        mesaGrabs.drop(win.id);
      }
    }

    /** Uma operacao `mesa` vinda de `pid`. Aceita tambem de quem esta na
     * vista Transmissao ("Por na mesa" de um link do chat); o eco so vai
     * para quem esta na Mesa, e a recusa sempre volta para o autor. */
    function handleMesaOp(pid, me, ws, msg) {
      const op = typeof msg.op === 'string' ? msg.op.slice(0, 16) : null;
      const wid = typeof msg.id === 'string' ? msg.id.slice(0, 32) : null;
      const deny = (reason, extra) => denyMesa(ws, op, wid, reason, extra);
      if (!mesaHit(pid, 'ops')) return deny('rate');
      const isLeader = me.owner === true;
      const mesa = mesaState.mesa;
      const now = Date.now();
      const ctx = () => ({ from: pid, by: pid, isLeader, now, peers: mesaPeersCtx(me.room), random: Math.random });
      // Modulo de janela e codigo de outro time rodando no processo de quem
      // hospeda: excecao dele vira recusa, nunca queda da sala.
      const guard = (fase, type, fn) => {
        try {
          return { ok: true, value: fn() };
        } catch {
          log(`mesa: modulo ${JSON.stringify(type)} lancou em ${fase}`);
          return { ok: false };
        }
      };
      // Sobreposicao ou fora do mundo: recusa com o lugar livre mais perto.
      const denyPlace = (verdict, rect, ignoreId) => {
        const fix = mesaModel.nearestFree(mesa.windows, rect, { gap: mesaModel.GAP, ignoreId });
        if (!fix) return deny('no-space');
        return deny(verdict === 'out-of-world' ? 'out-of-world' : 'overlap', { fix });
      };
      const win = wid ? mesa.windows.find((w) => w.id === wid) || null : null;

      switch (op) {
        case 'add': {
          const raw = msg.win;
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return deny('bad-request');
          const mod = typeof raw.type === 'string' ? mesaRegistry.get(raw.type) : null;
          if (!mod) return deny('unknown-type');
          if (mod.media) return deny('auto'); // tela e camera: o servidor poe sozinho
          if (mesa.leaderOnly && !isLeader) return deny('locked');
          if (mesa.windows.length >= mesaModel.MAX_WINDOWS) return deny('full');
          const rect = mesaModel.normRect(raw);
          if (!rect) return deny('bad-rect');
          const verdict = mesaModel.checkRect(rect, mod.size);
          if (verdict !== true && verdict !== 'out-of-world') return deny(verdict);
          if (verdict === 'out-of-world' || mesa.windows.some((o) => mesaModel.overlaps(rect, o, 0))) return denyPlace(verdict, rect, null);
          const init = guard('init', mod.type, () => mesaModel.cloneJson(mod.init(ctx())));
          if (!init.ok || init.value === undefined) return deny('error');
          if (mesaModel.jsonBytes(init.value) > mod.maxStateBytes) return deny('state-too-big');
          const cand = mesaCandidate({ op: 'add', by: pid, win: { id: newWindowId(), type: mod.type, owner: pid, ...rect, state: init.value } });
          if (!cand) return deny('error');
          commitMesa(me.room, cand, pid);
          return;
        }
        case 'remove': {
          if (!win) return deny('not-found');
          const mod = mesaRegistry.get(win.type);
          if (mesa.leaderOnly && !isLeader) return deny('locked');
          // A tela de alguem ao vivo so sai pela propria pessoa ou pelo
          // lider: senao qualquer um sumiria com a transmissao dos outros.
          if (mod?.media && win.state?.peerId !== pid && !isLeader) return deny('not-yours');
          const holder = mesaGrabs.holder(win.id, now);
          if (holder !== null && holder !== pid) return deny('held', { holder });
          const cand = mesaCandidate({ op: 'remove', id: win.id, by: pid });
          if (!cand) return deny('error');
          commitMesa(me.room, cand, pid);
          mesaGrabs.drop(win.id);
          return;
        }
        case 'place': {
          if (!win) return deny('not-found');
          const mod = mesaRegistry.get(win.type);
          if (!mod) return deny('unknown-type');
          if (mesa.leaderOnly && !isLeader) return deny('locked');
          const holder = mesaGrabs.holder(win.id, now);
          if (holder !== null && holder !== pid) return deny('held', { holder });
          const rect = mesaModel.normRect(msg);
          if (!rect) return deny('bad-rect');
          // "Travar tamanho": mover sem mudar o tamanho continua livre.
          if (mesa.lockSize && !isLeader && (rect.w !== win.w || rect.h !== win.h)) return deny('size-locked');
          const verdict = mesaModel.checkRect(rect, mod.size);
          if (verdict !== true && verdict !== 'out-of-world') return deny(verdict);
          const others = mesa.windows.filter((o) => o.id !== win.id);
          if (verdict === 'out-of-world' || others.some((o) => mesaModel.overlaps(rect, o, 0))) return denyPlace(verdict, rect, win.id);
          const cand = mesaCandidate({ op: 'place', id: win.id, ...rect, by: pid });
          if (!cand) return deny('error');
          commitMesa(me.room, cand, pid);
          return;
        }
        case 'act': {
          // Com qualquer trava, usar a janela (jogar, dar play) continua livre.
          if (!win) return deny('not-found');
          const mod = mesaRegistry.get(win.type);
          if (!mod || typeof mod.reduce !== 'function') return deny('no-act');
          const raw = msg.action;
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return deny('bad-request');
          if (mesaModel.jsonBytes(raw) > MAX_MESA_ACTION_BYTES) return deny('too-big');
          const action = mesaModel.cloneJson(raw);
          const c = ctx();
          // validate ve a acao como o cliente mandou (o cliente chama o
          // mesmo validate para desligar botoes, sem prepare); prepare poe
          // sorte e hora depois; reduce so le o que veio na acao.
          const verdict = guard('validate', mod.type, () => mod.validate(win.state, action, c));
          if (!verdict.ok) return deny('error');
          if (verdict.value !== true) return deny('invalid', { detail: typeof verdict.value === 'string' ? verdict.value.slice(0, 120) : null });
          let prepared = action;
          if (typeof mod.prepare === 'function') {
            const p = guard('prepare', mod.type, () => mesaModel.cloneJson(mod.prepare(win.state, action, c)));
            if (!p.ok || !p.value || typeof p.value !== 'object' || Array.isArray(p.value)) return deny('error');
            prepared = p.value;
          }
          const cand = mesaCandidate({ op: 'act', id: win.id, action: prepared, by: pid, isLeader });
          if (!cand) {
            log(`mesa: modulo ${JSON.stringify(mod.type)} falhou no reduce`);
            return deny('error');
          }
          const after = cand.state.mesa.windows.find((w) => w.id === win.id);
          if (!after || mesaModel.jsonBytes(after.state) > mod.maxStateBytes) return deny('state-too-big');
          commitMesa(me.room, cand, pid);
          return;
        }
        case 'lock': {
          if (!isLeader) return deny('leader-only');
          const leaderOnly = typeof msg.leaderOnly === 'boolean' ? msg.leaderOnly : null;
          const lockSize = typeof msg.lockSize === 'boolean' ? msg.lockSize : null;
          if (leaderOnly === null && lockSize === null) return deny('bad-request');
          // Vai sempre com as duas travas resolvidas: quem recebe nao precisa
          // saber qual das duas mudou.
          const cand = mesaCandidate({
            op: 'lock',
            leaderOnly: leaderOnly ?? mesa.leaderOnly,
            lockSize: lockSize ?? mesa.lockSize,
            by: pid,
          });
          if (!cand) return deny('error');
          commitMesa(me.room, cand, pid);
          return;
        }
        default:
          return deny('bad-request');
      }
    }

    /** Anuncia quem e o dono da sala AGORA. `owner`/`ownerId` nulos dizem
     * "a sala esta sem dono" -- estado real quando o lider sai e quem criou
     * a sala nao esta mais nela.
     *
     * A lista de banidos migra junto: ela e ferramenta de dono, e quem
     * deixou de ser recebe uma lista vazia (e assim a secao "Banidos" some
     * da coluna dele) enquanto o novo recebe a de verdade. */
    function announceOwner(room, owner, ownerId) {
      broadcastToRoom(room, null, {
        type: 'owner-changed',
        id: ownerId ?? null,
        name: owner?.name ?? null,
      });
      for (const [, peer] of peers) {
        if (peer.room !== room) continue;
        if (peer.owner) send(peer.ws, { type: 'banned-list', list: listBans() });
        else send(peer.ws, { type: 'banned-list', list: [] });
      }
    }

    // O token e uma credencial, nao uma identidade: jamais vai em log ou em
    // mensagens de sala. Comparar os buffers so quando tem o mesmo tamanho
    // permite usar timingSafeEqual sem abrir a excecao de tamanhos distintos.
    function sameResumeToken(a, b) {
      if (typeof a !== 'string' || typeof b !== 'string') return false;
      const aa = Buffer.from(a);
      const bb = Buffer.from(b);
      return aa.length === bb.length && timingSafeEqual(aa, bb);
    }

    function clearResumeTimer(peer) {
      if (!peer?._resumeTimer) return;
      clearTimeout(peer._resumeTimer);
      peer._resumeTimer = null;
    }

    function suspendPeer(peerId, code) {
      const peer = peers.get(peerId);
      if (!peer || peer._suspendedAt) return;
      peer._suspendedAt = Date.now();
      log(`suspenso #${peerId} (code=${code})`);
      peer._resumeTimer = setTimeout(() => {
        // A retomada troca o socket e limpa o timer. Esta identidade impede
        // que um timeout velho tire quem ja voltou para a sala.
        if (peers.get(peerId) !== peer || !peer._suspendedAt) return;
        peer._resumeTimer = null;
        log(`retomada expirou #${peerId}`);
        removePeer(peerId, `retomada expirada (code=${code})`);
      }, resumeGraceMs);
      if (typeof peer._resumeTimer.unref === 'function') peer._resumeTimer.unref();
    }

    /** O lider saiu da sala. Quem criou a sala continua sendo a raiz da
     * autoridade (o `ownerToken` nunca deixou a maquina dele), entao a
     * lideranca volta pra casa -- e se ele nao estiver mais na sala, ela
     * fica vaga ate ele voltar, que e o que ja acontecia antes desta
     * feature quando o dono caia. Ver a spec, secao 4.2. */
    function reclaimOwnership(room) {
      transferredTo = null;
      for (const [pid, peer] of peers) {
        if (peer.room !== room || !peer.tokenHolder) continue;
        peer.owner = true;
        announceOwner(room, peer, pid);
        return;
      }
      announceOwner(room, null, null); // sala sem dono
    }

    /** Tira o peer da sala e avisa quem fica. E o UNICO caminho de saida: o
     * close do socket e a expulsao de um fantasma (reconexao com o mesmo
     * clientId, ver o 'join') passam por aqui, pra saida nunca ser anunciada
     * de dois jeitos. Peer que ja nao esta no mapa e no-op -- e isso que faz
     * o close tardio do socket de um fantasma ja expulso sair calado.
     *
     * `keepOwnership`: a expulsao de fantasma pula a devolucao da lideranca.
     * Quem esta entrando tem o MESMO clientId, entao o join dele ja volta como
     * lider (`transferredTo` bate) -- devolver pro host aqui faria a coroa ir
     * e voltar, com um 'owner-changed' falso no meio. */
    function removePeer(peerId, why, { keepOwnership = false } = {}) {
      const me = peers.get(peerId);
      if (!me) return null;
      clearResumeTimer(me);
      peers.delete(peerId);
      chatRateLimiters.delete(peerId);
      chatImageLimiters.delete(peerId);
      annotateLimiters.delete(peerId);
      annotateSyncLimiters.delete(peerId);
      laserLimiters.delete(peerId);
      reactionLimiters.delete(peerId);
      reofferLimiters.delete(peerId);
      watchersLimiters.delete(peerId);
      mesaLimiters.delete(peerId);
      log(`- ${logName(me.name)} (#${peerId}) saiu da sala ${logName(me.room)} (${why})`);
      broadcastToRoom(me.room, peerId, { type: 'peer-left', id: peerId });
      // Expulso/banido ja tem a linha 'kick'/'ban' -- nao duplica com 'leave'.
      if (!me._moderationClose) pushSystemLine(me.room, 'leave', me.name);
      // O lider (que nao e quem criou a sala) fechou o app: a sala
      // continua viva -- o servidor roda no processo do host -- mas
      // ficaria sem ninguem podendo moderar, com a sala aberta pra
      // rede. A lideranca volta pra quem criou a sala.
      if (me.owner && transferredTo && !keepOwnership) reclaimOwnership(me.room);
      // Mesa: solta as vezes de quem saiu e tira a tela e a camera dele. As
      // outras janelas que ele pos ficam (sao da sala).
      if (!closingRoom) {
        releaseMesaGrabsOf(me.room, peerId);
        removeMediaWindows(me.room, peerId, ['tela', 'camera']);
        if (me.mesaView) announceMesaViewers(me.room);
      }
      // Quem saiu (ou foi expulso/banido) conhecia o segredo atual: rotaciona
      // pra ele nao conseguir assinar um beacon de migracao desta sala.
      if (!closingRoom && roomPeers(me.room).length) announceMigrationInfo(me.room, rotateMigrationSecret(me.room));
      return me;
    }

    function onError(err) {
      // O bind falhou (tipicamente EADDRINUSE), mas o WebSocketServer e o
      // http.Server interno dele ja foram criados -- sem fecha-los aqui,
      // cada tentativa de findFreeServer (ports.js) que esbarra numa porta
      // ocupada deixa um servidor morto pra tras. `close()` num servidor
      // que nunca chegou a escutar e seguro (o `ws` trata isso).
      wss.close();
      reject(err);
    }

    wss.once('error', onError);

    wss.once('listening', () => {
      wss.off('error', onError);

      // Keep-alive: marca cada socket como vivo ao receber o pong do
      // navegador (que responde sozinho ao ping) e, a cada ciclo, derruba
      // quem nao respondeu o ping anterior.
      const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
          if (ws.isAlive === false) {
            // O "ha quanto tempo" separa uma rede que engasgou um ciclo
            // (~2x heartbeatMs) de um peer que sumiu faz tempo.
            const semPong = Math.round((Date.now() - ws.lastPongAt) / 1000);
            log(`heartbeat derrubou #${ws.peerId} (sem pong ha ${semPong}s)`);
            ws.terminate();
            continue;
          }
          ws.isAlive = false;
          try {
            ws.ping();
          } catch {
            /* socket ja fechando */
          }
        }
      }, heartbeatMs);
      if (typeof heartbeat.unref === 'function') heartbeat.unref();
      wss.on('close', () => clearInterval(heartbeat));

      // Sinal de vida pro cliente (ver `livenessMs`). So pra quem ja entrou:
      // antes do welcome o cliente ainda nao sabe se esta numa sala desta
      // versao, e nao ha o que vigiar.
      const liveness = setInterval(() => {
        for (const ws of wss.clients) {
          if (ws.joined) send(ws, { type: 'hb' });
        }
      }, livenessMs);
      if (typeof liveness.unref === 'function') liveness.unref();
      wss.on('close', () => clearInterval(liveness));

      wss.on('connection', (ws) => {
        const id = String(nextId++);
        // `id` e o numero desta conexao. Numa retomada, `peerId` troca para
        // o id antigo que a sala conhece; o socket novo nao pode falar como
        // um terceiro peer provisório.
        let peerId = id;
        let joined = false;
        const rateLimiter = createRateLimiter({});

        ws.isAlive = true;
        // Pro log do heartbeat: ele itera wss.clients, nao o mapa de peers.
        ws.peerId = id;
        ws.lastPongAt = Date.now();
        ws.joined = false;
        const pendingConnections = Array.from(wss.clients).filter((client) => !client.joined).length;
        if (pendingConnections > MAX_PENDING_CONNECTIONS) {
          ws.close(1013, 'too-many-pending');
          return;
        }
        ws.on('pong', () => {
          ws.isAlive = true;
          ws.lastPongAt = Date.now();
        });

        ws.on('message', (raw) => {
          // Depois de uma retomada o socket velho pode ainda ter frames na
          // fila. Ele nao pode falar pelo peer que ja recebeu outro socket.
          if (joined && peers.get(peerId)?.ws !== ws) return;
          // Cliente em loop ou tentando afogar o processo do host: fecha o
          // socket em vez de seguir processando frame por frame.
          if (!rateLimiter.hit(Date.now())) {
            ws.close(1008, 'flood');
            return;
          }

          let msg;
          try {
            msg = JSON.parse(raw.toString());
          } catch {
            return;
          }
          // JSON valido mas que nao e um objeto (`null`, `42`, `"x"`,
          // `[...]`, `true`): `msg.type` num `null` LANCA, e a excecao sobe
          // como uncaught e derruba o processo de quem hospeda a sala. Um
          // unico frame `null` de qualquer um que alcance a porta bastava.
          // Descarta em silencio, igual a frame malformado.
          if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return;

          switch (msg.type) {
            // Sonda dirigida (P2): o UNICO tipo aceito de um socket que
            // ainda nao entrou -- por isso vem antes do 'join' e nao mexe
            // em `peers`. Devolve so o resumo publico que a lista de salas
            // ja mostra (reconstruido campo a campo, nunca o msg cru): nome,
            // se pede PIN, quantas pessoas, versao. Nada de PIN, peers ou
            // id interno -- e por isso a conexao nunca vira peer: nao
            // conta no teto do R8 (MAX_CONNECTIONS) nem em getPeerCount.
            case 'probe': {
              if (joined) return; // quem ja entrou nao sonda a propria sala
              if (!probeLimiter.hit(ws._socket?.remoteAddress, Date.now())) {
                ws.close(1008, 'flood');
                return;
              }
              send(ws, {
                type: 'probe-ok',
                roomName: effectiveRoomName(),
                peers: peers.size,
                protected: Boolean(roomPin),
                version: hostVersion,
                // Item B: o sobrevivente de uma migracao sonda o IP do
                // sucessor e precisa saber se achou A MESMA sala. Responde
                // so sim/nao ao roomId que ELE mandou -- o id em si nao sai
                // pra quem so sonda.
                ...(typeof msg.roomId === 'string' && msg.roomId ? { sameRoom: msg.roomId === stableRoomId } : {}),
              });
              // A sonda nunca fica: pergunta e sai. Fechar aqui (em vez de
              // esperar o cliente) e o que garante que ela nunca ocupa uma
              // vaga de MAX_PENDING_CONNECTIONS por mais que o necessario.
              ws.close(1000, 'probe');
              break;
            }

            case 'join': {
              if (joined) return;
              // clientId e endereco entram cedo: a checagem de ban precisa
              // deles, e o peer guarda ambos pro `close`/`moderate` montarem
              // as mesmas chaves se o dono banir depois de o peer ja estar
              // dentro.
              const clientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 100) : null;
              const resumeToken = typeof msg.resumeToken === 'string' ? msg.resumeToken.slice(0, 100) : null;
              const remoteAddress = ws._socket?.remoteAddress || null;
              // Banido nao passa nem pela checagem de PIN (nao deve nem saber
              // se acertaria o PIN). Ver a spec, secao 9.3.
              if (findBan(banKeysFor({ address: remoteAddress, clientId }))) {
                log(`join recusado (#${id}): banido`);
                send(ws, { type: 'join-denied', reason: 'banned' });
                ws.close(1008, 'banned');
                return;
              }
              // Versao diferente da de quem criou a sala: recusa antes do PIN
              // (nao adianta acertar o PIN numa sala que o seu app nao sabe
              // conversar). Manda as duas versoes de volta pra que o cliente
              // saiba dizer QUEM precisa atualizar, e fecha com 1008.
              if (hostVersion && !sameVersion(msg.appVersion)) {
                const theirVersion = typeof msg.appVersion === 'string' ? msg.appVersion.slice(0, 40) : null;
                log(`join recusado (#${id}): versao ${JSON.stringify(theirVersion)} != ${JSON.stringify(hostVersion)}`);
                send(ws, { type: 'join-denied', reason: 'version', hostVersion, yourVersion: theirVersion });
                ws.close(1008, 'version');
                return;
              }
              if (roomPin && pinFailures.blocked(remoteAddress, Date.now())) {
                log(`join recusado (#${id}): PIN bloqueado`);
                send(ws, { type: 'join-denied', reason: 'pin' });
                ws.close(1008, 'pin');
                return;
              }
              // Sala protegida: PIN ausente ou errado e recusa explicita
              // (o cliente distingue "PIN errado" de "conexao caiu") seguida
              // de close 1008. Descartar em silencio faria o cliente ficar
              // preso em "Conectando...".
              if (roomPin && String(msg.pin == null ? '' : msg.pin) !== roomPin) {
                pinFailures.fail(remoteAddress, Date.now());
                log(`join recusado (#${id}): PIN ausente ou errado`);
                send(ws, { type: 'join-denied', reason: 'pin' });
                ws.close(1008, 'pin');
                return;
              }
              const room = String(msg.room || 'geral').slice(0, 40);
              if (roomPeers(room).length >= MAX_CONNECTIONS) {
                send(ws, { type: 'join-denied', reason: 'full' });
                ws.close(1013, 'full');
                return;
              }
              const name = String(msg.name || 'anonimo').slice(0, 40);
              const avatar = sanitizeAvatar(msg.avatar);
              // `tokenHolder` e um fato imutavel do peer (apresentou o token
              // de quem criou a sala); `owner` e quem manda AGORA. Enquanto
              // a lideranca nunca foi passada os dois coincidem -- depois de
              // passada, quem manda e so quem tem o clientId de destino.
              const tokenHolder = Boolean(ownerTok) && msg.ownerToken === ownerTok;
              // clientId identifica a instalacao, mas nao e segredo (o dono
              // o ve ao banir). Portanto ele sozinho NUNCA substitui um
              // socket: so o token rotativo, comparado em tempo constante,
              // autoriza retomar um peer suspenso ou um fantasma ainda vivo.
              // Fica DEPOIS de ban/versao/PIN: join recusado nao toca em
              // nenhum peer que ja esteja na sala.
              let resumedId = null;
              let resumedPeer = null;
              if (clientId && resumeToken) {
                for (const [pid, peer] of peers) {
                  if (peer.room === room && peer.clientId === clientId && sameResumeToken(peer.resumeToken, resumeToken)) {
                    resumedId = pid;
                    resumedPeer = peer;
                    break;
                  }
                }
              }
              if (resumedPeer) {
                const oldWs = resumedPeer.ws;
                const suspendedAt = resumedPeer._suspendedAt;
                clearResumeTimer(resumedPeer);
                resumedPeer.ws = ws;
                ws.joined = true;
                resumedPeer.name = name;
                resumedPeer.avatar = avatar;
                resumedPeer.address = remoteAddress;
                resumedPeer._suspendedAt = null;
                resumedPeer.resumeToken = randomUUID();
                chatRateLimiters.delete(resumedId);
                chatImageLimiters.delete(resumedId);
                annotateLimiters.delete(resumedId);
                annotateSyncLimiters.delete(resumedId);
                laserLimiters.delete(resumedId);
                reactionLimiters.delete(resumedId);
                reofferLimiters.delete(resumedId);
                watchersLimiters.delete(resumedId);
                mesaLimiters.delete(resumedId);
                // O que foi para o socket morto se perdeu (seq com buraco).
                // Volta fora da vista Mesa; o cliente que estava nela manda
                // mesa-view on de novo e recebe o retrato.
                const wasOnMesa = resumedPeer.mesaView === true;
                resumedPeer.mesaView = false;
                joined = true;
                peerId = resumedId;
                ws.peerId = resumedId;
                const elapsed = suspendedAt == null ? 0 : Math.max(0, Date.now() - suspendedAt);
                log(`retomado #${resumedId} apos ${elapsed} ms`);
                const resumedSecret = rotateMigrationSecret(room);
                send(ws, {
                  type: 'welcome', id: resumedId, owner: resumedPeer.owner, peers: roomPeers(room, resumedId),
                  chat: chatHistory.slice(), banned: resumedPeer.owner ? listBans() : [],
                  resumeToken: resumedPeer.resumeToken, resumed: true,
                  roomId: stableRoomId, hostId: findHostPeerId(room), roomName: effectiveRoomName(room),
                  migrationSecret: resumedSecret, peerAddresses: peerAddressesOf(room),
                  mesaCount: mesaState.mesa.windows.length, mesaViewers: mesaViewerIds(room),
                });
                if (wasOnMesa) {
                  releaseMesaGrabsOf(room, resumedId);
                  announceMesaViewers(room);
                }
                announceMigrationInfo(room, resumedSecret, resumedId);
                // Quem ficou nao recebe peer-joined na retomada, mas precisa
                // saber que o socket voltou para refazer uma oferta perdida.
                broadcastToRoom(room, resumedId, { type: 'peer-resumed', id: resumedId });
                // Fantasma ainda OPEN: corta logo. O close tardio encontra
                // `peer.ws !== ws` e nao pode suspender/remover o retomado.
                if (oldWs.readyState === oldWs.OPEN) oldWs.terminate();
                break;
              }
              const owner = transferredTo ? clientId != null && clientId === transferredTo : tokenHolder;
              const newResumeToken = randomUUID();
              peers.set(id, {
                ws, name, room, avatar, owner, tokenHolder, clientId, resumeToken: newResumeToken, address: remoteAddress,
                // Mesa: vista aberta e o que o servidor sabe de tela/camera
                // (e isso que poe e tira as janelas de midia).
                mesaView: false, live: false, cameraOn: false,
              });
              joined = true;
              ws.joined = true;
              log(`+ ${logName(name)} (#${id}) entrou na sala ${logName(room)}${owner ? ' (dono)' : ''}`);
              const joinSecret = rotateMigrationSecret(room);
              send(ws, {
                type: 'welcome', id, owner, peers: roomPeers(room, id),
                chat: chatHistory.slice(), banned: owner ? listBans() : [],
                resumeToken: newResumeToken,
                roomId: stableRoomId, hostId: findHostPeerId(room), roomName: effectiveRoomName(room),
                migrationSecret: joinSecret, peerAddresses: peerAddressesOf(room),
                // A mesa NAO vai no welcome: quem fica na Transmissao nao paga
                // por ela. So quantas janelas ha (o seletor mostra que a mesa
                // nao esta vazia) e quem esta la (avatares).
                mesaCount: mesaState.mesa.windows.length, mesaViewers: mesaViewerIds(room),
              });
              announceMigrationInfo(room, joinSecret, id);
              broadcastToRoom(room, id, { type: 'peer-joined', id, name, avatar, owner });
              pushSystemLine(room, 'join', name, undefined, id);
              break;
            }

            // Poderes do dono: parar transmissao (pedido, socket segue
            // aberto), expulsar (fecha 1008) e banir (expulsa + guarda as
            // chaves pro rejoin ser barrado). Ver a spec, secao 9.
            case 'moderate': {
              const me = peers.get(peerId);
              if (!me || !me.owner) return; // so o dono modera; nao-dono e ignorado em silencio
              if (msg.action === 'unban') {
                if (typeof msg.target !== 'string') return;
                // Le o nome ANTES de removeBan apagar a entrada, pra a linha
                // de sistema poder dizer quem foi readmitido.
                const rec = bans.get(msg.target);
                removeBan(msg.target);
                if (rec) pushSystemLine(me.room, 'unban', me.name, rec.name);
                sendBannedListToOwner(me.room);
                return;
              }
              const targetId = String(msg.target);
              if (targetId === peerId) return; // dono nao pode se auto-moderar
              const target = peers.get(targetId);
              if (!target || target.room !== me.room) return;

              // Passar a lideranca. Diferente das outras acoes, esta muda o
              // estado da SALA (quem pode moderar dai pra frente), nao o do
              // alvo -- por isso ela mexe em `transferredTo`, que e o que o
              // join de qualquer reconexao vai ler. Ver a spec, secao 4.
              if (msg.action === 'transfer-owner') {
                me.owner = false;
                target.owner = true;
                // Devolver pro dono original zera a transferencia em vez de
                // gravar o clientId dele: assim a sala volta ao estado de
                // origem (o token manda), e nao a um estado que depende de
                // um clientId que pode nem existir depois de reinstalar.
                transferredTo = target.tokenHolder ? null : target.clientId;
                announceOwner(me.room, target, targetId);
                pushSystemLine(me.room, 'transfer-owner', me.name, target.name);
                return;
              }

              if (msg.action === 'stop-share') {
                send(target.ws, { type: 'moderated', action: 'stop-share', by: me.name });
                pushSystemLine(me.room, 'stop-share', me.name, target.name);
                return;
              }
              if (msg.action === 'kick' || msg.action === 'ban') {
                send(target.ws, { type: 'moderated', action: msg.action, by: me.name });
                if (msg.action === 'ban') {
                  addBan(banKeysFor({ address: target.address, clientId: target.clientId }), target.name);
                  sendBannedListToOwner(me.room);
                }
                pushSystemLine(me.room, msg.action, me.name, target.name);
                // O close abaixo dispara o handler ws.on('close') do alvo, que
                // por padrao empurra uma linha 'leave'. Marca pra ele pular --
                // a linha 'kick'/'ban' acima ja cobriu a saida.
                target._moderationClose = true;
                // Suspenso ja nao tem socket que possa disparar outro close;
                // kick/ban precisa tira-lo AGORA, sem esperar a retomada.
                if (target._suspendedAt) {
                  removePeer(targetId, `moderado: ${msg.action}`);
                  return;
                }
                try {
                  target.ws.close(1008, msg.action);
                } catch {
                  /* socket ja fechando */
                }
                return;
              }
              break;
            }

            // Encaminhamento direto peer-a-peer: o servidor nao interpreta
            // nada, so entrega ao destinatario carimbando quem mandou.
            // 'view-state' e o espectador dizendo se esta ou nao assistindo
            // (F1.3); 'tree' e a origem distribuindo papeis da arvore de
            // retransmissao (F2). Ver a spec de 2026-08-23. 'reoffer' e o
            // espectador pedindo pra refazer uma conexao cuja tela nunca
            // mostrou imagem (hotfix 2026-09-12) -- quem recebe valida o kind
            // e tem teto de frequencia proprio.
            case 'offer':
            case 'answer':
            case 'ice':
            case 'view-state':
            case 'tree': {
              // Exige destino existente E na mesma sala do remetente. Hoje
              // todo mundo entra em 'geral', mas no dia em que salas
              // separadas existirem isto impede vazar sinalizacao entre
              // salas. Descartado em silencio, igual a destino inexistente.
              const me = peers.get(peerId);
              const target = peers.get(String(msg.to));
              if (!me || !target || me.room !== target.room) return;
              send(target.ws, { ...msg, from: peerId });
              break;
            }

            case 'reoffer': {
              // Reoffer nao e sinalizacao generica: os dois campos que viram
              // chave no cliente precisam ter tipo e formato exatos antes de
              // chegar la. Reconstruir tambem nao deixa campo arbitrario
              // viajar junto com o pedido.
              if (typeof msg.to !== 'string' || !CONNECTION_ID_RE.test(msg.to)) return;
              const me = peers.get(peerId);
              const target = peers.get(msg.to);
              const parsedKind = parseReofferKind(msg.kind);
              if (!me || !target || me.room !== target.room || !parsedKind) return;
              if (parsedKind.sourceId) {
                const source = peers.get(parsedKind.sourceId);
                if (!source || source.room !== me.room) return;
              }
              const limiter = reofferLimiters.get(peerId)
                || createRateLimiter({ limit: MAX_REOFFER_PER_SECOND, windowMs: 1000 });
              reofferLimiters.set(peerId, limiter);
              if (!limiter.hit(Date.now())) return;
              send(target.ws, { type: 'reoffer', to: msg.to, kind: parsedKind.kind, from: peerId });
              break;
            }

            case 'chat': {
              const me = peers.get(peerId);
              if (!me) return; // sem join previo, sem chat
              const limiter = chatRateLimiters.get(peerId) || createRateLimiter({ limit: 5, windowMs: 1000 });
              chatRateLimiters.set(peerId, limiter);
              if (!limiter.hit(Date.now())) return; // estoura em silencio, sem fechar o socket (chat nao e flood de sinalizacao)
              const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 500) : '';
              // Imagem: opcional, e a legenda tambem -- o que nao pode e a
              // mensagem ser vazia dos dois lados. Aceita so data URL de
              // imagem: uma `http(s)://` viraria o renderer buscando de um
              // endereco que quem mandou escolheu (e o CSP so permite
              // `data:`/`blob:` em img-src, entao nem carregaria).
              // Mesma regex da sanitizacao de historico acima e do renderer
              // (src/renderer/chatmedia.js); os modulos nao sao compartilhados.
              const image = typeof msg.image === 'string'
                && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(msg.image)
                && msg.image.length <= MAX_IMAGE_CHARS
                ? msg.image
                : null;
              if (!text && !image) return;
              if (image) {
                // Segunda cota, so pras imagens: 5 msg/s de texto e barato,
                // 5 imagens/s de 200 KB sao 1 MB/s repassados pra sala
                // inteira pelo PC de quem hospeda.
                const imgLimiter = chatImageLimiters.get(peerId) || createRateLimiter({ limit: 3, windowMs: 5000 });
                chatImageLimiters.set(peerId, imgLimiter);
                if (!imgLimiter.hit(Date.now())) return;
              }
              const entry = {
                type: 'chat', id: String(nextId++), from: peerId, name: me.name, text, ts: Date.now(),
                // w/h viajam junto pra linha do chat ja nascer com a altura
                // certa -- sem isso a lista pula quando a imagem decodifica.
                ...(image ? { image, w: clampDim(msg.w), h: clampDim(msg.h) } : {}),
              };
              pushChatEntry(entry);
              broadcastToRoom(me.room, null, entry); // pra sala INTEIRA, inclusive quem mandou
              break;
            }

            // Anotacao na tela de alguem (rabisco/escrita). O servidor NAO
            // guarda estado nenhum de anotacao: ele repassa e pronto -- quem
            // chega no meio recebe o desenho do proprio dono da tela, via
            // 'annotate-sync' logo abaixo. `surface` e o dono da tela (nao
            // quem desenha); `from` e carimbado aqui e e o que decide a cor
            // do pincel nos dois lados, entao ninguem desenha com a cor de
            // outro. Ver a spec de 2026-09-04, secao 5.5.
            case 'annotate': {
              const me = peers.get(peerId);
              if (!me) return;
              const limiter = annotateLimiters.get(peerId) || createRateLimiter({ limit: MAX_ANNOTATE_PER_SECOND, windowMs: 1000 });
              annotateLimiters.set(peerId, limiter);
              if (!limiter.hit(Date.now())) return; // estoura em silencio, igual ao chat
              // A chave e '<dono>:<kind>', nao o id cru: procurar a chave
              // inteira na tabela de peers nunca acha ninguem, e TODA op cai
              // neste `return` -- o rabisco parava aqui, em silencio, com a
              // cara de "tela de quem nao esta na sala". Ver surfaceOwner.
              const surface = peers.get(surfaceOwner(msg.surface));
              if (!surface || surface.room !== me.room) return; // tela de quem nao esta nesta sala
              const op = sanitizeAnnotateOp(msg);
              if (!op) return;
              broadcastToRoom(me.room, peerId, { ...op, type: 'annotate', surface: String(msg.surface), from: peerId });
              break;
            }

            case 'laser': {
              const me = peers.get(peerId);
              if (!me) return;
              const parsedSurface = parseSurface(msg.surface);
              if (!parsedSurface) return;
              const limiter = laserLimiters.get(peerId) || createRateLimiter({ limit: 30, windowMs: 1000 });
              laserLimiters.set(peerId, limiter);
              if (!limiter.hit(Date.now())) return;
              const surface = peers.get(parsedSurface.ownerId);
              if (!surface || surface.room !== me.room) return;
              const op = sanitizeLaserOp(msg);
              if (!op) return;
              broadcastToRoom(me.room, peerId, { ...op, type: 'laser', surface: parsedSurface.surface, from: peerId });
              break;
            }

            case 'reaction': {
              const me = peers.get(peerId);
              if (!me) return;
              const parsedSurface = parseSurface(msg.surface);
              if (!parsedSurface) return;
              const limiter = reactionLimiters.get(peerId) || createBurstLimiter();
              reactionLimiters.set(peerId, limiter);
              if (!limiter.hit(Date.now())) return;
              const surface = peers.get(parsedSurface.ownerId);
              if (!surface || surface.room !== me.room) return;
              const op = sanitizeReactionOp(msg);
              if (!op) return;
              broadcastToRoom(me.room, peerId, { ...op, type: 'reaction', surface: parsedSurface.surface, from: peerId });
              break;
            }

            // Snapshot da lousa pra UM peer (quem acabou de entrar). Roteado
            // como offer/answer, nao broadcast: e um estado inteiro, e so
            // quem chegou depois precisa dele.
            case 'annotate-sync': {
              const me = peers.get(peerId);
              if (!me || typeof msg.to !== 'string' || !CONNECTION_ID_RE.test(msg.to)) return;
              const target = peers.get(msg.to);
              const surface = parseSurface(msg.surface);
              if (!target || me.room !== target.room || !surface) return;
              const owner = peers.get(surface.ownerId);
              if (!owner || owner.room !== me.room || !Array.isArray(msg.items)) return;
              // Um snapshot sai para cada peer-joined. Balde por remetente
              // comporta uma sala inteira entrando junta, mas repoe so 2/s.
              const limiter = annotateSyncLimiters.get(peerId) || createBurstLimiter({ capacity: MAX_CONNECTIONS, refillMs: 500 });
              annotateSyncLimiters.set(peerId, limiter);
              if (!limiter.hit(Date.now())) return;
              const items = [];
              for (const item of msg.items.slice(0, MAX_ANNOTATE_SYNC_ITEMS)) {
                const safe = sanitizeAnnotateSnapshotItem(item);
                if (safe) items.push(safe);
              }
              send(target.ws, {
                type: 'annotate-sync',
                from: peerId,
                surface: surface.surface,
                items,
              });
              break;
            }

            case 'broadcast-state': {
              const me = peers.get(peerId);
              if (!me) return;
              broadcastToRoom(me.room, peerId, {
                type: 'broadcast-state',
                // peerId, nao o id da conexao: depois de uma retomada o
                // socket novo fala pelo id que a sala ja conhece.
                id: peerId,
                name: me.name,
                live: Boolean(msg.live),
                paused: Boolean(msg.paused),
                // Se a sala pode rabiscar NESTA tela. Quem assiste so
                // descobre isso por aqui -- sem o campo, a barra de
                // ferramentas de rabisco nunca aparece pra ninguem, e sem
                // erro nenhum no caminho pra denunciar. `=== true` porque o
                // campo vem de um cliente: qualquer coisa que nao seja o
                // booleano vira false, como ja acontece com `paused`.
                annotate: msg.annotate === true,
                // Estado reapresentado apos migracao: informa o cliente que
                // recebe para nao tratar a sincronizacao como transicao nova.
                bootstrap: msg.bootstrap === true,
                // P4: ver sanitizeLimit acima. Reconstruido campo a campo
                // como todo o resto desta mensagem -- e exatamente onde
                // `annotate` sumiu calado na 0.10.2 e `color` na 0.12.0.
                limit: sanitizeLimit(msg.limit),
              });
              // Mesa: ir ao vivo poe a janela da tela; parar tira. So na
              // TRANSICAO: o broadcast-state se repete (pausa, limite), e
              // quem tirou a propria tela da mesa nao a ve voltar sozinha.
              {
                const wasLive = me.live === true;
                me.live = Boolean(msg.live);
                if (me.live && !wasLive) addMediaWindow(me.room, peerId, 'tela');
                else if (!me.live) removeMediaWindows(me.room, peerId, ['tela']);
              }
              break;
            }

            // Estado da CAMERA. Existe separado do 'broadcast-state'
            // (que e sobre a tela) porque camera e tela sao independentes:
            // da pra estar com a camera ligada sem compartilhar tela
            // nenhuma, e nesse caso o broadcast-state nunca sai. Sem esta
            // mensagem, a permissao de rabiscar na camera nao teria como
            // chegar em ninguem.
            //
            // `id` e carimbado AQUI, do lado do servidor, como em todo o
            // resto: o cliente nao escolhe por quem fala. E `annotate`
            // segue a mesma regra do broadcast-state -- `=== true`, porque
            // o campo vem de um cliente e qualquer outra coisa vira false.
            case 'camera-state': {
              const me = peers.get(peerId);
              if (!me) return;
              broadcastToRoom(me.room, peerId, {
                type: 'camera-state',
                id: peerId,
                on: Boolean(msg.on),
                annotate: msg.annotate === true,
              });
              // Mesma regra da tela: camera ligada poe a janela, desligada tira.
              {
                const wasOn = me.cameraOn === true;
                me.cameraOn = Boolean(msg.on);
                if (me.cameraOn && !wasOn) addMediaWindow(me.room, peerId, 'camera');
                else if (!me.cameraOn) removeMediaWindows(me.room, peerId, ['camera']);
              }
              break;
            }

            // Quem esta transmitindo avisa a SALA INTEIRA (nao so quem
            // pediu) quem esta de fato assistindo aquele kind agora -- e o
            // que permite ao dono de qualquer tile (nao so o host) desenhar
            // "quem esta assistindo" no proprio tile, mesmo pra quem nao e o
            // remetente do view-state que mudou a lista.
            case 'watchers': {
              const me = peers.get(peerId);
              if (!me) return;
              const limiter = watchersLimiters.get(peerId) || createRateLimiter({ limit: MAX_WATCHERS_PER_SECOND, windowMs: 1000 });
              watchersLimiters.set(peerId, limiter);
              if (!limiter.hit(Date.now())) return; // estoura em silencio, igual ao chat
              // Cada item e refeito a partir da tabela de peers do servidor:
              // id que nao esta nesta sala some, repetido nao duplica, e
              // nome/avatar sao os que o proprio peer mandou no join. Um
              // cliente hostil nao injeta item gigante nem forja o nome de
              // ninguem, e o avatar legitimo continua chegando inteiro pra
              // lista de quem assiste (ui.grid.setWatchers desenha com ele).
              const vistos = new Set();
              const watchers = [];
              for (const w of Array.isArray(msg.watchers) ? msg.watchers.slice(0, 64) : []) {
                const wid = typeof w?.id === 'string' ? w.id : null;
                const peer = wid ? peers.get(wid) : null;
                if (!peer || peer.room !== me.room || vistos.has(wid)) continue;
                vistos.add(wid);
                watchers.push({ id: wid, name: peer.name, avatar: peer.avatar || null });
              }
              broadcastToRoom(me.room, peerId, {
                type: 'watchers',
                from: peerId,
                // Rebroadcast pra sala inteira: um cliente com bug (ou
                // hostil) que manda um `kind` gigante ou uma lista de
                // milhares de watchers veria isso amplificado por N. A
                // sala real nao passa de ~6; 64 e teto folgado.
                kind: String(msg.kind == null ? '' : msg.kind).slice(0, 64),
                // De quem e a TELA que estes espectadores estao vendo. Nem
                // sempre e quem manda: com a arvore de retransmissao ligada
                // quem serve uma folha e o RELAY, e sem este campo a folha
                // sumia da lista -- a origem so conseguia contar quem ela
                // mesma servia. Ausente vale como "a minha propria", que e
                // o que um cliente de versao antiga quer dizer.
                origin: msg.origin == null ? peerId : String(msg.origin).slice(0, 64),
                watchers,
              });
              break;
            }

            // ---- Mesa (ver o bloco "Mesa" no topo deste servidor) ----

            case 'mesa-view': {
              const me = peers.get(peerId);
              if (!me) return;
              const on = msg.on === true;
              // Abrir manda o retrato inteiro: tem cota. Fechar sempre passa.
              if (on && !mesaHit(peerId, 'sync')) return;
              setMesaView(peerId, on);
              break;
            }

            case 'mesa-sync': {
              const me = peers.get(peerId);
              if (!me || !mesaHit(peerId, 'sync')) return;
              send(ws, mesaSyncMsg());
              break;
            }

            case 'mesa': {
              const me = peers.get(peerId);
              if (!me) return;
              handleMesaOp(peerId, me, ws, msg);
              break;
            }

            case 'mesa-grab': {
              const me = peers.get(peerId);
              if (!me) return;
              const wid = typeof msg.id === 'string' ? msg.id.slice(0, 32) : null;
              if (!me.mesaView) return denyMesa(ws, 'grab', wid, 'not-viewing');
              if (!mesaHit(peerId, 'ops')) return denyMesa(ws, 'grab', wid, 'rate');
              if (!wid || !mesaState.mesa.windows.some((w) => w.id === wid)) return denyMesa(ws, 'grab', wid, 'not-found');
              if (mesaState.mesa.leaderOnly && !me.owner) return denyMesa(ws, 'grab', wid, 'locked');
              const res = mesaGrabs.take(wid, peerId, Date.now());
              if (!res.ok) return denyMesa(ws, 'grab', wid, 'held', { holder: res.holder });
              broadcastToMesa(me.room, null, { type: 'mesa-grab', id: wid, by: peerId });
              break;
            }

            case 'mesa-release': {
              const me = peers.get(peerId);
              if (!me || typeof msg.id !== 'string') return;
              const wid = msg.id.slice(0, 32);
              if (mesaGrabs.release(wid, peerId)) broadcastToMesa(me.room, null, { type: 'mesa-release', id: wid });
              break;
            }

            // Arraste ao vivo: nao guardado, so para quem esta na Mesa, e so
            // de quem tem a vez (que ele renova).
            case 'mesa-drag': {
              const me = peers.get(peerId);
              if (!me || !me.mesaView || !mesaHit(peerId, 'drag')) return;
              const wid = typeof msg.id === 'string' ? msg.id.slice(0, 32) : null;
              const rect = mesaModel.normDragRect(msg);
              if (!wid || !rect || !mesaGrabs.renew(wid, peerId, Date.now())) return;
              broadcastToMesa(me.room, peerId, { type: 'mesa-drag', id: wid, ...rect, by: peerId });
              break;
            }

            case 'cursor': {
              const me = peers.get(peerId);
              if (!me || !me.mesaView || !mesaHit(peerId, 'cursor')) return;
              const point = mesaModel.normCursor(msg);
              if (!point) return;
              broadcastToMesa(me.room, peerId, { type: 'cursor', ...point, from: peerId });
              break;
            }

            // Relogio do servidor para o YouTube junto: eco de t0 com a hora
            // daqui. So para quem perguntou.
            case 'time': {
              const me = peers.get(peerId);
              if (!me || typeof msg.t0 !== 'number' || !Number.isFinite(msg.t0) || !mesaHit(peerId, 'time')) return;
              send(ws, { type: 'time', t0: msg.t0, server: Date.now() });
              break;
            }

            default:
              break;
          }
        });

        ws.on('close', (code, reason) => {
          // Socket que so sondou (nunca entrou) nao tem `me` nenhum. A cota
          // dele fica no LRU por IP de proposito, para sobreviver ao close.
          const me = peers.get(peerId);
          // O socket de antes da retomada fecha depois do novo welcome. Ele
          // nao representa mais este peer e deve sair em silencio.
          if (!me || me.ws !== ws) return;
          // O reason vem do cliente (ate 123 bytes pelo protocolo); corta e
          // escapa como qualquer outro texto de fora antes de ir pro log.
          const why = `code=${code} reason=${JSON.stringify(String(reason || '').slice(0, 64))}`;
          // Nao existe mensagem explicita de leave no protocolo. So 1006 (o
          // socket morreu sem frame de close: rota caiu, ou o terminate do
          // heartbeat) ganha a janela de retomada. Qualquer frame de close
          // que chegou prova que a rota estava viva e o cliente saiu por
          // querer -- inclusive o 1005 do `ws.close()` sem codigo que o
          // Desconectar do app manda. Moderacao e encerramento da sala
          // tambem removem logo.
          if (closingRoom || me._moderationClose || code !== 1006) removePeer(peerId, why);
          else suspendPeer(peerId, code);
        });

        ws.on('error', () => {});
      });

      resolve({
        wss,
        port: wss.address().port,
        // O servidor roda no processo de quem hospeda. Quando o host sai da
        // sala (Desconectar) ou fecha o app, `close()` e chamado -- e a sala
        // deixa de existir: nao ha pra onde reconectar nem como entrar mais
        // ninguem. Sem avisar, cada cliente so ve o socket cair (code 1006) e,
        // pela logica de resiliencia do renderer (H1), fica "orfao" com a
        // sala fantasma na tela ate desconectar na mao. O 'room-closed'
        // explicito (+ close limpo 1001) deixa o cliente distinguir "a sala
        // acabou" de "a MINHA conexao caiu" e voltar pro lobby na hora.
        close: ({ migrate = false } = {}) => new Promise((res) => {
          closingRoom = true;
          for (const peer of peers.values()) clearResumeTimer(peer);
          const hostPeerId = findHostPeerId();
          const hostPeer = hostPeerId ? peers.get(hostPeerId) : null;
          const survivors = hostPeer
            ? [...peers].filter(([id, peer]) => id !== hostPeerId && peer.room === hostPeer.room).map(([id]) => id)
            : [];
          if (migrate === true && hostPeer && survivors.length) {
            const successor = chooseSuccessor(survivors, null);
            let currentOwnerId = null;
            for (const [id, peer] of peers) {
              if (peer.room === hostPeer.room && peer.owner) {
                currentOwnerId = id;
                break;
              }
            }
            const newOwnerId = chooseNewOwner(survivors, currentOwnerId, successor);
            const successorPeer = successor ? peers.get(successor) : null;
            broadcastToRoom(hostPeer.room, hostPeerId, {
              type: 'room-migrating',
              roomId: stableRoomId,
              successor,
              successorName: successorPeer ? successorPeer.name : null,
              newOwnerClientId: newOwnerId ? peers.get(newOwnerId)?.clientId ?? null : null,
              pin: roomPin,
              // P1: o sucessor precisa saber o nome pra semear a sala nova
              // com ele (o proprio hostPeer esta saindo -- sem isto
              // effectiveRoomName() do servidor NOVO cairia no nome de quem
              // assumiu, nao no nome que a sala tinha).
              roomName: effectiveRoomName(hostPeer.room),
              bans: listBans(),
              chat: chatHistory.slice(),
              // A mesa vai inteira (o sucessor a semeia como initialMesa) com
              // o piso de ids: ver seedIdFloor.
              mesa: { ...mesaModel.snapshot(mesaState), idFloor: nextId },
            });
          }
          log(`sala encerrada: room-closed para ${wss.clients.size} conexao(oes)`);
          for (const client of wss.clients) {
            send(client, { type: 'room-closed' });
            try {
              client.close(1001, 'host-left');
            } catch {
              /* socket ja fechando */
            }
          }
          wss.close(() => res());
        }),
        // Peer suspenso ainda pertence a sala durante a janela de retomada.
        getPeerCount: () => peers.size,
      });
    });
  });
}

module.exports = {
  createSignalingServer,
  createRateLimiter,
  createProbeLimiter,
  createPinFailureLimiter,
  sanitizeAnnotateOp,
  sanitizeAnnotateSnapshotItem,
  sanitizeInitialBan,
  sanitizeInitialChatEntry,
  sanitizeInitialMesa,
  seedIdFloor,
  clampDim,
  normalizeRoomName,
  MAX_IMAGE_CHARS,
  CHAT_IMAGE_HISTORY_MAX,
  MAX_CONNECTIONS,
  MAX_AVATAR_CHARS,
  MAX_ROOM_NAME_CHARS,
  MAX_PROBE_PER_SECOND,
};
