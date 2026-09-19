/*
 * Acha uma porta livre pro servidor de sinalizacao embutido, tentando um
 * intervalo fixo. Pura logica Node, sem dependencia de electron -- por isso
 * fica separada de main.js, que nao pode ser importado pelo node:test.
 */

'use strict';

/**
 * `preferredPort` vem primeiro quando definido: o sucessor de uma migracao
 * tenta a MESMA porta da sala que caiu, porque e nela que os sobreviventes
 * o procuram direto (sem depender do beacon UDP, que o Tailscale nao
 * repassa). Se ela estiver ocupada, segue a faixa normal.
 * @param {(port: number) => Promise<any>} createServer
 * @param {{ startPort?: number, endPort?: number, preferredPort?: number | null }} [opts]
 */
async function findFreeServer(createServer, { startPort = 9000, endPort = 9010, preferredPort = null } = {}) {
  const ports = [];
  if (Number.isInteger(preferredPort) && preferredPort > 0 && preferredPort <= 65535) ports.push(preferredPort);
  for (let port = startPort; port <= endPort; port++) if (port !== preferredPort) ports.push(port);
  for (const port of ports) {
    try {
      return await createServer(port);
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  const err = new Error('PORTS_EXHAUSTED');
  err.code = 'PORTS_EXHAUSTED';
  throw err;
}

module.exports = { findFreeServer };
