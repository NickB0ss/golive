'use strict';

/*
 * Janela "Sons" (soundboard) da Mesa -- modulo PURO (sem DOM, sem relogio,
 * sem sorte). Pesquisa: docs/2026-09-24-pesquisa-janelas-da-mesa.md, secao 4.
 *
 * Qualquer pessoa toca um som curto para a sala inteira. Os sons sao
 * sintetizados no PC de cada um (mesa-janelas/sons.js, WebAudio, sem arquivo
 * de audio); aqui so anda o NOME do som, quem tocou e a hora do servidor.
 *
 * - `play { sound }`: o servidor poe `at` (a hora dele, `ctx.now`) e `by` em
 *   `prepare`. Cada cliente toca ao receber um `play` novo, se ele for
 *   recente (o conteudo decide pela hora do servidor).
 * - Limite: um som por pessoa a cada 3 s. `validate` compara `ctx.now` com
 *   o ultimo `at` daquela pessoa, guardado no estado (`recent`). Quem nao
 *   toca ha mais de 3 s sai do `recent` no proximo `reduce`: o estado nao
 *   cresce.
 *
 * Contrato: docs/superpowers/plans/2026-09-24-mesa-contrato.md (secao 1).
 */

(function (root) {
  const TYPE = 'sons';
  const COOLDOWN_MS = 3000;
  const MAX_RECENT = 32;
  const PEER_RE = /^[A-Za-z0-9_-]{1,16}$/;

  // A ordem e a da grade de botoes.
  const SOUNDS = Object.freeze(['buzina', 'palmas', 'badumtss', 'rufar', 'sino', 'acertou', 'errou', 'suspense', 'boing', 'apito']);
  const SOUND_NAMES = Object.freeze({
    buzina: 'Buzina',
    palmas: 'Palmas',
    badumtss: 'Ba dum tss',
    rufar: 'Rufar',
    sino: 'Sino',
    acertou: 'Acertou',
    errou: 'Errou',
    suspense: 'Suspense',
    boing: 'Boing',
    apito: 'Apito',
  });

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isPeerId(v) {
    return typeof v === 'string' && PEER_RE.test(v);
  }

  function isTime(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0;
  }

  function init() {
    return { n: 0, last: null, recent: {} };
  }

  /** Forma da acao. `at`/`by` so existem depois do prepare; se vierem,
   * precisam estar certos (o servidor os troca pelos dele de qualquer jeito). */
  function parse(action) {
    if (!isObj(action) || action.kind !== 'play') return 'Ação desconhecida';
    if (typeof action.sound !== 'string' || !SOUNDS.includes(action.sound)) return 'Som desconhecido';
    const a = { kind: 'play', sound: action.sound };
    if (action.at !== undefined) {
      if (!isTime(action.at)) return 'Hora inválida';
      a.at = action.at;
    }
    if (action.by !== undefined) {
      if (!isPeerId(action.by)) return 'Pessoa inválida';
      a.by = action.by;
    }
    return a;
  }

  /** Quanto falta (ms) para `peerId` poder tocar de novo na hora `now`; 0 se
   * ja pode. Hora do ultimo som "no futuro" (relogio de outro servidor,
   * depois de uma migracao) nao prende ninguem. */
  function cooldownLeft(state, peerId, now) {
    if (!state || !isObj(state.recent) || !isTime(now)) return 0;
    const id = String(peerId);
    if (!Object.prototype.hasOwnProperty.call(state.recent, id)) return 0;
    const t = state.recent[id];
    if (!isTime(t)) return 0;
    const passou = now - t;
    return passou >= 0 && passou < COOLDOWN_MS ? COOLDOWN_MS - passou : 0;
  }

  function validate(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return a;
    const from = ctx && ctx.from != null ? String(ctx.from) : null;
    if (from !== null && ctx && isTime(ctx.now)) {
      const falta = cooldownLeft(state, from, ctx.now);
      if (falta > 0) return `Espere ${Math.ceil(falta / 1000)} s para tocar outro som`;
    }
    return true;
  }

  /** So no servidor: a hora e quem tocou vao prontos na acao. */
  function prepare(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return action;
    const out = { kind: 'play', sound: a.sound };
    if (ctx && isTime(ctx.now)) out.at = ctx.now;
    if (ctx && ctx.from != null && isPeerId(String(ctx.from))) out.by = String(ctx.from);
    return out;
  }

  function reduce(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string' || a.at === undefined) return state;
    const by = a.by !== undefined ? a.by : (ctx && ctx.from != null && isPeerId(String(ctx.from)) ? String(ctx.from) : null);
    if (by === null) return state;
    // So quem tocou nos ultimos 3 s (pela hora deste som) continua contando.
    const vivos = Object.keys(state.recent)
      .filter((id) => id !== by && isTime(state.recent[id]) && a.at - state.recent[id] < COOLDOWN_MS)
      .sort((x, y) => state.recent[y] - state.recent[x] || (x < y ? -1 : 1))
      .slice(0, MAX_RECENT - 1);
    const recent = {};
    for (const id of vivos.sort()) recent[id] = state.recent[id];
    recent[by] = a.at;
    const n = state.n + 1;
    return { n, last: { n, sound: a.sound, at: a.at, by }, recent };
  }

  function soundName(sound) {
    return Object.prototype.hasOwnProperty.call(SOUND_NAMES, sound) ? SOUND_NAMES[sound] : 'Som';
  }

  function summary(state) {
    return state.last ? `Último som: ${soundName(state.last.sound)}` : 'Nenhum som ainda';
  }

  const api = {
    type: TYPE,
    title: 'Sons',
    group: 'noite',
    size: { w: 400, h: 300, minW: 260, minH: 220, aspect: null },
    // 32 pessoas em `recent` (id de 16 + hora de 13 algarismos) + o ultimo.
    maxStateBytes: 2048,
    COOLDOWN_MS, MAX_RECENT, SOUNDS, SOUND_NAMES,
    init,
    prepare,
    validate,
    reduce,
    cooldownLeft,
    soundName,
    summary,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
