/*
 * Checagem TCP crua da porta da sala, pra separar "o processo do lider
 * morreu" de "a rota ate ele caiu" (src/renderer/leaderloss.js). O WebSocket
 * do renderer nao diz por que falhou; o `net` do Node diz: ECONNREFUSED so
 * vem de um RST, isto e, do proprio PC do lider respondendo que ninguem
 * escuta na porta. Pura logica Node, sem electron (testavel no node:test).
 */

'use strict';

const net = require('net');

// O Windows, ao receber RST num connect, repete o SYN duas vezes antes de
// devolver ECONNREFUSED (~2 s); 4 s cobre isso com folga, e o resultado
// costuma chegar antes do fim da tentativa seguinte da escada.
const DEFAULT_TIMEOUT_MS = 4000;

/** Codigo de erro do connect -> resultado. So ECONNREFUSED vira 'refused':
 * e a unica resposta que prova a maquina do outro lado alcancavel. ICMP de
 * "sem rota" (que um adaptador de VPN pode gerar pra um par fora do ar) e
 * 'unreachable', e fica do lado da rota caida. */
function classifyError(err) {
  switch (err && err.code) {
    case 'ECONNREFUSED': return 'refused';
    case 'ETIMEDOUT': return 'timeout';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EHOSTDOWN':
    case 'ENETDOWN': return 'unreachable';
    default: return 'error';
  }
}

function validTarget(host, port) {
  return typeof host === 'string' && host.length > 0 && host.length <= 255 && !/\s/.test(host)
    && Number.isInteger(port) && port > 0 && port <= 65535;
}

/**
 * Tenta abrir um TCP em host:porta e fecha na hora. Devolve 'open',
 * 'refused', 'timeout', 'unreachable' ou 'error' (nunca rejeita).
 * `connect` e so pra teste.
 */
function checkTcpPort(host, port, { timeoutMs = DEFAULT_TIMEOUT_MS, connect = net.connect } = {}) {
  if (!validTarget(host, port)) return Promise.resolve('error');
  const ms = Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 100), 10000) : DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    let socket = null;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket?.destroy(); } catch { /* ja fechado */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish('timeout'), ms);
    try {
      socket = connect({ host, port });
      socket.once('connect', () => finish('open'));
      socket.once('error', (err) => finish(classifyError(err)));
    } catch (err) {
      finish(classifyError(err));
    }
  });
}

module.exports = { checkTcpPort, classifyError, DEFAULT_TIMEOUT_MS };
