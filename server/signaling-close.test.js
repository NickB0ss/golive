'use strict';
/*
 * Auditoria 2026-11-25, M-01: o `close()` do servidor embutido so resolvia
 * quando TODA conexao TCP acabava. Um par WebSocket mudo (rota da VPN caiu)
 * segurava o fechamento por 30 s; uma conexao HTTP com cabecalho incompleto,
 * pra sempre -- e o `app.quit()` do main esperava por ele. Agora o `close()`
 * tem um prazo (`closeGraceMs`): passado ele, derruba o que sobrou.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const crypto = require('crypto');
const { createSignalingServer } = require('./signaling-core');

const GRACE_MS = 200;
// Teto de falha: bem acima do prazo, bem abaixo do closeTimeout de 30 s do `ws`.
const LIMITE_MS = 5000;

function comLimite(promessa, ms) {
  let timer;
  const limite = new Promise((resolve) => {
    timer = setTimeout(() => resolve('pendente'), ms);
  });
  return Promise.race([promessa.then(() => 'resolveu'), limite]).finally(() => clearTimeout(timer));
}

async function conectar(server) {
  const sock = net.connect(server.port, '127.0.0.1');
  await new Promise((resolve) => sock.once('connect', resolve));
  return sock;
}

test('close() resolve dentro do prazo mesmo com um par WebSocket mudo', { timeout: 15000 }, async () => {
  const server = await createSignalingServer({ port: 0, log: () => {}, closeGraceMs: GRACE_MS });
  const sock = await conectar(server);
  const key = crypto.randomBytes(16).toString('base64');
  sock.write(
    'GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
    + `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
  );
  await new Promise((resolve) => sock.once('data', resolve)); // 101 Switching Protocols
  sock.pause(); // nunca mais le nem responde ao close, como um PC cuja rota caiu
  const resultado = await comLimite(server.close({ migrate: true }), LIMITE_MS);
  sock.destroy();
  assert.equal(resultado, 'resolveu');
});

test('close() resolve dentro do prazo com uma conexao HTTP de cabecalho incompleto', { timeout: 15000 }, async () => {
  const server = await createSignalingServer({ port: 0, log: () => {}, closeGraceMs: GRACE_MS });
  const sock = await conectar(server);
  sock.write('GET / HTTP/1.1\r\nHost: x\r\n'); // nunca termina o cabecalho
  await new Promise((resolve) => setTimeout(resolve, 100));
  const resultado = await comLimite(server.close(), LIMITE_MS);
  sock.destroy();
  assert.equal(resultado, 'resolveu');
});

test('close() sem conexao pendente nao espera o prazo', { timeout: 15000 }, async () => {
  const server = await createSignalingServer({ port: 0, log: () => {}, closeGraceMs: 60000 });
  const resultado = await comLimite(server.close(), LIMITE_MS);
  assert.equal(resultado, 'resolveu');
});
