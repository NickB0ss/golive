'use strict';
/*
 * Regressao dos achados S-01..S-09 da auditoria de 2026-11-25
 * (docs/auditoria-2026-11-25/bugs-servidor.md). Cada teste e a reproducao do
 * relatorio ao contrario: ele passa quando o defeito NAO existe.
 *
 * Ameaca: qualquer um que alcanca a porta na LAN virtual. Os casos que
 * derrubariam o processo (S-07, S-08) sobem o servidor num processo filho sem
 * handler de uncaughtException, igual ao CLI (server/signaling.js).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const WebSocket = require('ws');
const { createSignalingServer, MAX_CONNECTIONS } = require('./signaling-core');

const PRAZO_MS = 4000;
const AVATAR = `data:image/png;base64,${'A'.repeat(64 * 1024 - 40)}`;

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cliente com caixa de entrada: `espera(tipo, pred)` devolve a primeira
 * mensagem que casa, mesmo que ela ja tenha chegado. */
function cliente(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const caixa = [];
  const esperas = new Set();
  let fechado = null;
  ws.on('message', (raw) => {
    caixa.push(JSON.parse(raw.toString()));
    for (const e of Array.from(esperas)) {
      const m = caixa.find(e.pred);
      if (!m) continue;
      esperas.delete(e);
      clearTimeout(e.timer);
      e.resolve(m);
    }
  });
  ws.on('close', (code) => {
    fechado = code;
  });
  ws.on('error', () => {});
  const c = {
    ws,
    caixa,
    get fechado() {
      return fechado;
    },
    aberto() {
      if (ws.readyState === WebSocket.OPEN) return Promise.resolve(c);
      return new Promise((resolve, reject) => {
        ws.once('open', () => resolve(c));
        ws.once('close', () => reject(new Error('fechou antes de abrir')));
      });
    },
    manda(obj) {
      ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
    },
    espera(type, pred = () => true, prazo = PRAZO_MS) {
      const casa = (m) => m.type === type && pred(m);
      const ja = caixa.find(casa);
      if (ja) return Promise.resolve(ja);
      return new Promise((resolve, reject) => {
        const e = { pred: casa, resolve };
        e.timer = setTimeout(() => {
          esperas.delete(e);
          reject(new Error(`${type} nao chegou`));
        }, prazo);
        esperas.add(e);
      });
    },
    fechou() {
      if (fechado !== null) return Promise.resolve(fechado);
      return new Promise((r) => ws.once('close', (code) => r(code)));
    },
  };
  return c;
}

async function entra(port, join = {}) {
  const c = await cliente(port).aberto();
  c.manda({ type: 'join', room: 'geral', name: 'x', ...join });
  c.welcome = await c.espera('welcome');
  c.id = c.welcome.id;
  return c;
}

/** Ate `cond()` ser verdade, ou falha depois de `prazo`. */
async function ate(cond, oque, prazo = PRAZO_MS) {
  const fim = Date.now() + prazo;
  while (!cond()) {
    if (Date.now() > fim) throw new Error(`${oque}: nao aconteceu em ${prazo} ms`);
    await pausa(20);
  }
}

const hashDaChave = (chave) => createHash('sha256').update(chave).digest('base64url');

/** Sobe o servidor num processo filho sem handler de uncaughtException (como
 * o CLI): excecao que escapar de um handler mata o filho. */
function sobeFilho() {
  const core = path.join(__dirname, 'signaling-core.js');
  const codigo = `require(${JSON.stringify(core)}).createSignalingServer({ port: 0, log: () => {} })`
    + ".then((s) => console.log('PORTA ' + s.port));";
  const filho = spawn(process.execPath, ['-e', codigo], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  filho.stderr.on('data', (d) => {
    stderr += d;
  });
  let saida = null;
  const saiu = new Promise((r) => filho.once('exit', (code) => {
    saida = code;
    r(code);
  }));
  return new Promise((resolve) => {
    filho.stdout.on('data', (d) => {
      const m = /PORTA (\d+)/.exec(String(d));
      if (m) {
        resolve({
          filho, port: Number(m[1]), saiu,
          get vivo() {
            return saida === null;
          },
          stderr: () => stderr,
        });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// S-01: amplificacao do 'watchers' e buffer de envio sem teto
// ---------------------------------------------------------------------------

test('S-01: watchers repassa so id e nome, e 1 s dele nao pendura megabytes no host', async () => {
  const server = await createSignalingServer({ port: 0 });
  const socks = [];
  try {
    for (let i = 0; i < MAX_CONNECTIONS; i++) socks.push(await entra(server.port, { name: `s${i}`, avatar: AVATAR }));
    // Os 15 destinatarios param de ler.
    for (const c of socks.slice(1)) c.ws._socket.pause();
    const msg = JSON.stringify({ type: 'watchers', kind: 'screen', watchers: socks.map((c) => ({ id: c.id })) });
    const t0 = Date.now();
    while (Date.now() - t0 < 1000) {
      socks[0].manda(msg);
      await pausa(50); // 20/s: dentro da cota de watchers
    }
    await pausa(300);
    let pendurado = 0;
    for (const ws of server.wss.clients) pendurado += ws.bufferedAmount;
    assert.ok(pendurado < 5e6, `buffer no host: ${(pendurado / 1e6).toFixed(1)} MB`);

    // O que chega: so id e nome -- o avatar ja esta no roster de quem recebe.
    socks[1].ws._socket.resume();
    const w = await socks[1].espera('watchers');
    assert.ok(w.watchers.length > 0);
    for (const item of w.watchers) assert.deepEqual(Object.keys(item).sort(), ['id', 'name']);
  } finally {
    for (const c of socks) c.ws.terminate();
    await server.close();
  }
});

test('S-01: quem para de ler e cortado quando o buffer de envio passa do teto', async () => {
  const TETO = 256 * 1024;
  const server = await createSignalingServer({ port: 0, maxBufferedBytes: TETO });
  try {
    const ana = await entra(server.port, { name: 'Ana', clientId: 'c-ana' });
    const bia = await entra(server.port, { name: 'Bia', clientId: 'c-bia' });
    bia.ws._socket.pause();
    // annotate-sync e roteado so pra Bia e sai do tamanho que entrou: 16
    // snapshots de ~450 KB (o balde comporta 16 de uma vez) dao ~7 MB.
    const pontos = Array.from({ length: 2000 }, (_, i) => [((i % 900) + 100) / 1000, 0.123]);
    const items = Array.from({ length: 16 }, (_, i) => ({ kind: 'stroke', id: `t${i}`, from: ana.id, points: pontos }));
    const msg = JSON.stringify({ type: 'annotate-sync', to: bia.id, surface: `${ana.id}:screen`, items });
    for (let i = 0; i < 16; i++) ana.manda(msg);
    const socketDaBia = () => [...server.wss.clients].find((ws) => ws.peerId === bia.id) || null;
    await ate(() => socketDaBia() === null, 'socket da Bia derrubado');
    for (const ws of server.wss.clients) {
      assert.ok(ws.bufferedAmount <= TETO, `#${ws.peerId} com ${ws.bufferedAmount} bytes pendurados`);
    }
    // Derrubado sem frame de close (1006): a Bia fica suspensa e pode retomar.
    assert.equal(server.getPeerCount(), 2);
    ana.ws.terminate();
    bia.ws.terminate();
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// S-02: lideranca presa a um clientId publico
// ---------------------------------------------------------------------------

test('S-02: room-migrating nao publica o clientId do lider novo; a chave vai so para ele', async () => {
  const server = await createSignalingServer({ port: 0, ownerToken: 'tok-velho' });
  const host = await entra(server.port, { name: 'Host', ownerToken: 'tok-velho', clientId: 'c-host' });
  const bia = await entra(server.port, { name: 'Bia', clientId: 'c-bia' });
  const mau = await entra(server.port, { name: 'Mau', clientId: 'c-mau' });
  const migrBia = bia.espera('room-migrating');
  const migrMau = mau.espera('room-migrating');
  await server.close({ migrate: true });
  const [mb, mm] = await Promise.all([migrBia, migrMau]);
  assert.equal(mb.successor, bia.id);
  for (const m of [mb, mm]) {
    assert.equal('newOwnerClientId' in m, false);
    assert.equal(JSON.stringify(m).includes('c-bia'), false, 'clientId da Bia vazou');
  }
  // Sucessora (e lider nova, porque o lider era o host que saiu): so ela
  // recebe a chave. Todos recebem o hash, que e o que o sucessor semeia.
  assert.equal(typeof mb.leaderKey, 'string');
  assert.equal('leaderKey' in mm, false);
  assert.equal(mm.leaderKeyHash, hashDaChave(mb.leaderKey));
  assert.equal(mb.leaderKeyHash, mm.leaderKeyHash);
  for (const c of [host, bia, mau]) c.ws.terminate();
});

test('S-02: no servidor do sucessor, so a chave vale coroa (o clientId, nao), e uma vez so', async () => {
  const chave = 'chave-secreta-da-bia';
  const server = await createSignalingServer({
    port: 0, ownerToken: 'tok-caio', initialTransferredTo: hashDaChave(chave),
  });
  try {
    // Quem hospeda a sala nova (token) nao e o lider escolhido.
    const caio = await entra(server.port, { name: 'Caio', ownerToken: 'tok-caio', clientId: 'c-caio' });
    assert.equal(caio.welcome.owner, false);
    const mau = await entra(server.port, { name: 'Mau', clientId: 'c-bia' });
    assert.equal(mau.welcome.owner, false, 'clientId sozinho nao e coroa');
    const errada = await entra(server.port, { name: 'Mau2', clientId: 'c-bia', leaderKey: 'chute' });
    assert.equal(errada.welcome.owner, false);
    const bia = await entra(server.port, { name: 'Bia', clientId: 'c-bia', leaderKey: chave });
    assert.equal(bia.welcome.owner, true);
    // Chave gasta: repetir nao cria segunda coroa.
    const copia = await entra(server.port, { name: 'Copia', clientId: 'c-bia', leaderKey: chave });
    assert.equal(copia.welcome.owner, false);
    // E o Mau nao modera ninguem.
    mau.manda({ type: 'moderate', action: 'kick', target: bia.id });
    await pausa(150);
    assert.equal(bia.fechado, null);
    for (const c of [caio, mau, errada, bia, copia]) c.ws.terminate();
  } finally {
    await server.close();
  }
});

test('S-02: depois de transfer-owner, repetir o clientId do lider nao da coroa', async () => {
  const server = await createSignalingServer({ port: 0, ownerToken: 'tok' });
  try {
    const host = await entra(server.port, { name: 'Host', ownerToken: 'tok', clientId: 'c-host' });
    const bia = await entra(server.port, { name: 'Bia', clientId: 'c-bia' });
    host.manda({ type: 'moderate', action: 'transfer-owner', target: bia.id });
    await bia.espera('owner-changed', (m) => m.id === bia.id);
    const clone = await entra(server.port, { name: 'Clone', clientId: 'c-bia' });
    assert.equal(clone.welcome.owner, false);
    clone.manda({ type: 'moderate', action: 'ban', target: bia.id });
    await pausa(150);
    assert.equal(bia.fechado, null);
    for (const c of [host, bia, clone]) c.ws.terminate();
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// S-03: campo `room` livre
// ---------------------------------------------------------------------------

test('S-03: join com outra sala e recusado, e a geral cheia nao ganha vaga por outro nome', async () => {
  const server = await createSignalingServer({ port: 0 });
  const todos = [];
  try {
    const outra = await cliente(server.port).aberto();
    outra.manda({ type: 'join', room: 'z', name: 'Espiao' });
    assert.equal((await outra.espera('join-denied')).reason, 'room');
    assert.equal(server.getPeerCount(), 0);

    for (let i = 0; i < MAX_CONNECTIONS; i++) todos.push(await entra(server.port, { name: `g${i}` }));
    const extra = await cliente(server.port).aberto();
    extra.manda({ type: 'join', room: 'x0', name: 'extra' });
    assert.equal((await extra.espera('join-denied')).reason, 'room');
    // Sem o campo, a sala e a geral (e ela esta cheia).
    const semSala = await cliente(server.port).aberto();
    semSala.manda({ type: 'join', name: 'sem sala' });
    assert.equal((await semSala.espera('join-denied')).reason, 'full');
    assert.equal(server.getPeerCount(), MAX_CONNECTIONS);
  } finally {
    for (const c of todos) c.ws.terminate();
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// S-04: conexoes que nunca mandam join
// ---------------------------------------------------------------------------

test('S-04: conexao sem join cai no prazo, e um IP so nao ocupa todas as vagas pendentes', async () => {
  const server = await createSignalingServer({ port: 0, joinTimeoutMs: 300 });
  const ociosos = [];
  try {
    // Um IP so (loopback): passadas as vagas dele, a proxima e recusada,
    // mesmo com o teto global de pendentes longe.
    for (let i = 0; i < 8; i++) ociosos.push(await cliente(server.port).aberto());
    const alem = cliente(server.port);
    assert.equal(await Promise.race([alem.fechou(), pausa(2000).then(() => 'aberto')]), 1013);
    // Os ociosos caem no prazo do join...
    await ate(() => ociosos.every((c) => c.fechado !== null), 'ociosos derrubados');
    // ...e a vaga volta: um amigo entra normalmente.
    const amigo = await entra(server.port, { name: 'Amigo' });
    assert.ok(amigo.welcome);
    // Quem entrou nao cai no prazo do join.
    await pausa(450);
    assert.equal(amigo.fechado, null);
    amigo.ws.terminate();
  } finally {
    for (const c of ociosos) c.ws.terminate();
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// S-05: lider que volta com join novo durante a retomada
// ---------------------------------------------------------------------------

test('S-05: lider que volta sem resumeToken nao fica com coroa escondida', async () => {
  const server = await createSignalingServer({ port: 0, ownerToken: 'tok', resumeGraceMs: 300 });
  try {
    const host = await entra(server.port, { name: 'Host', ownerToken: 'tok', clientId: 'c-host' });
    const bia = await entra(server.port, { name: 'Bia', clientId: 'c-bia' });
    const caio = await entra(server.port, { name: 'Caio', clientId: 'c-caio' });
    host.manda({ type: 'moderate', action: 'transfer-owner', target: bia.id });
    await caio.espera('owner-changed', (m) => m.id === bia.id);

    bia.ws.terminate(); // 1006: suspensa, ainda lider
    await pausa(50);
    const bia2 = await entra(server.port, { name: 'Bia', clientId: 'c-bia' }); // join novo
    // A coroa continua com o fantasma ate ele expirar; o join novo nao ganha outra.
    assert.equal(bia2.welcome.owner, false);
    assert.deepEqual(bia2.welcome.peers.filter((p) => p.owner).map((p) => p.id), [bia.id]);

    const anuncio = await caio.espera('owner-changed', (m) => m.id === host.id, 2000);
    assert.equal(anuncio.id, host.id);

    // A Bia2 nao modera escondida.
    bia2.manda({ type: 'moderate', action: 'kick', target: caio.id });
    await pausa(150);
    assert.equal(caio.fechado, null);
    // Uma coroa so na sala, vista por quem entra agora.
    const novo = await entra(server.port, { name: 'Novo', clientId: 'c-novo' });
    assert.deepEqual(novo.welcome.peers.filter((p) => p.owner).map((p) => p.id), [host.id]);
    for (const c of [host, bia2, caio, novo]) c.ws.terminate();
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// S-06: sucessor escolhido entre peers suspensos
// ---------------------------------------------------------------------------

test('S-06: a migracao escolhe sucessor e lider novo so entre quem esta conectado', async () => {
  const server = await createSignalingServer({ port: 0, ownerToken: 'tok' });
  const host = await entra(server.port, { name: 'Host', ownerToken: 'tok', clientId: 'c-host' });
  const bia = await entra(server.port, { name: 'Bia', clientId: 'c-bia' });
  const caio = await entra(server.port, { name: 'Caio', clientId: 'c-caio' });
  bia.ws.terminate(); // 1006 -> suspensa (continua em `peers`)
  await pausa(100);
  assert.equal(server.getPeerCount(), 3);
  const migr = caio.espera('room-migrating');
  await server.close({ migrate: true });
  const m = await migr;
  assert.equal(m.successor, caio.id);
  assert.equal(m.successorName, 'Caio');
  // O lider era o host (que saiu): a coroa vai pro sucessor, o Caio.
  assert.equal(typeof m.leaderKey, 'string');
  host.ws.terminate();
  caio.ws.terminate();

  const novo = await createSignalingServer({ port: 0, ownerToken: 'tok-caio', initialTransferredTo: m.leaderKeyHash });
  try {
    const caio2 = await entra(novo.port, {
      name: 'Caio', ownerToken: 'tok-caio', clientId: 'c-caio', leaderKey: m.leaderKey,
    });
    assert.equal(caio2.welcome.owner, true);
    caio2.ws.terminate();
  } finally {
    await novo.close();
  }
});

// ---------------------------------------------------------------------------
// S-07: sinalizacao com aninhamento profundo
// ---------------------------------------------------------------------------

test('S-07: offer com 100 mil niveis nao derruba o servidor nem ensurdece o remetente', async () => {
  const filho = await sobeFilho();
  try {
    const a = await entra(filho.port, { name: 'A' });
    const b = await entra(filho.port, { name: 'B' });
    const D = 100000;
    a.manda(`{"type":"offer","to":"${b.id}","sdp":${'['.repeat(D)}${']'.repeat(D)}}`);
    a.manda({ type: 'chat', text: 'depois do veneno' });
    await b.espera('chat', (m) => m.text === 'depois do veneno');
    assert.equal(filho.vivo, true, filho.stderr());
    assert.equal(b.caixa.some((m) => m.type === 'offer'), false);
    // Sinalizacao normal continua passando inteira.
    a.manda({ type: 'offer', to: b.id, kind: 'screen', sdp: { type: 'offer', sdp: 'v=0' }, renegotiate: true });
    const offer = await b.espera('offer');
    assert.deepEqual(offer.sdp, { type: 'offer', sdp: 'v=0' });
    assert.equal(offer.from, a.id);
    a.ws.terminate();
    b.ws.terminate();
  } finally {
    filho.filho.kill();
  }
});

// ---------------------------------------------------------------------------
// S-08: socket recusado sem listener de 'error'
// ---------------------------------------------------------------------------

test('S-08: frame invalido num socket recusado por excesso de pendentes nao derruba o processo', async () => {
  const filho = await sobeFilho();
  const ociosos = [];
  try {
    for (let i = 0; i < 32; i++) ociosos.push(await cliente(filho.port).aberto().catch(() => null));
    const ultimo = cliente(filho.port);
    await new Promise((r) => ultimo.ws.once('upgrade', r));
    // Frame com opcode reservado 0x3 (FIN + opcode 3, mascarado, tamanho 0).
    ultimo.ws._socket.write(Buffer.from([0x83, 0x80, 0, 0, 0, 0]));
    const resultado = await Promise.race([filho.saiu.then(() => 'morreu'), pausa(1000).then(() => 'vivo')]);
    assert.equal(resultado, 'vivo', filho.stderr());
    assert.doesNotMatch(filho.stderr(), /Unhandled .error. event/);
    ultimo.ws.terminate();
  } finally {
    for (const c of ociosos) c?.ws.terminate();
    filho.filho.kill();
  }
});

// ---------------------------------------------------------------------------
// S-09: retomada numa sala cheia
// ---------------------------------------------------------------------------

test('S-09: quem caiu retoma o proprio lugar mesmo com a sala cheia', async () => {
  const server = await createSignalingServer({ port: 0 });
  const todos = [];
  try {
    for (let i = 0; i < MAX_CONNECTIONS; i++) {
      todos.push(await entra(server.port, { name: `p${i}`, clientId: `c${i}` }));
    }
    const caiu = todos[5];
    caiu.ws.terminate(); // 1006 -> suspenso
    await pausa(100);
    const volta = await cliente(server.port).aberto();
    todos.push(volta);
    volta.manda({ type: 'join', room: 'geral', name: 'p5', clientId: 'c5', resumeToken: caiu.welcome.resumeToken });
    const w = await volta.espera('welcome');
    assert.equal(w.resumed, true);
    assert.equal(w.id, caiu.id);
    // E a sala continua sem vaga pra quem e novo.
    const novo = await cliente(server.port).aberto();
    novo.manda({ type: 'join', room: 'geral', name: 'novo', clientId: 'c-novo' });
    assert.equal((await novo.espera('join-denied')).reason, 'full');
  } finally {
    for (const c of todos) c.ws.terminate();
    await server.close();
  }
});
