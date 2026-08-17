/*
 * Servidor de sinalizacao do GoLive LAN.
 *
 * Nao passa video nenhum por aqui. A unica funcao dele e apresentar os peers
 * uns aos outros e repassar as mensagens de negociacao do WebRTC (offer,
 * answer, candidatos ICE). Depois que dois peers se acham, o video vai
 * direto de um pro outro pela LAN virtual.
 *
 * Rode em UMA maquina so, e todo mundo aponta pro IP Radmin dela.
 *   node server/signaling.js
 */

const { WebSocketServer } = require('ws');
const os = require('os');

const PORT = Number(process.env.PORT) || 9000;

const wss = new WebSocketServer({ port: PORT });

/** @type {Map<string, {ws: import('ws').WebSocket, name: string, room: string}>} */
const peers = new Map();

let nextId = 1;

function log(...args) {
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...args);
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

/** Lista de peers da sala, sem incluir quem pediu. */
function roomPeers(room, exceptId) {
  const out = [];
  for (const [id, peer] of peers) {
    if (peer.room === room && id !== exceptId) out.push({ id, name: peer.name });
  }
  return out;
}

function broadcastToRoom(room, exceptId, payload) {
  for (const [id, peer] of peers) {
    if (peer.room === room && id !== exceptId) send(peer.ws, payload);
  }
}

wss.on('connection', (ws) => {
  const id = String(nextId++);
  let joined = false;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        if (joined) return;
        const room = String(msg.room || 'geral').slice(0, 40);
        const name = String(msg.name || 'anonimo').slice(0, 40);
        peers.set(id, { ws, name, room });
        joined = true;
        log(`+ ${name} (#${id}) entrou na sala "${room}"`);

        // Diz pro novo quem ja estava aqui.
        send(ws, { type: 'welcome', id, peers: roomPeers(room, id) });
        // Avisa os antigos que chegou gente.
        broadcastToRoom(room, id, { type: 'peer-joined', id, name });
        break;
      }

      // offer / answer / ice sao apenas repassados pro destinatario.
      case 'offer':
      case 'answer':
      case 'ice': {
        const target = peers.get(String(msg.to));
        if (!target) return;
        send(target.ws, { ...msg, from: id });
        break;
      }

      // Avisa a sala que alguem comecou ou parou de transmitir.
      case 'broadcast-state': {
        const me = peers.get(id);
        if (!me) return;
        broadcastToRoom(me.room, id, {
          type: 'broadcast-state',
          id,
          name: me.name,
          live: Boolean(msg.live),
        });
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    const me = peers.get(id);
    if (!me) return;
    peers.delete(id);
    log(`- ${me.name} (#${id}) saiu da sala "${me.room}"`);
    broadcastToRoom(me.room, id, { type: 'peer-left', id });
  });

  ws.on('error', () => {});
});

// Mostra os IPs onde o servidor pode ser alcancado, destacando o do Radmin.
function printAddresses() {
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
  console.log(`  escutando na porta ${PORT}`);
  console.log('');
  console.log('  Passe um destes enderecos pros seus amigos:');
  for (const c of candidates) {
    // Radmin VPN entrega IPs na faixa 26.x.x.x; Tailscale usa 100.64-127.x.x
    const isRadmin = c.address.startsWith('26.');
    const isTailscale = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(c.address);
    const tag = isRadmin ? '  <-- Radmin VPN' : isTailscale ? '  <-- Tailscale' : '';
    console.log(`    ws://${c.address}:${PORT}${tag}`);
  }
  console.log('');
  console.log('  Se ninguem conectar, libere a porta no firewall do Windows:');
  console.log(`    netsh advfirewall firewall add rule name="GoLive" dir=in action=allow protocol=TCP localport=${PORT}`);
  console.log('');
}

printAddresses();
