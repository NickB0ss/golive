# Melhorias nas salas ao vivo — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar as cinco melhorias descritas em [docs/superpowers/specs/2026-08-19-salas-vivas-design.md](../specs/2026-08-19-salas-vivas-design.md): contagem de pessoas por sala, botão de refresh, sons de entrada/saída, cooldown de 2s, e fotos de perfil.

**Architecture:** Mudanças em três camadas: `server/signaling-core.js` (contagem de peers + avatar no protocolo WS), `src/main/discovery.js` + `src/main.js` (beacon UDP com contagem, refresh do socket de descoberta), e `src/renderer/*` (UI: refresh, sons, cooldown, captura/exibição de avatar). Cada task entrega uma fatia testável isoladamente.

**Tech Stack:** Electron (main/preload/renderer), `ws` (WebSocket), `dgram` (UDP), `node:test` + `node:assert/strict` pros módulos sem DOM. Renderer não tem framework de teste (tudo DOM direto) — verificação manual via `npm start` faz parte das tasks de UI, como já indicado na spec.

## Global Constraints

- Nomenclatura e mensagens de erro em português, seguindo o padrão já usado no repo.
- Beacon UDP deve manter compatibilidade retroativa: campo `peers` é sempre opcional, ausência não invalida o beacon.
- Sem framework de teste de renderer — módulos DOM (`ui.js`, `app.js`, `sound.js`) são verificados manualmente via `npm start`, não com `node:test`.
- Cooldown fixo de 2000ms, volume dos sons fixo e baixo (ganho ~0.15) — nada disso é configurável (fora de escopo, spec explícita).
- Avatar: canvas 128×128, `image/jpeg` qualidade 0.8, rejeitar arquivo > 10MB antes de processar.

---

## Task 1: Signaling — contagem de peers e avatar no protocolo

**Files:**
- Modify: [server/signaling-core.js](../../../server/signaling-core.js)
- Test: [server/signaling-core.test.js](../../../server/signaling-core.test.js)

**Interfaces:**
- Produces: `createSignalingServer(...)` resolve value ganha `getPeerCount(): number`. Mensagem `welcome.peers[]` e `peer-joined` ganham campo `avatar: string | null`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `server/signaling-core.test.js` (antes do `});` final do arquivo não existe — são testes de topo, adicionar após o teste `'rejeita com EADDRINUSE...'`):

```javascript
test('getPeerCount reflete entradas e saidas', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    assert.equal(server.getPeerCount(), 0);

    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    await once(a, 'welcome');
    assert.equal(server.getPeerCount(), 1);

    a.close();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(server.getPeerCount(), 0);
  } finally {
    await server.close();
  }
});

test('avatar e repassado em welcome e peer-joined', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana', avatar: 'data:image/jpeg;base64,AAA' }));
    await once(a, 'welcome');

    const b = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => b.once('open', r));
    const joinedA = once(a, 'peer-joined');
    b.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Bruno' }));
    const welcomeB = await once(b, 'welcome');
    assert.equal(welcomeB.peers[0].avatar, 'data:image/jpeg;base64,AAA');

    const peerJoinedMsg = await joinedA;
    assert.equal(peerJoinedMsg.avatar, null);

    a.close();
    b.close();
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `node --test server/signaling-core.test.js`
Expected: FAIL — `server.getPeerCount is not a function` e `welcomeB.peers[0].avatar` é `undefined`.

- [ ] **Step 3: Implementar**

Em `server/signaling-core.js`:

Modificar `roomPeers` (linha 30-36) pra incluir `avatar`:

```javascript
function roomPeers(room, exceptId) {
  const out = [];
  for (const [id, peer] of peers) {
    if (peer.room === room && id !== exceptId) out.push({ id, name: peer.name, avatar: peer.avatar });
  }
  return out;
}
```

Modificar o `case 'join'` (linha 66-76):

```javascript
case 'join': {
  if (joined) return;
  const room = String(msg.room || 'geral').slice(0, 40);
  const name = String(msg.name || 'anonimo').slice(0, 40);
  const avatar = typeof msg.avatar === 'string' ? msg.avatar : null;
  peers.set(id, { ws, name, room, avatar });
  joined = true;
  log(`+ ${name} (#${id}) entrou na sala "${room}"`);
  send(ws, { type: 'welcome', id, peers: roomPeers(room, id) });
  broadcastToRoom(room, id, { type: 'peer-joined', id, name, avatar });
  break;
}
```

Adicionar `getPeerCount` no objeto resolvido (linha 115-119):

```javascript
resolve({
  wss,
  port: wss.address().port,
  close: () => new Promise((res) => wss.close(() => res())),
  getPeerCount: () => peers.size,
});
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `node --test server/signaling-core.test.js`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add server/signaling-core.js server/signaling-core.test.js
git commit -m "feat: signaling-core expoe getPeerCount e repassa avatar"
```

---

## Task 2: Discovery — beacon com contagem de peers, isAdvertising e socket reiniciável

**Files:**
- Modify: [src/main/discovery.js](../../../src/main/discovery.js)
- Test: [src/main/discovery.test.js](../../../src/main/discovery.test.js)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `formatBeacon({ name, port, address, peers? })`, `parseBeacon(raw)` devolvendo `peers?: number`, `toRoomList(roomsMap)` repassando `peers`. `createDiscovery()` devolve também `isAdvertising(): boolean`. `startAdvertising({ name, port, address, getPeerCount? })` — `getPeerCount` é chamado a cada tick do beacon. `start()` volta a funcionar após um `stop()` anterior na mesma instância (socket é recriado, não reaproveitado).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `src/main/discovery.test.js`:

```javascript
test('formatBeacon inclui peers quando informado como inteiro valido', () => {
  const raw = formatBeacon({ name: 'Sala', port: 9000, address: '1.2.3.4:9000', peers: 3 });
  assert.equal(JSON.parse(raw).peers, 3);
});

test('formatBeacon omite peers quando ausente ou invalido', () => {
  assert.equal(JSON.parse(formatBeacon({ name: 'Sala', port: 9000, address: '1.2.3.4:9000' })).peers, undefined);
  assert.equal(JSON.parse(formatBeacon({ name: 'Sala', port: 9000, address: '1.2.3.4:9000', peers: -1 })).peers, undefined);
  assert.equal(JSON.parse(formatBeacon({ name: 'Sala', port: 9000, address: '1.2.3.4:9000', peers: 1.5 })).peers, undefined);
});

test('parseBeacon repassa peers quando presente e valido', () => {
  const raw = formatBeacon({ name: 'Sala', port: 9000, address: '1.2.3.4:9000', peers: 5 });
  assert.equal(parseBeacon(raw).peers, 5);
});

test('parseBeacon compat: beacon sem peers continua valido e sem o campo', () => {
  const raw = JSON.stringify({ type: 'golive-room', port: 9000, address: '1.2.3.4:9000' });
  assert.equal(parseBeacon(raw).peers, undefined);
});

test('parseBeacon ignora peers invalido (negativo, float, string) sem invalidar o beacon', () => {
  assert.equal(parseBeacon(JSON.stringify({ type: 'golive-room', port: 9000, address: 'a', peers: -1 })).peers, undefined);
  assert.equal(parseBeacon(JSON.stringify({ type: 'golive-room', port: 9000, address: 'a', peers: 1.5 })).peers, undefined);
  assert.equal(parseBeacon(JSON.stringify({ type: 'golive-room', port: 9000, address: 'a', peers: 'x' })).peers, undefined);
});

test('toRoomList repassa peers quando presente', () => {
  const rooms = new Map([
    ['a:9000', { name: 'A', address: 'a:9000', port: 9000, peers: 2, lastSeen: 1 }],
    ['b:9000', { name: 'B', address: 'b:9000', port: 9000, lastSeen: 1 }],
  ]);
  const list = toRoomList(rooms);
  assert.deepEqual(list, [
    { name: 'A', address: 'a:9000', port: 9000, peers: 2 },
    { name: 'B', address: 'b:9000', port: 9000 },
  ]);
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `node --test src/main/discovery.test.js`
Expected: FAIL — `peers` sempre `undefined`/ausente porque `formatBeacon`/`parseBeacon`/`toRoomList` ainda não tratam o campo.

- [ ] **Step 3: Implementar**

Em `src/main/discovery.js`, substituir `formatBeacon` (linha 58-66):

```javascript
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
```

Substituir `parseBeacon` (linha 68-86):

```javascript
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
```

Substituir `toRoomList` (linha 105-110):

```javascript
function toRoomList(roomsMap) {
  return Array.from(roomsMap.values())
    .map(({ name, address, port, peers }) =>
      peers != null ? { name, address, port, peers } : { name, address, port }
    )
    .sort((a, b) => a.address.localeCompare(b.address));
}
```

Reescrever `createDiscovery` (linha 118-205) pra criar o socket dentro de `start()` (permite `stop()` + `start()` reabrir) e adicionar `isAdvertising`:

```javascript
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
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `node --test src/main/discovery.test.js`
Expected: PASS (todos os testes, incluindo os pré-existentes)

- [ ] **Step 5: Commit**

```bash
git add src/main/discovery.js src/main/discovery.test.js
git commit -m "feat: beacon UDP leva contagem de peers, discovery ganha isAdvertising e socket reiniciavel"
```

---

## Task 3: Main process — liga contagem de peers ao beacon e adiciona refresh de descoberta

**Files:**
- Modify: [src/main.js](../../../src/main.js)
- Modify: [src/preload.js](../../../src/preload.js)

**Interfaces:**
- Consumes: `embeddedServer.getPeerCount()` (Task 1), `discovery.isAdvertising()` e `startAdvertising({ ..., getPeerCount })` (Task 2).
- Produces: IPC `discovery:refresh` (sem payload, devolve `true`). `window.golive.refreshDiscovery(): Promise<boolean>`.

- [ ] **Step 1: Adicionar helper `advertiseHostedRoom` e usá-lo nos três pontos que ligam o anúncio**

Em `src/main.js`, adicionar logo antes do bloco `// --- IPC ---------------------------------------------------------------` (linha 126):

```javascript
function advertiseHostedRoom() {
  if (!embeddedServer) {
    discovery.stopAdvertising();
    return;
  }
  const picked = pickAddress();
  const address = picked ? `${picked.address}:${embeddedServer.port}` : null;
  if (!address) {
    discovery.stopAdvertising();
    return;
  }
  discovery.startAdvertising({
    name: hostedRoomName,
    port: embeddedServer.port,
    address,
    getPeerCount: () => embeddedServer.getPeerCount(),
  });
}
```

Substituir o corpo do handler `room:host` (linha 159-186), trecho que liga o anúncio:

```javascript
    hostedRoomName = name || 'anônimo';
    await ensureDiscoveryStarted();
    if (advertise && address) {
      advertiseHostedRoom();
    } else {
      discovery.stopAdvertising();
    }
```

Substituir o handler `discovery:setAdvertise` (linha 188-202):

```javascript
ipcMain.handle('discovery:setAdvertise', async (_event, enabled) => {
  await ensureDiscoveryStarted();
  if (!enabled || !embeddedServer) {
    discovery.stopAdvertising();
    return true;
  }
  advertiseHostedRoom();
  return true;
});
```

- [ ] **Step 2: Adicionar o handler `discovery:refresh`**

No final de `src/main.js`, depois do handler `discovery:setAdvertise`:

```javascript
ipcMain.handle('discovery:refresh', async () => {
  const wasAdvertising = discovery.isAdvertising();
  discovery.stop();
  discoveryStarted = false;
  await ensureDiscoveryStarted();
  if (wasAdvertising) advertiseHostedRoom();
  return true;
});
```

- [ ] **Step 3: Expor `refreshDiscovery` no preload**

Em `src/preload.js`, adicionar dentro do objeto `contextBridge.exposeInMainWorld('golive', { ... })`, depois de `setAdvertise`:

```javascript
  /** Força um novo ciclo de descoberta: fecha e reabre o socket UDP,
   * limpando salas conhecidas, e reanuncia a sala hospedada se havia uma
   * sendo anunciada. */
  refreshDiscovery: () => ipcRenderer.invoke('discovery:refresh'),
```

- [ ] **Step 4: Verificação manual**

Run: `npm start`

1. Criar uma sala com "Anunciar minha sala na rede" ligado (Configurações > Rede).
2. Em outra instância do app (ou outro processo), conferir que a sala aparece em "Ao vivo agora" com a contagem de pessoas correta.
3. Confirmar que a contagem muda quando um segundo peer entra/sai.

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/preload.js
git commit -m "feat: contagem de peers no beacon anunciado e IPC discovery:refresh"
```

---

## Task 4: Renderer — botão de refresh na lista de salas

**Files:**
- Modify: [src/renderer/index.html](../../../src/renderer/index.html)
- Modify: [src/renderer/style.css](../../../src/renderer/style.css)
- Modify: [src/renderer/app.js](../../../src/renderer/app.js)

**Interfaces:**
- Consumes: `window.golive.refreshDiscovery()` (Task 3).

- [ ] **Step 1: Adicionar o botão no HTML**

Em `src/renderer/index.html`, substituir a linha 20 (`<h2 class="rooms-title">Salas na rede</h2>`):

```html
    <h2 class="rooms-title">
      Salas na rede
      <button id="btn-refresh-discovery" class="icon-btn-inline" title="Atualizar lista de salas" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
      </button>
    </h2>
```

- [ ] **Step 2: Estilizar o botão e a animação de rotação**

Em `src/renderer/style.css`, modificar a regra `.rooms-title` (linha 100-106) e adicionar as regras novas logo depois:

```css
.rooms-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.9px;
  color: var(--muted);
  padding: 16px 16px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.icon-btn-inline {
  width: 22px; height: 22px;
  padding: 0;
  background: transparent;
  color: var(--muted);
  border-radius: 4px;
  display: grid;
  place-items: center;
}
.icon-btn-inline svg { width: 14px; height: 14px; }
.icon-btn-inline:hover { background: var(--bg-inset); color: var(--text); }
.icon-btn-inline.spin svg { animation: spin 600ms linear; }
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 3: Ligar o clique**

Em `src/renderer/app.js`, adicionar logo após o bloco `window.golive.onRoomsDiscovered(...)` (linha 121-124):

```javascript
  $('btn-refresh-discovery').addEventListener('click', () => {
    const btn = $('btn-refresh-discovery');
    btn.classList.remove('spin');
    void btn.offsetWidth; // força reflow pra reiniciar a animacao mesmo se clicado de novo dentro dos 600ms
    btn.classList.add('spin');
    window.golive.refreshDiscovery();
  });
```

- [ ] **Step 4: Verificação manual**

Run: `npm start`

1. Clicar no ícone de refresh ao lado de "Salas na rede" — o ícone deve girar por ~600ms.
2. Clicar duas vezes rápido — a animação deve reiniciar sem travar.
3. Com uma sala anunciada em outra instância, confirmar que ela reaparece na lista logo após o refresh.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.html src/renderer/style.css src/renderer/app.js
git commit -m "feat: botao de refresh na lista de salas"
```

---

## Task 5: Renderer — módulo de sons de entrada/saída

**Files:**
- Create: [src/renderer/sound.js](../../../src/renderer/sound.js)
- Modify: [src/renderer/index.html](../../../src/renderer/index.html)

**Interfaces:**
- Produces: `window.GoLive.sound.playJoinSound()`, `window.GoLive.sound.playLeaveSound()`.

- [ ] **Step 1: Criar o módulo**

Criar `src/renderer/sound.js`:

```javascript
// src/renderer/sound.js
'use strict';

(function (root) {
  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freqFrom, freqTo) {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const duration = 0.12;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqFrom, now);
    osc.frequency.linearRampToValueAtTime(freqTo, now + duration);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  function playJoinSound() {
    playTone(440, 660);
  }

  function playLeaveSound() {
    playTone(660, 440);
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.sound = { playJoinSound, playLeaveSound };
})(window);
```

- [ ] **Step 2: Carregar o script antes de `app.js`**

Em `src/renderer/index.html`, adicionar a linha entre `ui.js` e `app.js` (linha 123-127):

```html
<script src="config.js"></script>
<script src="signaling.js"></script>
<script src="mesh.js"></script>
<script src="ui.js"></script>
<script src="sound.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 3: Verificação manual**

Run: `npm start`, abrir DevTools (Ctrl+Shift+I) e no console rodar:

```javascript
window.GoLive.sound.playJoinSound()
window.GoLive.sound.playLeaveSound()
```

Expected: dois bipes curtos e distintos (um subindo, um descendo), sem estalo perceptível no início/fim.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/sound.js src/renderer/index.html
git commit -m "feat: modulo de sons de entrada e saida de sala"
```

---

## Task 6: Renderer — cooldown de 2s e sons ligados às transições de sala

**Files:**
- Modify: [src/renderer/app.js](../../../src/renderer/app.js)
- Modify: [src/renderer/ui.js](../../../src/renderer/ui.js)
- Modify: [src/renderer/style.css](../../../src/renderer/style.css)

**Interfaces:**
- Consumes: `window.GoLive.sound` (Task 5).
- Produces: `ui.rooms.render(rooms, { ..., isOnCooldown })` — novo campo opcional `isOnCooldown(address): boolean` repassado aos dois `fillRoomList`.

- [ ] **Step 1: `ui.js` — aceitar e aplicar `isOnCooldown`**

Em `src/renderer/ui.js`, modificar a assinatura de `fillRoomList` (linha 67) e o corpo do botão de conectar (linha 89-96):

```javascript
  function fillRoomList(listEl, rooms, { onSelect, onDelete, activeAddress, emptyMessage, isOnCooldown }) {
    listEl.innerHTML = '';
    if (!rooms.length) {
      if (emptyMessage) listEl.innerHTML = `<li class="muted" style="padding:8px 10px;">${escapeHtml(emptyMessage)}</li>`;
      return;
    }
    for (const room of rooms) {
      const isActive = activeAddress && room.address === activeAddress;
      const onCooldown = !isActive && !!isOnCooldown && isOnCooldown(room.address);
      const li = document.createElement('li');
      li.className = 'room-row';
      if (isActive) li.classList.add('active');

      const info = document.createElement('div');
      info.className = 'room-info';
      info.innerHTML = `
        <span class="dot ${isActive ? 'ok' : ''}"></span>
        <span class="room-item-text">
          <span class="room-name">${escapeHtml(room.name || room.hostName || 'sala')}</span>
          <span class="room-meta">${room.peers != null ? `${escapeHtml(String(room.peers))} pessoa(s)` : escapeHtml(room.address)}</span>
        </span>`;
      li.appendChild(info);

      const connectBtn = document.createElement('button');
      connectBtn.className = 'room-connect';
      connectBtn.type = 'button';
      connectBtn.title = isActive ? 'Já conectado nessa sala' : 'Conectar nessa sala';
      connectBtn.disabled = isActive || onCooldown;
      if (onCooldown) connectBtn.classList.add('cooldown');
      connectBtn.innerHTML = isActive ? CONNECTED_ICON : CONNECT_ICON;
      connectBtn.addEventListener('click', () => onSelect(room));
      li.appendChild(connectBtn);

      if (onDelete) {
        const del = document.createElement('button');
        del.className = 'room-delete';
        del.type = 'button';
        del.title = 'Remover sala da lista';
        del.innerHTML = TRASH_ICON;
        del.addEventListener('click', () => onDelete(room));
        li.appendChild(del);
      }

      listEl.appendChild(li);
    }
  }
```

E `renderRooms` (linha 117-126), repassando `isOnCooldown`:

```javascript
  function renderRooms(rooms, { onSelect, onDelete, activeAddress, liveRooms = [], isOnCooldown }) {
    roomsLiveTitleEl.classList.toggle('hidden', !liveRooms.length);
    fillRoomList(roomListLiveEl, liveRooms, { onSelect, activeAddress, isOnCooldown });
    fillRoomList(roomListEl, rooms, {
      onSelect,
      onDelete,
      activeAddress,
      isOnCooldown,
      emptyMessage: 'nenhuma sala salva ainda — crie uma ou entre por endereço',
    });
  }
```

- [ ] **Step 2: CSS pro estado de cooldown**

Em `src/renderer/style.css`, adicionar depois da linha `.room-connect:disabled { color: var(--good); cursor: default; opacity: 1; }` (linha 161):

```css
.room-connect.cooldown { opacity: .35; cursor: not-allowed; }
```

E depois da regra `#btn-disconnect svg { ... }` (linha 239):

```css
#btn-disconnect:disabled { opacity: .5; cursor: not-allowed; }
```

- [ ] **Step 3: `app.js` — estado de cooldown, sons e disparo dos re-renders**

Trocar a desestruturação do topo do arquivo (linha 5):

```javascript
  const { config, signaling, mesh: meshModule, ui, sound } = window.GoLive;
```

Adicionar, junto às outras variáveis module-level (depois da linha 27, `let discoveredRooms = [];`):

```javascript
  // Cooldown de 2s pra entrar/sair da mesma sala repetidamente: endereco ->
  // timestamp da ultima transicao (entrada ou saida).
  const roomCooldowns = new Map();

  function cooldownRemaining(address) {
    if (!address) return 0;
    const last = roomCooldowns.get(address);
    if (last == null) return 0;
    return Math.max(0, 2000 - (Date.now() - last));
  }

  function markCooldown(address) {
    if (!address) return;
    roomCooldowns.set(address, Date.now());
    setTimeout(() => {
      renderRoomList();
      updateDisconnectButtonState();
    }, 2000);
  }

  function updateDisconnectButtonState() {
    const btn = $('btn-disconnect');
    btn.disabled = !!activeRoomAddress && cooldownRemaining(activeRoomAddress) > 0;
  }
```

Modificar `renderRoomList` (linha 99-116) pra passar `isOnCooldown` e checar cooldown antes de conectar:

```javascript
  function renderRoomList() {
    ui.rooms.render(cfg.recentRooms, {
      activeAddress: activeRoomAddress,
      liveRooms: discoveredRooms,
      isOnCooldown: (address) => cooldownRemaining(address) > 0,
      onSelect: (room) => {
        if (room.address === activeRoomAddress) return; // já conectado nessa sala
        if (cooldownRemaining(room.address) > 0) return;
        hostInfo = null;
        renderHostWarning();
        joinRoom(room.address, cfg.name);
      },
      onDelete: (room) => {
        if (room.address === activeRoomAddress) leaveRoom();
        cfg = config.removeRecentRoom(cfg, room.address);
        persist();
        renderRoomList();
      },
    });
  }
```

No `onOpen` de `joinRoom` (linha 268-277), adicionar cooldown e som depois que `activeRoomAddress` é definido:

```javascript
        onOpen: () => {
          if (currentSession !== session) return;
          activeRoomAddress = publicAddress || url;
          cfg = config.addRecentRoom(cfg, { address: publicAddress || url, name: `sala de ${name || 'anônimo'}` });
          persist();
          markCooldown(activeRoomAddress);
          updateDisconnectButtonState();
          renderRoomList();
          session.sig.send({ type: 'join', room: 'geral', name: name || 'anônimo' });
          ui.stageHeader.set({ name: `sala de ${name || 'anônimo'}`, address: publicAddress || url });
          sound.playJoinSound();
          onSettled?.();
        },
```

Modificar `leaveRoom` (linha 329-340) pra checar cooldown no botão, tocar o som no início e marcar cooldown ao final:

```javascript
  function leaveRoom() {
    if (!currentSession) return;
    if (cooldownRemaining(activeRoomAddress) > 0) return;
    sound.playLeaveSound();
    const session = currentSession;
    const leavingAddress = activeRoomAddress;
    currentSession = null;
    activeRoomAddress = null;
    hostInfo = null;
    session.sig?.close();
    ui.stageHeader.clear();
    renderHostWarning();
    teardownSession(session);
    renderRoomList();
    markCooldown(leavingAddress);
  }
```

Em `handleSignal` (linha 343-390), adicionar som no `case 'peer-joined'` (linha 354-359) e no `case 'peer-left'` (linha 360-365):

```javascript
      case 'peer-joined': {
        mesh.addPeer(msg.id, msg.name);
        ui.members.render(mesh.peers);
        sound.playJoinSound();
        if (localStream) await mesh.offerTo(msg.id, localStream, cfg.quality);
        break;
      }
      case 'peer-left': {
        mesh.removePeer(msg.id);
        ui.grid.removeTile(msg.id, emptyMessage());
        ui.members.render(mesh.peers);
        sound.playLeaveSound();
        break;
      }
```

- [ ] **Step 4: Verificação manual**

Run: `npm start` com dois clientes (duas instâncias, ou uma janela + uma segunda instância do app) conectados na mesma sala.

1. Conectar num cliente — o outro deve tocar o som de entrada e ver o peer aparecer.
2. Desconectar — o outro cliente deve tocar o som de saída.
3. No mesmo cliente, tentar clicar duas vezes seguidas pra entrar/sair da mesma sala dentro de 2s — a segunda tentativa deve ser ignorada, e a linha da sala (ou o botão Desconectar) deve aparecer visualmente esmaecida/desabilitada até o cooldown passar.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/app.js src/renderer/ui.js src/renderer/style.css
git commit -m "feat: sons de entrada/saida e cooldown de 2s pra entrar/sair de sala"
```

---

## Task 7: Renderer — captura e armazenamento da foto de perfil

**Files:**
- Modify: [src/renderer/config.js](../../../src/renderer/config.js)
- Modify: [src/renderer/index.html](../../../src/renderer/index.html)
- Modify: [src/renderer/style.css](../../../src/renderer/style.css)
- Modify: [src/renderer/app.js](../../../src/renderer/app.js)

**Interfaces:**
- Produces: `cfg.avatar: string | null` (data URL JPEG, persistido em `localStorage` igual a `cfg.name`).

- [ ] **Step 1: `config.js` — novo campo `avatar`**

Em `src/renderer/config.js`, adicionar `avatar: null,` em `DEFAULTS` (depois da linha 5, `name: '',`):

```javascript
  const DEFAULTS = {
    v: 1,
    name: '',
    avatar: null,
    quality: {
```

E em `load()` (linha 47-54), adicionar o campo:

```javascript
    return {
      v: 1,
      name: typeof parsed.name === 'string' ? parsed.name : DEFAULTS.name,
      avatar: typeof parsed.avatar === 'string' ? parsed.avatar : DEFAULTS.avatar,
      quality: mergeSection(DEFAULTS.quality, parsed.quality),
      camera: mergeSection(DEFAULTS.camera, parsed.camera),
      network: mergeSection(DEFAULTS.network, parsed.network),
      recentRooms: Array.isArray(parsed.recentRooms) ? parsed.recentRooms : [],
    };
```

- [ ] **Step 2: `index.html` — avatar clicável no painel do usuário e liberar `blob:` no CSP**

Trocar o CSP (linha 5-6) pra liberar `blob:` no `img-src` (necessário pra carregar o arquivo escolhido antes de desenhar no canvas):

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:" />
```

Trocar o `.user-panel` (linha 42-55):

```html
    <div class="user-panel">
      <button id="user-panel-avatar" class="user-avatar" type="button" title="Alterar foto de perfil">
        <img id="user-panel-avatar-img" class="hidden" alt="" />
        <span id="user-panel-avatar-fallback"></span>
      </button>
      <input id="user-panel-avatar-input" type="file" accept="image/*" class="hidden" />
      <input id="user-panel-name" class="user-panel-name" type="text" placeholder="seu apelido" spellcheck="false" title="Clique para editar seu apelido" />
      <div class="user-panel-actions">
        <button id="btn-toggle-camera" class="icon-btn" title="Câmera" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
        </button>
        <button id="btn-toggle-share" class="icon-btn" title="Compartilhar tela" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        </button>
        <button id="btn-open-settings" class="icon-btn" title="Configurações" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
    </div>
```

- [ ] **Step 3: CSS do avatar do painel**

Em `src/renderer/style.css`, adicionar depois de `.user-panel { ... }` (linha 171-178):

```css
.user-avatar {
  width: 32px; height: 32px;
  padding: 0;
  border-radius: 50%;
  overflow: hidden;
  background: var(--accent);
  display: grid;
  place-items: center;
  flex: none;
}
.user-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
#user-panel-avatar-fallback { font-weight: 700; font-size: 13px; color: #fff; }
```

- [ ] **Step 4: `app.js` — captura, redimensionamento e persistência**

Adicionar as referências de elementos junto a `nameInput` (linha 41):

```javascript
  const nameInput = $('user-panel-name');
  const avatarBtn = $('user-panel-avatar');
  const avatarInput = $('user-panel-avatar-input');
  const avatarImg = $('user-panel-avatar-img');
  const avatarFallback = $('user-panel-avatar-fallback');
```

Modificar `renderUserPanel` (linha 43-46):

```javascript
  function renderUserPanel() {
    nameInput.value = cfg.name || '';
    if (cfg.avatar) {
      avatarImg.src = cfg.avatar;
      avatarImg.classList.remove('hidden');
      avatarFallback.textContent = '';
    } else {
      avatarImg.classList.add('hidden');
      avatarImg.src = '';
      avatarFallback.textContent = (cfg.name || '?').trim().charAt(0).toUpperCase() || '?';
    }
  }
  renderUserPanel();
```

Adicionar, logo depois do bloco `nameInput.addEventListener('keydown', ...)` (linha 55-63):

```javascript
  avatarBtn.addEventListener('click', () => avatarInput.click());

  function resizeImageToAvatar(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('load failed'));
      };
      img.src = url;
    });
  }

  avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files[0];
    avatarInput.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert('Imagem muito grande (máx. 10MB).');
      return;
    }
    try {
      const dataUrl = await resizeImageToAvatar(file);
      cfg = { ...cfg, avatar: dataUrl };
      persist();
      renderUserPanel();
    } catch {
      alert('Não consegui processar essa imagem.');
    }
  });
```

- [ ] **Step 5: Verificação manual**

Run: `npm start`

1. Sem avatar definido, conferir que aparece a inicial do apelido sobre fundo colorido.
2. Clicar no círculo do avatar, escolher uma imagem — deve aparecer recortada em círculo, cover-fit.
3. Fechar e reabrir o app — o avatar deve persistir (via `localStorage`).
4. Tentar selecionar um arquivo > 10MB — deve mostrar alerta e não travar a UI.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/config.js src/renderer/index.html src/renderer/style.css src/renderer/app.js
git commit -m "feat: captura e armazenamento de foto de perfil"
```

---

## Task 8: Renderer — transmissão do avatar entre peers

**Files:**
- Modify: [src/renderer/mesh.js](../../../src/renderer/mesh.js)
- Modify: [src/renderer/app.js](../../../src/renderer/app.js)

**Interfaces:**
- Consumes: `cfg.avatar` (Task 7), `msg.avatar` no protocolo de sinalização (Task 1).
- Produces: `mesh.addPeer(id, name, avatar?)` — entradas de `peers` ganham `avatar: string | null`.

- [ ] **Step 1: `mesh.js` — `addPeer` aceita e preserva `avatar`**

Em `src/renderer/mesh.js`, substituir `addPeer` (linha 9-12):

```javascript
    function addPeer(id, name, avatar) {
      if (!peers.has(id)) {
        peers.set(id, { id, name, avatar: avatar || null, live: false, outConn: null, inConn: null });
      } else if (avatar) {
        peers.get(id).avatar = avatar;
      }
      return peers.get(id);
    }
```

- [ ] **Step 2: `app.js` — enviar o avatar no `join` e repassar nos eventos de entrada**

No `onOpen` de `joinRoom` (dentro de `session.sig.send({ type: 'join', ... })`, editado na Task 6 — linha equivalente a 274 antes das mudanças de cooldown):

```javascript
          session.sig.send({ type: 'join', room: 'geral', name: name || 'anônimo', avatar: cfg.avatar || null });
```

Em `handleSignal`, `case 'welcome'` (linha 348-353):

```javascript
      case 'welcome': {
        myId = msg.id;
        for (const p of msg.peers) mesh.addPeer(p.id, p.name, p.avatar);
        ui.members.render(mesh.peers);
        break;
      }
```

E `case 'peer-joined'` (editado na Task 6, chamada `mesh.addPeer`):

```javascript
      case 'peer-joined': {
        mesh.addPeer(msg.id, msg.name, msg.avatar);
        ui.members.render(mesh.peers);
        sound.playJoinSound();
        if (localStream) await mesh.offerTo(msg.id, localStream, cfg.quality);
        break;
      }
```

- [ ] **Step 3: Verificação manual**

Run: `npm start` com dois clientes, um deles com avatar já configurado (Task 7).

1. Cliente com avatar entra na sala — o outro cliente deve ver `peer.avatar` populado (inspecionar via DevTools: `window.GoLive` não expõe `mesh` diretamente hoje, então validar via o resultado visual da Task 9 depois de implementada, ou temporariamente logar `mesh.peers` no console).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/mesh.js src/renderer/app.js
git commit -m "feat: avatar trafega entre peers via join/welcome/peer-joined"
```

---

## Task 9: Renderer — exibição do avatar na lista de membros

**Files:**
- Modify: [src/renderer/ui.js](../../../src/renderer/ui.js)
- Modify: [src/renderer/style.css](../../../src/renderer/style.css)

**Interfaces:**
- Consumes: `peer.avatar` (Task 8).

- [ ] **Step 1: `ui.js` — paleta de cores e hash simples**

Em `src/renderer/ui.js`, adicionar antes de `renderMembers` (linha 43):

```javascript
  const AVATAR_PALETTE = ['#f23f42', '#f0b232', '#23a55a', '#5865f2', '#eb459e', '#00a8fc'];

  function avatarColorFor(id) {
    const str = String(id);
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  }
```

- [ ] **Step 2: `renderMembers` — avatar com borda de status em vez do `.dot`**

Substituir `renderMembers` (linha 43-58):

```javascript
  function renderMembers(peers) {
    peerListEl.innerHTML = '';
    if (!peers.size) {
      peerListEl.innerHTML = '<li class="muted">só você por aqui</li>';
      return;
    }
    for (const peer of peers.values()) {
      const li = document.createElement('li');
      const state = peer.inConn?.connectionState || peer.outConn?.connectionState;
      const borderClass = state === 'connected' ? 'ok' : state ? 'warn' : '';
      const initial = escapeHtml((peer.name || '?').trim().charAt(0).toUpperCase() || '?');
      const avatarInner = peer.avatar
        ? `<img src="${escapeHtml(peer.avatar)}" alt="" />`
        : `<span class="peer-avatar-fallback" style="background:${avatarColorFor(peer.id)}">${initial}</span>`;
      li.innerHTML = `
        <span class="peer-avatar ${borderClass}">${avatarInner}</span>
        ${escapeHtml(peer.name)}
        ${peer.live ? '<em>AO VIVO</em>' : ''}`;
      peerListEl.appendChild(li);
    }
  }
```

- [ ] **Step 3: CSS do avatar na lista de membros**

Em `src/renderer/style.css`, adicionar depois de `.peer-list .muted { color: var(--muted); border: none; }` (linha 219):

```css
.peer-avatar {
  width: 26px; height: 26px;
  flex: none;
  border-radius: 50%;
  border: 2px solid transparent;
  overflow: hidden;
  display: grid;
  place-items: center;
}
.peer-avatar.ok { border-color: var(--good); }
.peer-avatar.warn { border-color: var(--warn); }
.peer-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.peer-avatar-fallback { width: 100%; height: 100%; display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 11px; }
```

- [ ] **Step 4: Verificação manual**

Run: `npm start` com dois clientes, um deles com avatar configurado (Task 7) e o outro sem.

1. Peer sem avatar aparece na lista de membros do outro cliente com a inicial do nome sobre fundo colorido consistente (mesma cor a cada render, baseada no `id`).
2. Peer com avatar aparece com a foto recortada em círculo.
3. Borda ao redor do avatar fica verde quando a conexão está `connected`, laranja durante `connecting`, sem borda quando parado — confirmar junto com o fluxo de compartilhar tela (que dispara a negociação WebRTC).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ui.js src/renderer/style.css
git commit -m "feat: avatar com borda de status na lista de membros"
```

---

## Task 10: Renderer — botão de expandir tela cheia no tile

**Files:**
- Modify: [src/renderer/ui.js](../../../src/renderer/ui.js)
- Modify: [src/renderer/style.css](../../../src/renderer/style.css)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: nenhuma API nova — comportamento puramente de DOM, reaproveita a classe `fullscreen` que o duplo-clique já alterna.

Pedido fora da spec original (2026-08-19-salas-vivas-design.md), adicionado diretamente pelo usuário nesta sessão. O `dblclick` que já alterna `.fullscreen` (linha 24 de `ui.js`) continua funcionando — o botão é só um atalho visível, útil porque duplo-clique não é descobrível.

- [ ] **Step 1: Adicionar o botão na criação do tile**

Em `src/renderer/ui.js`, dentro de `showTile` (linha 15-32), alterar o bloco de criação do tile:

```javascript
  function showTile(id, label, stream, muted = false) {
    gridEl.querySelector('.empty')?.remove();

    let tile = document.getElementById(`tile-${id}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'tile';
      tile.id = `tile-${id}`;
      tile.innerHTML = `
        <video autoplay playsinline></video>
        <span class="tile-label"></span>
        <button class="tile-fullscreen-btn" type="button" title="Tela cheia">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
        </button>`;
      tile.addEventListener('dblclick', () => tile.classList.toggle('fullscreen'));
      tile.querySelector('.tile-fullscreen-btn').addEventListener('click', (event) => {
        event.stopPropagation();
        tile.classList.toggle('fullscreen');
      });
      gridEl.appendChild(tile);
    }

    const video = tile.querySelector('video');
    if (video.srcObject !== stream) video.srcObject = stream;
    video.muted = muted;
    tile.querySelector('.tile-label').textContent = label;
  }
```

- [ ] **Step 2: CSS do botão**

Em `src/renderer/style.css`, adicionar depois de `.tile.fullscreen { ... }` (linha 279):

```css
.tile-fullscreen-btn {
  position: absolute;
  top: 10px; right: 10px;
  width: 30px; height: 30px;
  padding: 0;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  border-radius: 6px;
  display: grid;
  place-items: center;
  opacity: 0;
  transition: opacity 0.12s;
}
.tile-fullscreen-btn svg { width: 16px; height: 16px; }
.tile:hover .tile-fullscreen-btn { opacity: 1; }
.tile-fullscreen-btn:hover { background: rgba(0, 0, 0, 0.85); }
.tile.fullscreen .tile-fullscreen-btn { top: 16px; right: 16px; }
```

- [ ] **Step 3: Verificação manual**

Run: `npm start`, entrar numa sala com alguém transmitindo (ou compartilhar a própria tela).

1. Passar o mouse sobre um tile — o botão de tela cheia deve aparecer no canto superior direito, junto com o label.
2. Clicar nele — o tile deve expandir pra tela cheia (mesmo efeito do duplo-clique).
3. Clicar de novo — deve voltar ao tamanho normal no grid.
4. Confirmar que duplo-clique continua funcionando também.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/ui.js src/renderer/style.css
git commit -m "feat: botao de tela cheia nos tiles de video"
```

---

## Task 11: Renderer — menu de silenciar e volume (0%-200%) no botão direito do tile

**Files:**
- Modify: [src/renderer/ui.js](../../../src/renderer/ui.js)
- Modify: [src/renderer/style.css](../../../src/renderer/style.css)

**Interfaces:**
- Consumes: nada de tasks anteriores (independente de Task 10, mas edita o mesmo `showTile`/`removeTile`).
- Produces: nenhuma API pública nova — estado de volume/mute é interno a `ui.js`, por `peerId`, e não persiste entre reconexões.

Pedido fora da spec original, adicionado diretamente pelo usuário nesta sessão. Escopo: aplica-se só aos tiles remotos (qualquer `id` diferente de `'me'`/`'cam-me'` — as próprias prévias locais já tocam mudas, não fazem sentido ter controle de volume). Como `<video>` só aceita volume nativo de 0% a 100%, pra chegar a 200% o áudio do tile passa a sair por um grafo Web Audio (`MediaStreamAudioSourceNode` → `GainNode` → destino) em vez do elemento `<video>` — por isso o vídeo remoto fica `muted=true` permanentemente e o som real é controlado pelo `gain.value` (0 a 2).

- [ ] **Step 1: Estado de áudio por tile e helpers de grafo Web Audio**

Em `src/renderer/ui.js`, adicionar antes de `showTile` (linha 15):

```javascript
  // Volume/mute por tile remoto, roteado via Web Audio pra poder passar de
  // 100% (o <video> nativo so vai ate 1.0) -- ver Step 3 do Task 11 do plano
  // de implementacao pra contexto completo.
  let playbackAudioCtx = null;
  function getPlaybackAudioContext() {
    if (!playbackAudioCtx) playbackAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return playbackAudioCtx;
  }

  const tileAudio = new Map(); // id -> { volume, muted, source, gain }

  function getOrCreateAudioState(id) {
    let state = tileAudio.get(id);
    if (!state) {
      state = { volume: 1, muted: false, source: null, gain: null };
      tileAudio.set(id, state);
    }
    return state;
  }

  function ensureTileAudio(id, video, stream) {
    if (id === 'me' || id === 'cam-me') return;
    video.muted = true;
    const state = getOrCreateAudioState(id);
    const ctx = getPlaybackAudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (state.source) {
      try { state.source.disconnect(); } catch { /* ja desconectado */ }
    }
    state.source = ctx.createMediaStreamSource(stream);
    if (!state.gain) state.gain = ctx.createGain();
    state.gain.gain.value = state.muted ? 0 : state.volume;
    state.source.connect(state.gain).connect(ctx.destination);
  }

  function releaseTileAudio(id) {
    const state = tileAudio.get(id);
    if (!state) return;
    try { state.source?.disconnect(); } catch { /* ja desconectado */ }
    try { state.gain?.disconnect(); } catch { /* ja desconectado */ }
    tileAudio.delete(id);
  }
```

- [ ] **Step 2: Ligar `ensureTileAudio`/`releaseTileAudio` ao ciclo de vida do tile**

Em `showTile`, dentro do bloco `if (!tile) { ... }` (a versão já modificada pela Task 10), adicionar o listener de `contextmenu` (só pra tiles remotos):

```javascript
      if (id !== 'me' && id !== 'cam-me') {
        tile.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          openTileMenu(id, event.clientX, event.clientY);
        });
      }
```

Substituir o trecho final de `showTile` — a ordem importa: `video.muted = muted;` roda ANTES de `ensureTileAudio`, porque em tiles remotos `ensureTileAudio` precisa ser a última a mexer em `video.muted` (força `true` pra silenciar o elemento e deixar o áudio real sair só pelo `GainNode`; se `video.muted = muted` rodasse depois, o valor default `false` passado pros tiles remotos desfaria essa força):

```javascript
    const video = tile.querySelector('video');
    video.muted = muted;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      ensureTileAudio(id, video, stream);
    }
    tile.querySelector('.tile-label').textContent = label;
```

Em `removeTile` (linha 34-39), liberar o grafo de áudio:

```javascript
  function removeTile(id, emptyMessage) {
    document.getElementById(`tile-${id}`)?.remove();
    releaseTileAudio(id);
    if (!gridEl.children.length) {
      gridEl.innerHTML = `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
    }
  }
```

- [ ] **Step 3: Menu flutuante de silenciar/volume**

Em `src/renderer/ui.js`, adicionar (perto das outras funções de tile, antes do bloco `root.GoLive = ...` final):

```javascript
  let openMenuEl = null;

  function closeTileMenu() {
    openMenuEl?.remove();
    openMenuEl = null;
    document.removeEventListener('click', closeTileMenu, true);
  }

  function openTileMenu(id, x, y) {
    closeTileMenu();
    const state = getOrCreateAudioState(id);

    const menu = document.createElement('div');
    menu.className = 'tile-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.innerHTML = `
      <button class="tile-menu-mute" type="button">${state.muted ? 'Reativar som' : 'Silenciar'}</button>
      <label class="tile-menu-volume">
        <span>Volume: <b class="tile-menu-volume-label">${Math.round(state.volume * 100)}%</b></span>
        <input type="range" min="0" max="200" step="1" value="${Math.round(state.volume * 100)}" />
      </label>`;
    menu.addEventListener('click', (event) => event.stopPropagation());
    document.body.appendChild(menu);
    openMenuEl = menu;

    function applyGain() {
      if (state.gain) state.gain.gain.value = state.muted ? 0 : state.volume;
    }

    const muteBtn = menu.querySelector('.tile-menu-mute');
    muteBtn.addEventListener('click', () => {
      state.muted = !state.muted;
      muteBtn.textContent = state.muted ? 'Reativar som' : 'Silenciar';
      applyGain();
    });

    const range = menu.querySelector('input[type=range]');
    const volumeLabel = menu.querySelector('.tile-menu-volume-label');
    range.addEventListener('input', () => {
      state.volume = Number(range.value) / 100;
      volumeLabel.textContent = `${range.value}%`;
      applyGain();
    });

    setTimeout(() => document.addEventListener('click', closeTileMenu, true), 0);
  }
```

- [ ] **Step 4: CSS do menu**

Em `src/renderer/style.css`, adicionar depois das regras da Task 10 (`.tile-fullscreen-btn...`):

```css
.tile-menu {
  position: fixed;
  z-index: 60;
  background: var(--bg-panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 10px;
  min-width: 200px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tile-menu-mute { width: 100%; }
.tile-menu-volume { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--muted); }
.tile-menu-volume input[type="range"] { width: 100%; }
```

- [ ] **Step 5: Verificação manual**

Run: `npm start` com dois clientes, um transmitindo tela/câmera pro outro.

1. No cliente que recebe, clicar com o botão direito no tile remoto — deve abrir o menu com "Silenciar" e o slider de volume, perto do cursor, sem abrir o menu de contexto padrão do Electron/Chromium.
2. Mover o slider acima de 100% — o áudio deve ficar perceptivelmente mais alto que o volume original do sistema (confirma que está passando pelo `GainNode`, não só o volume nativo do `<video>` que trava em 100%).
3. Clicar em "Silenciar" — áudio para; o texto muda pra "Reativar som"; clicar de novo restaura o volume anterior (não volta pra 100% fixo).
4. Clicar fora do menu — ele fecha. Abrir de novo em outro tile — o menu antigo deve ter sumido (só um aberto por vez).
5. O peer sair da sala e voltar a entrar — abrir o menu de novo deve mostrar o volume resetado em 100% (estado não persiste entre reconexões — comportamento esperado, fora de escopo persistir).
6. Confirmar que tiles locais (`me`, `cam-me`, a própria prévia) não abrem esse menu no botão direito (mostram o menu padrão do sistema, sem problema, já que são só prévia local).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/ui.js src/renderer/style.css
git commit -m "feat: menu de silenciar e volume 0-200% no botao direito dos tiles remotos"
```

---

## Cobertura da spec (auto-revisão)

1. Contagem de pessoas → Task 1 (`getPeerCount`), Task 2 (beacon `peers`), Task 3 (wiring). `ui.js` já lia `room.peers` antes deste plano — confirmado no código atual, nenhuma mudança necessária aí.
2. Botão de refresh → Task 2 (socket reiniciável + `isAdvertising`), Task 3 (IPC + preload), Task 4 (UI).
3 & 4. Sons + cooldown → Task 5 (módulo de som), Task 6 (cooldown, wiring dos 4 pontos de som, UI de estado desabilitado).
5. Fotos de perfil → Task 7 (captura/armazenamento), Task 8 (transmissão), Task 9 (exibição).
Testes → Task 1 e Task 2 cobrem os módulos com `node:test`; tasks de renderer têm passo de verificação manual explícito, conforme a spec já apontava (sem framework de teste de renderer no projeto).
Fora de escopo (avatar em tiles de vídeo, cache de avatar remoto entre sessões, volume configurável) → nenhuma task implementa isso, intencionalmente.

Adicionado nesta sessão, fora da spec original: botão de tela cheia por tile (Task 10) e menu de silenciar/volume 0-200% no botão direito de tiles remotos (Task 11).
