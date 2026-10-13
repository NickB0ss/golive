'use strict';

/*
 * Verificacao de que nada ficou aberto depois do fechamento da SFU: o
 * processo do worker acabou e as portas UDP que os transports anunciaram
 * podem ser ocupadas de novo por outro socket.
 */

const dgram = require('dgram');

/** Faixa UDP dos transports da SFU (listenInfos[].portRange) e faixa propria dos sockets WebRTC do cliente (Chromium). */
const SFU_PORT_RANGE = { min: 42000, max: 42199 };
const CLIENT_PORT_RANGE = { min: 42200, max: 42399 };

/** Todas as portas de uma faixa { min, max }. */
function rangePorts(range) {
  const out = [];
  for (let p = range.min; p <= range.max; p += 1) out.push(p);
  return out;
}

/** true se da pra abrir um socket UDP exclusivo nessa porta (ou seja, ninguem escuta). */
function udpPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: host.includes(':') ? 'udp6' : 'udp4', exclusive: true });
    let settled = false;
    const done = (free) => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* ja fechado */ }
      resolve(free);
    };
    socket.once('error', () => done(false));
    socket.bind({ port, address: host, exclusive: true }, () => done(true));
  });
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // existe, so sem permissao de sinalizar
  }
}

/**
 * Verifica a faixa inteira do cliente. O Chromium liga em 0.0.0.0, entao o teste tambem usa 0.0.0.0
 * (no Windows um bind em 127.0.0.1 conviveria com um socket em 0.0.0.0 e esconderia o vazamento).
 * Tenta de novo por um tempo curto porque o Chromium solta os sockets de forma assincrona.
 * @returns {{ min, max, busyBefore: number[], verify }} (`busyBefore`: portas de terceiros, ignoradas)
 */
async function verifyClientRange(range, { busyBefore = [], attempts = 10, delayMs = 300 } = {}) {
  let verify = null;
  for (let i = 0; i < attempts; i += 1) {
    verify = await verifyClosed({ pid: null, ports: rangePorts(range), host: '0.0.0.0' });
    const leaked = verify.ports.filter((p) => !p.free && !busyBefore.includes(p.port));
    if (!leaked.length) break;
    await new Promise((resolve) => { setTimeout(resolve, delayMs); });
  }
  return { min: range.min, max: range.max, busyBefore, verify };
}

/** Portas da faixa ja ocupadas por terceiros (medido antes do cenario). */
async function busyPorts(range) {
  const v = await verifyClosed({ pid: null, ports: rangePorts(range), host: '0.0.0.0' });
  return v.ports.filter((p) => !p.free).map((p) => p.port);
}

/** @returns {{ workerPid, workerAlive, ports: {port, free}[], allFree }} */
async function verifyClosed({ pid, ports, host = '127.0.0.1' }) {
  const list = [];
  for (const port of ports || []) list.push({ port, free: await udpPortFree(port, host) });
  const workerAlive = pid == null ? false : pidAlive(pid);
  return {
    workerPid: pid ?? null,
    workerAlive,
    ports: list,
    allFree: !workerAlive && list.every((p) => p.free),
  };
}

module.exports = { SFU_PORT_RANGE, CLIENT_PORT_RANGE, rangePorts, verifyClientRange, busyPorts, udpPortFree, pidAlive, verifyClosed };
