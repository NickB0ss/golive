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
  await p.servidor({ roomId: 'sala-da-migracao', pin: '4821', ownerToken: 'segredo' });
  const host = await p.cliente('host');
  const bruno = await p.cliente('bruno');
  const carla = await p.cliente('carla');

  const welcomeHost = await host.entra('Host', { clientId: 'client-host', ownerToken: 'segredo', pin: '4821' });
  const welcomeBruno = await bruno.entra('Bruno', { clientId: 'client-bruno', pin: '4821' });
  const welcomeCarla = await carla.entra('Carla', { clientId: 'client-carla', pin: '4821' });

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
    assert.equal(msg.pin, '4821');
    assert.deepEqual(msg.bans, []);
    assert.ok(Array.isArray(msg.chat));
  }
  assert.equal(newOwnerId, welcomeCarla.id);
  await hostFechou;
  assert.deepEqual(host.entrada.filter((msg) => msg.type === 'room-migrating'), []);
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
