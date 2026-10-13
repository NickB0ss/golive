'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('dgram');
const { udpPortFree, pidAlive, verifyClosed } = require('./ports');

function bindEphemeral() {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.bind({ port: 0, address: '127.0.0.1', exclusive: true }, () => resolve(s));
  });
}

test('porta ocupada nao esta livre; depois de fechar o socket, esta', async () => {
  const s = await bindEphemeral();
  const { port } = s.address();
  assert.equal(await udpPortFree(port), false);
  await new Promise((r) => { s.close(r); });
  assert.equal(await udpPortFree(port), true);
});

test('pidAlive: processo atual vive; pid invalido ou inexistente nao', () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(null), false);
  assert.equal(pidAlive(-1), false);
  assert.equal(pidAlive(2 ** 30), false);
});

test('verifyClosed so da allFree com processo morto e todas as portas livres', async () => {
  const s = await bindEphemeral();
  const { port } = s.address();
  const busy = await verifyClosed({ pid: 2 ** 30, ports: [port] });
  assert.equal(busy.allFree, false);
  assert.equal(busy.ports[0].free, false);
  const alive = await verifyClosed({ pid: process.pid, ports: [] });
  assert.equal(alive.allFree, false);
  await new Promise((r) => { s.close(r); });
  const ok = await verifyClosed({ pid: 2 ** 30, ports: [port] });
  assert.equal(ok.allFree, true);
});

test('faixas do SFU e do cliente nao se sobrepoem; rangePorts lista a faixa inteira', () => {
  const { SFU_PORT_RANGE, CLIENT_PORT_RANGE, rangePorts } = require('./ports');
  assert.ok(SFU_PORT_RANGE.max < CLIENT_PORT_RANGE.min);
  assert.equal(rangePorts({ min: 5, max: 8 }).join(','), '5,6,7,8');
  assert.equal(rangePorts(CLIENT_PORT_RANGE).length, 200);
});

test('verifyClientRange: porta ocupada (em 0.0.0.0) e vazamento; ocupada antes e ignorada; liberada a tempo passa', async () => {
  const { verifyClientRange, busyPorts } = require('./ports');
  const sock = dgram.createSocket('udp4');
  await new Promise((resolve) => { sock.bind({ port: 0, address: '0.0.0.0' }, resolve); });
  const port = sock.address().port;
  const range = { min: port, max: port };
  try {
    assert.deepEqual(await busyPorts(range), [port]);
    const leak = await verifyClientRange(range, { attempts: 2, delayMs: 10 });
    assert.equal(leak.verify.ports[0].free, false);
    const ignored = await verifyClientRange(range, { busyBefore: [port], attempts: 1, delayMs: 10 });
    assert.deepEqual(ignored.busyBefore, [port]);
  } finally {
    await new Promise((resolve) => { sock.close(resolve); });
  }
  const freed = await verifyClientRange(range, { attempts: 3, delayMs: 10 });
  assert.equal(freed.verify.allFree, true);
});
