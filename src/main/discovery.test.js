'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeBroadcastAddress,
  listBroadcastTargets,
  formatBeacon,
  parseBeacon,
  isExpired,
  pruneExpiredRooms,
  toRoomList,
  BEACON_INTERVAL_MS,
  ROOM_TTL_MS,
  DISCOVERY_PORT,
} = require('./discovery');

test('constantes basicas', () => {
  assert.equal(typeof DISCOVERY_PORT, 'number');
  assert.notEqual(DISCOVERY_PORT, 9000); // nao pode colidir com o signaling
  assert.ok(BEACON_INTERVAL_MS > 0);
  assert.ok(ROOM_TTL_MS > BEACON_INTERVAL_MS); // TTL folgado o bastante pra tolerar 1 beacon perdido
});

test('computeBroadcastAddress calcula o broadcast de uma /24 comum', () => {
  assert.equal(computeBroadcastAddress('192.168.0.14', '255.255.255.0'), '192.168.0.255');
});

test('computeBroadcastAddress calcula o broadcast de uma /16', () => {
  assert.equal(computeBroadcastAddress('172.16.5.9', '255.255.0.0'), '172.16.255.255');
});

test('computeBroadcastAddress devolve null pra entrada invalida', () => {
  assert.equal(computeBroadcastAddress('nao-e-ip', '255.255.255.0'), null);
  assert.equal(computeBroadcastAddress('192.168.0.14', undefined), null);
});

test('listBroadcastTargets sempre inclui o broadcast global e ignora loopback/internal', () => {
  const interfaces = {
    Ethernet: [{ family: 'IPv4', internal: false, address: '192.168.0.14', netmask: '255.255.255.0' }],
    Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' }],
  };
  const targets = listBroadcastTargets(interfaces);
  assert.ok(targets.includes('255.255.255.255'));
  assert.ok(targets.includes('192.168.0.255'));
  assert.equal(targets.length, 2);
});

test('listBroadcastTargets nao duplica quando duas interfaces dao o mesmo broadcast', () => {
  const interfaces = {
    A: [{ family: 'IPv4', internal: false, address: '192.168.0.10', netmask: '255.255.255.0' }],
    B: [{ family: 'IPv4', internal: false, address: '192.168.0.20', netmask: '255.255.255.0' }],
  };
  const targets = listBroadcastTargets(interfaces);
  assert.equal(targets.filter((t) => t === '192.168.0.255').length, 1);
});

test('formatBeacon + parseBeacon fazem round-trip', () => {
  const raw = formatBeacon({ name: 'Fulano', port: 9001, address: '192.168.0.14:9001' });
  const parsed = parseBeacon(raw);
  assert.deepEqual(parsed, { name: 'Fulano', port: 9001, address: '192.168.0.14:9001' });
});

test('formatBeacon usa "anônimo" quando nome vazio', () => {
  const raw = formatBeacon({ name: '  ', port: 9001, address: '192.168.0.14:9001' });
  assert.equal(parseBeacon(raw).name, 'anônimo');
});

test('parseBeacon rejeita JSON invalido', () => {
  assert.equal(parseBeacon('isso nao e json'), null);
  assert.equal(parseBeacon('{ "quebrado": '), null);
});

test('parseBeacon rejeita payload de outro tipo/protocolo', () => {
  assert.equal(parseBeacon(JSON.stringify({ type: 'outra-coisa', port: 1, address: 'x' })), null);
});

test('parseBeacon rejeita porta invalida ou ausente', () => {
  assert.equal(parseBeacon(JSON.stringify({ type: 'golive-room', address: '1.2.3.4:9000' })), null);
  assert.equal(parseBeacon(JSON.stringify({ type: 'golive-room', port: 'nao-numero', address: '1.2.3.4:9000' })), null);
  assert.equal(parseBeacon(JSON.stringify({ type: 'golive-room', port: -1, address: '1.2.3.4:9000' })), null);
  assert.equal(parseBeacon(JSON.stringify({ type: 'golive-room', port: 1.5, address: '1.2.3.4:9000' })), null);
});

test('parseBeacon rejeita endereco ausente/vazio', () => {
  assert.equal(parseBeacon(JSON.stringify({ type: 'golive-room', port: 9000, address: '' })), null);
  assert.equal(parseBeacon(JSON.stringify({ type: 'golive-room', port: 9000 })), null);
});

test('isExpired usa o TTL informado', () => {
  const room = { lastSeen: 1000 };
  assert.equal(isExpired(room, 1000 + ROOM_TTL_MS - 1, ROOM_TTL_MS), false);
  assert.equal(isExpired(room, 1000 + ROOM_TTL_MS + 1, ROOM_TTL_MS), true);
});

test('pruneExpiredRooms remove so o que expirou e reporta mudanca', () => {
  const now = 100000;
  const rooms = new Map([
    ['a:9000', { name: 'A', address: 'a:9000', port: 9000, lastSeen: 0 }], // bem velha, expirou
    ['b:9000', { name: 'B', address: 'b:9000', port: 9000, lastSeen: now - 1000 }], // recente
  ]);
  const changed = pruneExpiredRooms(rooms, now, ROOM_TTL_MS);
  assert.equal(changed, true);
  assert.equal(rooms.size, 1);
  assert.ok(rooms.has('b:9000'));
});

test('pruneExpiredRooms nao reporta mudanca quando nada expira', () => {
  const rooms = new Map([['a:9000', { name: 'A', address: 'a:9000', port: 9000, lastSeen: 1000 }]]);
  const changed = pruneExpiredRooms(rooms, 1000 + 1, ROOM_TTL_MS);
  assert.equal(changed, false);
  assert.equal(rooms.size, 1);
});

test('toRoomList converte o Map interno pra lista simples e ordenada', () => {
  const rooms = new Map([
    ['b:9000', { name: 'B', address: 'b:9000', port: 9000, lastSeen: 1 }],
    ['a:9000', { name: 'A', address: 'a:9000', port: 9000, lastSeen: 2 }],
  ]);
  const list = toRoomList(rooms);
  assert.deepEqual(list, [
    { name: 'A', address: 'a:9000', port: 9000 },
    { name: 'B', address: 'b:9000', port: 9000 },
  ]);
});
