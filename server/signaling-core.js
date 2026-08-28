/*
 * Servidor de sinalizacao do GoLive LAN (nucleo reutilizavel).
 *
 * Nao passa video nenhum por aqui. A unica funcao dele e apresentar os peers
 * uns aos outros e repassar as mensagens de negociacao do WebRTC (offer,
 * answer, candidatos ICE). Depois que dois peers se acham, o video vai
 * direto de um pro outro pela LAN virtual.
 */

const { WebSocketServer } = require('ws');

// O servidor de sinalizacao roda no MESMO processo do app de quem criou a
// sala. O `maxPayload` padrao do `ws` e 100 MB: um cliente hostil (ou com
// bug) poderia estourar a memoria desse processo com um unico frame. A
// maior mensagem legitima e o avatar (256 KB, cortado no 'join'); 512 KB da
// folga pra base64 + envelope JSON sem abrir espaco pra abuso.
const MAX_PAYLOAD_BYTES = 512 * 1024;

// Teto de mensagens por segundo por socket. A sinalizacao e ociosa quase o
// tempo todo, MAS e bursty por natureza (ICE trickle) e tem uma rajada real
// no reingresso: quando um cliente reconecta, o handler de 'welcome' re-oferta
// pra sala inteira de uma vez -- ate `peers x kinds` RTCPeerConnection novas
// no mesmo instante, cada uma emitindo os candidatos ICE que junta.
//
// Pior caso realista (sala de 6, tela + camera):
//   pcs novas:        5 peers x 2 kinds                       = 10
//   ice/pc:           Ethernet + adaptador VPN + IPv6 + 2 srflx ~ 6-8
//   ice total:        10 x 8                                   = 80
//   offer + answer:   10 + 10                                  = 20
//   tree + watchers + view-state                               ~ 15
//   -----------------------------------------------------------------
//   ~115 frames no segundo de gathering
//
// 300/s cobre isso com folga de ~2.5x e ainda corta na hora um cliente em
// loop de verdade (um `while(true) ws.send()` faz dezenas de milhares/s).
const MAX_MSGS_PER_SECOND = 300;
const RATE_WINDOW_MS = 1000;

/** Contador de taxa por conexao, isolado pra ser testavel sem subir socket.
 * `hit(now)` registra uma mensagem e devolve `true` enquanto a conexao
 * estiver dentro do teto na janela corrente; `false` no primeiro estouro. */
function createRateLimiter({ limit = MAX_MSGS_PER_SECOND, windowMs = RATE_WINDOW_MS } = {}) {
  let windowStart = 0;
  let count = 0;
  return {
    hit(now) {
      if (now - windowStart >= windowMs) {
        windowStart = now;
        count = 0;
      }
      count += 1;
      return count <= limit;
    },
  };
}

function log(...args) {
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...args);
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

/** Cria o servidor de sinalizacao. Resolve quando a porta esta escutando,
 * rejeita (com err.code === 'EADDRINUSE' se for o caso) se nao conseguir.
 *
 * `heartbeatMs`: intervalo do ping keep-alive. A conexao de sinalizacao
 * fica ociosa quase o tempo todo (so a negociacao WebRTC passa por aqui);
 * numa LAN virtual (Radmin/Tailscale) uma conexao TCP ociosa por
 * 60-120s tem o estado de NAT descartado e o cliente "cai da sala"
 * sozinho, com close code 1006. O ping periodico mantem o fluxo vivo e
 * ainda deixa o servidor derrubar quem parou de responder. */
function createSignalingServer({ port, heartbeatMs = 25000 }) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port, maxPayload: MAX_PAYLOAD_BYTES });

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
      // O bind falhou (tipicamente EADDRINUSE), mas o WebSocketServer e o
      // http.Server interno dele ja foram criados -- sem fecha-los aqui,
      // cada tentativa de findFreeServer (ports.js) que esbarra numa porta
      // ocupada deixa um servidor morto pra tras. `close()` num servidor
      // que nunca chegou a escutar e seguro (o `ws` trata isso).
      wss.close();
      reject(err);
    }

    wss.once('error', onError);

    wss.once('listening', () => {
      wss.off('error', onError);

      // Keep-alive: marca cada socket como vivo ao receber o pong do
      // navegador (que responde sozinho ao ping) e, a cada ciclo, derruba
      // quem nao respondeu o ping anterior.
      const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
          if (ws.isAlive === false) {
            ws.terminate();
            continue;
          }
          ws.isAlive = false;
          try {
            ws.ping();
          } catch {
            /* socket ja fechando */
          }
        }
      }, heartbeatMs);
      if (typeof heartbeat.unref === 'function') heartbeat.unref();
      wss.on('close', () => clearInterval(heartbeat));

      wss.on('connection', (ws) => {
        const id = String(nextId++);
        let joined = false;
        const rateLimiter = createRateLimiter({});

        ws.isAlive = true;
        ws.on('pong', () => {
          ws.isAlive = true;
        });

        ws.on('message', (raw) => {
          // Cliente em loop ou tentando afogar o processo do host: fecha o
          // socket em vez de seguir processando frame por frame.
          if (!rateLimiter.hit(Date.now())) {
            ws.close(1008, 'flood');
            return;
          }

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
              // Exige destino existente E na mesma sala do remetente. Hoje
              // todo mundo entra em 'geral', mas no dia em que salas
              // separadas existirem isto impede vazar sinalizacao entre
              // salas. Descartado em silencio, igual a destino inexistente.
              const me = peers.get(id);
              const target = peers.get(String(msg.to));
              if (!me || !target || me.room !== target.room) return;
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

module.exports = { createSignalingServer, createRateLimiter };
