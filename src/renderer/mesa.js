'use strict';

/*
 * Mesa -- a parte PURA do segundo tipo da sala (spec 2026-09-24, secoes 3 e
 * 4; nomes e formatos em docs/superpowers/plans/2026-09-24-mesa-contrato.md).
 *
 * Carregado no renderer (window.GoLive.mesa) E no servidor de sinalizacao
 * (require), para os dois lados aplicarem as mesmas mensagens do mesmo jeito:
 * o servidor valida, carimba `seq` e aplica com `applyMessage`; cada cliente
 * aplica a mesma mensagem, na mesma ordem, com a mesma funcao.
 *
 * Nada aqui le relogio ou sorteia: quem precisa de hora recebe `now` por
 * parametro (vez por janela, limitador de taxa, ponteiros).
 */

(function (root) {
  // Area da mesa, em unidades da mesa (nao pixels: o zoom e de cada um).
  const WORLD = Object.freeze({ w: 4800, h: 3000 });
  // Quanto a vista pode passar da borda. So a vista: janela nenhuma fica
  // fora do mundo.
  const OVERSCROLL = 600;
  // Vao que o lugar livre deixa entre duas janelas. O servidor recusa so a
  // sobreposicao de verdade (vao 0); o vao e o que o cliente e o `fix` pedem.
  const GAP = 16;
  const MAX_WINDOWS = 32;
  // Vez por janela: o servidor da a vez por 5 s, renovada a cada mesa-drag.
  const GRAB_MS = 5000;
  // mesa-drag e cursor saem no maximo a 20 Hz (o laser sai a 24).
  const EMIT_HZ = 20;
  // Ponteiro parado some em 1 s, pelo relogio de quem desenha.
  const CURSOR_TTL_MS = 1000;
  // Menor janela que a mesa aceita, qualquer que seja o tipo. Cada tipo pode
  // pedir mais (size.minW/minH do modulo); nunca menos.
  const MIN_W = 48;
  const MIN_H = 48;
  // Teto de custo do nearestFree: com mais obstaculos que isto (so acontece
  // com lixo vindo de fora, a mesa tem teto de 32), o resto e ignorado.
  const MAX_OBSTACLES = MAX_WINDOWS * 2;

  const MODES = Object.freeze(['transmissao', 'mesa']);
  const WINDOW_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
  const TYPE_RE = /^[a-z][a-z0-9]{0,23}$/;

  function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function isMode(mode) {
    return MODES.includes(mode);
  }

  /** Bytes do JSON de um valor (o que atravessa o fio). Valor que nao vira
   * JSON (ciclo, BigInt, undefined solto) conta como infinito: nao cabe em
   * teto nenhum. */
  function jsonBytes(value) {
    let text;
    try {
      text = JSON.stringify(value);
    } catch {
      return Infinity;
    }
    if (typeof text !== 'string') return Infinity;
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    return text.length * 3; // teto seguro sem TextEncoder
  }

  /** Copia profunda por JSON: o estado da mesa e sempre JSON, e a copia
   * garante que nada de fora (funcao, prototipo, referencia compartilhada)
   * fica pendurado nele. `undefined` quando nao da. */
  function cloneJson(value) {
    try {
      const text = JSON.stringify(value);
      return typeof text === 'string' ? JSON.parse(text) : undefined;
    } catch {
      return undefined;
    }
  }

  // ---------------------------------------------------------------------
  // Retangulos
  // ---------------------------------------------------------------------

  /** Retangulo vindo de fora -> `{ x, y, w, h }` inteiros, ou `null` se
   * algum campo nao for numero finito. So arredonda: a posicao e livre, ao
   * pixel da mesa, sem encaixe em grade. String numerica nao vale. */
  function normRect(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const { x, y, w, h } = raw;
    if (!isNum(x) || !isNum(y) || !isNum(w) || !isNum(h)) return null;
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  /** `true` quando o retangulo (ja normalizado) e aceitavel na mesa; senao
   * o motivo: 'too-small', 'too-big' ou 'out-of-world'. `minW`/`minH` vem do
   * tipo da janela e nunca ficam abaixo de MIN_W/MIN_H. */
  function checkRect(rect, { minW = MIN_W, minH = MIN_H, world = WORLD } = {}) {
    if (!rect || !isNum(rect.x) || !isNum(rect.y) || !isNum(rect.w) || !isNum(rect.h)) return 'bad-rect';
    if (rect.w < Math.max(MIN_W, minW) || rect.h < Math.max(MIN_H, minH)) return 'too-small';
    if (rect.w > world.w || rect.h > world.h) return 'too-big';
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > world.w || rect.y + rect.h > world.h) return 'out-of-world';
    return true;
  }

  /** Dois retangulos se sobrepoem se, com `gap` de folga, eles se tocam por
   * dentro. Encostar na borda exata do vao NAO e sobrepor: e o lugar que o
   * nearestFree devolve. */
  function overlaps(a, b, gap = 0) {
    return a.x < b.x + b.w + gap
      && b.x < a.x + a.w + gap
      && a.y < b.y + b.h + gap
      && b.y < a.y + a.h + gap;
  }

  /** Lugar livre mais perto de `rect` (mesmo tamanho), dentro do mundo e a
   * `gap` de toda janela de `windows` (menos a de `ignoreId`, que e a que
   * esta sendo movida). `null` quando nao cabe em lugar nenhum.
   *
   * Busca exata e deterministica: o ponto livre mais perto ou e o pedido
   * (preso ao mundo), ou encosta numa borda de alguma janela (ou do mundo)
   * nos dois eixos. Entao basta testar as combinacoes dessas bordas, da mais
   * perto para a mais longe (empate: menor y, depois menor x), e parar na
   * primeira livre. Com o teto de obstaculos, o pior caso e de ~17 mil
   * pares, cada um testado contra ate 64 janelas. */
  function nearestFree(windows, rect, { gap = GAP, ignoreId = null, world = WORLD } = {}) {
    const r = normRect(rect);
    if (!r || r.w <= 0 || r.h <= 0 || r.w > world.w || r.h > world.h) return null;
    const { w, h } = r;
    const maxX = world.w - w;
    const maxY = world.h - h;
    const tx = clamp(r.x, 0, maxX);
    const ty = clamp(r.y, 0, maxY);
    const obstacles = [];
    for (const o of Array.isArray(windows) ? windows : []) {
      if (obstacles.length >= MAX_OBSTACLES) break;
      if (!o || (ignoreId != null && o.id === ignoreId)) continue;
      const or = normRect(o);
      if (or) obstacles.push(or);
    }
    const fits = (x, y) => {
      const cand = { x, y, w, h };
      for (const o of obstacles) if (overlaps(cand, o, gap)) return false;
      return true;
    };
    if (fits(tx, ty)) return { x: tx, y: ty, w, h };

    const xs = new Set([tx, 0, maxX]);
    const ys = new Set([ty, 0, maxY]);
    for (const o of obstacles) {
      xs.add(o.x + o.w + gap);
      xs.add(o.x - gap - w);
      ys.add(o.y + o.h + gap);
      ys.add(o.y - gap - h);
    }
    const inX = [...xs].filter((x) => x >= 0 && x <= maxX);
    const inY = [...ys].filter((y) => y >= 0 && y <= maxY);
    const pairs = [];
    for (const x of inX) {
      for (const y of inY) {
        const dx = x - tx;
        const dy = y - ty;
        pairs.push({ x, y, d: dx * dx + dy * dy });
      }
    }
    pairs.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    for (const p of pairs) {
      if (fits(p.x, p.y)) return { x: p.x, y: p.y, w, h };
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------

  /** Janela vinda de fora (welcome, mesa-sync, semente de migracao) ->
   * janela limpa, ou `null`. Confere so o que e do modelo; o que e do tipo
   * (tipo conhecido, teto do estado) fica com `accept`. */
  function sanitizeWindow(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.id !== 'string' || !WINDOW_ID_RE.test(raw.id)) return null;
    if (typeof raw.type !== 'string' || !TYPE_RE.test(raw.type)) return null;
    const rect = normRect(raw);
    if (!rect || checkRect(rect) !== true) return null;
    const state = raw.state === undefined ? null : cloneJson(raw.state);
    if (state === undefined) return null;
    const owner = typeof raw.owner === 'string' && raw.owner.length <= 64 ? raw.owner : null;
    return { id: raw.id, type: raw.type, owner, ...rect, state };
  }

  /** Retrato da mesa vindo de fora -> retrato limpo. Janela invalida,
   * repetida ou que sobreporia uma anterior sai; passa do teto, o resto
   * sai. `accept(win)` (opcional) decide o que depende do tipo e pode
   * devolver a janela ajustada (ou `null` para tirar). */
  function sanitizeMesa(raw, { accept = null, maxWindows = MAX_WINDOWS } = {}) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const seq = Number.isSafeInteger(src.seq) && src.seq >= 0 ? src.seq : 0;
    const windows = [];
    const ids = new Set();
    for (const item of Array.isArray(src.windows) ? src.windows.slice(0, maxWindows * 2) : []) {
      if (windows.length >= maxWindows) break;
      let win = sanitizeWindow(item);
      if (win && typeof accept === 'function') win = accept(win);
      if (!win || ids.has(win.id)) continue;
      if (windows.some((o) => overlaps(win, o, 0))) continue;
      ids.add(win.id);
      windows.push(win);
    }
    return { seq, leaderOnly: src.leaderOnly === true, windows };
  }

  function emptyMesa() {
    return { seq: 0, leaderOnly: false, windows: [] };
  }

  /** Estado inicial de quem acabou de entrar (welcome) ou do servidor
   * (semente). Tipo invalido cai no padrao: Transmissao. */
  function createState({ mode, mesa } = {}, opts = {}) {
    return {
      mode: isMode(mode) ? mode : 'transmissao',
      mesa: mesa ? sanitizeMesa(mesa, opts) : emptyMesa(),
    };
  }

  /** Retrato para mandar pela rede (welcome, mesa-sync, migracao). */
  function snapshot(state) {
    return {
      mode: state.mode,
      mesa: { seq: state.mesa.seq, leaderOnly: state.mesa.leaderOnly, windows: state.mesa.windows.map((w) => ({ ...w })) },
    };
  }

  function findWindow(state, id) {
    return state.mesa.windows.find((w) => w.id === id) || null;
  }

  function defaultGetModule(type) {
    const reg = root.GoLive && root.GoLive.mesaModules;
    return reg && Object.prototype.hasOwnProperty.call(reg, type) ? reg[type] : null;
  }

  /** Aplica uma mensagem ja aceita pelo servidor. Devolve sempre
   * `{ state, needSync }`, com `state` NOVO quando algo mudou (o anterior
   * nunca e mutado) e o mesmo objeto quando nada mudou.
   *
   * - `room-mode`: troca o tipo da sala.
   * - `mesa-sync`: troca o retrato inteiro (resposta a um pedido de sync).
   * - `mesa` com `seq`: so aplica o proximo da fila. `seq` ja visto e
   *   ignorado (`stale: true`); `seq` pulado devolve `needSync: true`, e
   *   quem chamou pede `{ type: 'mesa-sync' }`. Mensagem que nao casa com o
   *   estado (janela que nao existe, id repetido, modulo desconhecido)
   *   tambem pede sync: o retrato do servidor e a verdade.
   *
   * `opts.getModule(type)` acha o modulo do tipo para o `act`; o padrao le
   * `GoLive.mesaModules`, onde cada modulo se registra. */
  function applyMessage(state, msg, { getModule = defaultGetModule } = {}) {
    const same = { state, needSync: false };
    if (!msg || typeof msg !== 'object') return same;
    if (msg.type === 'room-mode') {
      if (!isMode(msg.mode) || msg.mode === state.mode) return same;
      return { state: { ...state, mode: msg.mode }, needSync: false };
    }
    if (msg.type === 'mesa-sync') {
      return { state: createState({ mode: msg.mode === undefined ? state.mode : msg.mode, mesa: msg.mesa || emptyMesa() }), needSync: false };
    }
    if (msg.type !== 'mesa') return same;
    if (!Number.isSafeInteger(msg.seq)) return same;
    const cur = state.mesa.seq;
    if (msg.seq <= cur) return { state, needSync: false, stale: true };
    if (msg.seq !== cur + 1) return { state, needSync: true };
    const next = applyOp(state.mesa, msg, getModule);
    if (!next) return { state, needSync: true };
    return { state: { ...state, mesa: { ...next, seq: msg.seq } }, needSync: false };
  }

  /** Uma operacao sobre a mesa. `null` quando a mensagem nao casa com o
   * estado (quem chamou pede sync). */
  function applyOp(mesa, msg, getModule) {
    const windows = mesa.windows;
    switch (msg.op) {
      case 'add': {
        const win = sanitizeWindow(msg.win);
        if (!win || windows.some((w) => w.id === win.id)) return null;
        return { ...mesa, windows: [...windows, win] };
      }
      case 'remove': {
        if (!windows.some((w) => w.id === msg.id)) return null;
        return { ...mesa, windows: windows.filter((w) => w.id !== msg.id) };
      }
      case 'place': {
        const rect = normRect(msg);
        const i = windows.findIndex((w) => w.id === msg.id);
        if (!rect || i < 0) return null;
        const out = windows.slice();
        out[i] = { ...windows[i], ...rect };
        return { ...mesa, windows: out };
      }
      case 'act': {
        const i = windows.findIndex((w) => w.id === msg.id);
        if (i < 0) return null;
        const mod = typeof getModule === 'function' ? getModule(windows[i].type) : null;
        if (!mod || typeof mod.reduce !== 'function') return null;
        let nextState;
        try {
          // Mesmo contexto no servidor e nos clientes: so quem agiu e se era
          // o lider. Hora e sorte ja vieram dentro da acao (prepare).
          nextState = cloneJson(mod.reduce(windows[i].state, msg.action, { from: msg.by ?? null, isLeader: msg.isLeader === true }));
        } catch {
          return null;
        }
        if (nextState === undefined) return null;
        const out = windows.slice();
        out[i] = { ...windows[i], state: nextState };
        return { ...mesa, windows: out };
      }
      case 'lock':
        return { ...mesa, leaderOnly: msg.leaderOnly === true };
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------
  // Vez por janela
  // ---------------------------------------------------------------------

  /** Quem esta movendo cada janela. Pura: o relogio entra por parametro.
   * O servidor usa para decidir; o cliente usa com o proprio relogio para
   * apagar o "Bia esta movendo" se a soltura nunca chegar (GRAB_MS depois
   * do ultimo mesa-grab/mesa-drag visto). */
  function createGrabs({ ms = GRAB_MS } = {}) {
    const held = new Map(); // janela -> { by, until }

    function holder(id, now) {
      const g = held.get(id);
      if (!g) return null;
      if (g.until <= now) {
        held.delete(id);
        return null;
      }
      return g.by;
    }

    /** Pede a vez. Livre (ou vencida, ou ja sua): pega e renova. */
    function take(id, by, now) {
      const cur = holder(id, now);
      if (cur !== null && cur !== by) return { ok: false, holder: cur };
      held.set(id, { by, until: now + ms });
      return { ok: true };
    }

    /** Anota a vez que o servidor ja deu (lado do cliente). */
    function set(id, by, now) {
      held.set(id, { by, until: now + ms });
    }

    /** Renova so para quem ja tem a vez. */
    function renew(id, by, now) {
      if (holder(id, now) !== by) return false;
      held.set(id, { by, until: now + ms });
      return true;
    }

    /** Solta. `by` null solta de quem quer que seja (lado do cliente, ao
     * receber mesa-release). */
    function release(id, by = null) {
      const g = held.get(id);
      if (!g || (by !== null && g.by !== by)) return false;
      held.delete(id);
      return true;
    }

    /** Solta tudo de uma pessoa (ela saiu). Devolve as janelas soltas. */
    function dropPeer(by) {
      const out = [];
      for (const [id, g] of held) {
        if (g.by === by) {
          held.delete(id);
          out.push(id);
        }
      }
      return out;
    }

    function drop(id) {
      held.delete(id);
    }

    function list(now) {
      const out = [];
      for (const id of [...held.keys()]) {
        const by = holder(id, now);
        if (by !== null) out.push({ id, by, until: held.get(id).until });
      }
      return out;
    }

    return { take, set, renew, release, holder, dropPeer, drop, list };
  }

  // ---------------------------------------------------------------------
  // mesa-drag e cursor: limitador e ultimo ponto por pessoa
  // ---------------------------------------------------------------------

  /** Mesma regra do laser (laser.shouldEmit): zero/ausente e "nunca
   * enviou", e o primeiro ponto sai na hora. */
  function shouldEmit(lastSentAt, now, hz = EMIT_HZ) {
    if (!lastSentAt) return true;
    if (!(typeof hz === 'number' && Number.isFinite(hz) && hz > 0)) return false;
    return now - lastSentAt >= 1000 / hz;
  }

  /** Ponto do ponteiro vindo da rede -> `{ x, y }` inteiros, ou `null`.
   * Vale a mesa mais a folga da vista (o ponteiro passa da borda). */
  function normCursor(raw) {
    if (!raw || !isNum(raw.x) || !isNum(raw.y)) return null;
    const x = Math.round(raw.x);
    const y = Math.round(raw.y);
    if (x < -OVERSCROLL || y < -OVERSCROLL || x > WORLD.w + OVERSCROLL || y > WORLD.h + OVERSCROLL) return null;
    return { x, y };
  }

  /** Retangulo durante o arraste: pode passar por cima de outras janelas e
   * da borda (so a folga da vista), mas continua sendo um retangulo sao. */
  function normDragRect(raw) {
    const r = normRect(raw);
    if (!r || r.w < MIN_W || r.h < MIN_H || r.w > WORLD.w || r.h > WORLD.h) return null;
    if (r.x < -OVERSCROLL || r.y < -OVERSCROLL || r.x + r.w > WORLD.w + OVERSCROLL || r.y + r.h > WORLD.h + OVERSCROLL) return null;
    return r;
  }

  /** Ultimo ponto de cada pessoa, com prazo pelo relogio de quem desenha
   * (padrao do laser). Serve para os ponteiros e para o arraste ao vivo. */
  function createPointerStore({ ttlMs = CURSOR_TTL_MS } = {}) {
    const points = new Map(); // pessoa -> { data, ts }

    function apply(from, data, now) {
      if (data == null) return false;
      points.set(String(from), { data, ts: now });
      return true;
    }

    function active(now, ttl = ttlMs) {
      const out = [];
      for (const [from, p] of points) {
        const age = now - p.ts;
        if (age < ttl) out.push({ from, ...p.data, age });
      }
      return out;
    }

    function drop(from) {
      points.delete(String(from));
    }

    return { apply, active, drop };
  }

  const api = {
    WORLD, OVERSCROLL, GAP, MAX_WINDOWS, GRAB_MS, EMIT_HZ, CURSOR_TTL_MS, MIN_W, MIN_H, MODES,
    isMode, jsonBytes, cloneJson,
    normRect, checkRect, overlaps, nearestFree,
    sanitizeWindow, sanitizeMesa, createState, snapshot, findWindow, applyMessage,
    createGrabs,
    shouldEmit, normCursor, normDragRect, createPointerStore,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesa = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
