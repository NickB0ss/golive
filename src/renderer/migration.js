'use strict';

// Decisao da migracao de sala quando o lider cai (itens B e C da auditoria
// 2026-09-18, anexo 3 · R3). Modulo puro, sem DOM e sem relogio proprio:
// quem chama passa `now`, entao o teste anda o tempo na mao.
//
// Por que existe: antes, cada sobrevivente so descobria onde reconectar pelo
// beacon UDP do sucessor. No Tailscale (L3, sem broadcast) o beacon nunca
// chega, cada um desistia no seu proprio relogio e virava host com o mesmo
// roomId -- a sala se partia em N. Agora:
//   1. Todo mundo ja sabe, antes da queda, o IP de cada membro (o servidor
//      manda `peerAddresses`) e a porta da sala atual. O sucessor sobe o
//      servidor novo NA MESMA PORTA (com a faixa 9000-9010 de reserva), e os
//      demais o procuram DIRETO em ip:porta, com retentativas. O beacon UDP
//      vira so um atalho a mais.
//   2. A vez de cada um e medida a partir do MESMO evento (a queda), nao da
//      desistencia individual: o candidato k so assume em
//      dropAt + baseMs + k * stepMs, e so se nesse instante for a vez dele.
//      Quem nao e a vez procura os candidatos anteriores; quem perdeu a vez
//      (sucessor lento) procura o da vez em vez de subir uma segunda sala.
//   3. O beacon UDP carrega uma prova HMAC-SHA256 feita com o
//      `migrationSecret`, que o servidor rotaciona a cada entrada e a cada
//      saida -- ex-membro (inclusive banido) nao tem o segredo atual.

(function (root) {
  // No renderer o succession.js carrega antes (index.html); no Node vem por
  // `module.require` (mesmo molde do config.js: `require` solto nao existe
  // no escopo das <script> do renderer).
  const succession = (root.GoLive && root.GoLive.succession)
    || (typeof module !== 'undefined' && typeof module.require === 'function' ? module.require('./succession') : null);

  // Janela de cada candidato. Mesmo valor que a espera por rank ja usava
  // (15 s): no caminho gracioso os tempos continuam exatamente os de antes.
  const MIGRATION_STEP_MS = succession ? succession.SUCCESSOR_TIMEOUT_MS : 15000;
  // Folga somada ao pior caso da escada de reconexao no caminho abrupto: a
  // queda e percebida por cada maquina com alguns segundos de diferenca.
  const ABRUPT_SLACK_MS = 5000;
  // Intervalo entre rodadas de procura direta pelo sucessor.
  const DIAL_INTERVAL_MS = 2000;
  // A cada quantas rodadas a procura varre a faixa inteira de portas (o
  // sucessor quase sempre consegue a porta da sala; varrer toda rodada
  // encheria o console de "WebSocket failed" sem ganho).
  const FULL_SWEEP_EVERY = 5;
  const PORT_RANGE_START = 9000;
  const PORT_RANGE_END = 9010;
  // Validade do beacon assinado. Curta o bastante pra um beacon capturado
  // nao servir numa migracao futura, larga o bastante pro relogio de duas
  // maquinas da LAN virtual discordar em alguns segundos sem quebrar nada.
  const PROOF_MAX_AGE_MS = 120000;

  /** Base do prazo absoluto: 0 no caminho gracioso (o 'room-migrating'
   * chega a todos no mesmo instante), e o pior caso da reconexao + folga no
   * abrupto (todos tentam o lider morto por ate esse tempo antes de desistir). */
  function baseDelayMs({ abrupt = false, worstCaseReconnectMs = 0 } = {}) {
    if (!abrupt) return 0;
    const worst = Number.isFinite(worstCaseReconnectMs) && worstCaseReconnectMs > 0 ? worstCaseReconnectMs : 0;
    return worst + ABRUPT_SLACK_MS;
  }

  /** Quem e o candidato da vez em `now`: 0 (o sucessor) ate o primeiro
   * prazo, depois 1, 2... sem passar do ultimo. -1 sem candidatos. */
  function turnAt({ count, dropAt, baseMs = 0, stepMs = MIGRATION_STEP_MS, now }) {
    if (!Number.isInteger(count) || count <= 0) return -1;
    const elapsed = now - dropAt - baseMs;
    if (!(elapsed >= stepMs)) return 0;
    return Math.min(count - 1, Math.floor(elapsed / stepMs));
  }

  /** Instante em que comeca a vez do candidato `rank` (>= 1). */
  function turnStartsAt({ rank, dropAt, baseMs = 0, stepMs = MIGRATION_STEP_MS }) {
    return dropAt + baseMs + rank * stepMs;
  }

  /**
   * O que ESTE sobrevivente faz agora.
   * - `host`: e a vez dele -- sobe o servidor novo.
   * - `dial`: procura direto os candidatos ate o da vez (menos ele mesmo).
   * - `none`: ele nao esta na lista (ex.: era o proprio lider).
   * `nextTurnAt` diz quando reavaliar (null se ja e o ultimo).
   */
  function decide({ order, myId, dropAt, baseMs = 0, stepMs = MIGRATION_STEP_MS, now }) {
    const list = Array.isArray(order) ? order : [];
    const myRank = list.indexOf(myId);
    if (myRank < 0) return { action: 'none', turn: -1, myRank, targets: [], nextTurnAt: null };
    const turn = turnAt({ count: list.length, dropAt, baseMs, stepMs, now });
    const nextTurnAt = turn + 1 < list.length ? turnStartsAt({ rank: turn + 1, dropAt, baseMs, stepMs }) : null;
    if (turn === myRank) return { action: 'host', turn, myRank, targets: [], nextTurnAt };
    // Procura o da vez E os anteriores: um candidato anterior que subiu
    // atrasado (ou que so este sobrevivente alcanca) ainda junta a sala.
    const targets = list.slice(0, turn + 1).filter((id) => id !== myId);
    return { action: 'dial', turn, myRank, targets, nextTurnAt };
  }

  /** Rechecagem depois que `hostRoomFlow` finalmente terminou. Se a vez de
   * outro candidato ja comecou, o host lento PRECISA sondar antes de se
   * anunciar; a resposta da sonda decide entre ceder ou assumir. */
  function hostSuccessCheck(args) {
    const step = decide(args);
    return step.action === 'dial'
      ? { action: 'probe', targets: step.targets, turn: step.turn, myRank: step.myRank }
      : { action: 'assume', targets: [], turn: step.turn, myRank: step.myRank };
  }

  function finishHostSuccessCheck(check, found) {
    return check?.action === 'probe' && found?.sameRoom === true ? 'yield' : 'assume';
  }

  /** Resultado terminal de uma tentativa de host. `discard` e deliberado:
   * quem chama deve fechar o servidor antes de considerar qualquer beacon. */
  function hostSuccessAction({ attemptToken, currentAttemptToken, check = null, found = null } = {}) {
    if (attemptToken !== currentAttemptToken) return 'discard';
    return finishHostSuccessCheck(check, found);
  }

  /** Ordem de sucessao dos sobreviventes; o sucessor anunciado pelo
   * servidor (caminho gracioso) vai pra frente se a conta local discordar. */
  function successionOrder(candidates, hostId, announcedSuccessor = null) {
    const order = succession ? succession.survivorsInOrder(candidates, hostId) : [];
    if (typeof announcedSuccessor === 'string' && announcedSuccessor && announcedSuccessor !== hostId) {
      const rest = order.filter((id) => id !== announcedSuccessor);
      return [announcedSuccessor, ...rest];
    }
    return order;
  }

  /** Portas a tentar nesta rodada: a da sala sempre primeiro; a faixa
   * inteira so de tempos em tempos. */
  function dialPorts(preferredPort, round = 0) {
    const preferred = Number.isInteger(preferredPort) && preferredPort > 0 && preferredPort <= 65535 ? preferredPort : PORT_RANGE_START;
    if (!(round > 0 && round % FULL_SWEEP_EVERY === 0)) return [preferred];
    const out = [preferred];
    for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p += 1) if (p !== preferred) out.push(p);
    return out;
  }

  /** "ip:porta" pra WebSocket (IPv6 entre colchetes). */
  function hostPort(ip, port) {
    if (typeof ip !== 'string' || !ip) return null;
    return ip.includes(':') ? `[${ip}]:${port}` : `${ip}:${port}`;
  }

  /** Enderecos a sondar nesta rodada, na ordem de prioridade. */
  function dialAddresses({ targets, addresses, port, round = 0 }) {
    const out = [];
    const ports = dialPorts(port, round);
    for (const id of targets || []) {
      const ip = addresses && typeof addresses === 'object' ? addresses[id] : null;
      for (const p of ports) {
        const addr = hostPort(ip, p);
        if (addr && !out.includes(addr)) out.push(addr);
      }
    }
    return out;
  }

  // --- Prova do beacon (HMAC-SHA256, WebCrypto: roda no renderer e no Node) ---

  function proofMessage(roomId, address, ts) {
    return `golive-migrate\n${roomId}\n${address}\n${ts}`;
  }

  function subtle() {
    const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    return c && c.subtle ? c.subtle : null;
  }

  function toHex(buf) {
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** HMAC-SHA256(secret, roomId|address|ts) em hex. O main assina com o
   * `crypto` do Node (mesma conta; ha teste cruzando os dois). */
  async function migrationProof(secret, roomId, address, ts) {
    const s = subtle();
    if (!s || typeof secret !== 'string' || !secret) return null;
    const enc = new TextEncoder();
    const key = await s.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await s.sign('HMAC', key, enc.encode(proofMessage(roomId, address, ts)));
    return toHex(sig);
  }

  // Comparacao sem saida antecipada: o tempo nao revela quantos caracteres
  // da prova batem.
  function sameHex(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  /** O beacon so e seguido se: roomId bate, a prova foi feita com o segredo
   * que ESTE sobrevivente tinha na queda e o carimbo esta dentro da janela. */
  async function verifyMigrationBeacon({ beacon, roomId, secret, now, maxAgeMs = PROOF_MAX_AGE_MS }) {
    if (!beacon || typeof beacon !== 'object') return false;
    if (typeof roomId !== 'string' || !roomId || beacon.roomId !== roomId) return false;
    if (typeof secret !== 'string' || !secret) return false;
    if (!Number.isFinite(beacon.ts) || Math.abs(now - beacon.ts) > maxAgeMs) return false;
    if (typeof beacon.proof !== 'string' || !/^[0-9a-f]{64}$/.test(beacon.proof)) return false;
    const expected = await migrationProof(secret, beacon.roomId, beacon.address, beacon.ts);
    return sameHex(expected, beacon.proof);
  }

  const api = {
    MIGRATION_STEP_MS,
    ABRUPT_SLACK_MS,
    DIAL_INTERVAL_MS,
    FULL_SWEEP_EVERY,
    PORT_RANGE_START,
    PORT_RANGE_END,
    PROOF_MAX_AGE_MS,
    baseDelayMs,
    turnAt,
    turnStartsAt,
    decide,
    hostSuccessCheck,
    finishHostSuccessCheck,
    hostSuccessAction,
    successionOrder,
    dialPorts,
    dialAddresses,
    hostPort,
    proofMessage,
    migrationProof,
    verifyMigrationBeacon,
  };
  root.GoLive = root.GoLive || {};
  root.GoLive.migration = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
