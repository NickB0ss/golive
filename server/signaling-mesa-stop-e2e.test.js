'use strict';
/* Prova de segredo do Stop: enquanto a rodada escreve, nenhuma mensagem de
 * Bia (eco, state, sync ou room-migrating) contem a resposta da Ana. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createSignalingServer } = require('./signaling-core');
require('../src/renderer/mesa-modules/index');

const WAIT = 5000;

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const inbox = [];
  const waits = new Set();
  ws.on('message', (raw) => {
    inbox.push(JSON.parse(raw));
    for (const w of [...waits]) {
      const found = inbox.slice(w.from).find(w.pred);
      if (found) { waits.delete(w); clearTimeout(w.timer); w.ok(found); }
    }
  });
  ws.on('error', () => {});
  const c = {
    ws, inbox, id: null,
    open() {
      if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
      return new Promise((ok, no) => { ws.once('open', ok); ws.once('error', no); });
    },
    wait(pred, from = inbox.length) {
      const found = inbox.slice(from).find(pred);
      if (found) return Promise.resolve(found);
      return new Promise((ok, no) => {
        const w = { pred, from, ok };
        w.timer = setTimeout(() => { waits.delete(w); no(new Error('mensagem não chegou')); }, WAIT);
        waits.add(w);
      });
    },
    send(msg) { ws.send(JSON.stringify(msg)); },
    async join(name, extra = {}) {
      c.send({ type: 'join', room: 'stop', name, ...extra });
      const welcome = await c.wait((m) => m.type === 'welcome', 0);
      c.id = welcome.id;
    },
    async mesa() {
      const p = c.wait((m) => m.type === 'mesa-sync');
      c.send({ type: 'mesa-view', on: true });
      return (await p).mesa;
    },
    async op(id, action) {
      const p = c.wait((m) => (m.type === 'mesa' && m.op === 'state' && m.id === id && m.by === c.id)
        || (m.type === 'mesa-denied' && m.op === 'act'));
      c.send({ type: 'mesa', op: 'act', id, action });
      return p;
    },
  };
  return c;
}

test('Stop nunca manda resposta escondida a outra pessoa, nem na migracao', async (t) => {
  const server = await createSignalingServer({ port: 0, ownerToken: 'stop-e2e', roomId: 'stop-e2e' });
  const ana = client(server.port);
  const bia = client(server.port);
  t.after(async () => { ana.ws.close(); bia.ws.close(); await server.close(); });
  await ana.open();
  await bia.open();
  await ana.join('Ana', { ownerToken: 'stop-e2e' });
  await bia.join('Bia');
  await ana.mesa();
  await bia.mesa();
  const add = ana.wait((m) => m.type === 'mesa' && m.op === 'add' && m.win.type === 'stop');
  ana.send({ type: 'mesa', op: 'add', win: { type: 'stop', x: 20, y: 20, w: 720, h: 460 } });
  const id = (await add).win.id;
  await ana.op(id, { kind: 'start' });
  const secret = ['Araponga', 'Âmbar', 'Açaí', 'Acre', 'Alicate', 'Ator', 'Astra', 'Arara'];
  await ana.op(id, { kind: 'answer', answers: secret });
  const sync = bia.wait((m) => m.type === 'mesa-sync');
  bia.send({ type: 'mesa-sync' });
  await sync;
  const migrating = bia.wait((m) => m.type === 'room-migrating');
  await server.close({ migrate: true });
  const msg = await migrating;
  const wire = bia.inbox.map((m) => JSON.stringify(m)).join('\n');
  for (const answer of secret) assert.equal(wire.includes(answer), false, `Bia recebeu ${answer}`);
  const migrated = msg.mesa.windows.find((w) => w.id === id).state;
  assert.equal(migrated.phase, 'setup');
  assert.equal(JSON.stringify(migrated).includes('Araponga'), false);
});
