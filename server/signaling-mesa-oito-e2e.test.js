'use strict';

/* Prova de fio do Oito maluco: nenhuma mensagem destinada a outra pessoa
 * pode carregar mao alheia nem o monte, inclusive add, state e mesa-sync. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createSignalingServer } = require('./signaling-core');
require('../src/renderer/mesa-modules/oito');
require('../src/renderer/mesa-modules/index');

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`); const messages = []; const waits = [];
  ws.on('message', (raw) => { const m = JSON.parse(raw); messages.push(m); for (const w of waits.slice()) if (w.f(m)) { waits.splice(waits.indexOf(w), 1); clearTimeout(w.t); w.ok(m); } });
  const wait = (f, label, from = 0) => new Promise((ok, no) => { const old = messages.slice(from).find(f); if (old) return ok(old); const w = { f, ok, t: setTimeout(() => no(new Error(`faltou ${label}`)), 5000) }; waits.push(w); });
  return { ws, messages, wait, async join(name, extra = {}) { if (ws.readyState !== WebSocket.OPEN) await new Promise((ok, no) => { ws.once('open', ok); ws.once('error', no); }); ws.send(JSON.stringify({ type: 'join', room: 'oito-segredo', name, ...extra })); const w = await wait((m) => m.type === 'welcome', 'welcome'); this.id = w.id; return this; }, open() { const p = wait((m) => m.type === 'mesa-sync', 'sync', messages.length); ws.send(JSON.stringify({ type: 'mesa-view', on: true })); return p; }, send(m) { ws.send(JSON.stringify(m)); }, async action(id, action) { const p = wait((m) => (m.type === 'mesa' && m.op === 'state' && m.id === id && m.by === this.id) || (m.type === 'mesa-denied' && m.op === 'act'), action.kind, messages.length); ws.send(JSON.stringify({ type: 'mesa', op: 'act', id, action })); return p; } };
}
function states(c) { const out = []; for (const m of c.messages) { if (m.type === 'mesa' && m.op === 'add' && m.win?.type === 'oito') out.push(m.win.state); if (m.type === 'mesa' && m.op === 'state') out.push(m.state); if (m.type === 'mesa-sync' || m.type === 'room-migrating') for (const w of m.mesa?.windows || []) if (w.type === 'oito') out.push(w.state); } return out; }
function noSecret(c, ownCards, label) {
  const wire = JSON.stringify(c.messages);
  for (const s of states(c)) { assert.ok(Array.isArray(s.hand) || Array.isArray(s.hands), `${label}: estado sem formato de mao`); if (Array.isArray(s.hands)) assert.ok(s.hands.every((h) => Array.isArray(h) && h.length === 0), `${label}: mao crua na migracao`); if (Array.isArray(s.deck)) assert.equal(s.deck.length, 0, `${label}: monte na migracao`); }
  for (const card of ownCards) assert.ok(wire.includes(card), `${label}: a propria carta deve chegar`);
}

test('cada socket recebe somente a propria mao e nunca recebe monte ou mao alheia', async (t) => {
  const server = await createSignalingServer({ port: 0, ownerToken: 'oito', roomId: 'sala-oito-segredo' });
  const ana = client(server.port); const bia = client(server.port); const caio = client(server.port);
  t.after(async () => { for (const c of [ana, bia, caio]) c.ws.close(); await server.close(); });
  await ana.join('Ana', { ownerToken: 'oito', clientId: 'ana' }); await bia.join('Bia', { clientId: 'bia' }); await caio.join('Caio', { clientId: 'caio' });
  await ana.open(); await bia.open(); await caio.open();
  const add = ana.wait((m) => m.type === 'mesa' && m.op === 'add' && m.win?.type === 'oito', 'add');
  ana.send({ type: 'mesa', op: 'add', win: { type: 'oito', x: 100, y: 100, w: 640, h: 400 } });
  const id = (await add).win.id;
  await ana.action(id, { kind: 'sit', seat: 0 }); await bia.action(id, { kind: 'sit', seat: 1 });
  const bStarted = bia.wait((m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state?.phase === 'play', 'estado da Bia', bia.messages.length);
  const cStarted = caio.wait((m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.state?.phase === 'play', 'estado do Caio', caio.messages.length);
  const started = await ana.action(id, { kind: 'start' }); assert.equal(started.state.phase, 'play');
  const a = started.state.hand; const b = (await bStarted).state.hand;
  assert.equal(a.length, 7); assert.equal(b.length, 7); assert.equal((await cStarted).state.hand.length, 0);
  const sync = bia.wait((m) => m.type === 'mesa-sync' && m.mesa?.windows.some((w) => w.id === id), 'sync filtrado'); bia.send({ type: 'mesa-sync' }); await sync;
  noSecret(ana, a, 'Ana'); noSecret(bia, b, 'Bia');
  noSecret(caio, [], 'Caio');
  const migrating = Promise.all([bia.wait((m) => m.type === 'room-migrating', 'migracao da Bia', bia.messages.length), caio.wait((m) => m.type === 'room-migrating', 'migracao do Caio', caio.messages.length)]);
  await server.close({ migrate: true }); await migrating;
  noSecret(bia, b, 'Bia na migracao'); noSecret(caio, [], 'Caio na migracao');
});
