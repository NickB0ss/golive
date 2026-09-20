'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createSignalingServer } = require('./signaling-core');
const { chooseSuccessor, chooseNewOwner } = require('../src/renderer/succession');

const DEADLINE_MS = 5000;

function criarCliente(port, rotulo) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const entrada = [];
  const espera = new Set();

  function reavaliar() {
    for (const esperaAtual of Array.from(espera)) {
      const msg = esperaAtual.pred(entrada);
      if (!msg) continue;
      espera.delete(esperaAtual);
      clearTimeout(esperaAtual.prazo);
      esperaAtual.resolve(msg);
    }
  }

  ws.on('message', (raw) => {
    entrada.push(JSON.parse(raw.toString()));
    reavaliar();
  });
  ws.on('error', () => {});

  const cliente = {
    ws,
    entrada,
    id: null,

    aberto() {
      if (ws.readyState === WebSocket.OPEN) return Promise.resolve(cliente);
      return new Promise((resolve, reject) => {
        ws.once('open', () => resolve(cliente));
        ws.once('error', reject);
      });
    },

    esperaMsg(pred, oque) {
      const msg = pred(entrada);
      if (msg) return Promise.resolve(msg);
      return new Promise((resolve, reject) => {
        const esperaAtual = { pred, resolve, reject };
        esperaAtual.prazo = setTimeout(() => {
          espera.delete(esperaAtual);
          reject(new Error(`${rotulo}: ${oque} nao chegou em ${DEADLINE_MS}ms`));
        }, DEADLINE_MS);
        if (typeof esperaAtual.prazo.unref === 'function') esperaAtual.prazo.unref();
        espera.add(esperaAtual);
      });
    },

    esperaTipo(type) {
      return cliente.esperaMsg((caixa) => caixa.find((msg) => msg.type === type), `mensagem ${type}`);
    },

    async entra(name, extra = {}) {
      ws.send(JSON.stringify({ type: 'join', room: 'geral', name, ...extra }));
      const welcome = await cliente.esperaTipo('welcome');
      cliente.id = welcome.id;
      return welcome;
    },
  };

  return cliente;
}

function palco(t) {
  let server = null;
  const clients = [];
  let closed = false;

  async function closeServer(opts) {
    if (!server || closed) return;
    closed = true;
    await server.close(opts);
  }

  t.after(async () => {
    for (const client of clients) {
      try {
        client.ws.close();
      } catch {
        /* socket ja fechando */
      }
    }
    await closeServer();
  });

  return {
    async servidor(opts = {}) {
      server = await createSignalingServer({ port: 0, ...opts });
      return server;
    },
    async cliente(rotulo) {
      const client = criarCliente(server.port, rotulo);
      clients.push(client);
      await client.aberto();
      return client;
    },
    closeServer,
  };
}

test('close({ migrate: true }) anuncia a migracao aos sobreviventes, sem avisar o host', async (t) => {
  const p = palco(t);
  await p.servidor({ roomId: 'sala-da-migracao', pin: '482100', ownerToken: 'segredo' });
  const host = await p.cliente('host');
  const bruno = await p.cliente('bruno');
  const carla = await p.cliente('carla');

  const welcomeHost = await host.entra('Host', { clientId: 'client-host', ownerToken: 'segredo', pin: '482100' });
  const welcomeBruno = await bruno.entra('Bruno', { clientId: 'client-bruno', pin: '482100' });
  const welcomeCarla = await carla.entra('Carla', { clientId: 'client-carla', pin: '482100' });

  const mudouDono = carla.esperaTipo('owner-changed');
  host.ws.send(JSON.stringify({ type: 'moderate', action: 'transfer-owner', target: welcomeCarla.id }));
  await mudouDono;

  const migrandoBruno = bruno.esperaTipo('room-migrating');
  const migrandoCarla = carla.esperaTipo('room-migrating');
  const hostFechou = host.esperaTipo('room-closed');
  const candidatos = [welcomeHost.id, welcomeBruno.id, welcomeCarla.id];
  const successor = chooseSuccessor(candidatos, welcomeHost.id);
  const newOwnerId = chooseNewOwner([welcomeBruno.id, welcomeCarla.id], welcomeCarla.id, successor);

  await p.closeServer({ migrate: true });

  const [msgBruno, msgCarla] = await Promise.all([migrandoBruno, migrandoCarla]);
  for (const msg of [msgBruno, msgCarla]) {
    assert.equal(msg.roomId, 'sala-da-migracao');
    assert.equal(msg.successor, successor);
    assert.equal(msg.successorName, 'Bruno');
    assert.equal(msg.newOwnerClientId, 'client-carla');
    assert.equal(msg.pin, '482100');
    assert.deepEqual(msg.bans, []);
    assert.ok(Array.isArray(msg.chat));
  }
  assert.equal(newOwnerId, welcomeCarla.id);
  await hostFechou;
  assert.deepEqual(host.entrada.filter((msg) => msg.type === 'room-migrating'), []);
});

test('close({ migrate: true }) leva o nome escolhido da sala no room-migrating (P1)', async (t) => {
  const p = palco(t);
  await p.servidor({ roomId: 'sala-com-nome', roomName: 'Sala dos Amigos' });
  const host = await p.cliente('host');
  const bruno = await p.cliente('bruno');

  await host.entra('Host', { clientId: 'client-host' });
  await bruno.entra('Bruno', { clientId: 'client-bruno' });
  const migrando = bruno.esperaTipo('room-migrating');

  await p.closeServer({ migrate: true });

  const msg = await migrando;
  assert.equal(msg.roomName, 'Sala dos Amigos');
});

test('close({ migrate: true }) sem nome escolhido leva o padrao "sala de <host>" no room-migrating', async (t) => {
  const p = palco(t);
  await p.servidor();
  const host = await p.cliente('host');
  const bruno = await p.cliente('bruno');

  await host.entra('Host', { clientId: 'client-host' });
  await bruno.entra('Bruno', { clientId: 'client-bruno' });
  const migrando = bruno.esperaTipo('room-migrating');

  await p.closeServer({ migrate: true });

  const msg = await migrando;
  assert.equal(msg.roomName, 'sala de Host');
});

test('close({ migrate: true }) com somente o host segue o room-closed normal', async (t) => {
  const p = palco(t);
  await p.servidor();
  const host = await p.cliente('host');
  await host.entra('Host');
  const fechou = host.esperaTipo('room-closed');

  await p.closeServer({ migrate: true });

  await fechou;
  assert.deepEqual(host.entrada.filter((msg) => msg.type === 'room-migrating'), []);
});

test('close({ migrate: true }) elege sucessor somente entre sobreviventes da sala do host', async (t) => {
  const p = palco(t);
  await p.servidor({ ownerToken: 'segredo' });
  const host = await p.cliente('host');
  const visitanteDeOutraSala = await p.cliente('visitante de outra sala');
  const sobrevivente = await p.cliente('sobrevivente');

  await host.entra('Host', { room: 'sala-host', ownerToken: 'segredo', clientId: 'client-host' });
  const welcomeVisitante = await visitanteDeOutraSala.entra('Visitante', { room: 'outra-sala', clientId: 'client-outra-sala' });
  const welcomeSobrevivente = await sobrevivente.entra('Sobrevivente', { room: 'sala-host', clientId: 'client-sobrevivente' });
  const migrando = sobrevivente.esperaTipo('room-migrating');

  await p.closeServer({ migrate: true });

  const msg = await migrando;
  assert.equal(msg.successor, welcomeSobrevivente.id);
  assert.equal(msg.successorName, 'Sobrevivente');
  assert.equal(visitanteDeOutraSala.entrada.some((entrada) => entrada.type === 'room-migrating'), false);
  assert.notEqual(msg.successor, welcomeVisitante.id);
});

// ---------------------------------------------------------------------------
// Itens B/C da auditoria 2026-09-18: migracao sem broadcast e beacon
// autenticado. Aqui nao existe UDP nenhum: os sobreviventes so tem o que o
// servidor antigo lhes ensinou (segredo + IPs + porta) e a decisao pura de
// src/renderer/migration.js, com o relogio andado na mao.
// ---------------------------------------------------------------------------

const { findFreeServer } = require('../src/main/ports');
const migration = require('../src/renderer/migration');
const { worstCaseReconnectMs, MAX_RECONNECT } = require('../src/renderer/reconnect');
const { formatMigrationBeacon, parseMigrationBeacon } = require('../src/main/discovery');

/** O que o cliente sabe pra migrar: ultimo segredo e ultima lista de IPs,
 * vindos do welcome ou de um 'migration-info' (o mesmo que applyMigrationInfo
 * do app.js faz). */
function infoMigracao(cliente) {
  let secret = null;
  let peerAddresses = {};
  for (const msg of cliente.entrada) {
    if (msg.type !== 'welcome' && msg.type !== 'migration-info') continue;
    if (typeof msg.migrationSecret === 'string') secret = msg.migrationSecret;
    if (msg.peerAddresses) peerAddresses = msg.peerAddresses;
  }
  return { secret, peerAddresses };
}

/** Sonda igual a do app (probeRoomAt): 'probe' com o roomId, espera
 * 'probe-ok' ou desiste em 1,5 s / erro de conexao. */
function sonda(address, roomId) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${address}`);
    let feito = false;
    const fim = (r) => {
      if (feito) return;
      feito = true;
      clearTimeout(prazo);
      try {
        ws.terminate();
      } catch {
        /* ja fechado */
      }
      resolve(r);
    };
    const prazo = setTimeout(() => fim(null), 1500);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'probe', roomId })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'probe-ok') fim({ ...msg, address });
    });
    ws.on('error', () => fim(null));
    ws.on('close', () => fim(null));
  });
}

/** Palco com varios servidores (o antigo e os que os sobreviventes sobem). */
function palcoMigracao(t) {
  const servidores = [];
  const clientes = [];
  t.after(async () => {
    for (const c of clientes) {
      try {
        c.ws.terminate();
      } catch {
        /* ja fechado */
      }
    }
    for (const s of servidores) {
      if (s.derrubado) continue;
      s.derrubado = true;
      await s.close();
    }
  });
  return {
    async servidor(opts = {}) {
      const s = await createSignalingServer({ port: 0, ...opts });
      servidores.push(s);
      return s;
    },
    /** O sucessor sobe o servidor novo na porta da sala que caiu. */
    async servidorNaPorta(preferredPort, opts = {}) {
      const s = await findFreeServer((port) => createSignalingServer({ port, ...opts }), { preferredPort });
      servidores.push(s);
      return s;
    },
    async cliente(port, rotulo) {
      const c = criarCliente(port, rotulo);
      clientes.push(c);
      await c.aberto();
      return c;
    },
    /** Queda ABRUPTA (PC travou, processo morto): sem room-migrating, sem
     * room-closed -- os sockets somem e a porta fica livre. */
    async derruba(s) {
      s.derrubado = true;
      for (const ws of s.wss.clients) ws.terminate();
      await new Promise((res) => s.wss.close(() => res()));
    },
  };
}

async function salaComQuatro(p, roomId) {
  const antigo = await p.servidor({ roomId });
  const host = await p.cliente(antigo.port, 'host');
  const ana = await p.cliente(antigo.port, 'ana');
  const bia = await p.cliente(antigo.port, 'bia');
  const caio = await p.cliente(antigo.port, 'caio');
  const wHost = await host.entra('Host');
  await ana.entra('Ana');
  await bia.entra('Bia');
  const wCaio = await caio.entra('Caio');
  // Todo mundo tem de ter visto a ultima rotacao (a entrada do Caio).
  await Promise.all([host, ana, bia].map((c) => c.esperaMsg(
    (caixa) => caixa.find((m) => m.type === 'migration-info' && m.migrationSecret === wCaio.migrationSecret),
    'migration-info da entrada do Caio',
  )));
  return { antigo, host, ana, bia, caio, hostId: wHost.id };
}

function planoDe(cliente, hostId) {
  const info = infoMigracao(cliente);
  return {
    ...info,
    order: migration.successionOrder(Object.keys(info.peerAddresses), hostId),
  };
}

function portaDe(address) {
  return Number(address.slice(address.lastIndexOf(':') + 1));
}

const BASE_ABRUPTA = migration.baseDelayMs({ abrupt: true, worstCaseReconnectMs: worstCaseReconnectMs(MAX_RECONNECT) });

test('welcome entrega segredo de migracao e IPs; cada entrada e saida rotaciona pra quem esta dentro', async (t) => {
  const linhasDeLog = [];
  const p = palcoMigracao(t);
  const s = await p.servidor({ log: (...a) => linhasDeLog.push(a.join(' ')) });
  const host = await p.cliente(s.port, 'host');
  const ana = await p.cliente(s.port, 'ana');
  const wHost = await host.entra('Host');
  assert.match(wHost.migrationSecret, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(wHost.peerAddresses, { [wHost.id]: '127.0.0.1' });

  const wAna = await ana.entra('Ana');
  assert.notEqual(wAna.migrationSecret, wHost.migrationSecret);
  assert.deepEqual(Object.keys(wAna.peerAddresses).sort(), [wHost.id, wAna.id].sort());
  const infoHost = await host.esperaTipo('migration-info');
  assert.equal(infoHost.migrationSecret, wAna.migrationSecret);
  assert.deepEqual(infoHost.peerAddresses, wAna.peerAddresses);

  // Saida: quem fica recebe segredo novo; quem saiu nao recebe nada.
  const antesDaSaida = host.entrada.length;
  ana.ws.close();
  const rotacao = await host.esperaMsg(
    (caixa) => caixa.slice(antesDaSaida).find((m) => m.type === 'migration-info'),
    'migration-info da saida',
  );
  assert.notEqual(rotacao.migrationSecret, wAna.migrationSecret);
  assert.deepEqual(Object.keys(rotacao.peerAddresses), [wHost.id]);
  assert.equal(ana.entrada.some((m) => m.migrationSecret === rotacao.migrationSecret), false);

  // O segredo nunca vai pro log do servidor.
  for (const segredo of [wHost.migrationSecret, wAna.migrationSecret, rotacao.migrationSecret]) {
    assert.equal(linhasDeLog.some((l) => l.includes(segredo)), false);
  }
});

test('probe com roomId responde so se e a mesma sala, sem revelar o id', async (t) => {
  const p = palcoMigracao(t);
  const s = await p.servidor({ roomId: 'sala-sondada' });
  const certa = await sonda(`127.0.0.1:${s.port}`, 'sala-sondada');
  assert.equal(certa.sameRoom, true);
  assert.equal('roomId' in certa, false);
  const errada = await sonda(`127.0.0.1:${s.port}`, 'outra-sala');
  assert.equal(errada.sameRoom, false);
});

test('(a) queda abrupta SEM beacon: sobreviventes acham o sucessor direto e a sala nao se parte', async (t) => {
  const p = palcoMigracao(t);
  const { antigo, ana, bia, caio, hostId } = await salaComQuatro(p, 'sala-abrupta');
  const porta = antigo.port;
  const sobreviventes = [ana, bia, caio];
  const planos = sobreviventes.map((c) => planoDe(c, hostId));
  // Todos chegam a MESMA ordem, sem conversar.
  for (const plano of planos) assert.deepEqual(plano.order, planos[0].order);
  assert.deepEqual(planos[0].order, sobreviventes.map((c) => c.id));

  await p.derruba(antigo);

  // Cada um desiste num tempo diferente (60 s ... pior caso), mas todos
  // medem a partir da queda (dropAt = 0): so o sucessor assume.
  const desistencias = [60000, 90000, worstCaseReconnectMs(MAX_RECONNECT)];
  const decisoes = sobreviventes.map((c, i) => migration.decide({
    order: planos[i].order, myId: c.id, dropAt: 0, baseMs: BASE_ABRUPTA, now: desistencias[i],
  }));
  assert.deepEqual(decisoes.map((d) => d.action), ['host', 'dial', 'dial']);

  // O sucessor sobe na MESMA porta da sala que caiu e entra nela.
  const novo = await p.servidorNaPorta(porta, { roomId: 'sala-abrupta' });
  assert.equal(novo.port, porta);
  const anaNova = await p.cliente(novo.port, 'ana na sala nova');
  await anaNova.entra('Ana');

  // Os outros sondam o IP do sucessor na porta da sala -- nada de UDP.
  for (let i = 1; i < sobreviventes.length; i += 1) {
    const enderecos = migration.dialAddresses({ targets: decisoes[i].targets, addresses: planos[i].peerAddresses, port: porta, round: 0 });
    assert.deepEqual(enderecos, [`127.0.0.1:${porta}`]);
    const achados = await Promise.all(enderecos.map((addr) => sonda(addr, 'sala-abrupta')));
    const achado = achados.find((r) => r && r.sameRoom === true);
    assert.ok(achado, `${sobreviventes[i].id} nao achou o sucessor`);
    const c = await p.cliente(portaDe(achado.address), `sobrevivente ${i}`);
    const w = await c.entra(`S${i}`);
    assert.equal(w.roomId, 'sala-abrupta');
  }
  assert.equal(novo.getPeerCount(), 3);
});

test('(b) sucessor tambem caiu: exatamente o proximo assume apos o prazo absoluto e o resto se junta a ele', async (t) => {
  const p = palcoMigracao(t);
  const { antigo, ana, bia, caio, hostId } = await salaComQuatro(p, 'sala-dupla');
  const porta = antigo.port;
  const planoBia = planoDe(bia, hostId);
  const planoCaio = planoDe(caio, hostId);
  assert.deepEqual(planoBia.order, [ana.id, bia.id, caio.id]);

  // A Ana (sucessora) cai junto com o host e nunca sobe servidor nenhum.
  await p.derruba(antigo);

  // Antes do prazo absoluto da vez 1: os dois procuram a Ana e nao acham.
  const antes = BASE_ABRUPTA + migration.MIGRATION_STEP_MS - 1;
  for (const [c, plano] of [[bia, planoBia], [caio, planoCaio]]) {
    const d = migration.decide({ order: plano.order, myId: c.id, dropAt: 0, baseMs: BASE_ABRUPTA, now: antes });
    assert.equal(d.action, 'dial');
    assert.deepEqual(d.targets, [ana.id]);
    const enderecos = migration.dialAddresses({ targets: d.targets, addresses: plano.peerAddresses, port: porta, round: 0 });
    const achados = await Promise.all(enderecos.map((addr) => sonda(addr, 'sala-dupla')));
    assert.equal(achados.some((r) => r && r.sameRoom), false);
  }

  // No prazo: so a Bia (proxima da lista) assume; o Caio procura Ana e Bia.
  const prazo = BASE_ABRUPTA + migration.MIGRATION_STEP_MS;
  const dBia = migration.decide({ order: planoBia.order, myId: bia.id, dropAt: 0, baseMs: BASE_ABRUPTA, now: prazo });
  const dCaio = migration.decide({ order: planoCaio.order, myId: caio.id, dropAt: 0, baseMs: BASE_ABRUPTA, now: prazo });
  assert.equal(dBia.action, 'host');
  assert.equal(dCaio.action, 'dial');
  assert.deepEqual(dCaio.targets, [ana.id, bia.id]);

  const novo = await p.servidorNaPorta(porta, { roomId: 'sala-dupla' });
  const biaNova = await p.cliente(novo.port, 'bia na sala nova');
  await biaNova.entra('Bia');

  const enderecos = migration.dialAddresses({ targets: dCaio.targets, addresses: planoCaio.peerAddresses, port: porta, round: 0 });
  const achados = await Promise.all(enderecos.map((addr) => sonda(addr, 'sala-dupla')));
  const achado = achados.find((r) => r && r.sameRoom === true);
  assert.ok(achado);
  const caioNovo = await p.cliente(portaDe(achado.address), 'caio na sala nova');
  const w = await caioNovo.entra('Caio');
  assert.equal(w.roomId, 'sala-dupla');
  assert.equal(novo.getPeerCount(), 2);
});

test('(c) beacon com o roomId certo mas prova errada ou antiga e ignorado', async (t) => {
  const p = palcoMigracao(t);
  const { antigo, bia, hostId } = await salaComQuatro(p, 'sala-do-beacon');
  const { secret } = planoDe(bia, hostId);
  await p.derruba(antigo);
  const now = Date.now();
  const verifica = (raw) => migration.verifyMigrationBeacon({ beacon: parseMigrationBeacon(raw), roomId: 'sala-do-beacon', secret, now });

  assert.equal(await verifica(formatMigrationBeacon({ roomId: 'sala-do-beacon', address: '127.0.0.1:9999', port: 9999 })), false);
  assert.equal(await verifica(formatMigrationBeacon({ roomId: 'sala-do-beacon', address: '127.0.0.1:9999', port: 9999, secret: 'chute', ts: now })), false);
  assert.equal(await verifica(formatMigrationBeacon({
    roomId: 'sala-do-beacon', address: '127.0.0.1:9999', port: 9999, secret, ts: now - migration.PROOF_MAX_AGE_MS - 1,
  })), false);
  // Controle: o sucessor legitimo, com o segredo da sala, e seguido.
  assert.equal(await verifica(formatMigrationBeacon({ roomId: 'sala-do-beacon', address: '127.0.0.1:9999', port: 9999, secret, ts: now })), true);
});

for (const [como, sai] of [
  ['saiu', async (ex) => { ex.ws.close(); }],
  ['foi banido', async (ex, dono, exId) => { dono.ws.send(JSON.stringify({ type: 'moderate', action: 'ban', target: exId })); }],
]) {
  test(`(d) ex-membro que ${como} antes da rotacao nao consegue desviar a sala`, async (t) => {
    const p = palcoMigracao(t);
    const s = await p.servidor({ roomId: 'sala-visada', ownerToken: 'tok' });
    const dono = await p.cliente(s.port, 'dono');
    const ana = await p.cliente(s.port, 'ana');
    const ex = await p.cliente(s.port, 'ex');
    await dono.entra('Dono', { ownerToken: 'tok', clientId: 'c-dono' });
    await ana.entra('Ana', { clientId: 'c-ana' });
    const wEx = await ex.entra('Ex', { clientId: 'c-ex' });
    // O ex-membro conhecia o roomId e o segredo vigente enquanto estava dentro.
    const segredoDoEx = infoMigracao(ex).secret;
    assert.equal(wEx.roomId, 'sala-visada');
    await ana.esperaMsg((caixa) => caixa.find((m) => m.type === 'migration-info' && m.migrationSecret === segredoDoEx), 'rotacao da entrada do ex');

    const marca = ana.entrada.length;
    await sai(ex, dono, wEx.id);
    await ana.esperaMsg((caixa) => caixa.slice(marca).find((m) => m.type === 'migration-info'), 'rotacao da saida do ex');
    // Uma entrada depois dele tambem rotaciona -- e ele nao fica sabendo.
    const bruno = await p.cliente(s.port, 'bruno');
    await bruno.entra('Bruno', { clientId: 'c-bruno' });
    await ana.esperaMsg((caixa) => caixa.slice(marca).filter((m) => m.type === 'migration-info').length >= 2 ? caixa[caixa.length - 1] : null, 'rotacao da entrada do Bruno');
    const { secret: segredoDaAna, peerAddresses } = infoMigracao(ana);
    assert.notEqual(segredoDaAna, segredoDoEx);
    assert.ok(!(wEx.id in peerAddresses));
    assert.equal(ex.entrada.some((m) => m.migrationSecret === segredoDaAna), false);

    // O lider cai; o ex-membro anuncia a "migracao" pra propria maquina.
    await p.derruba(s);
    const now = Date.now();
    const falso = parseMigrationBeacon(formatMigrationBeacon({
      roomId: 'sala-visada', address: '10.66.66.66:9000', port: 9000, secret: segredoDoEx, ts: now,
    }));
    assert.equal(await migration.verifyMigrationBeacon({ beacon: falso, roomId: 'sala-visada', secret: segredoDaAna, now }), false);
    // Controle: o mesmo beacon com o segredo de quem ficou passaria.
    const legitimo = parseMigrationBeacon(formatMigrationBeacon({
      roomId: 'sala-visada', address: '127.0.0.1:9000', port: 9000, secret: segredoDaAna, ts: now,
    }));
    assert.equal(await migration.verifyMigrationBeacon({ beacon: legitimo, roomId: 'sala-visada', secret: segredoDaAna, now }), true);
  });
}
