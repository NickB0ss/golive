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

// M-07 da auditoria 2026-11-25: no Windows, porta dentro de uma faixa reservada
// (Hyper-V/WSL/Docker, `netsh int ipv4 show excludedportrange`) falha com
// EACCES no bind -- tem que passar pra proxima, como uma porta ocupada.
test('EACCES (porta reservada no Windows) tambem cai pra proxima porta', async () => {
  const calls = [];
  const createServer = async (port) => {
    calls.push(port);
    if (port === 9000 || port === 9001) {
      const err = new Error(`listen EACCES: permission denied 0.0.0.0:${port}`);
      err.code = 'EACCES';
      throw err;
    }
    return { port };
  };
  const server = await findFreeServer(createServer);
  assert.equal(server.port, 9002);
  assert.deepEqual(calls, [9000, 9001, 9002]);
});

test('preferredPort reservada (EACCES) cai na faixa normal em vez de abortar a migracao', async () => {
  const calls = [];
  const createServer = async (port) => {
    calls.push(port);
    if (port === 9004) {
      const err = new Error('listen EACCES');
      err.code = 'EACCES';
      throw err;
    }
    return { port };
  };
  const server = await findFreeServer(createServer, { preferredPort: 9004 });
  assert.equal(server.port, 9000);
  assert.deepEqual(calls, [9004, 9000]);
});

// B/C da auditoria 2026-09-18: o sucessor de uma migracao tenta primeiro a
// porta da sala que caiu, que e onde os sobreviventes o procuram direto.
test('preferredPort e tentada antes da faixa e nao repete na varredura', async () => {
  const { createServer, calls } = fakeCreateServer(new Set());
  const server = await findFreeServer(createServer, { preferredPort: 9004 });
  assert.equal(server.port, 9004);
  assert.deepEqual(calls, [9004]);
});

test('preferredPort ocupada cai na faixa normal sem tentar a mesma porta duas vezes', async () => {
  const { createServer, calls } = fakeCreateServer(new Set([9004, 9000]));
  const server = await findFreeServer(createServer, { preferredPort: 9004 });
  assert.equal(server.port, 9001);
  assert.deepEqual(calls, [9004, 9000, 9001]);
});
