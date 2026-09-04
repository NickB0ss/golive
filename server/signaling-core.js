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

// Imagem no chat. O servidor de sinalizacao roda no PC de quem criou a
// sala, e o historico de chat vive na memoria desse processo -- por isso
// tem DOIS tetos, e nao um:
//
//  - MAX_IMAGE_CHARS: tamanho de UMA imagem (caracteres do data URL, ou
//    seja ~3/4 disso em bytes). O cliente ja reduz e reencoda ate caber
//    (ver chatmedia.js); este e o teto que nao depende de o cliente ser
//    o nosso.
//  - CHAT_IMAGE_HISTORY_MAX: quantas mensagens COM imagem o historico
//    guarda. 50 x 200 KB seriam 10 MB pendurados no host so pra quem
//    entrar depois ver print de meia hora atras; 8 poe o teto real em
//    ~1,6 MB. Quem ja esta na sala continua vendo tudo -- o corte e so
//    no que se conta pra quem chega.
const MAX_IMAGE_CHARS = 200 * 1024;
const CHAT_IMAGE_HISTORY_MAX = 8;

// Anotacao na tela (rabisco/escrita). Limitador SEPARADO do de sinalizacao
// e do de chat de proposito: desenhar rapido nao pode fechar o socket (o
// de sinalizacao fecha em 1008) nem gastar a cota de chat, e uma
// renegociacao acontecendo junto nao pode ser derrubada por quem esta
// rabiscando. O cliente manda um lote de pontos por quadro de animacao
// (~17/s no pior caso), entao 60/s e ~3x de folga.
const MAX_ANNOTATE_PER_SECOND = 60;
const MAX_ANNOTATE_POINTS = 200; // pontos por mensagem (lote de um quadro)
const MAX_ANNOTATE_TEXT = 120; // caracteres de uma escrita
const MAX_ANNOTATE_SYNC_ITEMS = 400; // itens de um snapshot pra quem chegou depois

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

/** Dimensao de imagem vinda do cliente, so pra reservar a altura da linha
 * do chat. Qualquer coisa que nao seja um numero util vira `null` -- quem
 * desenha cai no tamanho natural da imagem. */
function clampDim(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), 10000);
}

/** Coordenada normalizada de anotacao: 0..1, tres casas. Fora disso (NaN,
 * negativo, 12, string) vira `null`, e a op inteira e descartada. */
function normPoint(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return Math.round(n * 1000) / 1000;
}

/** Valida e recorta uma op de anotacao vinda da rede, devolvendo SO os
 * campos que aquela op usa (ou `null` se ela nao for aproveitavel). Fora
 * do createSignalingServer pra poder ser testada sem subir socket.
 *
 * A cor NAO passa por aqui de proposito: ela e derivada de `from` nos dois
 * lados (ver annotate.js), entao nao ha campo de cor pra um cliente forjar. */
function sanitizeAnnotateOp(msg) {
  const id = typeof msg.id === 'string' && msg.id ? msg.id.slice(0, 64) : null;
  switch (msg.op) {
    case 'begin': {
      const x = normPoint(msg.x);
      const y = normPoint(msg.y);
      if (!id || x === null || y === null) return null;
      const width = Number(msg.width);
      return { op: 'begin', id, x, y, width: Number.isFinite(width) ? Math.min(Math.max(width, 1), 20) : 4 };
    }
    case 'points': {
      if (!id || !Array.isArray(msg.points)) return null;
      const points = [];
      for (const p of msg.points.slice(0, MAX_ANNOTATE_POINTS)) {
        if (!Array.isArray(p)) continue;
        const x = normPoint(p[0]);
        const y = normPoint(p[1]);
        if (x === null || y === null) continue;
        points.push([x, y]);
      }
      if (!points.length) return null;
      return { op: 'points', id, points };
    }
    case 'end':
      return id ? { op: 'end', id } : null;
    case 'text': {
      const x = normPoint(msg.x);
      const y = normPoint(msg.y);
      const text = typeof msg.text === 'string' ? msg.text.slice(0, MAX_ANNOTATE_TEXT) : '';
      if (!id || x === null || y === null || !text.trim()) return null;
      const size = Number(msg.size);
      return { op: 'text', id, x, y, text, size: Number.isFinite(size) ? Math.min(Math.max(size, 8), 96) : 20 };
    }
    case 'undo':
      return { op: 'undo' };
    case 'clear':
      return { op: 'clear', scope: msg.scope === 'all' ? 'all' : 'mine' };
    default:
      return null;
  }
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
function createSignalingServer({ port, heartbeatMs = 25000, pin = null, ownerToken = null, appVersion = null }) {
  // PIN opcional da sala (B3 da auditoria). Nao e cripto: so corta o
  // entrar-por-acidente numa rede Radmin/Tailscale compartilhada, onde o
  // beacon anuncia a sala pra todo mundo. `null`/'' => sala aberta, igual
  // a sempre. Normalizado pra string pra comparar com o que vem do cliente.
  const roomPin = pin != null && String(pin) !== '' ? String(pin) : null;
  // Token de dono (opcional). Gerado pelo main.js e devolvido so pro
  // renderer de quem criou a sala -- nunca sai da maquina. Comparado por
  // igualdade estrita: string vazia/null nunca marca dono.
  const ownerTok = typeof ownerToken === 'string' && ownerToken !== '' ? ownerToken : null;
  // Versao do app de quem hospeda. Quando definida, TODO mundo que entrar
  // tem de estar exatamente nela: o protocolo de sinalizacao, o formato da
  // arvore e a negociacao P2P mudam entre releases sem nenhum acordo de
  // compatibilidade, e uma sala com versoes misturadas quebra de um jeito
  // que parece problema de rede (tile que nunca abre, arvore que nao fecha).
  // `null` (o default, usado pelos testes de protocolo) desliga a checagem.
  const hostVersion = typeof appVersion === 'string' && appVersion.trim() !== '' ? appVersion.trim() : null;
  const sameVersion = (v) => typeof v === 'string' && v.trim() !== '' && v.trim().replace(/^v/, '') === hostVersion.replace(/^v/, '');
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port, maxPayload: MAX_PAYLOAD_BYTES });

    /** @type {Map<string, {ws: import('ws').WebSocket, name: string, room: string, avatar: string | null, owner: boolean, clientId: string | null, address: string | null}>} */
    const peers = new Map();
    let nextId = 1;

    // Quem recebeu a lideranca da sala (clientId), ou null enquanto ela
    // nunca saiu de quem criou a sala. E o que decide `owner` no join --
    // ver a spec de 2026-09-04, secao 4.1: sem isto, o host que passa a
    // lideranca e depois reconecta voltaria como dono (o ownerToken dele
    // continua valido) e a sala teria duas coroas.
    let transferredTo = null;

    const CHAT_HISTORY_MAX = 50;
    const chatHistory = []; // ring buffer -- mensagens de texto e linhas de sistema juntas
    const chatRateLimiters = new Map(); // peerId -> limiter, 5 msg/s
    const chatImageLimiters = new Map(); // peerId -> limiter, 3 imagens / 5s
    const annotateLimiters = new Map(); // peerId -> limiter, 60 msg/s

    function pushChatEntry(entry) {
      chatHistory.push(entry);
      if (chatHistory.length > CHAT_HISTORY_MAX) chatHistory.shift();
      if (entry.image) trimImageHistory();
    }

    /** Mantem no maximo CHAT_IMAGE_HISTORY_MAX mensagens com imagem no
     * historico, descartando a mais antiga inteira. Roda so quando uma
     * imagem entra -- mensagem de texto nao mexe nisso. */
    function trimImageHistory() {
      let extras = chatHistory.filter((e) => e.image).length - CHAT_IMAGE_HISTORY_MAX;
      while (extras > 0) {
        const i = chatHistory.findIndex((e) => e.image);
        if (i < 0) return;
        chatHistory.splice(i, 1);
        extras -= 1;
      }
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

    /** Anuncia quem e o dono da sala AGORA. `owner`/`ownerId` nulos dizem
     * "a sala esta sem dono" -- estado real quando o lider sai e quem criou
     * a sala nao esta mais nela.
     *
     * A lista de banidos migra junto: ela e ferramenta de dono, e quem
     * deixou de ser recebe uma lista vazia (e assim a secao "Banidos" some
     * da coluna dele) enquanto o novo recebe a de verdade. */
    function announceOwner(room, owner, ownerId) {
      broadcastToRoom(room, null, {
        type: 'owner-changed',
        id: ownerId ?? null,
        name: owner?.name ?? null,
      });
      for (const [, peer] of peers) {
        if (peer.room !== room) continue;
        if (peer.owner) send(peer.ws, { type: 'banned-list', list: listBans() });
        else send(peer.ws, { type: 'banned-list', list: [] });
      }
    }

    /** O lider saiu da sala. Quem criou a sala continua sendo a raiz da
     * autoridade (o `ownerToken` nunca deixou a maquina dele), entao a
     * lideranca volta pra casa -- e se ele nao estiver mais na sala, ela
     * fica vaga ate ele voltar, que e o que ja acontecia antes desta
     * feature quando o dono caia. Ver a spec, secao 4.2. */
    function reclaimOwnership(room) {
      transferredTo = null;
      for (const [pid, peer] of peers) {
        if (peer.room !== room || !peer.tokenHolder) continue;
        peer.owner = true;
        announceOwner(room, peer, pid);
        return;
      }
      announceOwner(room, null, null); // sala sem dono
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
              // Versao diferente da de quem criou a sala: recusa antes do PIN
              // (nao adianta acertar o PIN numa sala que o seu app nao sabe
              // conversar). Manda as duas versoes de volta pra que o cliente
              // saiba dizer QUEM precisa atualizar, e fecha com 1008.
              if (hostVersion && !sameVersion(msg.appVersion)) {
                const theirVersion = typeof msg.appVersion === 'string' ? msg.appVersion.slice(0, 40) : null;
                send(ws, { type: 'join-denied', reason: 'version', hostVersion, yourVersion: theirVersion });
                ws.close(1008, 'version');
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
              // `tokenHolder` e um fato imutavel do peer (apresentou o token
              // de quem criou a sala); `owner` e quem manda AGORA. Enquanto
              // a lideranca nunca foi passada os dois coincidem -- depois de
              // passada, quem manda e so quem tem o clientId de destino.
              const tokenHolder = Boolean(ownerTok) && msg.ownerToken === ownerTok;
              const owner = transferredTo ? clientId != null && clientId === transferredTo : tokenHolder;
              peers.set(id, { ws, name, room, avatar, owner, tokenHolder, clientId, address: remoteAddress });
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
                // Le o nome ANTES de removeBan apagar a entrada, pra a linha
                // de sistema poder dizer quem foi readmitido.
                const rec = bans.get(msg.target);
                removeBan(msg.target);
                if (rec) pushSystemLine(me.room, 'unban', me.name, rec.name);
                sendBannedListToOwner(me.room);
                return;
              }
              const targetId = String(msg.target);
              if (targetId === id) return; // dono nao pode se auto-moderar
              const target = peers.get(targetId);
              if (!target || target.room !== me.room) return;

              // Passar a lideranca. Diferente das outras acoes, esta muda o
              // estado da SALA (quem pode moderar dai pra frente), nao o do
              // alvo -- por isso ela mexe em `transferredTo`, que e o que o
              // join de qualquer reconexao vai ler. Ver a spec, secao 4.
              if (msg.action === 'transfer-owner') {
                me.owner = false;
                target.owner = true;
                // Devolver pro dono original zera a transferencia em vez de
                // gravar o clientId dele: assim a sala volta ao estado de
                // origem (o token manda), e nao a um estado que depende de
                // um clientId que pode nem existir depois de reinstalar.
                transferredTo = target.tokenHolder ? null : target.clientId;
                announceOwner(me.room, target, targetId);
                pushSystemLine(me.room, 'transfer-owner', me.name, target.name);
                return;
              }

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
                // O close abaixo dispara o handler ws.on('close') do alvo, que
                // por padrao empurra uma linha 'leave'. Marca pra ele pular --
                // a linha 'kick'/'ban' acima ja cobriu a saida.
                target._moderationClose = true;
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
              const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 500) : '';
              // Imagem: opcional, e a legenda tambem -- o que nao pode e a
              // mensagem ser vazia dos dois lados. Aceita so data URL de
              // imagem: uma `http(s)://` viraria o renderer buscando de um
              // endereco que quem mandou escolheu (e o CSP so permite
              // `data:`/`blob:` em img-src, entao nem carregaria).
              const image = typeof msg.image === 'string'
                && /^data:image\/(png|jpeg|gif|webp);base64,/.test(msg.image)
                && msg.image.length <= MAX_IMAGE_CHARS
                ? msg.image
                : null;
              if (!text && !image) return;
              if (image) {
                // Segunda cota, so pras imagens: 5 msg/s de texto e barato,
                // 5 imagens/s de 200 KB sao 1 MB/s repassados pra sala
                // inteira pelo PC de quem hospeda.
                const imgLimiter = chatImageLimiters.get(id) || createRateLimiter({ limit: 3, windowMs: 5000 });
                chatImageLimiters.set(id, imgLimiter);
                if (!imgLimiter.hit(Date.now())) return;
              }
              const entry = {
                type: 'chat', id: String(nextId++), from: id, name: me.name, text, ts: Date.now(),
                // w/h viajam junto pra linha do chat ja nascer com a altura
                // certa -- sem isso a lista pula quando a imagem decodifica.
                ...(image ? { image, w: clampDim(msg.w), h: clampDim(msg.h) } : {}),
              };
              pushChatEntry(entry);
              broadcastToRoom(me.room, null, entry); // pra sala INTEIRA, inclusive quem mandou
              break;
            }

            // Anotacao na tela de alguem (rabisco/escrita). O servidor NAO
            // guarda estado nenhum de anotacao: ele repassa e pronto -- quem
            // chega no meio recebe o desenho do proprio dono da tela, via
            // 'annotate-sync' logo abaixo. `surface` e o dono da tela (nao
            // quem desenha); `from` e carimbado aqui e e o que decide a cor
            // do pincel nos dois lados, entao ninguem desenha com a cor de
            // outro. Ver a spec de 2026-09-04, secao 5.5.
            case 'annotate': {
              const me = peers.get(id);
              if (!me) return;
              const limiter = annotateLimiters.get(id) || createRateLimiter({ limit: MAX_ANNOTATE_PER_SECOND, windowMs: 1000 });
              annotateLimiters.set(id, limiter);
              if (!limiter.hit(Date.now())) return; // estoura em silencio, igual ao chat
              const surface = peers.get(String(msg.surface));
              if (!surface || surface.room !== me.room) return; // tela de quem nao esta nesta sala
              const op = sanitizeAnnotateOp(msg);
              if (!op) return;
              broadcastToRoom(me.room, id, { ...op, type: 'annotate', surface: String(msg.surface), from: id });
              break;
            }

            // Snapshot da lousa pra UM peer (quem acabou de entrar). Roteado
            // como offer/answer, nao broadcast: e um estado inteiro, e so
            // quem chegou depois precisa dele.
            case 'annotate-sync': {
              const me = peers.get(id);
              const target = peers.get(String(msg.to));
              if (!me || !target || me.room !== target.room) return;
              if (!Array.isArray(msg.items)) return;
              send(target.ws, {
                type: 'annotate-sync',
                from: id,
                surface: String(msg.surface),
                items: msg.items.slice(0, MAX_ANNOTATE_SYNC_ITEMS),
              });
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
                paused: Boolean(msg.paused),
                // Se a sala pode rabiscar NESTA tela. Quem assiste so
                // descobre isso por aqui -- sem o campo, a barra de
                // ferramentas de rabisco nunca aparece pra ninguem, e sem
                // erro nenhum no caminho pra denunciar. `=== true` porque o
                // campo vem de um cliente: qualquer coisa que nao seja o
                // booleano vira false, como ja acontece com `paused`.
                annotate: msg.annotate === true,
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
          chatImageLimiters.delete(id);
          annotateLimiters.delete(id);
          log(`- ${me.name} (#${id}) saiu da sala "${me.room}"`);
          broadcastToRoom(me.room, id, { type: 'peer-left', id });
          // Expulso/banido ja tem a linha 'kick'/'ban' -- nao duplica com 'leave'.
          if (!me._moderationClose) pushSystemLine(me.room, 'leave', me.name);
          // O lider (que nao e quem criou a sala) fechou o app: a sala
          // continua viva -- o servidor roda no processo do host -- mas
          // ficaria sem ninguem podendo moderar, com a sala aberta pra
          // rede. A lideranca volta pra quem criou a sala.
          if (me.owner && transferredTo) reclaimOwnership(me.room);
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

module.exports = {
  createSignalingServer,
  createRateLimiter,
  sanitizeAnnotateOp,
  clampDim,
  MAX_IMAGE_CHARS,
  CHAT_IMAGE_HISTORY_MAX,
};
