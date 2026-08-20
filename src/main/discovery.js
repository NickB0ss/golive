/*
 * Descoberta de salas na LAN via broadcast UDP. Roda inteiramente no
 * processo principal (fora do sandbox do renderer). Uma porta dedicada
 * (DISCOVERY_PORT), separada da faixa 9000-9010 usada pelo servidor de
 * sinalizacao, pra nao colidir.
 *
 * A parte que fala com socket de verdade (createDiscovery) fica fininha de
 * proposito -- toda a logica que vale a pena testar (parsing de payload,
 * calculo de broadcast, TTL/expiracao) fica em funcoes puras, sem dgram.
 */

'use strict';

const os = require('os');

const DISCOVERY_PORT = 41235;
const BEACON_INTERVAL_MS = 2000;
const ROOM_TTL_MS = 7000;
const BEACON_TYPE = 'golive-room';

// --- Funcoes puras, testaveis sem abrir socket -------------------------

function ipToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4 || parts.some((p) => p === '' || Number.isNaN(Number(p)))) return null;
  return parts.reduce((acc, octet) => (acc << 8) + (Number(octet) & 255), 0) >>> 0;
}

function intToIp(int) {
  return [24, 16, 8, 0].map((shift) => (int >>> shift) & 255).join('.');
}

/** Endereco de broadcast de uma interface, a partir de IP + mascara. */
function computeBroadcastAddress(address, netmask) {
  const addrInt = ipToInt(address);
  const maskInt = ipToInt(netmask);
  if (addrInt === null || maskInt === null) return null;
  const broadcastInt = ((addrInt & maskInt) | (~maskInt >>> 0)) >>> 0;
  return intToIp(broadcastInt);
}

/** Todos os alvos de broadcast validos pras interfaces atuais, mais o
 * broadcast global 255.255.255.255 como fallback (cobre o caso de interface
 * sem netmask utilizavel, ou VPNs tipo Radmin/Tailscale que nao repassam
 * broadcast mas nao fazem mal em tentar). */
function listBroadcastTargets(interfaces = os.networkInterfaces()) {
  const targets = new Set(['255.255.255.255']);
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs || []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const bcast = computeBroadcastAddress(addr.address, addr.netmask);
      if (bcast) targets.add(bcast);
    }
  }
  return Array.from(targets);
}

/** Serializa o beacon que anuncia uma sala. */
function formatBeacon({ name, port, address, peers }) {
  const payload = {
    type: BEACON_TYPE,
    name: typeof name === 'string' && name.trim() ? name.trim() : 'anônimo',
    port,
    address,
  };
  if (typeof peers === 'number' && Number.isInteger(peers) && peers >= 0) payload.peers = peers;
  return JSON.stringify(payload);
}

/** Parseia e valida um beacon recebido. Devolve null se malformado. */
function parseBeacon(raw) {
  let data;
  try {
    data = JSON.parse(String(raw));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  if (data.type !== BEACON_TYPE) return null;
  if (typeof data.port !== 'number' || !Number.isInteger(data.port) || data.port <= 0) return null;
  if (typeof data.address !== 'string' || !data.address.trim()) return null;

  const result = {
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'anônimo',
    port: data.port,
    address: data.address.trim(),
  };
  if (typeof data.peers === 'number' && Number.isInteger(data.peers) && data.peers >= 0) {
    result.peers = data.peers;
  }
  return result;
}

/** Uma sala expirou se nao chegou beacon novo dentro do TTL. */
function isExpired(room, now, ttl = ROOM_TTL_MS) {
  return now - room.lastSeen > ttl;
}

/** Remove do Map toda sala expirada. Devolve true se algo mudou. */
function pruneExpiredRooms(roomsMap, now, ttl = ROOM_TTL_MS) {
  let changed = false;
  for (const [key, room] of roomsMap) {
    if (isExpired(room, now, ttl)) {
      roomsMap.delete(key);
      changed = true;
    }
  }
  return changed;
}

/** Formata o Map interno (chave = address) pra lista simples pro renderer. */
function toRoomList(roomsMap) {
  return Array.from(roomsMap.values())
    .map(({ name, address, port, peers }) =>
      peers != null ? { name, address, port, peers } : { name, address, port }
    )
    .sort((a, b) => a.address.localeCompare(b.address));
}

// --- Parte com socket de verdade ----------------------------------------

/**
 * Cria uma instancia de descoberta. `deps.dgram` e injetavel pra teste, mas
 * por padrao usa o modulo `dgram` de verdade do Node.
 */
function createDiscovery({
  port = DISCOVERY_PORT,
  advertiseIntervalMs = BEACON_INTERVAL_MS,
  ttlMs = ROOM_TTL_MS,
  deps = {},
} = {}) {
  const dgram = deps.dgram || require('dgram');

  const rooms = new Map();
  let onRoomsChange = null;
  let advertiseTimer = null;
  let pruneTimer = null;
  let started = false;
  let advertising = false;
  let socket = null;

  function notify() {
    if (onRoomsChange) onRoomsChange(toRoomList(rooms));
  }

  function bindSocket(sock) {
    sock.on('message', (msg) => {
      const beacon = parseBeacon(msg);
      if (!beacon) return;
      rooms.set(beacon.address, { ...beacon, lastSeen: Date.now() });
      notify();
    });
    sock.on('error', () => {
      /* socket UDP de descoberta e best-effort -- nunca deve derrubar o app */
    });
  }

  function start() {
    if (started) return Promise.resolve();
    started = true;
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    bindSocket(socket);
    return new Promise((resolve) => {
      socket.bind(port, () => {
        try {
          socket.setBroadcast(true);
        } catch {
          /* algumas plataformas negam SO_BROADCAST em certas interfaces */
        }
        pruneTimer = setInterval(() => {
          if (pruneExpiredRooms(rooms, Date.now(), ttlMs)) notify();
        }, 1000);
        resolve();
      });
    });
  }

  function startAdvertising({ name, port: roomPort, address, getPeerCount }) {
    stopAdvertising();
    advertising = true;
    const send = () => {
      if (!socket) return;
      const peers = typeof getPeerCount === 'function' ? getPeerCount() : undefined;
      const payload = Buffer.from(formatBeacon({ name, port: roomPort, address, peers }));
      for (const target of listBroadcastTargets()) {
        socket.send(payload, port, target, () => {});
      }
    };
    send();
    advertiseTimer = setInterval(send, advertiseIntervalMs);
  }

  function stopAdvertising() {
    if (advertiseTimer) clearInterval(advertiseTimer);
    advertiseTimer = null;
    advertising = false;
  }

  function stop() {
    stopAdvertising();
    if (pruneTimer) clearInterval(pruneTimer);
    pruneTimer = null;
    rooms.clear();
    notify();
    started = false;
    if (socket) {
      try {
        socket.close();
      } catch {
        /* ja fechado */
      }
      socket = null;
    }
  }

  function setOnRoomsChange(callback) {
    onRoomsChange = callback;
  }

  function getRooms() {
    return toRoomList(rooms);
  }

  function isAdvertising() {
    return advertising;
  }

  return { start, stop, startAdvertising, stopAdvertising, setOnRoomsChange, getRooms, isAdvertising };
}

module.exports = {
  DISCOVERY_PORT,
  BEACON_INTERVAL_MS,
  ROOM_TTL_MS,
  computeBroadcastAddress,
  listBroadcastTargets,
  formatBeacon,
  parseBeacon,
  isExpired,
  pruneExpiredRooms,
  toRoomList,
  createDiscovery,
};
