'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { EventEmitter } = require('events');
const { checkTcpPort, classifyError } = require('./tcpcheck');

function listen() {
  return new Promise((resolve) => {
    const server = net.createServer((s) => s.destroy());
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('porta escutando: open', async () => {
  const server = await listen();
  try {
    assert.equal(await checkTcpPort('127.0.0.1', server.address().port), 'open');
  } finally {
    server.close();
  }
});

test('porta fechada no loopback (RST): refused', async () => {
  const server = await listen();
  const { port } = server.address();
  await new Promise((resolve) => { server.close(resolve); });
  assert.equal(await checkTcpPort('127.0.0.1', port), 'refused');
});

test('sem resposta no prazo: timeout (e fecha o socket)', async () => {
  let destroyed = false;
  const connect = () => {
    const s = new EventEmitter();
    s.destroy = () => { destroyed = true; };
    return s;
  };
  assert.equal(await checkTcpPort('10.0.0.1', 9000, { timeoutMs: 100, connect }), 'timeout');
  assert.ok(destroyed);
});

test('erros do connect viram a classe certa', async () => {
  const casos = [['ECONNREFUSED', 'refused'], ['EHOSTUNREACH', 'unreachable'], ['ENETUNREACH', 'unreachable'], ['ETIMEDOUT', 'timeout'], ['ENOTFOUND', 'error']];
  for (const [code, want] of casos) {
    const connect = () => {
      const s = new EventEmitter();
      s.destroy = () => {};
      setImmediate(() => s.emit('error', Object.assign(new Error(code), { code })));
      return s;
    };
    assert.equal(await checkTcpPort('10.0.0.1', 9000, { connect }), want, code);
  }
  assert.equal(classifyError(null), 'error');
});

test('alvo invalido nao abre nada', async () => {
  const connect = () => { throw new Error('nao devia conectar'); };
  for (const [host, port] of [['', 9000], ['a b', 9000], [123, 9000], ['10.0.0.1', 0], ['10.0.0.1', 70000], ['10.0.0.1', '9000']]) {
    assert.equal(await checkTcpPort(host, port, { connect }), 'error');
  }
});
