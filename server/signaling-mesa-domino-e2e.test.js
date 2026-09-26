'use strict';
/* Prova de fio: nenhuma mensagem recebida por outra pessoa leva uma pedra
 * da mão alheia, nem o monte. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createSignalingServer } = require('./signaling-core');
require('../src/renderer/mesa-modules/index');

function cliente(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`); const inbox = [];
  ws.on('message', (x) => inbox.push(JSON.parse(x.toString()))); ws.on('error', () => {});
  const wait = (fn, from = inbox.length) => new Promise((resolve, reject) => { const until = Date.now() + 5000; const tick = () => { const v = inbox.slice(from).find(fn); if (v) return resolve(v); if (Date.now() > until) return reject(new Error('mensagem não chegou')); setTimeout(tick, 10); }; tick(); });
  return { ws, inbox, async join(name, token) { if (ws.readyState !== WebSocket.OPEN) await new Promise((ok) => ws.once('open', ok)); ws.send(JSON.stringify({ type: 'join', room: 'domino-segredo', name, ownerToken: token })); const w = await wait((m) => m.type === 'welcome', 0); this.id = w.id; }, send(m) { ws.send(JSON.stringify(m)); }, wait };
}

test('dominó secreto não envia mão ou monte alheios em add, state ou sync', async (t) => {
  const server = await createSignalingServer({ port: 0, ownerToken: 'd' }); const a = cliente(server.port); const b = cliente(server.port);
  t.after(async () => { a.ws.close(); b.ws.close(); await server.close(); });
  await a.join('Ana', 'd'); await b.join('Bia');
  for (const c of [a, b]) { const n = c.inbox.length; c.send({ type: 'mesa-view', on: true }); await c.wait((m) => m.type === 'mesa-sync', n); }
  let n = a.inbox.length; a.send({ type: 'mesa', op: 'add', win: { type: 'domino', x: 1, y: 1, w: 720, h: 480 } }); const add = await a.wait((m) => m.type === 'mesa' && m.op === 'add', n); const id = add.win.id;
  async function act(c, action) { const from = c.inbox.length; c.send({ type: 'mesa', op: 'act', id, action }); return c.wait((m) => m.type === 'mesa' && m.op === 'state' && m.id === id, from); }
  await act(a, { kind: 'sit', seat: 0 }); await act(b, { kind: 'sit', seat: 1 }); const started = await act(a, { kind: 'start' });
  const mine = started.state.hand; assert.ok(mine.length === 6 || mine.length === 7, 'a mão tem sete pedras, menos a abertura se for da Ana');
  const bState = b.inbox.filter((m) => m.type === 'mesa' && m.op === 'state' && m.id === id).at(-1).state;
  assert.ok(bState.hand.length === 6 || bState.hand.length === 7); assert.equal(bState.stock, 14);
  const forbidden = mine.map((p) => JSON.stringify(p));
  const forbiddenB = bState.hand.map((p) => JSON.stringify(p));
  for (const message of b.inbox) assert.equal(forbidden.some((p) => JSON.stringify(message).includes(p)), false, 'Bia recebeu uma pedra da Ana');
  for (const message of a.inbox) assert.equal(forbiddenB.some((p) => JSON.stringify(message).includes(p)), false, 'Ana recebeu uma pedra da Bia');
  n = b.inbox.length; b.send({ type: 'mesa-sync' }); const sync = await b.wait((m) => m.type === 'mesa-sync', n); const view = sync.mesa.windows.find((w) => w.id === id).state;
  assert.ok(view.hand.length === 6 || view.hand.length === 7); assert.equal(JSON.stringify(view).includes('"hands"'), false); assert.equal(JSON.stringify(view).includes('"stock":['), false);
});
