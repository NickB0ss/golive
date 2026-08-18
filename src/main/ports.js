/*
 * Acha uma porta livre pro servidor de sinalizacao embutido, tentando um
 * intervalo fixo. Pura logica Node, sem dependencia de electron -- por isso
 * fica separada de main.js, que nao pode ser importado pelo node:test.
 */

'use strict';

/**
 * @param {(port: number) => Promise<any>} createServer
 * @param {{ startPort?: number, endPort?: number }} [opts]
 */
async function findFreeServer(createServer, { startPort = 9000, endPort = 9010 } = {}) {
  for (let port = startPort; port <= endPort; port++) {
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
