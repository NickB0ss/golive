/*
 * Deteccao de endereco pro host mostrar aos amigos. Extraido/adaptado de
 * printAddresses (server/signaling.js).
 */

const os = require('os');

const TAILSCALE_RE = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

function classify(address) {
  if (address.startsWith('26.')) return 'radmin';
  if (TAILSCALE_RE.test(address)) return 'tailscale';
  return 'lan';
}

/** Lista candidatos IPv4 nao-internos, classificados. */
function listAddresses(interfaces = os.networkInterfaces()) {
  const out = [];
  for (const [iface, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs || []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      out.push({ iface, address: addr.address, kind: classify(addr.address) });
    }
  }
  return out;
}

const PRIORITY = { radmin: 0, tailscale: 1, lan: 2 };

/** Melhor candidato pra mostrar ao host: radmin > tailscale > lan > null. */
function pickAddress(interfaces = os.networkInterfaces()) {
  const list = listAddresses(interfaces);
  if (!list.length) return null;
  return [...list].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind])[0];
}

module.exports = { listAddresses, pickAddress };
