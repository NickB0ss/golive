'use strict';

/*
 * Janela "Radio da sala" da Mesa -- modulo PURO (contrato:
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secao 1; pesquisa
 * docs/2026-09-24-pesquisa-janelas-da-mesa.md, secao 1.3).
 *
 * Uma fila de musicas do YouTube. Toca so o audio (cada PC o proprio
 * player, escondido) sincronizado como o "Video do YouTube": `playing`,
 * `pos` (s) na hora do servidor `at` (ms), `rate`.
 *
 * Estado:
 *   current: { id, videoId, title, by, name } | null   -- a que toca
 *   queue:   [ mesmo formato ]                          -- as proximas (ate 50)
 *   playing, pos, at, rate
 *   votes:   [peerId]  -- quem votou para pular a atual
 *   failed:  [{ videoId, title }]  -- as ultimas que nao deixam tocar fora
 *                                     do YouTube (embed bloqueado)
 *   seq:     contador dos ids da fila
 *
 * Acoes:
 *   add {url}            poe na fila (sem nada tocando, ja toca)
 *   remove {id}          quem pos ou o lider
 *   move {id, to}        reordena a fila (to = indice na fila)
 *   play / pause {pos?}
 *   skip                 quem pos a atual ou o lider
 *   vote-skip            maioria das pessoas da sala pula (o `prepare`
 *                        conta a sala: so o servidor conhece `ctx.peers`)
 *   failed {videoId, id?} o player diz que o video nao deixa embed: pula e marca
 *   ended {videoId, id?}  acabou (idempotente: so avanca se for a atual)
 *   title {id, title}     o player descobriu o titulo (so preenche vazio)
 */

(function (root) {
  const L = (root.GoLive && root.GoLive.mesaMidiaLinks)
    || (typeof module !== 'undefined' && typeof module.require === 'function' ? module.require('./midialinks') : null);

  const TYPE = 'radio';
  const MAX_QUEUE = 50;
  const MAX_TITLE = 80;
  const MAX_NAME = 32;
  const MAX_FAILED = 3;
  const ID_RE = /^r\d{1,9}$/;
  // Acoes que podem trocar a musica ou mexer no relogio: precisam da hora.
  const TIMED = new Set(['add', 'remove', 'play', 'pause', 'skip', 'vote-skip', 'failed', 'ended']);

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isPeerId(v) {
    return typeof v === 'string' && v.length > 0 && v.length <= 32;
  }

  function init() {
    return { current: null, queue: [], playing: false, pos: 0, at: null, rate: 1, votes: [], failed: [], seq: 0 };
  }

  function findItem(state, id) {
    if (state.current && state.current.id === id) return state.current;
    return state.queue.find((it) => it.id === id) || null;
  }

  /** Maioria simples das pessoas da sala (1 -> 1, 2 -> 2, 3 -> 2, 4 -> 3). */
  function votesNeeded(peerCount) {
    const n = Number.isInteger(peerCount) && peerCount > 0 ? peerCount : 1;
    return Math.floor(n / 2) + 1;
  }

  function parse(action) {
    if (!isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
    const extra = {};
    if (L.isTime(action.at)) extra.at = action.at;
    switch (action.kind) {
      case 'add': {
        // A acao preparada leva `videoId` + `start` (o link ja foi lido).
        const link = L.parseYouTube(typeof action.videoId === 'string' ? action.videoId : action.url);
        if (!link) return 'Link do YouTube não reconhecido';
        const start = link.start || (L.isPos(action.start) ? Math.floor(action.start) : 0);
        const a = { kind: 'add', videoId: link.videoId, start, ...extra };
        const name = L.cleanText(action.name, MAX_NAME);
        if (name) a.name = name;
        return a;
      }
      case 'remove':
        return typeof action.id === 'string' && ID_RE.test(action.id) ? { kind: 'remove', id: action.id, ...extra } : 'Música inválida';
      case 'move':
        if (typeof action.id !== 'string' || !ID_RE.test(action.id)) return 'Música inválida';
        if (!Number.isInteger(action.to) || action.to < 0 || action.to >= MAX_QUEUE) return 'Posição inválida';
        return { kind: 'move', id: action.id, to: action.to };
      case 'play':
      case 'pause': {
        if (action.pos !== undefined && action.pos !== null && !L.isPos(action.pos)) return 'Posição inválida';
        const a = { kind: action.kind, ...extra };
        if (L.isPos(action.pos)) a.pos = action.pos;
        return a;
      }
      case 'skip':
        return { kind: 'skip', ...extra };
      case 'vote-skip': {
        const a = { kind: 'vote-skip', ...extra };
        if (Number.isInteger(action.need) && action.need >= 1 && action.need <= 1000) a.need = action.need;
        if (Array.isArray(action.keep) && action.keep.length <= 1000 && action.keep.every(isPeerId)) a.keep = action.keep.slice();
        return a;
      }
      case 'failed':
      case 'ended': {
        if (!L.isVideoId(action.videoId)) return 'Vídeo inválido';
        if (action.id !== undefined && (typeof action.id !== 'string' || !ID_RE.test(action.id))) return 'Música inválida';
        const a = { kind: action.kind, videoId: action.videoId, ...extra };
        if (action.id !== undefined) a.id = action.id;
        return a;
      }
      case 'title': {
        if (typeof action.id !== 'string' || !ID_RE.test(action.id)) return 'Música inválida';
        const title = L.cleanText(action.title, MAX_TITLE);
        if (!title) return 'Título inválido';
        return { kind: 'title', id: action.id, title };
      }
      default:
        return 'Ação desconhecida';
    }
  }

  /** So no servidor: hora do servidor em tudo que mexe no relogio; nome de
   * quem poe a musica; e, no voto, quantos votos bastam e quais votos ainda
   * sao de gente na sala (quem saiu nao conta mais). */
  function prepare(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return action;
    delete a.at;
    delete a.need;
    delete a.keep;
    delete a.name;
    const peers = ctx && Array.isArray(ctx.peers) ? ctx.peers : null;
    if (TIMED.has(a.kind) && ctx && L.isTime(ctx.now)) a.at = ctx.now;
    if (a.kind === 'add' && peers && ctx.from != null) {
      const me = peers.find((p) => p && String(p.id) === String(ctx.from));
      const name = me ? L.cleanText(me.name, MAX_NAME) : null;
      if (name) a.name = name;
    }
    if (a.kind === 'vote-skip' && peers) {
      const present = new Set(peers.map((p) => String(p && p.id)));
      a.need = votesNeeded(peers.length);
      a.keep = state.votes.filter((v) => present.has(v));
    }
    return a;
  }

  function canManage(item, ctx) {
    return !!(ctx && (ctx.isLeader || (ctx.from != null && item.by === String(ctx.from))));
  }

  function validate(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return a;
    switch (a.kind) {
      case 'add':
        if (state.queue.length >= MAX_QUEUE) return `Fila cheia (máx. ${MAX_QUEUE})`;
        return true;
      case 'remove': {
        const item = findItem(state, a.id);
        if (!item) return 'Essa música já saiu';
        return canManage(item, ctx) ? true : 'Só quem pôs ou o líder tira';
      }
      case 'move':
        if (!state.queue.some((it) => it.id === a.id)) return 'Essa música não está na fila';
        return true;
      case 'play':
        if (!state.current) return 'Nada para tocar';
        return state.playing ? 'Já está tocando' : true;
      case 'pause':
        if (!state.current) return 'Nada tocando';
        return state.playing ? true : 'Já está pausado';
      case 'skip':
        if (!state.current) return 'Nada tocando';
        return canManage(state.current, ctx) ? true : 'Só quem pôs ou o líder pula; vote para pular';
      case 'vote-skip':
        if (!state.current) return 'Nada tocando';
        if (ctx && ctx.from != null && state.votes.includes(String(ctx.from))) return 'Você já votou';
        return true;
      case 'title':
        return findItem(state, a.id) ? true : 'Essa música já saiu';
      default:
        return true; // failed / ended: idempotentes, o reduce ignora o que nao e a atual
    }
  }

  /** Troca para a proxima da fila (ou para nada). Tocando continua tocando. */
  function advance(state, at) {
    const [next, ...rest] = state.queue;
    if (!next) return { ...state, current: null, queue: [], playing: false, pos: 0, at, votes: [] };
    return { ...state, current: next, queue: rest, pos: next.start || 0, at, votes: [], playing: state.playing };
  }

  function isCurrent(state, a) {
    if (!state.current) return false;
    if (a.id !== undefined) return state.current.id === a.id && state.current.videoId === a.videoId;
    return state.current.videoId === a.videoId;
  }

  function reduce(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return state;
    if (TIMED.has(a.kind) && a.at === undefined) return state;
    const from = ctx && ctx.from != null ? String(ctx.from) : null;
    switch (a.kind) {
      case 'add': {
        if (state.queue.length >= MAX_QUEUE) return state;
        const seq = state.seq + 1;
        const item = { id: `r${seq}`, videoId: a.videoId, title: '', by: from, name: a.name || '' };
        if (a.start) item.start = a.start;
        if (!state.current) {
          return { ...state, seq, current: item, playing: true, pos: a.start || 0, at: a.at, votes: [] };
        }
        return { ...state, seq, queue: [...state.queue, item] };
      }
      case 'remove': {
        const item = findItem(state, a.id);
        if (!item || !canManage(item, ctx)) return state;
        if (state.current && state.current.id === a.id) return advance(state, a.at);
        return { ...state, queue: state.queue.filter((it) => it.id !== a.id) };
      }
      case 'move': {
        const from_ = state.queue.findIndex((it) => it.id === a.id);
        if (from_ < 0) return state;
        const queue = state.queue.slice();
        const [item] = queue.splice(from_, 1);
        queue.splice(Math.min(a.to, queue.length), 0, item);
        return { ...state, queue };
      }
      case 'play':
        if (!state.current || state.playing) return state;
        return { ...state, playing: true, pos: a.pos !== undefined ? a.pos : state.pos, at: a.at };
      case 'pause':
        if (!state.current || !state.playing) return state;
        return { ...state, playing: false, pos: a.pos !== undefined ? a.pos : L.positionAt(state, a.at), at: a.at };
      case 'skip':
        if (!state.current || !canManage(state.current, ctx)) return state;
        return advance(state, a.at);
      case 'vote-skip': {
        if (!state.current || from === null) return state;
        const base = a.keep ? state.votes.filter((v) => a.keep.includes(v)) : state.votes;
        if (base.includes(from)) return state;
        const votes = [...base, from];
        if (a.need !== undefined && votes.length >= a.need) return advance(state, a.at);
        return { ...state, votes };
      }
      case 'failed': {
        if (!isCurrent(state, a)) return state;
        const mark = { videoId: state.current.videoId, title: state.current.title || '' };
        const failed = [...state.failed.filter((f) => f.videoId !== mark.videoId), mark].slice(-MAX_FAILED);
        return { ...advance(state, a.at), failed };
      }
      case 'ended':
        if (!isCurrent(state, a)) return state;
        return advance(state, a.at);
      case 'title': {
        const fill = (it) => (it.id === a.id && !it.title ? { ...it, title: a.title } : it);
        const current = state.current ? fill(state.current) : null;
        const queue = state.queue.map(fill);
        if (current === state.current && queue.every((it, i) => it === state.queue[i])) return state;
        return { ...state, current, queue };
      }
      default:
        return state;
    }
  }

  function summary(state, serverNow) {
    if (!state || !state.current) return state && state.queue.length ? `${state.queue.length} na fila` : 'Fila vazia';
    const name = state.current.title || state.current.videoId;
    const pos = L.formatPos(L.positionAt(state, serverNow));
    const fila = state.queue.length ? ` · +${state.queue.length} na fila` : '';
    return `${state.playing ? 'Tocando' : 'Pausado'}: ${name} · ${pos}${fila}`;
  }

  const api = {
    type: TYPE,
    title: 'Rádio da sala',
    group: 'assistir',
    size: { w: 360, h: 480, minW: 280, minH: 320, aspect: null },
    maxStateBytes: 16 * 1024,
    MAX_QUEUE, MAX_TITLE,
    init,
    prepare,
    validate,
    reduce,
    summary,
    votesNeeded,
    positionAt: L.positionAt,
    parseLink: L.parseYouTube,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
