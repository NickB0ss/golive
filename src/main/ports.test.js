// src/main/ports.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findFreeServer } = require('./ports');

function fakeCreateServer(takenPorts) {
  const calls = [];
  const createServer = async (port) => {
    calls.push(port);
    if (takenPorts.has(port)) {
      const err = new Error('address in use');
      err.code = 'EADDRINUSE';
      throw err;
    }
    return { port };
  };
  return { createServer, calls };
}

test('usa a primeira porta se ela estiver livre', async () => {
  const { createServer, calls } = fakeCreateServer(new Set());
  const server = await findFreeServer(createServer);
  assert.equal(server.port, 9000);
  assert.deepEqual(calls, [9000]);
});

test('cai pra proxima porta livre quando as primeiras estao ocupadas', async () => {
  const { createServer, calls } = fakeCreateServer(new Set([9000, 9001, 9002]));
  const server = await findFreeServer(createServer);
  assert.equal(server.port, 9003);
  assert.deepEqual(calls, [9000, 9001, 9002, 9003]);
});

test('estoura PORTS_EXHAUSTED quando todo o intervalo esta ocupado', async () => {
  const taken = new Set();
  for (let p = 9000; p <= 9010; p++) taken.add(p);
  const { createServer, calls } = fakeCreateServer(taken);

  await assert.rejects(
    () => findFreeServer(createServer),
    (err) => {
      assert.equal(err.code, 'PORTS_EXHAUSTED');
      return true;
    }
  );
  assert.equal(calls.length, 11);
});

test('propaga imediatamente um erro que nao seja EADDRINUSE', async () => {
  const calls = [];
  const createServer = async (port) => {
    calls.push(port);
    throw new Error('falha inesperada');
  };

  await assert.rejects(() => findFreeServer(createServer), /falha inesperada/);
  assert.deepEqual(calls, [9000]);
});
