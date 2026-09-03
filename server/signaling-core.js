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
function createSignalingServer({ port, heartbeatMs = 25000, pin = null, ownerToken = null }) {
  // PIN opcional da sala (B3 da auditoria). Nao e cripto: so corta o
  // entrar-por-acidente numa rede Radmin/Tailscale compartilhada, onde o
  // beacon anuncia a sala pra todo mundo. `null`/'' => sala aberta, igual
  // a sempre. Normalizado pra string pra comparar com o que vem do cliente.
  const roomPin = pin != null && String(pin) !== '' ? String(pin) : null;
  // Token de dono (opcional). Gerado pelo main.js e devolvido so pro
  // renderer de quem criou a sala -- nunca sai da maquina. Comparado por
  // igualdade estrita: string vazia/null nunca marca dono.
  const ownerTok = typeof ownerToken === 'string' && ownerToken !== '' ? ownerToken : null;
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port, maxPayload: MAX_PAYLOAD_BYTES });

    /** @type {Map<string, {ws: import('ws').WebSocket, name: string, room: string, avatar: string | null, owner: boolean, clientId: string | null, address: string | null}>} */
    const peers = new Map();
    let nextId = 1;

    const CHAT_HISTORY_MAX = 50;
    const chatHistory = []; // ring buffer -- mensagens de texto e linhas de sistema juntas
    const chatRateLimiters = new Map(); // peerId -> limiter, 5 msg/s

    function pushChatEntry(entry) {
      chatHistory.push(entry);
      if (chatHistory.length > CHAT_HISTORY_MAX) chatHistory.shift();
    }

    /** Linha de sistema (entrada/saida/moderacao). `target` e omitido pra
     * join/leave -- o `actor` JA e quem entrou ou saiu. Guardada no historico
     * (pra quem entrar depois ver o que passou) e broadcast pra sala.
     * `exceptId` pula um peer no broadcast ao vivo: o proprio recem-chegado
     * nao precisa da linha "fulano entrou" sobre si (o welcome dele ja
     * estabeleceu que ele entrou), igual o `peer-joined` tambem o pula. */
    function pushSystemLine(room, event, actor, target, exceptId = null) {
      const entry = { type: 'chat', system: true, event, actor, ...(target ? { target } : {}), ts: Date.now() };
      pushChatEntry(entry);
      broadcastToRoom(room, exceptId, entry);
    }

    function roomPeers(room, exceptId) {
      const out = [];
      for (const [id, peer] of peers) {
        if (peer.room === room && id !== exceptId) out.push({ id, name: peer.name, avatar: peer.avatar, owner: peer.owner });
      }
      return out;
    }

    function broadcastToRoom(room, exceptId, payload) {
      for (const [id, peer] of peers) {
        if (peer.room === room && id !== exceptId) send(peer.ws, payload);
      }
    }

    // Chave(s) de ban pra um peer: client:<clientId> sempre que houver
    // clientId (o caso comum), e ip:<endereco> so quando o endereco NAO for
    // loopback -- o dono conecta em 127.0.0.1, e banir por loopback baniria
    // o proprio dono no proximo reconnect. Ver a spec, secao 9.3.
    function normalizeAddress(address) {
      if (typeof address !== 'string') return null;
      return address.replace(/^::ffff:/, '');
    }
    function isLoopback(address) {
      return address === '127.0.0.1' || address === '::1';
    }
    function banKeysFor({ address, clientId }) {
      const keys = [];
      const ip = normalizeAddress(address);
      if (ip && !isLoopback(ip)) keys.push(`ip:${ip}`);
      if (typeof clientId === 'string' && clientId) keys.push(`client:${clientId}`);
      return keys;
    }

    const bans = new Map(); // qualquer chave (ip: ou client:) -> { primaryKey, name }

    function findBan(keys) {
      for (const k of keys) if (bans.has(k)) return bans.get(k);
      return null;
    }
    function addBan(keys, name) {
      if (!keys.length) return null;
      const primaryKey = keys.find((k) => k.startsWith('client:')) || keys[0];
      for (const k of keys) bans.set(k, { primaryKey, name });
      return primaryKey;
    }
    function removeBan(primaryKey) {
      for (const [k, rec] of bans) if (rec.primaryKey === primaryKey) bans.delete(k);
    }
    function listBans() {
      const seen = new Set();
      const out = [];
      for (const rec of bans.values()) {
        if (seen.has(rec.primaryKey)) continue;
        seen.add(rec.primaryKey);
        out.push({ key: rec.primaryKey, name: rec.name });
      }
      return out;
    }
    function sendBannedListToOwner(room) {
      for (const [, peer] of peers) {
        if (peer.room === room && peer.owner) send(peer.ws, { type: 'banned-list', list: listBans() });
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
          // JSON valido mas que nao e um objeto (`null`, `42`, `"x"`,
          // `[...]`, `true`): `msg.type` num `null` LANCA, e a excecao sobe
          // como uncaught e derruba o processo de quem hospeda a sala. Um
          // unico frame `null` de qualquer um que alcance a porta bastava.
          // Descarta em silencio, igual a frame malformado.
          if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return;

          switch (msg.type) {
            case 'join': {
              if (joined) return;
              // clientId e endereco entram cedo: a checagem de ban precisa
              // deles, e o peer guarda ambos pro `close`/`moderate` montarem
              // as mesmas chaves se o dono banir depois de o peer ja estar
              // dentro.
              const clientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 100) : null;
              const remoteAddress = ws._socket?.remoteAddress || null;
              // Banido nao passa nem pela checagem de PIN (nao deve nem saber
              // se acertaria o PIN). Ver a spec, secao 9.3.
              if (findBan(banKeysFor({ address: remoteAddress, clientId }))) {
                send(ws, { type: 'join-denied', reason: 'banned' });
                ws.close(1008, 'banned');
                return;
              }
              // Sala protegida: PIN ausente ou errado e recusa explicita
              // (o cliente distingue "PIN errado" de "conexao caiu") seguida
              // de close 1008. Descartar em silencio faria o cliente ficar
              // preso em "Conectando...".
              if (roomPin && String(msg.pin == null ? '' : msg.pin) !== roomPin) {
                send(ws, { type: 'join-denied', reason: 'pin' });
                ws.close(1008, 'pin');
                return;
              }
              const room = String(msg.room || 'geral').slice(0, 40);
              const name = String(msg.name || 'anonimo').slice(0, 40);
              const avatar = typeof msg.avatar === 'string' ? msg.avatar.slice(0, 256 * 1024) : null;
              const owner = Boolean(ownerTok) && msg.ownerToken === ownerTok;
              peers.set(id, { ws, name, room, avatar, owner, clientId, address: remoteAddress });
              joined = true;
              log(`+ ${name} (#${id}) entrou na sala "${room}"${owner ? ' (dono)' : ''}`);
              send(ws, {
                type: 'welcome', id, owner, peers: roomPeers(room, id),
                chat: chatHistory.slice(), banned: owner ? listBans() : [],
              });
              broadcastToRoom(room, id, { type: 'peer-joined', id, name, avatar, owner });
              pushSystemLine(room, 'join', name, undefined, id);
              break;
            }

            // Poderes do dono: parar transmissao (pedido, socket segue
            // aberto), expulsar (fecha 1008) e banir (expulsa + guarda as
            // chaves pro rejoin ser barrado). Ver a spec, secao 9.
            case 'moderate': {
              const me = peers.get(id);
              if (!me || !me.owner) return; // so o dono modera; nao-dono e ignorado em silencio
              if (msg.action === 'unban') {
                if (typeof msg.target !== 'string') return;
                removeBan(msg.target);
                sendBannedListToOwner(me.room);
                return;
              }
              const targetId = String(msg.target);
              if (targetId === id) return; // dono nao pode se auto-moderar
              const target = peers.get(targetId);
              if (!target || target.room !== me.room) return;

              if (msg.action === 'stop-share') {
                send(target.ws, { type: 'moderated', action: 'stop-share', by: me.name });
                pushSystemLine(me.room, 'stop-share', me.name, target.name);
                return;
              }
              if (msg.action === 'kick' || msg.action === 'ban') {
                send(target.ws, { type: 'moderated', action: msg.action, by: me.name });
                if (msg.action === 'ban') {
                  addBan(banKeysFor({ address: target.address, clientId: target.clientId }), target.name);
                  sendBannedListToOwner(me.room);
                }
                pushSystemLine(me.room, msg.action, me.name, target.name);
                try {
                  target.ws.close(1008, msg.action);
                } catch {
                  /* socket ja fechando */
                }
                return;
              }
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

            case 'chat': {
              const me = peers.get(id);
              if (!me) return; // sem join previo, sem chat
              const limiter = chatRateLimiters.get(id) || createRateLimiter({ limit: 5, windowMs: 1000 });
              chatRateLimiters.set(id, limiter);
              if (!limiter.hit(Date.now())) return; // estoura em silencio, sem fechar o socket (chat nao e flood de sinalizacao)
              if (typeof msg.text !== 'string') return;
              const text = msg.text.trim().slice(0, 500);
              if (!text) return;
              const entry = { type: 'chat', id: String(nextId++), from: id, name: me.name, text, ts: Date.now() };
              pushChatEntry(entry);
              broadcastToRoom(me.room, null, entry); // pra sala INTEIRA, inclusive quem mandou
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
                // Rebroadcast pra sala inteira: um cliente com bug (ou
                // hostil) que manda um `kind` gigante ou uma lista de
                // milhares de watchers veria isso amplificado por N. A
                // sala real nao passa de ~6; 64 e teto folgado.
                kind: String(msg.kind == null ? '' : msg.kind).slice(0, 64),
                watchers: Array.isArray(msg.watchers) ? msg.watchers.slice(0, 64) : [],
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
          chatRateLimiters.delete(id);
          log(`- ${me.name} (#${id}) saiu da sala "${me.room}"`);
          broadcastToRoom(me.room, id, { type: 'peer-left', id });
          pushSystemLine(me.room, 'leave', me.name);
        });

        ws.on('error', () => {});
      });

      resolve({
        wss,
        port: wss.address().port,
        // O servidor roda no processo de quem hospeda. Quando o host sai da
        // sala (Desconectar) ou fecha o app, `close()` e chamado -- e a sala
        // deixa de existir: nao ha pra onde reconectar nem como entrar mais
        // ninguem. Sem avisar, cada cliente so ve o socket cair (code 1006) e,
        // pela logica de resiliencia do renderer (H1), fica "orfao" com a
        // sala fantasma na tela ate desconectar na mao. O 'room-closed'
        // explicito (+ close limpo 1001) deixa o cliente distinguir "a sala
        // acabou" de "a MINHA conexao caiu" e voltar pro lobby na hora.
        close: () => new Promise((res) => {
          for (const client of wss.clients) {
            send(client, { type: 'room-closed' });
            try {
              client.close(1001, 'host-left');
            } catch {
              /* socket ja fechando */
            }
          }
          wss.close(() => res());
        }),
        getPeerCount: () => peers.size,
      });
    });
  });
}

module.exports = { createSignalingServer, createRateLimiter };
