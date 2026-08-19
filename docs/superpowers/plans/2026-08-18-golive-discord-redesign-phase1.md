# GoLive Discord Redesign — Fase 1 (Interface) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reformular a interface do GoLive LAN pro layout de três colunas + trilho do Discord, mover os controles de qualidade pra um modal de Configurações, e trocar o checkbox fixo de áudio por uma escolha feita no momento de compartilhar a tela.

**Architecture:** `src/renderer/app.js` (686 linhas) é dividido em cinco módulos carregados como `<script>` sem bundler: `config.js` (config/localStorage, puro, testável), `signaling.js` (WebSocket), `mesh.js` (RTCPeerConnection, tracks, stats), `ui.js` (DOM: grade, membros, salas, modais) e `app.js` (inicialização e wiring). Cada módulo se expõe em `window.GoLive.<nome>`. A malha WebRTC em si (ofertas, ICE, tracks) não muda de comportamento nesta fase — só muda de arquivo e ganha o modo de áudio no lugar do booleano.

**Tech Stack:** Electron (sem bundler), `node --test` + `node:assert/strict` pros módulos puros, CSS custom properties.

## Global Constraints

- Sem bundler, sem passo de build: scripts carregados via `<script>` na ordem de dependência (`config.js`, `signaling.js`, `mesh.js`, `ui.js`, `app.js`).
- Cada módulo se expõe como `window.GoLive.<nome>` dentro de uma IIFE.
- `config.js` termina com `if (typeof module !== 'undefined') module.exports = ...` pra rodar em `node --test`.
- Paleta: `--bg-app: #313338`, `--bg-panel: #2b2d31`, `--bg-rail: #1e1f22`, `--accent: #5865f2`, mais tokens de texto/borda a definir na Task 4. Nenhum asset/ícone/fonte do Discord é copiado — SVG inline próprio.
- `localStorage['golive']` passa a guardar `{ v: 1, name, quality: {...}, camera: {...}, network: {...}, recentRooms: [...] }`; leitura preenche campos ausentes com os padrões (instalação antiga não quebra).
- Modal de Configurações fecha com `Esc` ou clique fora; mudanças de qualidade se aplicam ao vivo (como o bitrate já faz).
- IPC `sources:select` passa a receber `{ id, audioMode }` em vez de `{ id, systemAudio }`, onde `audioMode` é `'none' | 'system' | 'device'`.
- Testes novos ficam em `src/renderer/config.test.js`, rodados por `npm test` (`node --test`).

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/renderer/config.js` | criar | defaults, leitura/escrita de `localStorage`, derivação de constraints de vídeo |
| `src/renderer/config.test.js` | criar | testes do módulo acima |
| `src/renderer/signaling.js` | criar | abrir WebSocket, enviar/rotear mensagens, callbacks de evento |
| `src/renderer/mesh.js` | criar | RTCPeerConnection (out/in), oferta, applyEncoding, stats |
| `src/renderer/ui.js` | criar | grade de vídeo, lista de membros, lista de salas, modal de Configurações, diálogo de compartilhar |
| `src/renderer/app.js` | reescrever | inicialização, liga config+signaling+mesh+ui |
| `src/renderer/index.html` | reescrever | markup de três colunas + trilho, modal de Configurações, diálogo de compartilhar com seletor de áudio |
| `src/renderer/style.css` | reescrever | tokens do tema, layout novo |
| `src/main.js` | modificar (linhas 66-80, 96-125) | `setDisplayMediaRequestHandler` e `sources:select` usam `audioMode` |
| `src/preload.js` | modificar (linha 13-14) | `selectSource(id, audioMode)` |

---

## Task 1: `config.js` — defaults, persistência versionada, constraints

**Files:**
- Create: `src/renderer/config.js`
- Test: `src/renderer/config.test.js`

**Interfaces:**
- Produces:
  - `GoLive.config.DEFAULTS` — objeto com a forma completa de configuração.
  - `GoLive.config.load(rawJson)` — `(string|null) -> ConfigObject`. Faz `JSON.parse` (ou usa `{}` se `rawJson` for `null`/inválido) e mescla com `DEFAULTS` campo a campo (merge raso por seção: `quality`, `camera`, `network`), preservando `recentRooms` como array.
  - `GoLive.config.serialize(configObject)` — `(ConfigObject) -> string`, sempre grava `v: 1`.
  - `GoLive.config.videoConstraints(qualityConfig)` — `(quality) -> MediaTrackConstraints` pra `getDisplayMedia`/`applyConstraints` (usa `qualityConfig.width/height/fps`).
  - `GoLive.config.cameraConstraints(cameraConfig)` — mesmo formato, pros valores de câmera (720p30 por padrão).
  - `GoLive.config.addRecentRoom(config, room)` — `(ConfigObject, {address, name}) -> ConfigObject` novo, com `room` no topo de `recentRooms`, deduplicado por `address`, limitado a 5.

**Steps:**

- [ ] **Step 1: Escrever os testes**

```js
// src/renderer/config.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, load, serialize, videoConstraints, cameraConstraints, addRecentRoom } = require('./config');

test('load com null devolve os defaults', () => {
  const cfg = load(null);
  assert.deepEqual(cfg, DEFAULTS);
});

test('load com JSON invalido devolve os defaults', () => {
  const cfg = load('{ nao é json');
  assert.deepEqual(cfg, DEFAULTS);
});

test('load preenche campos ausentes de uma config antiga', () => {
  const old = JSON.stringify({ server: 'ws://26.0.0.1:9000', name: 'Nicolas', hostName: 'Nicolas' });
  const cfg = load(old);
  assert.equal(cfg.name, 'Nicolas');
  assert.equal(cfg.v, 1);
  assert.deepEqual(cfg.quality, DEFAULTS.quality);
  assert.deepEqual(cfg.camera, DEFAULTS.camera);
  assert.deepEqual(cfg.recentRooms, []);
});

test('load preserva campos de uma config na v1 completa', () => {
  const full = serialize({
    ...DEFAULTS,
    name: 'Ana',
    quality: { ...DEFAULTS.quality, fps: 30 },
    recentRooms: [{ address: 'ws://26.0.0.1:9000', name: 'sala do Nicolas' }],
  });
  const cfg = load(full);
  assert.equal(cfg.name, 'Ana');
  assert.equal(cfg.quality.fps, 30);
  assert.equal(cfg.quality.width, DEFAULTS.quality.width);
  assert.deepEqual(cfg.recentRooms, [{ address: 'ws://26.0.0.1:9000', name: 'sala do Nicolas' }]);
});

test('serialize sempre grava v:1', () => {
  const json = serialize(DEFAULTS);
  assert.equal(JSON.parse(json).v, 1);
});

test('videoConstraints usa largura, altura e fps da qualidade', () => {
  const c = videoConstraints({ width: 1920, height: 1080, fps: 60 });
  assert.deepEqual(c, {
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
    frameRate: { ideal: 60, max: 60 },
  });
});

test('cameraConstraints usa a config de camera', () => {
  const c = cameraConstraints({ width: 1280, height: 720, fps: 30 });
  assert.deepEqual(c, {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, max: 30 },
  });
});

test('addRecentRoom poe a sala nova no topo', () => {
  let cfg = load(null);
  cfg = addRecentRoom(cfg, { address: 'ws://26.0.0.1:9000', name: 'sala A' });
  cfg = addRecentRoom(cfg, { address: 'ws://26.0.0.2:9000', name: 'sala B' });
  assert.deepEqual(cfg.recentRooms.map((r) => r.address), [
    'ws://26.0.0.2:9000',
    'ws://26.0.0.1:9000',
  ]);
});

test('addRecentRoom deduplica por endereco, movendo pro topo', () => {
  let cfg = load(null);
  cfg = addRecentRoom(cfg, { address: 'ws://26.0.0.1:9000', name: 'sala A' });
  cfg = addRecentRoom(cfg, { address: 'ws://26.0.0.2:9000', name: 'sala B' });
  cfg = addRecentRoom(cfg, { address: 'ws://26.0.0.1:9000', name: 'sala A renomeada' });
  assert.deepEqual(cfg.recentRooms, [
    { address: 'ws://26.0.0.1:9000', name: 'sala A renomeada' },
    { address: 'ws://26.0.0.2:9000', name: 'sala B' },
  ]);
});

test('addRecentRoom limita a 5 entradas', () => {
  let cfg = load(null);
  for (let i = 0; i < 7; i++) {
    cfg = addRecentRoom(cfg, { address: `ws://26.0.0.${i}:9000`, name: `sala ${i}` });
  }
  assert.equal(cfg.recentRooms.length, 5);
  assert.equal(cfg.recentRooms[0].address, 'ws://26.0.0.6:9000');
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- --test-name-pattern=""` (ou `node --test src/renderer/config.test.js`)
Expected: FAIL — `Cannot find module './config'`

- [ ] **Step 3: Implementar `config.js`**

```js
// src/renderer/config.js
'use strict';

(function (root) {
  const DEFAULTS = {
    v: 1,
    name: '',
    quality: {
      width: 1920,
      height: 1080,
      fps: 60,
      bitrate: 12_000_000,
      codec: 'video/H264',
    },
    camera: {
      width: 1280,
      height: 720,
      fps: 30,
      bitrate: 2_000_000,
    },
    network: {
      advertise: true,
    },
    recentRooms: [],
  };

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function mergeSection(defaults, incoming) {
    if (!isObject(incoming)) return { ...defaults };
    return { ...defaults, ...incoming };
  }

  function load(rawJson) {
    let parsed = {};
    if (typeof rawJson === 'string') {
      try {
        parsed = JSON.parse(rawJson);
        if (!isObject(parsed)) parsed = {};
      } catch {
        parsed = {};
      }
    }

    return {
      v: 1,
      name: typeof parsed.name === 'string' ? parsed.name : DEFAULTS.name,
      quality: mergeSection(DEFAULTS.quality, parsed.quality),
      camera: mergeSection(DEFAULTS.camera, parsed.camera),
      network: mergeSection(DEFAULTS.network, parsed.network),
      recentRooms: Array.isArray(parsed.recentRooms) ? parsed.recentRooms : [],
    };
  }

  function serialize(config) {
    return JSON.stringify({ ...config, v: 1 });
  }

  function toConstraints(section) {
    return {
      width: { ideal: section.width, max: section.width },
      height: { ideal: section.height, max: section.height },
      frameRate: { ideal: section.fps, max: section.fps },
    };
  }

  function videoConstraints(quality) {
    return toConstraints(quality);
  }

  function cameraConstraints(camera) {
    return toConstraints(camera);
  }

  function addRecentRoom(config, room) {
    const withoutDup = config.recentRooms.filter((r) => r.address !== room.address);
    const recentRooms = [room, ...withoutDup].slice(0, 5);
    return { ...config, recentRooms };
  }

  const api = { DEFAULTS, load, serialize, videoConstraints, cameraConstraints, addRecentRoom };

  root.GoLive = root.GoLive || {};
  root.GoLive.config = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test src/renderer/config.test.js`
Expected: PASS — todos os 10 testes verdes

- [ ] **Step 5: Commit**

```bash
git add src/renderer/config.js src/renderer/config.test.js
git commit -m "feat: config.js com defaults versionados e constraints de video"
```

---

## Task 2: `signaling.js` — WebSocket isolado do resto

**Files:**
- Create: `src/renderer/signaling.js`

**Interfaces:**
- Consumes: nada de outros módulos novos.
- Produces:
  - `GoLive.signaling.connect(url, { onOpen, onMessage, onError, onClose })` — `(string, handlers) -> Signaling`. Abre o `WebSocket`, liga os quatro handlers aos eventos correspondentes (`onMessage` recebe o objeto já com `JSON.parse` feito), devolve o objeto `Signaling`.
  - `Signaling.send(payload)` — serializa e envia se `readyState === WebSocket.OPEN`, senão não faz nada.
  - `Signaling.close()` — fecha o socket.
  - `Signaling.isOpen()` — `() -> boolean`.

- [ ] **Step 1: Implementar `signaling.js`**

Extraído 1:1 do que hoje é `ws`/`signal`/`connectTo` em `app.js:126-179`, sem mudança de comportamento — só isolamento em módulo:

```js
// src/renderer/signaling.js
'use strict';

(function (root) {
  function connect(url, { onOpen, onMessage, onError, onClose } = {}) {
    const ws = new WebSocket(url);

    ws.addEventListener('open', () => onOpen && onOpen());
    ws.addEventListener('message', (event) => {
      if (onMessage) onMessage(JSON.parse(event.data));
    });
    ws.addEventListener('error', () => onError && onError());
    ws.addEventListener('close', () => onClose && onClose());

    return {
      send(payload) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
      },
      close() {
        ws.close();
      },
      isOpen() {
        return ws.readyState === WebSocket.OPEN;
      },
    };
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.signaling = { connect };
})(window);
```

- [ ] **Step 2: Verificar manualmente**

Este módulo não tem lógica pura testável em `node --test` (depende de `WebSocket` do browser). A verificação acontece na Task 9, quando `app.js` liga tudo e a conexão real é testada à mão (host + join com duas instâncias).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/signaling.js
git commit -m "feat: extrai signaling.js do app.js"
```

---

## Task 3: `mesh.js` — RTCPeerConnections, tracks, encoding, stats

**Files:**
- Create: `src/renderer/mesh.js`

**Interfaces:**
- Consumes: `signaling.send(payload)` (Task 2), `config.videoConstraints`/`config.cameraConstraints` (Task 1) — passados por injeção, não por import direto (o módulo não assume que `GoLive.signaling` já existe; recebe `send` como argumento em `createMesh`).
- Produces: `GoLive.mesh.createMesh({ send, onTrack, onPeerState })` — `(deps) -> Mesh`, com:
  - `Mesh.addPeer(id, name)`
  - `Mesh.removePeer(id)` — fecha `outConn`/`inConn` do peer e o remove do registro interno.
  - `Mesh.peers` — `Map` peerId -> `{ id, name, live, outConn, inConn }` (mesma forma de hoje).
  - `Mesh.handleOffer(fromId, sdp)` — `async (string, RTCSessionDescriptionInit) -> RTCSessionDescriptionInit` (a resposta, pra sinalizar).
  - `Mesh.handleAnswer(fromId, sdp)` — `async (string, RTCSessionDescriptionInit) -> void`.
  - `Mesh.handleIce(fromId, dir, candidate)` — `async (string, 'out'|'in', RTCIceCandidateInit) -> void`.
  - `Mesh.offerTo(peerId, stream, quality)` — `async (string, MediaStream, QualityConfig) -> void`, mesma lógica de `offerTo` hoje (`app.js:367-385`).
  - `Mesh.applyEncoding(quality)` — mesma lógica de `applyEncoding` hoje (`app.js:412-426`).
  - `Mesh.closeAllOut()` — fecha `outConn` de todos os peers (usado em `stopShare`).
  - `Mesh.statsFor(peerId)` — wrapper fino sobre `getStats()`, usado pelo cálculo de estatísticas em `ui.js`.

**Steps:**

- [ ] **Step 1: Implementar `mesh.js`**

Move `RTC_CONFIG`, `makeConnection`, `ensureOutConn`, `ensureInConn`, `offerTo`, `preferCodec`, `applyEncoding` de `app.js` (linhas 25, 313-426) pra dentro de `createMesh`, trocando `signal(...)` por `deps.send(...)` e `showTile(...)` por `deps.onTrack(...)`, `renderPeers()` por `deps.onPeerState()`. O comportamento é idêntico ao atual — só a superfície muda de função solta pra métodos de um objeto:

```js
// src/renderer/mesh.js
'use strict';

(function (root) {
  const RTC_CONFIG = { iceServers: [], iceTransportPolicy: 'all' };

  function createMesh({ send, onTrack, onPeerState }) {
    const peers = new Map();

    function addPeer(id, name) {
      if (!peers.has(id)) peers.set(id, { id, name, live: false, outConn: null, inConn: null });
      return peers.get(id);
    }

    function removePeer(id) {
      const peer = peers.get(id);
      if (!peer) return;
      peer.outConn?.close();
      peer.inConn?.close();
      peers.delete(id);
    }

    function makeConnection(peerId, dir) {
      const pc = new RTCPeerConnection(RTC_CONFIG);

      pc.addEventListener('icecandidate', (event) => {
        if (event.candidate) send({ type: 'ice', to: peerId, dir, candidate: event.candidate });
      });

      if (dir === 'in') {
        pc.addEventListener('track', (event) => {
          const peer = peers.get(peerId);
          onTrack(peerId, peer ? peer.name : peerId, event.streams[0]);
        });
      }

      pc.addEventListener('connectionstatechange', () => {
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState) && dir === 'in') {
          onPeerState(peerId, { removedTile: true });
        } else {
          onPeerState(peerId, {});
        }
      });

      return pc;
    }

    function ensureOutConn(peerId) {
      const peer = addPeer(peerId, peers.get(peerId)?.name || `#${peerId}`);
      if (!peer.outConn) peer.outConn = makeConnection(peerId, 'out');
      return peer.outConn;
    }

    function ensureInConn(peerId) {
      const peer = addPeer(peerId, peers.get(peerId)?.name || `#${peerId}`);
      if (peer.inConn) {
        peer.inConn.close();
        onPeerState(peerId, { removedTile: true });
      }
      peer.inConn = makeConnection(peerId, 'in');
      return peer.inConn;
    }

    function preferCodec(transceiver, mimeType) {
      if (!transceiver.setCodecPreferences) return;
      const caps = RTCRtpSender.getCapabilities('video');
      if (!caps) return;
      const wanted = caps.codecs.filter((c) => c.mimeType.toLowerCase() === mimeType.toLowerCase());
      if (!wanted.length) return;
      const rest = caps.codecs.filter((c) => c.mimeType.toLowerCase() !== mimeType.toLowerCase());
      try {
        transceiver.setCodecPreferences([...wanted, ...rest]);
      } catch {
        /* combinacao nao suportada, segue com o padrao */
      }
    }

    async function offerTo(peerId, stream, quality) {
      const pc = ensureOutConn(peerId);

      for (const track of stream.getTracks()) {
        const transceiver = pc.addTransceiver(track, {
          direction: 'sendonly',
          streams: [stream],
          sendEncodings: track.kind === 'video'
            ? [{ maxBitrate: quality.bitrate, maxFramerate: quality.fps }]
            : undefined,
        });
        if (track.kind === 'video') preferCodec(transceiver, quality.codec);
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: 'offer', to: peerId, sdp: pc.localDescription });
    }

    async function handleOffer(fromId, sdp) {
      const pc = ensureInConn(fromId);
      await pc.setRemoteDescription(sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      return pc.localDescription;
    }

    async function handleAnswer(fromId, sdp) {
      const peer = peers.get(fromId);
      if (!peer?.outConn) return;
      await peer.outConn.setRemoteDescription(sdp);
    }

    async function handleIce(fromId, dir, candidate) {
      const peer = peers.get(fromId);
      if (!peer || !candidate) return;
      const target = dir === 'out' ? peer.inConn : peer.outConn;
      if (!target) return;
      try {
        await target.addIceCandidate(candidate);
      } catch {
        /* candidato tardio, ignorar */
      }
    }

    function applyEncoding(quality) {
      for (const peer of peers.values()) {
        if (!peer.outConn) continue;
        for (const sender of peer.outConn.getSenders()) {
          if (!sender.track || sender.track.kind !== 'video') continue;
          const params = sender.getParameters();
          if (!params.encodings || !params.encodings.length) params.encodings = [{}];
          params.encodings[0].maxBitrate = quality.bitrate;
          params.encodings[0].maxFramerate = quality.fps;
          params.degradationPreference = 'maintain-framerate';
          sender.setParameters(params).catch(() => {});
        }
      }
    }

    function closeAllOut() {
      for (const peer of peers.values()) {
        if (!peer.outConn) continue;
        peer.outConn.close();
        peer.outConn = null;
      }
    }

    async function statsFor(peerId) {
      const peer = peers.get(peerId);
      if (!peer?.outConn || peer.outConn.connectionState !== 'connected') return null;
      return peer.outConn.getStats();
    }

    return {
      peers,
      addPeer,
      removePeer,
      handleOffer,
      handleAnswer,
      handleIce,
      offerTo,
      applyEncoding,
      closeAllOut,
      statsFor,
    };
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.mesh = { createMesh };
})(window);
```

- [ ] **Step 2: Verificar manualmente**

Sem teste automatizado nesta fase (fica pra Fase 2, quando `stream-roles` entra e há lógica pura de mapeamento pra testar com stubs). Verificação acontece na Task 9 com duas instâncias reais.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/mesh.js
git commit -m "feat: extrai mesh.js do app.js"
```

---

## Task 4: HTML — layout de três colunas + trilho

**Files:**
- Modify: `src/renderer/index.html` (reescrita completa do `<body>`)

**Interfaces:**
- Produces: os `id`s de DOM que `ui.js` (Task 6) vai consumir via `document.getElementById`.

- [ ] **Step 1: Reescrever `index.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; img-src 'self' data:; media-src 'self' blob: mediastream:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:" />
<title>GoLive LAN</title>
<link rel="stylesheet" href="style.css" />
</head>
<body>

<div id="app" class="app">
  <!-- ============ TRILHO ============ -->
  <nav class="rail">
    <div class="rail-brand" title="GoLive LAN">GL</div>
    <button id="btn-create-room" class="rail-action" title="Criar sala" type="button">+</button>
  </nav>

  <!-- ============ COLUNA DE SALAS ============ -->
  <aside class="rooms-col">
    <h2 class="rooms-title">Salas na rede</h2>
    <ul id="room-list" class="room-list"></ul>

    <button id="btn-join-address" class="ghost small room-join-btn" type="button">Entrar por endereço</button>
    <div id="join-address-form" class="join-address-form hidden">
      <input id="in-server" type="text" placeholder="26.0.0.1 ou ws://26.0.0.1:9000" spellcheck="false" />
      <button id="btn-connect" class="primary small" type="button">Conectar</button>
      <p id="setup-error" class="error"></p>
    </div>

    <div class="user-panel">
      <span id="user-panel-name" class="user-panel-name">anônimo</span>
      <div class="user-panel-actions">
        <button id="btn-toggle-camera" class="icon-btn" title="Câmera" type="button">CAM</button>
        <button id="btn-toggle-share" class="icon-btn" title="Compartilhar tela" type="button">TELA</button>
        <button id="btn-open-settings" class="icon-btn" title="Configurações" type="button">CFG</button>
      </div>
    </div>
  </aside>

  <!-- ============ PALCO ============ -->
  <main class="stage">
    <header id="stage-header" class="stage-header hidden">
      <span id="stage-room-name" class="stage-room-name"></span>
      <span id="stage-room-address" class="stage-room-address"></span>
      <button id="btn-copy-address" class="ghost small">Copiar</button>
    </header>
    <div id="grid" class="grid">
      <div class="empty">Entre ou crie uma sala pra começar.</div>
    </div>
  </main>

  <!-- ============ MEMBROS ============ -->
  <aside class="members-col">
    <h2 class="members-title">Na sala</h2>
    <ul id="peer-list" class="peer-list"></ul>
  </aside>
</div>

<!-- ============ MODAL DE CONFIGURACOES ============ -->
<div id="settings-modal" class="modal hidden">
  <div class="modal-box settings-box">
    <nav class="settings-nav">
      <button class="settings-cat active" data-cat="voice">Voz e Vídeo</button>
      <button class="settings-cat" data-cat="broadcast">Transmissão</button>
      <button class="settings-cat" data-cat="network">Rede</button>
      <button class="settings-cat" data-cat="stats">Estatísticas</button>
    </nav>
    <div class="settings-content">
      <section id="settings-voice" class="settings-pane"></section>
      <section id="settings-broadcast" class="settings-pane hidden"></section>
      <section id="settings-network" class="settings-pane hidden"></section>
      <section id="settings-stats" class="settings-pane hidden"></section>
    </div>
    <button id="btn-close-settings" class="modal-close" title="Fechar" type="button">×</button>
  </div>
</div>

<!-- ============ SELETOR DE FONTE + AUDIO ============ -->
<div id="picker" class="modal hidden">
  <div class="modal-box picker-box">
    <h2>O que você quer compartilhar?</h2>
    <div id="picker-grid" class="picker-grid"></div>

    <h3>Áudio</h3>
    <div id="audio-mode" class="audio-mode">
      <label><input type="radio" name="audio-mode" value="none" /> Sem áudio</label>
      <label><input type="radio" name="audio-mode" value="system" checked /> Áudio do sistema (inclui a voz do Discord)</label>
      <label><input type="radio" name="audio-mode" value="device" /> Um dispositivo específico</label>
    </div>
    <select id="audio-device" class="hidden"></select>

    <div class="picker-actions">
      <button id="picker-cancel" class="ghost" type="button">Cancelar</button>
      <button id="btn-go-live" class="primary" type="button" disabled>Ir ao vivo</button>
    </div>
  </div>
</div>

<script src="config.js"></script>
<script src="signaling.js"></script>
<script src="mesh.js"></script>
<script src="ui.js"></script>
<script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verificar visualmente**

Run: `npm start`
Expected: a janela abre sem erros no console (o app ainda não funciona de ponta a ponta — `ui.js`/`app.js` só chegam nas próximas tasks — mas o HTML precisa carregar sem exceção de parsing). Ignorar por ora os `<script>` que ainda não existem — eles são criados nas próximas tasks; comente as tags dos que faltam se for rodar antes da Task 8, ou pule esta verificação e faça-a ao final da Task 9.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.html
git commit -m "feat: novo layout HTML de tres colunas estilo Discord"
```

---

## Task 5: CSS — tokens do tema e layout novo

**Files:**
- Modify: `src/renderer/style.css` (reescrita completa)

- [ ] **Step 1: Reescrever `style.css`**

Substitui as classes antigas (`.setup`, `.sidebar`, `.tabs`, `.host-panel`, etc.) pelas novas do HTML da Task 4, preservando o que ainda se aplica (`.tile`, `.tile-label`, `.tile.fullscreen`, `.dot`, `.stat*`, `.warn-box`, `.error`, `.hint`, `.picker-grid`, `.source-card` — reaproveitados quase 1:1).

```css
/* GoLive LAN - tema estilo Discord */

:root {
  --bg-app: #313338;
  --bg-panel: #2b2d31;
  --bg-rail: #1e1f22;
  --bg-inset: #1e1f22;
  --line: #3f4147;
  --text: #f2f3f5;
  --muted: #949ba4;
  --accent: #5865f2;
  --good: #23a55a;
  --warn: #f0b232;
  --bad: #f23f42;
  --radius: 8px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: "Segoe UI", system-ui, sans-serif;
  background: var(--bg-app);
  color: var(--text);
  height: 100vh;
  overflow: hidden;
  font-size: 14px;
}

.hidden { display: none !important; }

button {
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  border: none;
  border-radius: var(--radius);
  padding: 10px 16px;
  cursor: pointer;
  transition: filter 0.12s;
  color: var(--text);
}
button:hover:not(:disabled) { filter: brightness(1.15); }
button:disabled { opacity: 0.5; cursor: default; }

.primary { background: var(--accent); color: #fff; }
.danger { background: var(--bad); color: #fff; }
.ghost { background: var(--bg-inset); color: var(--text); }
.small { padding: 6px 10px; font-size: 0.85em; }

.error { color: var(--bad); margin-top: 10px; font-size: 13px; line-height: 1.5; }
.hint { color: var(--muted); font-size: 0.85em; min-height: 1.2em; }

input[type="text"], select {
  width: 100%;
  padding: 9px 11px;
  background: var(--bg-inset);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
}
input[type="text"]:focus, select:focus { outline: none; border-color: var(--accent); }

/* ---------- Layout raiz ---------- */

.app {
  display: grid;
  grid-template-columns: 72px 240px 1fr 200px;
  height: 100vh;
}

.rail {
  background: var(--bg-rail);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}
.rail-brand {
  width: 44px; height: 44px;
  border-radius: 16px;
  background: var(--accent);
  display: grid; place-items: center;
  font-weight: 700;
}
.rail-action {
  width: 44px; height: 44px;
  border-radius: 16px;
  background: var(--bg-panel);
  padding: 0;
  font-size: 20px;
}

.rooms-col, .members-col {
  background: var(--bg-panel);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.rooms-col { border-right: 1px solid var(--line); }
.members-col { border-left: 1px solid var(--line); padding: 16px; }

.rooms-title, .members-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.9px;
  color: var(--muted);
  padding: 16px 16px 8px;
}

.room-list, .peer-list { list-style: none; flex: 1; overflow-y: auto; }
.room-list { padding: 0 8px; }
.room-item {
  width: 100%;
  text-align: left;
  background: transparent;
  padding: 8px 10px;
  border-radius: 6px;
  margin-bottom: 2px;
}
.room-item:hover { background: var(--bg-inset); }
.room-item .room-name { font-weight: 600; display: block; }
.room-item .room-meta { font-size: 12px; color: var(--muted); }

.room-join-btn { margin: 8px 16px; width: calc(100% - 32px); text-align: left; }
.join-address-form { padding: 0 16px 12px; display: flex; flex-direction: column; gap: 8px; }

.user-panel {
  margin-top: auto;
  padding: 10px 12px;
  background: var(--bg-inset);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.user-panel-name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-panel-actions { display: flex; gap: 4px; }
.icon-btn {
  width: 32px; height: 32px;
  padding: 0;
  background: transparent;
  font-size: 11px;
  border-radius: 6px;
}
.icon-btn:hover { background: var(--bg-panel); }
.icon-btn.active { background: var(--accent); }

.peer-list li {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
}
.peer-list li em {
  margin-left: auto;
  font-style: normal;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: var(--bad);
  padding: 2px 6px;
  border-radius: 4px;
}
.peer-list .muted { color: var(--muted); border: none; }

.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
.dot.ok { background: var(--good); }
.dot.warn { background: var(--warn); }
.dot.bad { background: var(--bad); }

/* ---------- Palco ---------- */

.stage { display: flex; flex-direction: column; overflow: hidden; }

.stage-header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--line);
}
.stage-room-name { font-weight: 700; }
.stage-room-address { color: var(--muted); font-family: monospace; font-size: 12px; }

.grid {
  flex: 1;
  padding: 16px;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 14px;
  align-content: start;
}

.empty {
  grid-column: 1 / -1;
  display: grid;
  place-items: center;
  height: 100%;
  color: var(--muted);
}

.tile {
  position: relative;
  background: #000;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  aspect-ratio: 16 / 9;
}
.tile video { width: 100%; height: 100%; object-fit: contain; display: block; }
.tile-label {
  position: absolute;
  left: 10px; bottom: 10px;
  padding: 3px 9px;
  background: rgba(0, 0, 0, 0.65);
  border-radius: 5px;
  font-size: 12px;
  opacity: 0;
  transition: opacity 0.12s;
}
.tile:hover .tile-label { opacity: 1; }
.tile.fullscreen { position: fixed; inset: 0; z-index: 50; border-radius: 0; aspect-ratio: auto; }

/* ---------- Modais (Configuracoes + Compartilhar) ---------- */

.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: grid;
  place-items: center;
  z-index: 100;
}
.modal-box {
  position: relative;
  background: var(--bg-panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 26px;
}
.modal-close {
  position: absolute;
  top: 14px; right: 14px;
  width: 32px; height: 32px;
  padding: 0;
  background: var(--bg-inset);
  font-size: 18px;
  line-height: 1;
  border-radius: 50%;
}

.settings-box { width: min(880px, 90vw); height: min(600px, 85vh); display: grid; grid-template-columns: 200px 1fr; padding: 0; overflow: hidden; }
.settings-nav { background: var(--bg-inset); padding: 20px 10px; display: flex; flex-direction: column; gap: 2px; }
.settings-cat {
  background: transparent;
  text-align: left;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--muted);
}
.settings-cat.active { background: var(--bg-panel); color: var(--text); }
.settings-content { padding: 26px; overflow-y: auto; }
.settings-pane h3 { font-size: 12px; text-transform: uppercase; color: var(--muted); margin: 18px 0 8px; }
.settings-pane h3:first-child { margin-top: 0; }
.settings-field { margin-bottom: 14px; }
.settings-field label { display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; }
.settings-field small { display: block; font-weight: 400; color: var(--muted); margin-top: 5px; }
.settings-field input[type="range"] { width: 100%; accent-color: var(--accent); }
.settings-field video { width: 100%; max-width: 280px; border-radius: var(--radius); background: #000; aspect-ratio: 4/3; }

.picker-box { width: min(880px, 90vw); max-height: 88vh; overflow-y: auto; }
.picker-box h2 { font-size: 17px; margin-bottom: 18px; }
.picker-box h3 { font-size: 12px; text-transform: uppercase; color: var(--muted); margin: 18px 0 10px; }
.picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; margin-bottom: 8px; }
.source-card {
  background: var(--bg-inset);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 8px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--text);
}
.source-card.selected { border-color: var(--accent); }
.source-card:hover { border-color: var(--accent); }
.source-card img { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 6px; background: #000; }
.source-name { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.source-meta { font-size: 11px; color: var(--muted); font-weight: 400; }

.audio-mode { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.audio-mode label { display: flex; align-items: center; gap: 8px; font-weight: 400; font-size: 13px; }
.audio-mode input { accent-color: var(--accent); }

.picker-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }

/* ---------- Estatisticas ---------- */

.stats { font-size: 12px; }
.stat { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid var(--line); }
.stat span { color: var(--muted); }
.stat b.good { color: var(--good); }
.stat b.warn-text { color: var(--warn); }
.stat-warn {
  margin-top: 10px;
  padding: 8px 10px;
  background: rgba(240, 178, 50, 0.12);
  border-left: 3px solid var(--warn);
  border-radius: 4px;
  color: var(--warn);
}

.warn-box {
  margin-top: 8px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(240, 178, 50, 0.15);
  border: 1px solid rgba(240, 178, 50, 0.4);
  font-size: 0.85em;
}
.warn-box code { display: block; margin: 6px 0; word-break: break-all; }
```

- [ ] **Step 2: Verificar visualmente**

Run: `npm start`
Expected: trilho, coluna de salas, palco e coluna de membros aparecem com a paleta escura nova, sem overflow horizontal.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/style.css
git commit -m "feat: tema e layout CSS estilo Discord"
```

---

## Task 6: `ui.js` — grade, membros, salas (sem modais ainda)

**Files:**
- Create: `src/renderer/ui.js`

**Interfaces:**
- Consumes: nenhum import direto — recebe elementos de DOM via `document.getElementById` no próprio módulo (mesmo padrão do `app.js` original), e `escapeHtml` local.
- Produces: `GoLive.ui.grid`, com:
  - `grid.showTile(id, label, stream, muted)` — idêntico a `showTile` hoje (`app.js:520-538`), mas usando `#grid`.
  - `grid.removeTile(id)` — idêntico a `removeTile` hoje (`app.js:540-545`), com a mensagem vazia trocada pra "Entre ou crie uma sala pra começar." só quando não há sala ativa, e "Ninguém transmitindo ainda." quando há — recebe um parâmetro `emptyMessage`.
  - `GoLive.ui.members.render(peersMap)` — substitui `renderPeers` (`app.js:547-562`), escreve em `#peer-list`.
  - `GoLive.ui.rooms.render(rooms, { onSelect })` — nova: recebe uma lista `[{ address, name, hostName, peers, live, source: 'recent'|'discovered' }]` e desenha `#room-list`; cada `<li>` vira clicável e chama `onSelect(room)`.
  - `GoLive.ui.stageHeader.set({ name, address })` / `GoLive.ui.stageHeader.clear()` — mostra/esconde `#stage-header` e preenche `#stage-room-name`/`#stage-room-address`.
  - `GoLive.ui.escapeHtml(str)` — mesma função utilitária de hoje (`app.js:682-686`), reexportada porque outros módulos (Task 7/8) também escapam texto vindo da rede.

**Steps:**

- [ ] **Step 1: Implementar `ui.js` (parte 1 — grade, membros, salas, cabeçalho do palco)**

```js
// src/renderer/ui.js
'use strict';

(function (root) {
  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  const gridEl = $('grid');

  function showTile(id, label, stream, muted = false) {
    gridEl.querySelector('.empty')?.remove();

    let tile = document.getElementById(`tile-${id}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'tile';
      tile.id = `tile-${id}`;
      tile.innerHTML = `<video autoplay playsinline></video><span class="tile-label"></span>`;
      tile.addEventListener('dblclick', () => tile.classList.toggle('fullscreen'));
      gridEl.appendChild(tile);
    }

    const video = tile.querySelector('video');
    if (video.srcObject !== stream) video.srcObject = stream;
    video.muted = muted;
    tile.querySelector('.tile-label').textContent = label;
  }

  function removeTile(id, emptyMessage) {
    document.getElementById(`tile-${id}`)?.remove();
    if (!gridEl.children.length) {
      gridEl.innerHTML = `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
    }
  }

  const peerListEl = $('peer-list');

  function renderMembers(peers) {
    peerListEl.innerHTML = '';
    if (!peers.size) {
      peerListEl.innerHTML = '<li class="muted">só você por aqui</li>';
      return;
    }
    for (const peer of peers.values()) {
      const li = document.createElement('li');
      const state = peer.inConn?.connectionState || peer.outConn?.connectionState;
      li.innerHTML = `
        <span class="dot ${state === 'connected' ? 'ok' : state ? 'warn' : ''}"></span>
        ${escapeHtml(peer.name)}
        ${peer.live ? '<em>AO VIVO</em>' : ''}`;
      peerListEl.appendChild(li);
    }
  }

  const roomListEl = $('room-list');

  function renderRooms(rooms, { onSelect }) {
    roomListEl.innerHTML = '';
    if (!rooms.length) {
      roomListEl.innerHTML = '<li class="muted" style="padding:8px 10px;">nenhuma sala por aqui ainda</li>';
      return;
    }
    for (const room of rooms) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'room-item';
      button.type = 'button';
      button.innerHTML = `
        <span class="room-name"># ${escapeHtml(room.name || room.hostName || 'sala')}</span>
        <span class="room-meta">${room.peers != null ? `${room.peers} pessoa(s)` : escapeHtml(room.address)}</span>`;
      button.addEventListener('click', () => onSelect(room));
      li.appendChild(button);
      roomListEl.appendChild(li);
    }
  }

  const stageHeaderEl = $('stage-header');
  const stageRoomNameEl = $('stage-room-name');
  const stageRoomAddressEl = $('stage-room-address');

  function setStageHeader({ name, address }) {
    stageRoomNameEl.textContent = name || '';
    stageRoomAddressEl.textContent = address || '';
    stageHeaderEl.classList.remove('hidden');
  }

  function clearStageHeader() {
    stageHeaderEl.classList.add('hidden');
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.ui = {
    escapeHtml,
    grid: { showTile, removeTile },
    members: { render: renderMembers },
    rooms: { render: renderRooms },
    stageHeader: { set: setStageHeader, clear: clearStageHeader },
  };
})(window);
```

- [ ] **Step 2: Verificar manualmente**

Sem teste automatizado (manipulação de DOM real, fora do escopo de `node --test` neste projeto). Verificação acontece na Task 9.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/ui.js
git commit -m "feat: ui.js com grade, membros e lista de salas"
```

---

## Task 7: `ui.js` — modal de Configurações

**Files:**
- Modify: `src/renderer/ui.js` (acrescenta ao objeto exportado)

**Interfaces:**
- Consumes: `GoLive.config` (Task 1) pros valores/labels; recebe `deps.onQualityChange(quality)`, `deps.onCameraDeviceChange(deviceId)`, `deps.onNetworkChange(network)` como callbacks pra `app.js` aplicar mudanças ao vivo.
- Produces: `GoLive.ui.settings.open(config, deps)` / `GoLive.ui.settings.close()` / `GoLive.ui.settings.setStatsHtml(html)` (usado pelo loop de stats existente pra escrever dentro da aba Estatísticas).

**Steps:**

- [ ] **Step 1: Acrescentar o módulo de Configurações a `ui.js`**

Insere, antes do `root.GoLive = ...` final:

```js
  // ---------- Modal de Configuracoes ----------

  const settingsModalEl = $('settings-modal');
  const settingsCatButtons = Array.from(document.querySelectorAll('.settings-cat'));
  const settingsPanes = {
    voice: $('settings-voice'),
    broadcast: $('settings-broadcast'),
    network: $('settings-network'),
    stats: $('settings-stats'),
  };

  settingsCatButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      settingsCatButtons.forEach((b) => b.classList.toggle('active', b === btn));
      Object.entries(settingsPanes).forEach(([cat, pane]) =>
        pane.classList.toggle('hidden', cat !== btn.dataset.cat)
      );
    });
  });

  $('btn-close-settings').addEventListener('click', closeSettings);
  settingsModalEl.addEventListener('click', (event) => {
    if (event.target === settingsModalEl) closeSettings();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !settingsModalEl.classList.contains('hidden')) closeSettings();
  });

  function closeSettings() {
    settingsModalEl.classList.add('hidden');
  }

  function bandwidthLine(config) {
    const screenMbps = config.quality.bitrate / 1_000_000;
    const cameraMbps = config.camera.bitrate / 1_000_000;
    return `${screenMbps.toFixed(1)} Mbps (tela) + ${cameraMbps.toFixed(1)} Mbps (câmera) × número de espectadores`;
  }

  async function openSettings(config, deps) {
    settingsPanes.voice.innerHTML = `
      <h3>Câmera</h3>
      <div class="settings-field">
        <label for="settings-camera-device">Dispositivo</label>
        <select id="settings-camera-device"></select>
      </div>
      <div class="settings-field">
        <video id="settings-camera-preview" autoplay playsinline muted></video>
      </div>
      <h3>Áudio</h3>
      <div class="settings-field">
        <label for="settings-audio-device">Dispositivo padrão pra compartilhamento</label>
        <select id="settings-audio-device"></select>
      </div>`;

    settingsPanes.broadcast.innerHTML = `
      <h3>Tela</h3>
      <div class="settings-field">
        <label>Resolução</label>
        <select id="settings-res">
          <option value="1920x1080">1920x1080 (Full HD)</option>
          <option value="2560x1440">2560x1440 (QHD)</option>
          <option value="1280x720">1280x720 (HD)</option>
        </select>
      </div>
      <div class="settings-field">
        <label>Framerate</label>
        <select id="settings-fps">
          <option value="60">60 fps</option>
          <option value="30">30 fps</option>
        </select>
      </div>
      <div class="settings-field">
        <label>Bitrate: <b id="settings-bitrate-label"></b></label>
        <input id="settings-bitrate" type="range" min="2" max="40" step="1" />
      </div>
      <div class="settings-field">
        <label>Codec</label>
        <select id="settings-codec">
          <option value="video/H264">H.264 (hardware, menor latência)</option>
          <option value="video/VP9">VP9 (melhor imagem, mais CPU)</option>
          <option value="video/AV1">AV1 (menor banda, exige GPU nova)</option>
        </select>
      </div>
      <h3>Câmera</h3>
      <div class="settings-field">
        <label>Bitrate da câmera: <b id="settings-camera-bitrate-label"></b></label>
        <input id="settings-camera-bitrate" type="range" min="1" max="8" step="1" />
        <small>${escapeHtml(bandwidthLine(config))}</small>
      </div>`;

    settingsPanes.network.innerHTML = `
      <div class="settings-field">
        <label class="check-inline"><input id="settings-advertise" type="checkbox" /> Anunciar minha sala na rede</label>
        <small>Desligado, a sala funciona normalmente e só entra quem receber o endereço.</small>
      </div>`;

    settingsPanes.stats.innerHTML = '<div id="settings-stats-body" class="stats"></div>';

    $('settings-res').value = `${config.quality.width}x${config.quality.height}`;
    $('settings-fps').value = String(config.quality.fps);
    $('settings-bitrate').value = String(config.quality.bitrate / 1_000_000);
    $('settings-bitrate-label').textContent = `${config.quality.bitrate / 1_000_000} Mbps`;
    $('settings-codec').value = config.quality.codec;
    $('settings-camera-bitrate').value = String(config.camera.bitrate / 1_000_000);
    $('settings-camera-bitrate-label').textContent = `${config.camera.bitrate / 1_000_000} Mbps`;
    $('settings-advertise').checked = config.network.advertise;

    function emitQuality() {
      const [width, height] = $('settings-res').value.split('x').map(Number);
      deps.onQualityChange({
        width,
        height,
        fps: Number($('settings-fps').value),
        bitrate: Number($('settings-bitrate').value) * 1_000_000,
        codec: $('settings-codec').value,
      });
    }

    $('settings-res').addEventListener('change', emitQuality);
    $('settings-fps').addEventListener('change', emitQuality);
    $('settings-codec').addEventListener('change', emitQuality);
    $('settings-bitrate').addEventListener('input', () => {
      $('settings-bitrate-label').textContent = `${$('settings-bitrate').value} Mbps`;
      emitQuality();
    });
    $('settings-camera-bitrate').addEventListener('input', () => {
      $('settings-camera-bitrate-label').textContent = `${$('settings-camera-bitrate').value} Mbps`;
      deps.onCameraQualityChange({ ...config.camera, bitrate: Number($('settings-camera-bitrate').value) * 1_000_000 });
    });
    $('settings-advertise').addEventListener('change', () => {
      deps.onNetworkChange({ ...config.network, advertise: $('settings-advertise').checked });
    });

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameraSelect = $('settings-camera-device');
      const audioSelect = $('settings-audio-device');
      for (const d of devices.filter((d) => d.kind === 'videoinput')) {
        cameraSelect.add(new Option(d.label || 'Câmera', d.deviceId));
      }
      for (const d of devices.filter((d) => d.kind === 'audioinput')) {
        audioSelect.add(new Option(d.label || 'Entrada de áudio', d.deviceId));
      }
      cameraSelect.addEventListener('change', () => deps.onCameraDeviceChange(cameraSelect.value));
    } catch {
      /* sem permissao de midia ainda, dropdowns ficam vazios */
    }

    settingsModalEl.classList.remove('hidden');
  }

  function setStatsHtml(html) {
    const body = $('settings-stats-body');
    if (body) body.innerHTML = html;
  }
```

E acrescenta ao objeto final:

```js
  root.GoLive.ui.settings = { open: openSettings, close: closeSettings, setStatsHtml };
```

- [ ] **Step 2: Verificar manualmente**

Run: `npm start`, clicar no botão de Configurações (`btn-open-settings`, ligado na Task 9), navegar entre as quatro categorias, conferir que `Esc` e clique fora fecham o modal.
Expected: modal abre, categorias trocam de painel, valores iniciais batem com os defaults de `config.js`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/ui.js
git commit -m "feat: modal de Configuracoes com categorias Voz/Transmissao/Rede/Stats"
```

---

## Task 8: `ui.js` — diálogo de compartilhar com escolha de áudio + IPC de áudio

**Files:**
- Modify: `src/renderer/ui.js` (acrescenta ao objeto exportado)
- Modify: `src/main.js:66-80,96-125`
- Modify: `src/preload.js:13-14`

**Interfaces:**
- Produces: `GoLive.ui.picker.open({ onGoLive })` — abre `#picker`, carrega fontes via `window.golive.listSources()`, gerencia o seletor de fonte + os três modos de áudio; `onGoLive(sourceId, audioMode, audioDeviceId)` é chamado quando o usuário clica "Ir ao vivo".
- `window.golive.selectSource(id, audioMode)` — nova assinatura (era `(id, systemAudio)`).

**Steps:**

- [ ] **Step 1: Atualizar `main.js`**

```js
// src/main.js:23-26 — substitui
/** Fonte de captura escolhida no seletor do renderer. */
let selectedSourceId = null;
/** Modo de audio: 'none' | 'system' | 'device'. 'device' e capturado no
 * renderer via getUserMedia, entao aqui so importa distinguir 'system'. */
let audioMode = 'system';
```

```js
// src/main.js:66-80 — substitui o callback do setDisplayMediaRequestHandler
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          const chosen = sources.find((s) => s.id === selectedSourceId) || sources[0];
          if (!chosen) return callback({});
          // 'loopback' so no modo 'system'; nos modos 'none' e 'device' o
          // getDisplayMedia nao carrega audio (o modo 'device' e adicionado
          // pelo renderer via getUserMedia, fora deste handler).
          callback({ video: chosen, audio: audioMode === 'system' ? 'loopback' : undefined });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false }
  );
```

```js
// src/main.js:121-125 — substitui o handler de sources:select
ipcMain.handle('sources:select', (_event, { id, audioMode: mode }) => {
  selectedSourceId = id;
  audioMode = mode === 'system' || mode === 'device' ? mode : 'none';
  return true;
});
```

- [ ] **Step 2: Atualizar `preload.js`**

```js
// src/preload.js:12-14 — substitui
  /** Define qual fonte o getDisplayMedia vai devolver e o modo de audio
   * ('none' | 'system' | 'device'). */
  selectSource: (id, audioMode) =>
    ipcRenderer.invoke('sources:select', { id, audioMode }),
```

- [ ] **Step 3: Acrescentar o diálogo de compartilhar a `ui.js`**

```js
  // ---------- Dialogo de compartilhar ----------

  const pickerEl = $('picker');
  const pickerGridEl = $('picker-grid');
  const audioDeviceEl = $('audio-device');
  const btnGoLiveEl = $('btn-go-live');
  let selectedSourceId = null;

  function currentAudioMode() {
    return document.querySelector('input[name="audio-mode"]:checked').value;
  }

  document.querySelectorAll('input[name="audio-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      audioDeviceEl.classList.toggle('hidden', currentAudioMode() !== 'device');
    });
  });

  $('picker-cancel').addEventListener('click', () => pickerEl.classList.add('hidden'));

  async function openPicker({ onGoLive }) {
    selectedSourceId = null;
    btnGoLiveEl.disabled = true;
    pickerGridEl.innerHTML = '';
    audioDeviceEl.innerHTML = '';

    const sources = await window.golive.listSources();
    for (const source of sources) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'source-card';
      card.innerHTML = `
        <img src="${source.thumbnail}" alt="" />
        <span class="source-name">${escapeHtml(source.name)}</span>
        <span class="source-meta">${source.isScreen ? 'Tela' : 'Janela'}${
          source.resolution ? ` &middot; ${source.resolution}` : ''
        }</span>`;
      card.addEventListener('click', () => {
        selectedSourceId = source.id;
        btnGoLiveEl.disabled = false;
        pickerGridEl.querySelectorAll('.source-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
      });
      pickerGridEl.appendChild(card);
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      for (const d of devices.filter((d) => d.kind === 'audioinput')) {
        audioDeviceEl.add(new Option(d.label || 'Entrada de áudio', d.deviceId));
      }
    } catch {
      /* sem permissao ainda */
    }

    btnGoLiveEl.onclick = () => {
      const mode = currentAudioMode();
      pickerEl.classList.add('hidden');
      onGoLive(selectedSourceId, mode, mode === 'device' ? audioDeviceEl.value : null);
    };

    pickerEl.classList.remove('hidden');
  }
```

E acrescenta ao objeto final:

```js
  root.GoLive.ui.picker = { open: openPicker };
```

- [ ] **Step 4: Verificar manualmente**

Run: `npm start`, abrir o diálogo de compartilhar, escolher cada um dos três modos de áudio, confirmar que o dropdown de dispositivo só aparece no modo "Um dispositivo específico" e que "Ir ao vivo" fica desabilitado até uma fonte ser escolhida.
Expected: os três modos funcionam visualmente; a chamada de `onGoLive` é testada de ponta a ponta na Task 9.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ui.js src/main.js src/preload.js
git commit -m "feat: dialogo de compartilhar com escolha de audio (nenhum/sistema/dispositivo)"
```

---

## Task 9: `app.js` — inicialização e wiring dos módulos

**Files:**
- Rewrite: `src/renderer/app.js`

**Interfaces:**
- Consumes: `GoLive.config`, `GoLive.signaling`, `GoLive.mesh`, `GoLive.ui` (Tasks 1, 2, 3, 6, 7, 8).

**Steps:**

- [ ] **Step 1: Reescrever `app.js`**

Junta tudo: carrega a config salva, monta a lista de salas recentes, liga os botões do trilho/coluna de salas/painel do usuário, cria o `signaling` e o `mesh` só quando uma sala é escolhida (entrar ou criar), rotea `handleSignal` pros métodos do `mesh`, e liga `openPicker`/`openSettings`.

```js
// src/renderer/app.js
'use strict';

(function () {
  const { config, signaling, mesh: meshModule, ui } = window.GoLive;

  let cfg = config.load(localStorage.getItem('golive'));
  let sig = null;
  let mesh = null;
  let myId = null;
  let localStream = null;
  let hostInfo = null;
  let statsTimer = null;
  let lastBytes = 0;
  let lastAt = 0;

  const $ = (id) => document.getElementById(id);

  function persist() {
    localStorage.setItem('golive', config.serialize(cfg));
  }

  function emptyMessage() {
    return sig ? 'Ninguém transmitindo ainda.' : 'Entre ou crie uma sala pra começar.';
  }

  // ---------- Painel do usuario ----------

  function renderUserPanel() {
    $('user-panel-name').textContent = cfg.name || 'anônimo';
  }
  renderUserPanel();

  $('btn-open-settings').addEventListener('click', () => {
    ui.settings.open(cfg, {
      onQualityChange: (quality) => {
        cfg = { ...cfg, quality };
        persist();
        if (localStream) applyLiveQuality();
      },
      onCameraQualityChange: (camera) => {
        cfg = { ...cfg, camera };
        persist();
      },
      onCameraDeviceChange: () => {
        // Selecao de dispositivo de camera: consumida na Fase 2, quando a
        // webcam ganha captura propria. Por ora so persiste a escolha.
      },
      onNetworkChange: (network) => {
        cfg = { ...cfg, network };
        persist();
      },
    });
  });

  async function applyLiveQuality() {
    const track = localStream.getVideoTracks()[0];
    if (track) {
      await track.applyConstraints(config.videoConstraints(cfg.quality)).catch(() => {});
    }
    mesh.applyEncoding(cfg.quality);
  }

  // ---------- Lista de salas ----------

  function renderRoomList() {
    ui.rooms.render(cfg.recentRooms, { onSelect: (room) => joinRoom(room.address, cfg.name) });
  }
  renderRoomList();

  $('btn-join-address').addEventListener('click', () => {
    $('join-address-form').classList.toggle('hidden');
  });

  $('btn-connect').addEventListener('click', () => {
    let url = $('in-server').value.trim();
    if (!url) return ($('setup-error').textContent = 'Informe o endereço do servidor.');
    if (!/^wss?:\/\//.test(url)) url = `ws://${url}`;
    if (!/:\d+$/.test(url)) url += ':9000';
    joinRoom(url, cfg.name);
  });

  $('btn-create-room').addEventListener('click', async () => {
    let result;
    try {
      result = await window.golive.hostRoom({ name: cfg.name || 'anônimo' });
    } catch {
      $('setup-error').textContent = 'Não consegui subir a sala: erro inesperado. Tente de novo.';
      return;
    }
    if (!result.ok) {
      $('setup-error').textContent =
        result.error === 'PORTS_EXHAUSTED'
          ? 'Todas as portas 9000-9010 estão ocupadas. Feche outras instâncias do GoLive e tente de novo.'
          : `Não consegui subir a sala: ${result.error}`;
      return;
    }
    hostInfo = { port: result.port, address: result.address, firewall: result.firewall, addressWarning: result.addressWarning };
    joinRoom(`ws://127.0.0.1:${result.port}`, cfg.name, hostInfo.address);
  });

  // ---------- Conexao de sinalizacao ----------

  function joinRoom(url, name, publicAddress) {
    sig = signaling.connect(url, {
      onOpen: () => {
        cfg = config.addRecentRoom(cfg, { address: publicAddress || url, name: `sala de ${name || 'anônimo'}` });
        persist();
        renderRoomList();
        sig.send({ type: 'join', room: 'geral', name: name || 'anônimo' });
        ui.stageHeader.set({ name: `sala de ${name || 'anônimo'}`, address: publicAddress || url });
      },
      onMessage: handleSignal,
      onError: () => {
        $('setup-error').textContent =
          'Não consegui conectar. Confira o IP, se o servidor está rodando e se a porta está liberada no firewall.';
      },
      onClose: () => {
        ui.stageHeader.clear();
        mesh = null;
        ui.members.render(new Map());
      },
    });

    mesh = meshModule.createMesh({
      send: (payload) => sig.send(payload),
      onTrack: (peerId, name, stream) => ui.grid.showTile(peerId, name, stream),
      onPeerState: (peerId, { removedTile }) => {
        if (removedTile) ui.grid.removeTile(peerId, emptyMessage());
        ui.members.render(mesh.peers);
      },
    });
  }

  $('btn-copy-address').addEventListener('click', () => {
    if (hostInfo?.address) navigator.clipboard.writeText(hostInfo.address);
  });

  async function handleSignal(msg) {
    switch (msg.type) {
      case 'welcome': {
        myId = msg.id;
        for (const p of msg.peers) mesh.addPeer(p.id, p.name);
        ui.members.render(mesh.peers);
        break;
      }
      case 'peer-joined': {
        mesh.addPeer(msg.id, msg.name);
        ui.members.render(mesh.peers);
        if (localStream) await mesh.offerTo(msg.id, localStream, cfg.quality);
        break;
      }
      case 'peer-left': {
        mesh.removePeer(msg.id);
        ui.grid.removeTile(msg.id, emptyMessage());
        ui.members.render(mesh.peers);
        break;
      }
      case 'offer': {
        const answerSdp = await mesh.handleOffer(msg.from, msg.sdp);
        sig.send({ type: 'answer', to: msg.from, sdp: answerSdp });
        break;
      }
      case 'answer': {
        await mesh.handleAnswer(msg.from, msg.sdp);
        mesh.applyEncoding(cfg.quality);
        break;
      }
      case 'ice': {
        await mesh.handleIce(msg.from, msg.dir, msg.candidate);
        break;
      }
      case 'broadcast-state': {
        const peer = mesh.peers.get(msg.id);
        if (peer) peer.live = msg.live;
        if (!msg.live) ui.grid.removeTile(msg.id, emptyMessage());
        ui.members.render(mesh.peers);
        break;
      }
    }
  }

  // ---------- Compartilhar tela ----------

  $('btn-toggle-share').addEventListener('click', () => {
    if (localStream) return stopShare();
    ui.picker.open({ onGoLive: startShare });
  });

  async function startShare(sourceId, audioMode, audioDeviceId) {
    if (!sig) return;
    await window.golive.selectSource(sourceId, audioMode);

    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: config.videoConstraints(cfg.quality),
        audio: audioMode === 'system',
      });
    } catch (err) {
      alert(`Não consegui capturar a tela: ${err.message}`);
      return;
    }

    if (audioMode === 'device' && audioDeviceId) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: audioDeviceId } } });
        const [track] = micStream.getAudioTracks();
        if (track) localStream.addTrack(track);
      } catch {
        /* usuario recusou o dispositivo, segue so com video */
      }
    }

    const track = localStream.getVideoTracks()[0];
    if (track) {
      track.contentHint = 'motion';
      track.applyConstraints({ frameRate: { ideal: cfg.quality.fps, max: cfg.quality.fps } }).catch(() => {});
      track.addEventListener('ended', stopShare);
    }
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) audioTrack.contentHint = 'music';

    ui.grid.showTile('me', 'Você (prévia)', localStream, true);

    for (const peerId of mesh.peers.keys()) await mesh.offerTo(peerId, localStream, cfg.quality);

    sig.send({ type: 'broadcast-state', live: true });
    $('btn-toggle-share').classList.add('active');
    startStatsLoop();
  }

  function stopShare() {
    if (!localStream) return;
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    mesh.closeAllOut();
    ui.grid.removeTile('me', emptyMessage());
    sig.send({ type: 'broadcast-state', live: false });
    $('btn-toggle-share').classList.remove('active');
    stopStatsLoop();
  }

  // ---------- Estatisticas ----------

  function startStatsLoop() {
    stopStatsLoop();
    statsTimer = setInterval(updateStats, 1000);
  }

  function stopStatsLoop() {
    clearInterval(statsTimer);
    statsTimer = null;
    ui.settings.setStatsHtml('');
  }

  async function updateStats() {
    let fps = 0, bytes = 0, rtt = 0, width = 0, height = 0, codec = '', limitation = '', connections = 0;

    for (const peerId of mesh.peers.keys()) {
      const report = await mesh.statsFor(peerId);
      if (!report) continue;
      connections++;
      report.forEach((stat) => {
        if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
          fps = Math.max(fps, stat.framesPerSecond || 0);
          bytes += stat.bytesSent || 0;
          width = stat.frameWidth || width;
          height = stat.frameHeight || height;
          if (stat.qualityLimitationReason && stat.qualityLimitationReason !== 'none') {
            limitation = stat.qualityLimitationReason;
          }
        }
        if (stat.type === 'codec' && stat.mimeType?.startsWith('video/')) {
          codec = stat.mimeType.split('/')[1];
        }
        if (stat.type === 'candidate-pair' && stat.nominated && stat.currentRoundTripTime != null) {
          rtt = Math.max(rtt, stat.currentRoundTripTime * 1000);
        }
      });
    }

    const now = performance.now();
    let mbps = 0;
    if (lastAt) mbps = ((bytes - lastBytes) * 8) / ((now - lastAt) / 1000) / 1_000_000;
    lastBytes = bytes;
    lastAt = now;

    const motivo = { bandwidth: 'banda da rede insuficiente', cpu: 'CPU no limite', other: 'limite do encoder' }[limitation];

    ui.settings.setStatsHtml(`
      <div class="stat"><span>enviando pra</span><b>${connections} peer(s)</b></div>
      <div class="stat"><span>resolução</span><b>${width}x${height}</b></div>
      <div class="stat"><span>fps real</span><b class="${fps >= 50 ? 'good' : 'warn-text'}">${Math.round(fps)}</b></div>
      <div class="stat"><span>saída total</span><b>${mbps.toFixed(1)} Mbps</b></div>
      <div class="stat"><span>latência</span><b>${rtt ? Math.round(rtt) + ' ms' : '-'}</b></div>
      <div class="stat"><span>codec</span><b>${codec || '-'}</b></div>
      ${motivo ? `<div class="stat-warn">Limitado por: ${motivo}</div>` : ''}`);
  }
})();
```

- [ ] **Step 2: Rodar a suíte de testes automatizados**

Run: `npm test`
Expected: PASS — todos os testes de `config.test.js` continuam verdes; nenhuma regressão nos testes de `ports`/`firewall`/`network`.

- [ ] **Step 3: Verificação manual de ponta a ponta**

Run: `npm start` (duas instâncias, ou uma instância + um segundo processo `npm start` numa segunda janela)
Roteiro:
1. Instância A: "Criar sala" — confirma que aparece na coluna do palco o endereço, e que a sala aparece em "Salas na rede" (como recente) ao reabrir o app.
2. Instância B: "Entrar por endereço", cola o IP:porta da instância A — confirma que entra na sala e A aparece na coluna de membros.
3. Em A: compartilhar tela, testar os três modos de áudio (nenhum, sistema, dispositivo) — confirma que B recebe o vídeo e (nos casos com áudio) o áudio correspondente.
4. Abrir Configurações em A durante a transmissão, mudar resolução/fps/bitrate/codec — confirma que aplica ao vivo (sem reconectar) e que a aba Estatísticas mostra números atualizando.
5. Fechar o modal com `Esc` e com clique fora.
6. Parar a transmissão em A — confirma que o tile some em B e o indicador "AO VIVO" desaparece da lista de membros.

Expected: os seis passos completam sem erro no console (`DevTools` do Electron) e sem travar a UI.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/app.js
git commit -m "feat: app.js liga config, signaling, mesh e ui"
```

---

## Task 10: Remover código morto e atualizar README

**Files:**
- Modify: `README.md` (seção de áudio)

**Steps:**

- [ ] **Step 1: Localizar a seção de áudio do README**

Run: `grep -n "áudio\|audio" README.md`

- [ ] **Step 2: Acrescentar a explicação do arranjo de dispositivo específico**

Adiciona um parágrafo explicando: Windows não oferece captura de áudio por aplicativo; a opção "um dispositivo específico" só isola o áudio do jogo do áudio do Discord se o usuário mandar o Discord tocar em outra saída pelo mixer de volume do Windows (ou usar um cabo de áudio virtual); a opção "áudio do sistema" inclui tudo, Discord incluso.

- [ ] **Step 3: Conferir que não sobrou referência a `chk-audio` ou ao HTML antigo**

Run: `grep -rn "chk-audio\|systemAudio\|pane-host\|pane-join\|tab-host\|tab-join" src/`
Expected: nenhuma ocorrência (todas as referências foram substituídas nas Tasks 4-9). Se algo aparecer, é um resíduo esquecido — corrigir antes de seguir.

- [ ] **Step 4: Rodar a suíte completa uma última vez**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: explica o arranjo de audio por dispositivo especifico"
```

---

## Self-review — cobertura da spec (Fase 1)

- Layout de três colunas + trilho → Task 4 (HTML) + Task 5 (CSS).
- Modal de Configurações com as quatro categorias → Task 7.
- Persistência versionada `{ v: 1, ... }` com preenchimento de campos ausentes → Task 1.
- Diálogo de compartilhar com os três modos de áudio + IPC `sources:select` recebendo o modo → Task 8.
- Divisão de `app.js` em `config.js`/`signaling.js`/`mesh.js`/`ui.js`/`app.js`, namespace `GoLive.*`, `module.exports` em `config.js` → Tasks 1-3, 6-9.
- README explicando o arranjo de áudio por dispositivo → Task 10.
- Lista de salas recentes (só `localStorage` nesta fase, descoberta de rede é Fase 3) → Task 1 (`addRecentRoom`) + Task 6 (`ui.rooms.render`) + Task 9 (`joinRoom` grava ao entrar).
- Controle de volume individual por tile e botão de tela cheia no hover — **não coberto nesta fase**: a spec lista isso na seção de Palco (linha 96-98) mas não faz parte dos quatro objetivos centrais de Fase 1 nem é bloqueante pra Fase 2/3. Recomendo tratar como Task 11 opcional se o usuário quiser antes de seguir pra Fase 2 — não a incluí aqui pra não inflar o escopo desta rodada.
