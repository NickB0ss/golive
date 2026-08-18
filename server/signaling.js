/*
 * CLI do servidor de sinalizacao do GoLive LAN.
 *
 * Rode em UMA maquina so, e todo mundo aponta pro IP Radmin dela.
 *   node server/signaling.js
 */

const os = require('os');
const { createSignalingServer } = require('./signaling-core');

const PORT = Number(process.env.PORT) || 9000;

function printAddresses(port) {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const [iface, addrs] of Object.entries(nets)) {
    for (const addr of addrs || []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      candidates.push({ iface, address: addr.address });
    }
  }

  console.log('');
  console.log('  GoLive LAN - servidor de sinalizacao');
  console.log(`  escutando na porta ${port}`);
  console.log('');
  console.log('  Passe um destes enderecos pros seus amigos:');
  for (const c of candidates) {
    const isRadmin = c.address.startsWith('26.');
    const isTailscale = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(c.address);
    const tag = isRadmin ? '  <-- Radmin VPN' : isTailscale ? '  <-- Tailscale' : '';
    console.log(`    ws://${c.address}:${port}${tag}`);
  }
  console.log('');
  console.log('  Se ninguem conectar, libere a porta no firewall do Windows:');
  console.log(`    netsh advfirewall firewall add rule name="GoLive" dir=in action=allow protocol=TCP localport=${port}`);
  console.log('');
}

createSignalingServer({ port: PORT })
  .then((server) => printAddresses(server.port))
  .catch((err) => {
    console.error('Nao consegui subir o servidor:', err.message);
    process.exit(1);
  });
