/*
 * Servidor de sinalizacao do GoLive LAN (nucleo reutilizavel).
 *
 * Nao passa video nenhum por aqui. A unica funcao dele e apresentar os peers
 * uns aos outros e repassar as mensagens de negociacao do WebRTC (offer,
 * answer, candidatos ICE). Depois que dois peers se acham, o video vai
 * direto de um pro outro pela LAN virtual.
 */

const { WebSocketServer } = require('ws');

function log(...args) {
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...args);
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

/** Cria o servidor de sinalizacao. Resolve quando a porta esta escutando,
 * rejeita (com err.code === 'EADDRINUSE' se for o caso) se nao conseguir. */
function createSignalingServer({ port }) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port });

    /** @type {Map<string, {ws: import('ws').WebSocket, name: string, room: string, avatar: string | null}>} */
    const peers = new Map();
    let nextId = 1;

    function roomPeers(room, exceptId) {
      const out = [];
      for (const [id, peer] of peers) {
        if (peer.room === room && id !== exceptId) out.push({ id, name: peer.name, avatar: peer.avatar });
      }
      return out;
    }

    function broadcastToRoom(room, exceptId, payload) {
      for (const [id, peer] of peers) {
        if (peer.room === room && id !== exceptId) send(peer.ws, payload);
      }
    }

    function onError(err) {
      reject(err);
    }

    wss.once('error', onError);

    wss.once('listening', () => {
      wss.off('error', onError);

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
              const avatar = typeof msg.avatar === 'string' ? msg.avatar.slice(0, 256 * 1024) : null;
              peers.set(id, { ws, name, room, avatar });
              joined = true;
              log(`+ ${name} (#${id}) entrou na sala "${room}"`);
              send(ws, { type: 'welcome', id, peers: roomPeers(room, id) });
              broadcastToRoom(room, id, { type: 'peer-joined', id, name, avatar });
              break;
            }

            // Encaminhamento direto peer-a-peer: o servidor nao interpreta
            // nada, so entrega ao destinatario carimbando quem mandou.
            // 'view-state' e o espectador dizendo se esta ou nao assistindo
            // (F1.3); 'tree' e a origem distribuindo papeis da arvore de
            // retransmissao (F2). Ver a spec de 2026-08-23.
            case 'offer':
            case 'answer':
            case 'ice':
            case 'view-state':
            case 'tree': {
              const target = peers.get(String(msg.to));
              if (!target) return;
              send(target.ws, { ...msg, from: id });
              break;
            }

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

            // Quem esta transmitindo avisa a SALA INTEIRA (nao so quem
            // pediu) quem esta de fato assistindo aquele kind agora -- e o
            // que permite ao dono de qualquer tile (nao so o host) desenhar
            // "quem esta assistindo" no proprio tile, mesmo pra quem nao e o
            // remetente do view-state que mudou a lista.
            case 'watchers': {
              const me = peers.get(id);
              if (!me) return;
              broadcastToRoom(me.room, id, {
                type: 'watchers',
                from: id,
                kind: msg.kind,
                watchers: Array.isArray(msg.watchers) ? msg.watchers : [],
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

      resolve({
        wss,
        port: wss.address().port,
        close: () => new Promise((res) => wss.close(() => res())),
        getPeerCount: () => peers.size,
      });
    });
  });
}

module.exports = { createSignalingServer };
