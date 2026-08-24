# Fase 2 — Árvore de retransmissão (F2) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a árvore de retransmissão descrita na seção F2 de
`docs/superpowers/specs/2026-08-23-performance-e-redesign-design.md`, atrás
de um interruptor `cfg.network.tree` desligado por padrão, sem quebrar o
comportamento de malha existente.

**Architecture:** A origem (quem transmite) calcula a topologia sozinha
(sem eleição distribuída) num módulo puro novo (`tree.js`), e distribui os
papéis via mensagem `tree` (já encaminhada pelo servidor de sinalização —
ver `server/signaling-core.js:88`, já testado). `mesh.js` ganha as
primitivas de baixo nível (guardar a track recebida, repassá-la, fechar uma
`outConn` específica). `app.js` orquestra: decide quando recalcular,
aplica a topologia (quem recebe oferta direta, quem vira relay, quem é
cortado da origem), reage a `tree` recebido (relay repassa pros filhos),
propaga demanda (F1.3) rio acima, e recupera quando um relay cai.

**Tech Stack:** JavaScript vanilla (sem framework), `window.GoLive.*` como
namespace de módulo (script tags, não ESM), `node:test` + `node:assert/strict`
para testes, WebRTC (`RTCPeerConnection`) no processo renderer do Electron.

## Global Constraints

- `FANOUT_ORIGEM = 1`, `FANOUT_RELAY = 2`, `PROFUNDIDADE_MAX = 2` — valores
  exatos da spec (§F2 "Papéis e escolha do relay"). Não inventar outros.
- Protocolo `tree` é exatamente `{ type: 'tree', to, kind, origem, paiId,
  filhos, epoch }` — o servidor já encaminha isso sem interpretar (ver
  `server/signaling-core.js:88`, coberto por
  `server/signaling-core.test.js:114`). Não mexer no servidor.
- `epoch` é por-origem: **ignorar `tree` com `epoch` menor que o último
  visto daquela origem.** Mesmo padrão do `currentSession !== session` já
  usado no resto do app.js.
- `TREE_ENABLED` (aqui: `cfg.network.tree`) começa **desligado**
  (`false`) por padrão. Com ele desligado, o comportamento tem que ser
  bit-a-bit igual ao de hoje (malha direta).
- Nunca usar `pc.close()` pra suspensão de demanda (isso é F1.3,
  `setPeerDemand`, já implementado) — só pra troca de PAPEL na árvore
  (origem parando de mandar direto pra quem virou folha).
- Todo código novo segue o estilo do arquivo que edita: comentários em
  português explicando o *porquê*, nomes de função em inglês/neutro,
  `'use strict'` + IIFE `(function (root) { ... })(...)` nos módulos do
  renderer, exportado em `window.GoLive.<nome>` e via `module.exports`
  quando `typeof module !== 'undefined'` (padrão de `mesh.js`, `config.js`).
- Rodar testes com `npm test` (= `node --test`, recursivo — pega qualquer
  `*.test.js` novo automaticamente).

## Fora de escopo deste plano (documentado, não implementado)

- **`watchersOf` da origem não lista folhas individualmente** quando a
  árvore está ativa — a origem só tem `outConns` diretas pra quem é
  `'direct'` ou `'relay'`; a lista de "quem está assistindo" no próprio
  tile vai mostrar o relay, mas não vai discriminar as folhas atrás dele.
  A spec de F2 não cobre essa interação (a lista "assistindo" é de uma
  spec anterior). Registrar como limitação conhecida, não resolver aqui.
- **Recomputo contínuo por RTT** (reotimizar a árvore a cada amostra de
  stats) não é implementado — geraria troca de papel (e portanto corte +
  reconexão) toda hora. O recálculo acontece só em eventos discretos:
  peer entra, peer sai, relay falha. Ver Task 4.
- Overflow (mais peers do que uma árvore de profundidade 2 com fanout 1×2
  comporta — ou seja, mais de 1 relay + 2 folhas) cai para `'direct'`
  (malha) com a origem — decisão registrada no Task 2 porque a spec não
  especifica esse caso; ela só valida uma sala de 4 (exatamente a
  capacidade da árvore).

---

### Task 1: `cfg.network.tree` — interruptor desligado por padrão

**Files:**
- Modify: `src/renderer/config.js:57-60` (`DEFAULTS.network`)
- Test: `src/renderer/config.test.js`

**Interfaces:**
- Produces: `DEFAULTS.network.tree === false`. `config.load(json).network.tree`
  é sempre booleano (migra config antigo sem a chave pro default `false`,
  do mesmo jeito que `mergeSection` já faz pra `advertise`).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `src/renderer/config.test.js`:

```js
test('network.tree comeca desligado e config antigo migra pra false', () => {
  const fresh = load(null);
  assert.equal(fresh.network.tree, false);

  const old = serialize({ ...DEFAULTS, network: { advertise: true } }); // sem 'tree'
  const cfg = load(old);
  assert.equal(cfg.network.tree, false);
  assert.equal(cfg.network.advertise, true);
});

test('network.tree e preservado quando ja esta salvo como true', () => {
  const saved = serialize({ ...DEFAULTS, network: { advertise: true, tree: true } });
  const cfg = load(saved);
  assert.equal(cfg.network.tree, true);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test src/renderer/config.test.js`
Expected: FAIL em `network.tree comeca desligado...` (`undefined` não é
`false` — `assert.equal` com `!=` frouxo passaria, então use
`assert.equal(fresh.network.tree, false)` mesmo assim para deixar a
intenção clara; ele falha porque hoje `network` não tem a chave `tree` e
`DEFAULTS.network` também não).

- [ ] **Step 3: Implementar**

Em `src/renderer/config.js`, dentro de `DEFAULTS`:

```js
    network: {
      advertise: true,
      tree: false,
    },
```

Nada mais muda: `mergeSection(DEFAULTS.network, parsed.network)` (linha
104: `network: mergeSection(DEFAULTS.network, parsed.network)`) já faz
spread de `DEFAULTS` por baixo do que veio salvo, então config antigo sem
`tree` herda `false` automaticamente.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test src/renderer/config.test.js`
Expected: PASS, todos os testes (os novos e os que já existiam).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/config.js src/renderer/config.test.js
git commit -m "feat(f2): flag cfg.network.tree, desligada por padrao"
```

---

### Task 2: `tree.js` — cálculo puro da topologia

**Files:**
- Create: `src/renderer/tree.js`
- Test: `src/renderer/tree.test.js`
- Modify: `src/renderer/index.html:154` (adicionar `<script src="tree.js">`
  antes de `mesh.js`, já que `app.js` vai depender de ambos e a ordem de
  script tags não importa entre os dois — mas manter alfabético/lógico com
  os demais módulos de domínio antes de `ui.js`)

**Interfaces:**
- Produces: `window.GoLive.tree.computeTree(originId, candidates)` →
  `Map<peerId, { role: 'relay'|'folha'|'direct', paiId: string, filhosIds: string[] }>`.
  `candidates` é `Array<{ id: string, joinedAt: number, rtt: number|null,
  transmitting: boolean, suspended: boolean }>` (não inclui a própria
  origem). Também exporta `FANOUT_ORIGEM`, `FANOUT_RELAY`,
  `PROFUNDIDADE_MAX`.
- Consumes: nada (módulo puro, sem WebRTC, sem DOM — é o que o torna
  testável em `node:test` sem mocks pesados).

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/renderer/tree.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeTree, FANOUT_ORIGEM, FANOUT_RELAY, PROFUNDIDADE_MAX } = require('./tree');

test('constantes batem com a spec de 2026-08-23 (F2)', () => {
  assert.equal(FANOUT_ORIGEM, 1);
  assert.equal(FANOUT_RELAY, 2);
  assert.equal(PROFUNDIDADE_MAX, 2);
});

test('sala de 4 (origem + 3): 1 relay, 2 folhas -- cenario de validacao da spec', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 40, transmitting: false, suspended: false },
    { id: 'c', joinedAt: 2, rtt: 10, transmitting: false, suspended: false },
    { id: 'd', joinedAt: 3, rtt: 90, transmitting: false, suspended: false },
  ];
  const out = computeTree('a', candidates);

  assert.equal(out.get('c').role, 'relay'); // menor RTT vence
  assert.deepEqual(out.get('c').paiId, 'a');
  assert.deepEqual(out.get('c').filhosIds.sort(), ['b', 'd']);

  assert.equal(out.get('b').role, 'folha');
  assert.equal(out.get('b').paiId, 'c');
  assert.equal(out.get('d').role, 'folha');
  assert.equal(out.get('d').paiId, 'c');
});

test('desempate por quem entrou ha mais tempo quando RTT e igual ou desconhecido', () => {
  const candidates = [
    { id: 'b', joinedAt: 5, rtt: null, transmitting: false, suspended: false },
    { id: 'c', joinedAt: 1, rtt: null, transmitting: false, suspended: false },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('c').role, 'relay'); // entrou primeiro
  assert.equal(out.get('b').role, 'folha');
});

test('quem esta transmitindo ou suspenso nao e candidato a relay', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: true, suspended: false },  // ja e origem de outra arvore
    { id: 'c', joinedAt: 2, rtt: 5, transmitting: false, suspended: true },  // minimizou (F1.3)
    { id: 'd', joinedAt: 3, rtt: 999, transmitting: false, suspended: false },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('d').role, 'relay'); // unico elegivel, mesmo com RTT ruim
  assert.equal(out.get('b').role, 'folha');
  assert.equal(out.get('c').role, 'folha');
});

test('sem nenhum candidato elegivel, todo mundo cai pra direct (malha)', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: true, suspended: false },
    { id: 'c', joinedAt: 2, rtt: 5, transmitting: true, suspended: false },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('b').role, 'direct');
  assert.equal(out.get('c').role, 'direct');
  assert.equal(out.get('b').paiId, 'a');
});

test('overflow alem da capacidade do relay (fanout 2) cai pra direct com a origem', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 10, transmitting: false, suspended: false }, // vira relay
    { id: 'c', joinedAt: 2, rtt: 20, transmitting: false, suspended: false },
    { id: 'd', joinedAt: 3, rtt: 30, transmitting: false, suspended: false },
    { id: 'e', joinedAt: 4, rtt: 40, transmitting: false, suspended: false }, // excedente
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('b').role, 'relay');
  assert.deepEqual(out.get('b').filhosIds.sort(), ['c', 'd']);
  assert.equal(out.get('e').role, 'direct');
  assert.equal(out.get('e').paiId, 'a');
});

test('lista de candidatos vazia devolve mapa vazio', () => {
  assert.equal(computeTree('a', []).size, 0);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test src/renderer/tree.test.js`
Expected: FAIL — `Cannot find module './tree'`.

- [ ] **Step 3: Implementar**

Criar `src/renderer/tree.js`:

```js
'use strict';

(function (root) {
  // Valores travados na spec de 2026-08-23 (F2, "Papeis e escolha do
  // relay"). A origem manda pra UM so relay; cada relay atende no maximo
  // dois; a arvore nao passa de origem -> relay -> folha. Profundidade
  // maxima 2 e o freio de latencia E a garantia contra ciclo -- com a
  // arvore recalculada so pela origem, nao ha como um no virar ancestral
  // de si mesmo.
  const FANOUT_ORIGEM = 1;
  const FANOUT_RELAY = 2;
  const PROFUNDIDADE_MAX = 2;

  // candidates: Array<{ id, joinedAt, rtt: number|null, transmitting,
  // suspended }> -- todo peer da sala, exceto a propria origem.
  //
  // Devolve Map<peerId, { role: 'relay'|'folha'|'direct', paiId, filhosIds }>.
  // 'direct' fica fora da arvore e recebe oferta direta da origem -- e o
  // fallback de malha, tanto pra "nenhum candidato elegivel" quanto pro
  // excedente que nao cabe no fanout de um relay so (a spec so cobre o
  // caso de uma sala de 4, que cabe exatamente; excedente alem disso e uma
  // decisao deste modulo, nao da spec).
  function computeTree(originId, candidates) {
    const assignments = new Map();
    if (!candidates.length) return assignments;

    // Nao pode estar transmitindo (ja e origem de outra arvore) nem estar
    // suspenso por F1.3 (quem minimizou nao e candidato).
    const eligible = candidates.filter((c) => !c.transmitting && !c.suspended);

    eligible.sort((a, b) => {
      const rttA = a.rtt == null ? Infinity : a.rtt;
      const rttB = b.rtt == null ? Infinity : b.rtt;
      if (rttA !== rttB) return rttA - rttB;
      return a.joinedAt - b.joinedAt; // desempate: quem entrou ha mais tempo
    });

    const relay = eligible[0] || null;

    if (!relay) {
      for (const c of candidates) assignments.set(c.id, { role: 'direct', paiId: originId, filhosIds: [] });
      return assignments;
    }

    const rest = candidates.filter((c) => c.id !== relay.id);
    const leaves = rest.slice(0, FANOUT_RELAY);
    const leafIds = leaves.map((c) => c.id);
    const overflow = rest.filter((c) => !leafIds.includes(c.id));

    assignments.set(relay.id, { role: 'relay', paiId: originId, filhosIds: leafIds });
    for (const leaf of leaves) assignments.set(leaf.id, { role: 'folha', paiId: relay.id, filhosIds: [] });
    for (const extra of overflow) assignments.set(extra.id, { role: 'direct', paiId: originId, filhosIds: [] });

    return assignments;
  }

  const api = { computeTree, FANOUT_ORIGEM, FANOUT_RELAY, PROFUNDIDADE_MAX };

  root.GoLive = root.GoLive || {};
  root.GoLive.tree = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
```

Em `src/renderer/index.html`, logo antes de `<script src="mesh.js"></script>`
(linha 154):

```html
<script src="tree.js"></script>
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test src/renderer/tree.test.js`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/tree.js src/renderer/tree.test.js src/renderer/index.html
git commit -m "feat(f2): modulo puro de calculo da arvore de retransmissao"
```

---

### Task 3: `mesh.js` — guardar stream recebida, repassar, fechar out-conn por peer

**Files:**
- Modify: `src/renderer/mesh.js:80-124` (`addPeer`, `makeConnection`)
- Modify: `src/renderer/mesh.js:358-375` (objeto retornado por `createMesh`)
- Test: `src/renderer/mesh.test.js`

**Interfaces:**
- Consumes: nada novo (usa `RTCPeerConnection`, já usado pelo resto do
  arquivo).
- Produces:
  - `peer.joinedAt: number` (timestamp de quando `addPeer` criou o peer —
    usado pelo desempate de `tree.computeTree`).
  - `peer.inStreams[kind]: MediaStream` (guardado no evento `track` de uma
    conexão `'in'` — hoje só é repassado pro `onTrack`, não fica guardado).
  - `mesh.relayTo(childId, sourcePeerId, kind, quality) => Promise<boolean>`
    — repassa `peers.get(sourcePeerId).inStreams[kind]` pra `childId` via
    `offerTo`. Devolve `false` sem lançar se não há stream recebida daquele
    `sourcePeerId`/`kind` ainda (a `offer` pode não ter chegado antes do
    `tree` — ver Task 5, que trata esse caso de corrida).
  - `mesh.closeOut(peerId, kind)` — fecha só a `outConn` daquele
    peer/kind (usa `pc.close()`, não `replaceTrack` — isto é troca de
    PAPEL na árvore, não suspensão de demanda de F1.3).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `src/renderer/mesh.test.js`:

```js
// --- F2: inStreams, relayTo, closeOut ---

test('addPeer registra joinedAt', () => {
  const mesh = createMesh({ send() {}, onTrack() {}, onPeerState() {} });
  const before = Date.now();
  mesh.addPeer('7', 'Bruno');
  const peer = mesh.peers.get('7');
  assert.ok(typeof peer.joinedAt === 'number');
  assert.ok(peer.joinedAt >= before);
});

test('closeOut fecha so a outConn daquele peer/kind, sem afetar outros', () => {
  const mesh = createMesh({ send() {}, onTrack() {}, onPeerState() {} });
  mesh.addPeer('7', 'Bruno');
  let screenClosed = false;
  let cameraClosed = false;
  mesh.peers.get('7').outConns.screen = { close: () => { screenClosed = true; } };
  mesh.peers.get('7').outConns.camera = { close: () => { cameraClosed = true; } };

  mesh.closeOut('7', 'screen');

  assert.equal(screenClosed, true);
  assert.equal(cameraClosed, false);
  assert.equal(mesh.peers.get('7').outConns.screen, null);
  assert.ok(mesh.peers.get('7').outConns.camera); // intacta
});

test('closeOut em peer ou kind sem conexao e ignorado, sem lancar', () => {
  const mesh = createMesh({ send() {}, onTrack() {}, onPeerState() {} });
  mesh.addPeer('7', 'Bruno');
  assert.doesNotThrow(() => mesh.closeOut('7', 'camera'));
  assert.doesNotThrow(() => mesh.closeOut('999', 'screen'));
});

test('relayTo sem stream recebida ainda (corrida tree x offer) devolve false, sem lancar', async () => {
  const mesh = createMesh({ send() {}, onTrack() {}, onPeerState() {} });
  mesh.addPeer('origem', 'Ana');
  const ok = await mesh.relayTo('folha', 'origem', 'screen', { bitrate: 1_000_000, fps: 30, codec: 'video/H264' });
  assert.equal(ok, false);
});

// Fake minimo de RTCPeerConnection: so o suficiente pra offerTo (chamado
// por relayTo) rodar sem lancar. RTCRtpSender.getCapabilities devolvendo
// null faz preferCodec voltar cedo (ver mesh.js), entao nao precisa
// simular codecs de verdade.
function installFakeWebRTC() {
  global.RTCRtpSender = { getCapabilities: () => null };
  global.RTCPeerConnection = class {
    constructor() {
      this.senders = [];
      this.localDescription = null;
    }
    addEventListener() {}
    addTransceiver(track) {
      const sender = { track, getParameters: () => ({}), setParameters: () => Promise.resolve() };
      this.senders.push(sender);
      return { sender, setCodecPreferences: undefined };
    }
    createOffer() {
      return Promise.resolve({ type: 'offer', sdp: 'v=0' });
    }
    setLocalDescription(desc) {
      this.localDescription = desc;
      return Promise.resolve();
    }
    getSenders() {
      return this.senders;
    }
  };
}

test('relayTo com stream recebida chama offerTo e manda offer pro filho', async () => {
  installFakeWebRTC();
  const sent = [];
  const mesh = createMesh({ send: (msg) => sent.push(msg), onTrack() {}, onPeerState() {} });
  mesh.addPeer('origem', 'Ana');
  mesh.addPeer('folha', 'Bruno');

  const videoTrack = { kind: 'video' };
  const fakeStream = { getTracks: () => [videoTrack], getVideoTracks: () => [videoTrack] };
  mesh.peers.get('origem').inStreams = { screen: fakeStream };

  const ok = await mesh.relayTo('folha', 'origem', 'screen', { bitrate: 1_000_000, fps: 30, codec: 'video/H264' });

  assert.equal(ok, true);
  assert.equal(videoTrack.contentHint, 'motion');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'offer');
  assert.equal(sent[0].to, 'folha');
  assert.equal(sent[0].kind, 'screen');

  delete global.RTCPeerConnection;
  delete global.RTCRtpSender;
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test src/renderer/mesh.test.js`
Expected: FAIL — `mesh.closeOut is not a function`, `mesh.relayTo is not a
function`, `peer.joinedAt` undefined.

- [ ] **Step 3: Implementar**

Em `src/renderer/mesh.js`, `addPeer` (linha 80-87), guardar `joinedAt`:

```js
    function addPeer(id, name, avatar) {
      if (!peers.has(id)) {
        peers.set(id, {
          id, name, avatar: avatar || null, live: false,
          outConns: {}, inConns: {}, joinedAt: Date.now(),
        });
      } else if (avatar) {
        peers.get(id).avatar = avatar;
      }
      return peers.get(id);
    }
```

Em `makeConnection` (linha 108-113), guardar a stream recebida:

```js
      if (dir === 'in') {
        pc.addEventListener('track', (event) => {
          const peer = peers.get(peerId);
          if (peer) (peer.inStreams ||= {})[kind] = event.streams[0];
          onTrack(peerId, peer ? peer.name : peerId, event.streams[0], kind);
        });
      }
```

Duas funções novas, perto de `removeTrack` (depois da linha 266):

```js
    // Fecha so a outConn de um peer/kind especifico, sem mexer no outro
    // kind do mesmo peer nem nos demais peers. Usado na troca de PAPEL na
    // arvore (F2): a origem para de mandar direto pra um peer que passou a
    // ser folha de um relay. Diferente de setPeerDemand (F1.3): aqui a
    // conexao fecha de verdade, porque quem vai mandar video pra esse peer
    // e outro no (o relay), nao mais a origem.
    function closeOut(peerId, kind) {
      const peer = peers.get(peerId);
      const pc = peer?.outConns[kind];
      if (!pc) return;
      pc.close();
      peer.outConns[kind] = null;
    }

    // Repassa uma track JA RECEBIDA (peers.get(sourcePeerId).inStreams[kind])
    // pra um peer abaixo na arvore (F2). O Chromium recodifica -- nao existe
    // passagem direta de frame codificado entre RTCPeerConnections -- entao
    // isto custa 1 decode + 1 encode a mais no relay. Ver a spec de
    // 2026-08-23, secao F2.
    //
    // Devolve false sem lancar se a stream ainda nao chegou (a mensagem
    // 'tree' pode chegar antes da 'offer' da origem terminar de negociar --
    // ver o retry em app.js, Task 5).
    async function relayTo(childId, sourcePeerId, kind, quality) {
      const inbound = peers.get(sourcePeerId)?.inStreams?.[kind];
      if (!inbound) return false;
      const track = inbound.getVideoTracks()[0];
      // Heranca do contentHint da origem nao e garantida pelo Chromium na
      // recodificacao -- reaplicar aqui.
      if (track) track.contentHint = 'motion';
      await offerTo(childId, inbound, quality, kind);
      return true;
    }
```

E no `return` de `createMesh` (linha 358-375), adicionar `closeOut` e
`relayTo`:

```js
    return {
      peers,
      addPeer,
      removePeer,
      handleOffer,
      handleAnswer,
      handleIce,
      offerTo,
      removeTrack,
      applyEncoding,
      closeAllOut,
      closeOut,
      relayTo,
      statsFor,
      setPeerDemand,
      isPeerSuspended,
      receivingFrom,
      watchersOf,
    };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test src/renderer/mesh.test.js`
Expected: PASS, todos os testes (os novos e os que já existiam).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/mesh.js src/renderer/mesh.test.js
git commit -m "feat(f2): mesh.js ganha relayTo, closeOut e inStreams"
```

---

### Task 4: `app.js` — a origem calcula e aplica a topologia

**Files:**
- Modify: `src/renderer/app.js` (estado no topo da IIFE, perto da linha 40;
  `peer-joined`/`peer-left` no `handleSignal`, linhas 573-596; fim de
  `startShare`, linha 982-983)

**Interfaces:**
- Consumes: `window.GoLive.tree.computeTree` (Task 2), `mesh.offerTo`,
  `mesh.closeOut`, `mesh.isPeerSuspended` (já existiam), `mesh.peers`
  (com `joinedAt` da Task 3).
- Produces:
  - `originTree.screen` / `originTree.camera`:
    `{ epoch: number, assignments: Map<peerId, assignment> }` — a última
    topologia que ESTA sessão calculou pra aquele kind (só é significativo
    quando esta sessão é a origem daquele kind, i.e. `localStream`/
    `cameraStream` existe).
  - `recomputeTree(kind)` — chamada em peer-joined, peer-left e ao começar
    a transmitir. Não faz nada se `cfg.network.tree` for `false` ou se não
    houver stream local daquele kind.
  - Usado pela Task 6 (`recoverFromRelayLoss`) e Task 7 (`onPeerState`).

- [ ] **Step 1: Escrever o teste manual que vai validar isto (sem WebRTC real
  não dá pra automatizar — ver Task 9 pro checklist completo)**

Este task não tem teste automatizado próprio: `recomputeTree` e
`applyOriginAssignments` chamam `mesh.offerTo`/`mesh.closeOut`, que por sua
vez dependem de `RTCPeerConnection` real (o Electron). A cobertura
automatizada já existe nas pontas puras (`tree.computeTree` no Task 2,
`mesh.closeOut`/`relayTo` no Task 3). Este task é verificado manualmente no
Task 9. Antes de implementar, confirme que os testes dos Tasks 1-3 continuam
passando:

Run: `npm test`
Expected: PASS (nenhuma regressão nos tasks anteriores).

- [ ] **Step 2: Implementar o estado**

Em `src/renderer/app.js`, perto da declaração de `myId` (linha 15), somar:

```js
  const { tree } = window.GoLive;

  // Topologia da arvore de retransmissao (F2), por kind -- so significativa
  // quando ESTA sessao e a origem daquele kind (localStream/cameraStream
  // existe). epoch sobe a cada recalculo, mesmo quando o resultado nao
  // muda -- o pior caso e um recalculo redundante, nao uma atribuicao velha
  // vencendo (ver a mensagem 'tree' em handleSignal, Task 5).
  const originTree = {
    screen: { epoch: 0, assignments: new Map() },
    camera: { epoch: 0, assignments: new Map() },
  };
```

- [ ] **Step 3: Implementar `recomputeTree` e `applyOriginAssignments`**

Perto de `broadcastWatchers` (depois da linha 1155):

```js
  // ---------- Arvore de retransmissao (F2, spec de 2026-08-23) ----------

  // So a origem chama isto, e so quando aquele kind esta ao vivo. Junta os
  // candidatos (todo peer da sala, com o RTT mais recente medido nas
  // estatisticas -- ver updateStats na Task 8) e delega o calculo puro pro
  // modulo tree.js. Recalculo e discreto: peer entrou/saiu, ou comecamos a
  // transmitir -- NAO a cada amostra de RTT (evitaria trocar de papel toda
  // hora). Ver "Fora de escopo" no cabecalho deste plano.
  function recomputeTree(kind) {
    const session = currentSession;
    if (!session?.mesh || !cfg.network.tree) return;
    const stream = kind === 'camera' ? cameraStream : localStream;
    if (!stream) return;

    const candidates = [];
    for (const [id, peer] of session.mesh.peers) {
      candidates.push({
        id,
        joinedAt: peer.joinedAt || 0,
        rtt: peer.rtt?.[kind] ?? null,
        transmitting: Boolean(peer.live),
        suspended: session.mesh.isPeerSuspended(id, kind),
      });
    }
    if (!candidates.length) return;

    const assignments = tree.computeTree(myId, candidates);
    const epoch = ++originTree[kind].epoch;
    originTree[kind].assignments = assignments;
    applyOriginAssignments(session, kind, assignments, epoch);
  }

  // Distribui os papeis calculados: manda 'tree' pra todo mundo (protocolo
  // exato da spec: { type, to, kind, origem, paiId, filhos, epoch }), e
  // ajusta as outConns desta sessao pra bater com o papel de cada um.
  // 'direct' e 'relay' recebem oferta direta (se ainda nao tiverem); quem
  // virou 'folha' e cortado daqui -- quem vai mandar pra ele e o relay, via
  // relayTo (Task 5).
  function applyOriginAssignments(session, kind, assignments, epoch) {
    const stream = kind === 'camera' ? cameraStream : localStream;
    const quality = kind === 'camera' ? { ...cfg.camera, codec: 'video/VP8' } : cfg.quality;

    for (const [peerId, assignment] of assignments) {
      session.sig.send({
        type: 'tree', to: peerId, kind,
        origem: myId, paiId: assignment.paiId, filhos: assignment.filhosIds, epoch,
      });

      const hasOutConn = Boolean(session.mesh.peers.get(peerId)?.outConns[kind]);
      if (assignment.role === 'direct' || assignment.role === 'relay') {
        if (!hasOutConn) session.mesh.offerTo(peerId, stream, quality, kind).catch(() => {});
      } else {
        session.mesh.closeOut(peerId, kind);
      }
    }

    broadcastWatchers(kind);
  }
```

- [ ] **Step 4: Ligar `recomputeTree` aos eventos discretos**

No `case 'peer-joined'` de `handleSignal` (linha 573-585), depois de
`broadcastWatchers('screen')`/`broadcastWatchers('camera')`, somar as
chamadas (o bloco inteiro fica assim):

```js
      case 'peer-joined': {
        mesh.addPeer(msg.id, msg.name, msg.avatar);
        renderMembersPanel();
        sound.playJoinSound();
        if (localStream) {
          await mesh.offerTo(msg.id, localStream, cfg.quality, 'screen');
          broadcastWatchers('screen'); // novo espectador -- entra "assistindo" por padrao
          recomputeTree('screen');
        }
        if (cameraStream) {
          await mesh.offerTo(msg.id, cameraStream, { ...cfg.camera, codec: 'video/VP8' }, 'camera');
          broadcastWatchers('camera');
          recomputeTree('camera');
        }
        break;
      }
```

No `case 'peer-left'` (linha 587-596), depois de
`broadcastWatchers('camera')`:

```js
      case 'peer-left': {
        mesh.removePeer(msg.id);
        ui.grid.removeTile(msg.id, emptyMessage());
        ui.grid.removeTile(`cam-${msg.id}`, emptyMessage());
        renderMembersPanel();
        sound.playLeaveSound();
        broadcastWatchers('screen'); // quem saiu pode ter sido um espectador na lista
        broadcastWatchers('camera');
        recomputeTree('screen');
        recomputeTree('camera');
        break;
      }
```

Em `startShare`, depois de `broadcastWatchers('screen')` (linha 982):

```js
      broadcastWatchers('screen'); // lista inicial: todo mundo conta como assistindo
      recomputeTree('screen');
```

Em `startCamera`, depois de `broadcastWatchers('camera')` (linha 1046):

```js
        broadcastWatchers('camera'); // lista inicial: todo mundo conta como assistindo
        recomputeTree('camera');
```

- [ ] **Step 5: Rodar os testes automatizados (regressão)**

Run: `npm test`
Expected: PASS. Nada neste task tem teste próprio (depende de
`RTCPeerConnection` real), mas nenhuma regressão nos tasks anteriores.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/app.js
git commit -m "feat(f2): origem calcula e aplica a topologia da arvore"
```

---

### Task 5: `app.js` — receber `tree`, relay repassa pros filhos (com retry de corrida)

**Files:**
- Modify: `src/renderer/app.js` (estado `myRole` perto de `originTree`;
  novo `case 'tree'` em `handleSignal`; ajuste no `case 'offer'` existente)

**Interfaces:**
- Consumes: `mesh.relayTo` (Task 3).
- Produces: `myRole.screen` / `myRole.camera`:
  `{ epoch, role: 'direct'|'relay'|'folha', paiId: string|null,
  filhosIds: string[], relayed: Set<string> }` — o papel que ESTA sessão
  recebeu de alguma origem (só relevante quando não é a própria origem
  daquele kind). Usado pela Task 6 (propagação de demanda) e Task 7
  (recuperação).

- [ ] **Step 1: Escrever o teste manual (ver observação do Task 4 — sem
  WebRTC real isto não é testável em `node:test`; a Task 9 cobre isto no
  checklist manual)**

Run: `npm test`
Expected: PASS (regressão dos tasks anteriores, antes de mexer).

- [ ] **Step 2: Implementar o estado**

Ao lado de `originTree` (Task 4, Step 2):

```js
  // Papel que ESTA sessao recebeu de alguma origem, por kind -- so
  // relevante quando esta sessao NAO e a origem daquele kind. 'relayed'
  // registra pra quais filhos ja repassamos NESTE epoch, pra relayTo nao
  // ser chamado duas vezes pro mesmo filho (duplicaria transceivers) --
  // ver o retry em 'offer' no Step 3.
  const myRole = {
    screen: { epoch: 0, role: 'direct', paiId: null, filhosIds: [], relayed: new Set() },
    camera: { epoch: 0, role: 'direct', paiId: null, filhosIds: [], relayed: new Set() },
  };
```

- [ ] **Step 3: Implementar o `case 'tree'` e o retry de corrida**

O protocolo manda `paiId` e `filhos`, sem um campo `role` explícito — dá
pra inferir sem ambiguidade: `filhos.length > 0` é relay; senão, se
`paiId === origem` é `'direct'` (a própria origem, sem intermediário);
senão é `'folha'` (o pai é um relay, não a origem).

Perto de `broadcastWatchers` (a mesma área da Task 4), somar:

```js
  // Tenta repassar (relayTo) pros filhos pendentes deste epoch. Chamado
  // tanto ao receber 'tree' (o caso comum: a offer da origem ja chegou)
  // quanto depois de processar uma 'offer' daquela origem (o caso de
  // corrida: 'tree' chegou ANTES da offer terminar de negociar, entao
  // mesh.relayTo devolveu false na hora -- ver Task 3). 'relayed' evita
  // repassar duas vezes pro mesmo filho.
  async function flushPendingRelay(session, kind, sourcePeerId) {
    const state = myRole[kind];
    if (state.role !== 'relay' || state.paiId !== sourcePeerId) return;
    const quality = kind === 'camera' ? { ...cfg.camera, codec: 'video/VP8' } : cfg.quality;
    for (const childId of state.filhosIds) {
      if (state.relayed.has(childId)) continue;
      const ok = await session.mesh.relayTo(childId, sourcePeerId, kind, quality);
      if (ok) state.relayed.add(childId);
    }
  }
```

No `switch` de `handleSignal`, adicionar o `case 'tree'` (perto do `case
'watchers'`, linha 642-646):

```js
      // Atribuicao de papel na arvore de retransmissao (F2), mandada pela
      // origem daquele kind. epoch descarta atribuicao velha (mensagens
      // cruzando) -- mesmo padrao do currentSession !== session usado no
      // resto deste arquivo. Ver a spec de 2026-08-23, secao F2.
      case 'tree': {
        const kind = msg.kind;
        if (kind !== 'screen' && kind !== 'camera') break;
        const state = myRole[kind];
        if (msg.epoch < state.epoch) break;
        state.epoch = msg.epoch;
        state.paiId = msg.paiId;
        state.filhosIds = Array.isArray(msg.filhos) ? msg.filhos : [];
        state.relayed = new Set();
        state.role = state.filhosIds.length
          ? 'relay'
          : msg.paiId === msg.origem ? 'direct' : 'folha';

        if (state.role === 'relay') await flushPendingRelay(session, kind, msg.origem);
        break;
      }
```

E no `case 'offer'` já existente (linha 597-607), depois de mandar o
`view-state` de correção de visibilidade, tentar destravar um relay
pendente:

```js
      case 'offer': {
        const answerSdp = await mesh.handleOffer(msg.from, msg.sdp, msg.kind);
        if (currentSession !== session) return; // sessao caiu enquanto negociava
        sig.send({ type: 'answer', to: msg.from, sdp: answerSdp, kind: msg.kind });
        if (!isAppVisible()) sig.send({ type: 'view-state', to: msg.from, kind: msg.kind, watching: false });
        await flushPendingRelay(session, msg.kind, msg.from);
        break;
      }
```

- [ ] **Step 4: Rodar os testes automatizados (regressão)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/app.js
git commit -m "feat(f2): recebe tree e repassa pros filhos, com retry de corrida offer/tree"
```

---

### Task 6: `app.js` — demanda (F1.3) propaga rio acima através do relay

**Files:**
- Modify: `src/renderer/app.js:1127-1134` (`broadcastViewState`), e o
  `case 'view-state'` em `handleSignal` (linha 629-636)

**Interfaces:**
- Consumes: `myRole` (Task 5), `mesh.isPeerSuspended` (já existia).
- Produces: nenhuma interface nova — ajusta comportamento existente.

Regra da spec (§F2 "Demanda propaga pra cima"): um relay só pode dizer
"não estou assistindo" pra origem se ele **e toda a sua sub-árvore**
(folhas) não estiverem olhando.

- [ ] **Step 1: Escrever o teste manual (mesma observação — sem WebRTC real
  não dá pra automatizar; checklist no Task 9)**

Run: `npm test`
Expected: PASS antes de mexer.

- [ ] **Step 2: Implementar**

`broadcastViewState` (linha 1127-1134) hoje manda o mesmo `watching`
(`isAppVisible()`) pra todo peer de quem recebemos vídeo. Passa a
considerar a sub-árvore quando esta sessão é relay daquele peer:

```js
  // Avisa cada transmissor de quem estamos recebendo se ainda estamos ou
  // nao olhando. Peer que nunca recebeu um 'view-state' conta como
  // assistindo -- padrao seguro. Quando esta sessao e RELAY do peer em
  // questao (F2), o watching mandado pra cima e agregado: continua "sim"
  // se qualquer folha da nossa sub-arvore ainda estiver olhando, mesmo que
  // esta janela esteja minimizada -- um relay que minimizou mas tem
  // espectadores atras nao pode cortar o encode de quem esta assistindo de
  // verdade. Ver a spec de 2026-08-23, secao "Demanda propaga pra cima".
  function broadcastViewState() {
    const session = currentSession;
    if (!session?.mesh || !session.sig.isOpen()) return;
    for (const { peerId, kind } of session.mesh.receivingFrom()) {
      const state = myRole[kind];
      const isUpstreamOfRelay = state.role === 'relay' && state.paiId === peerId;
      const anyFolhaWatching = isUpstreamOfRelay
        && state.filhosIds.some((id) => !session.mesh.isPeerSuspended(id, kind));
      const watching = isAppVisible() || anyFolhaWatching;
      session.sig.send({ type: 'view-state', to: peerId, kind, watching });
    }
  }
```

No `case 'view-state'` (linha 629-636), quando esta sessão é relay e a
suspensão de uma folha muda, precisa reavaliar o que reporta pra origem —
reusa `broadcastViewState()` em vez de criar uma função nova:

```js
      case 'view-state': {
        const track = trackForKind(msg.kind);
        if (mesh.setPeerDemand(msg.from, msg.kind, Boolean(msg.watching), track)) {
          renderMembersPanel();
          broadcastWatchers(msg.kind);
          broadcastViewState(); // se formos relay, isto pode mudar o que reportamos rio acima
        }
        break;
      }
```

- [ ] **Step 3: Rodar os testes automatizados (regressão)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/app.js
git commit -m "feat(f2): demanda de F1.3 propaga rio acima atraves do relay"
```

---

### Task 7: `app.js` — recuperação (relay sai da sala, ou conexão origem→relay falha)

**Files:**
- Modify: `src/renderer/app.js` (novo `recoverFromRelayLoss`; ajuste no
  `case 'peer-left'`; ajuste no `onPeerState` passado a `createMesh`)
- Modify: `src/renderer/mesh.js:115-121` (`connectionstatechange` — passar
  `dir` e `failed` pro callback)
- Test: `src/renderer/mesh.test.js` (cobre só a mudança de `mesh.js`; a
  reação em `app.js` é manual — Task 9)

**Interfaces:**
- Consumes: `originTree` (Task 4).
- Produces: `onPeerState(peerId, { removedTile, kind, dir, failed })` — dois
  campos novos no payload que `mesh.js` já mandava pro callback
  `onPeerState` de `createMesh`.

- [ ] **Step 1: Escrever o teste que falha (parte de mesh.js)**

Este teste cobre só que o payload de `onPeerState` ganhou `dir`/`failed` —
o resto (reação em `app.js`) precisa de `RTCPeerConnection` real e fica pro
checklist manual do Task 9. Adicionar a `src/renderer/mesh.test.js`:

```js
test('onPeerState recebe dir e failed no payload (F2: distinguir falha de out-conn pra relay)', () => {
  // makeConnection nao e exportado -- exercita via ensureOutConn/ensureInConn,
  // que criam RTCPeerConnection de verdade. Sem RTCPeerConnection no
  // ambiente Node, isto so roda com o fake instalado (mesmo do teste
  // anterior de relayTo).
  installFakeWebRTC();
  global.RTCPeerConnection.prototype.connectionState = 'failed';
  // Estende o fake com addEventListener que guarda o listener de
  // connectionstatechange pra disparar manualmente.
  const listeners = [];
  const OriginalCtor = global.RTCPeerConnection;
  global.RTCPeerConnection = class extends OriginalCtor {
    addEventListener(event, fn) {
      if (event === 'connectionstatechange') listeners.push(fn);
    }
  };

  const events = [];
  const mesh = createMesh({
    send() {},
    onTrack() {},
    onPeerState: (peerId, payload) => events.push({ peerId, ...payload }),
  });
  mesh.addPeer('7', 'Bruno');
  mesh.peers.get('7'); // garante que o peer existe antes de abrir a conexao
  const pc = mesh.peers.get('7').outConns.screen; // ainda nao existe -- ensureOutConn cria abaixo

  // ensureOutConn nao e exportado; usa offerTo indiretamente via relayTo
  // seria mais indireto -- em vez disso, cria a conexao via handleOffer
  // (dir 'in') que E exportado, e cobre o mesmo trecho de connectionstatechange.
  mesh.handleOffer('7', { type: 'offer', sdp: 'v=0' }, 'screen');

  assert.equal(listeners.length, 1);
  listeners[0](); // dispara connectionstatechange com pc.connectionState = 'failed'

  assert.equal(events.length, 1);
  assert.equal(events[0].dir, 'in');
  assert.equal(events[0].failed, true);
  assert.equal(events[0].removedTile, true);

  delete global.RTCPeerConnection;
  delete global.RTCRtpSender;
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test src/renderer/mesh.test.js`
Expected: FAIL — `events[0].dir` é `undefined` (o payload de hoje só tem
`kind` e, às vezes, `removedTile`).

- [ ] **Step 3: Implementar a mudança em `mesh.js`**

Em `makeConnection` (linha 115-121):

```js
      pc.addEventListener('connectionstatechange', () => {
        const failed = ['failed', 'closed', 'disconnected'].includes(pc.connectionState);
        if (failed && dir === 'in') {
          onPeerState(peerId, { removedTile: true, kind, dir, failed });
        } else {
          onPeerState(peerId, { kind, dir, failed });
        }
      });
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test src/renderer/mesh.test.js`
Expected: PASS.

- [ ] **Step 5: Implementar a recuperação em `app.js`**

Perto de `applyOriginAssignments` (Task 4):

```js
  // Um relay saiu da sala (ou a conexao origem->relay caiu): as folhas dele
  // ficam orfas. Reconecta direto (malha) PRIMEIRO -- o video volta rapido
  // -- e SO DEPOIS recalcula a arvore (que pode escolher um relay novo).
  // Ver a spec de 2026-08-23, tabela de Recuperacao em F2.
  function recoverFromRelayLoss(kind, relayId) {
    const session = currentSession;
    const stream = kind === 'camera' ? cameraStream : localStream;
    if (!session?.mesh || !stream) return;
    const orphans = originTree[kind].assignments.get(relayId)?.filhosIds || [];
    if (!orphans.length) {
      recomputeTree(kind);
      return;
    }
    const quality = kind === 'camera' ? { ...cfg.camera, codec: 'video/VP8' } : cfg.quality;
    Promise.all(orphans.map((id) => session.mesh.offerTo(id, stream, quality, kind).catch(() => {})))
      .then(() => recomputeTree(kind));
  }
```

No `case 'peer-left'` (já tocado na Task 4), antes dos `recomputeTree`
finais, detectar se quem saiu era relay:

```js
      case 'peer-left': {
        mesh.removePeer(msg.id);
        ui.grid.removeTile(msg.id, emptyMessage());
        ui.grid.removeTile(`cam-${msg.id}`, emptyMessage());
        renderMembersPanel();
        sound.playLeaveSound();
        broadcastWatchers('screen');
        broadcastWatchers('camera');
        for (const kind of ['screen', 'camera']) {
          if (originTree[kind].assignments.get(msg.id)?.role === 'relay') {
            recoverFromRelayLoss(kind, msg.id);
          } else {
            recomputeTree(kind);
          }
        }
        break;
      }
```

(Isto substitui as duas chamadas `recomputeTree('screen')` /
`recomputeTree('camera')` adicionadas no Task 4, Step 4, dentro deste
`case` especificamente — fora dele, em `peer-joined`, permanecem como
estavam.)

No callback `onPeerState` passado a `meshModule.createMesh` (linha
506-510), reagir a uma falha na conexão *de saída* com um relay:

```js
      onPeerState: (peerId, { removedTile, kind, dir, failed }) => {
        if (currentSession !== session) return;
        if (removedTile) ui.grid.removeTile(kind === 'camera' ? `cam-${peerId}` : peerId, emptyMessage());
        if (failed && dir === 'out' && originTree[kind]?.assignments.get(peerId)?.role === 'relay') {
          recoverFromRelayLoss(kind, peerId);
        }
        renderMembersPanel();
      },
```

- [ ] **Step 6: Rodar os testes automatizados (regressão completa)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/app.js src/renderer/mesh.js src/renderer/mesh.test.js
git commit -m "feat(f2): recupera quando um relay sai ou a conexao com ele falha"
```

---

### Task 8: `app.js` — coletar RTT por peer nas estatísticas (alimenta `computeTree`)

**Files:**
- Modify: `src/renderer/app.js:1292-1306` (dentro de `updateStats`)

**Interfaces:**
- Produces: `peer.rtt[kind]: number|null` em cada peer de `mesh.peers` —
  consumido por `recomputeTree` (Task 4). Reusa `readSenderReport(report).rtt`,
  que `updateStats` já calcula por sender mas hoje descarta depois de montar
  `rows`.

- [ ] **Step 1: Ler o trecho atual pra confirmar o ponto de inserção**

`updateStats` (linha 1292 em diante) já faz, por peer × kind:
```js
for (const [peerId, peer] of activeMesh.peers) {
  for (const kind of ['screen', 'camera']) {
    if (currentSession !== session) return;
    const report = await activeMesh.statsFor(peerId, kind);
    if (!report) continue;
    // ... (aqui embaixo e onde entra readSenderReport(report))
```

- [ ] **Step 2: Implementar**

Dentro do mesmo loop, logo depois de `const sample = readSenderReport(report);`
(o nome exato da variável está no trecho que segue a linha 1306 — usar
`Read` em `src/renderer/app.js` por volta da linha 1300-1320 pra confirmar
o nome antes de editar, pode ter mudado), somar:

```js
        (peer.rtt ||= {})[kind] = sample.rtt || peer.rtt?.[kind] || null;
```

Regra: só sobrescreve com um valor novo se `sample.rtt` for verdadeiro
(`candidate-pair.currentRoundTripTime` pode não vir em toda amostra);
senão preserva o último valor conhecido em vez de apagar pra `null` a cada
poll.

- [ ] **Step 3: Rodar os testes automatizados (regressão)**

Run: `npm test`
Expected: PASS (não há teste automatizado direto pra `updateStats`, que
depende de `getStats()` real — cobertura é via checklist manual, Task 9).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/app.js
git commit -m "feat(f2): guarda RTT por peer, usado pra escolher o relay"
```

---

### Task 9: Configurações → Rede — interruptor da árvore + validação manual

**Files:**
- Modify: `src/renderer/ui.js:979-983` (`settingsPanes.network.innerHTML`)
  e `:1006-1008` (listener de `settings-advertise`)

**Interfaces:**
- Consumes: `deps.onNetworkChange` (já existe, genérico — Task já visto em
  `app.js:175-179`, não precisa mudar).

- [ ] **Step 1: Implementar o toggle**

Em `src/renderer/ui.js`, `settingsPanes.network.innerHTML` (linha 979-983):

```js
    settingsPanes.network.innerHTML = `
      <div class="settings-field">
        <label class="check-inline"><input id="settings-advertise" type="checkbox" /> Anunciar minha sala na rede</label>
        <small>Desligado, a sala funciona normalmente e só entra quem receber o endereço.</small>
      </div>
      <div class="settings-field">
        <label class="check-inline"><input id="settings-tree" type="checkbox" /> Retransmissão em cadeia (experimental)</label>
        <small>Reduz o custo pra quem transmite, às custas de um pouco de latência pra quem assiste.</small>
      </div>`;
```

Logo depois de `$('settings-advertise').checked = config.network.advertise;`
(linha 988):

```js
    $('settings-tree').checked = Boolean(config.network.tree);
```

Logo depois do listener de `settings-advertise` (linha 1006-1008):

```js
    $('settings-tree').addEventListener('change', () => {
      deps.onNetworkChange({ ...config.network, tree: $('settings-tree').checked });
    });
```

- [ ] **Step 2: Rodar os testes automatizados (regressão completa do plano)**

Run: `npm test`
Expected: PASS — todos os testes de `config.test.js`, `tree.test.js`,
`mesh.test.js`, `signaling-core.test.js` e os demais que já existiam
(`discovery.test.js`, `firewall.test.js`, `network.test.js`,
`ports.test.js`).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/ui.js
git commit -m "feat(f2): toggle de retransmissao em cadeia em Configuracoes > Rede"
```

- [ ] **Step 4: Checklist de validação manual (spec §8, seção F2)**

Isto não é automatizável (precisa de PCs reais na LAN, várias janelas do
GoLive, e jogo pesado rodando) — é o mesmo checklist que já levou à
decisão de implementar F2 (ver
`golive - árvore de retransmissão em vez de SFU no host` no vault).
Rodar **com `cfg.network.tree` ligado manualmente** nas Configurações, em
uma sala de 4 PCs (ou 4 janelas/perfis, se estiver testando sozinho antes
de validar entre PCs de verdade):

1. Sala de 4. Ligar a árvore. Nas estatísticas da origem: **1** sender de
   vídeo ativo, não 3.
2. `totalEncodeTime / framesEncoded` na origem cai proporcionalmente.
3. `encoderImplementation` na origem permanece hardware.
4. No relay: 1 decoder + 2 encoders ativos (ver painel de Estatísticas do
   relay).
5. Matar o relay (fechar o app). Cronometrar até o vídeo voltar nas
   folhas. **Meta: < 3s.**
6. Comparar lado a lado, no mesmo instante e num jogo com movimento, a
   imagem de uma folha (2 gerações) com a de um filho direto (1 geração).
   Se a diferença for visível a olho nu, revisar o bitrate do relay.
7. Minimizar o GoLive numa folha: confirmar que o relay continua
   recebendo e repassando pras outras folhas (a suspensão de F1.3 não
   pode se propagar rio acima enquanto houver *alguém* assistindo na
   sub-árvore — Task 6).
8. Fechar o app numa folha (não no relay): confirmar que só aquela folha
   some, sem afetar as demais nem o relay.

Registrar o resultado (com números, como a decisão de 2026-08-23 já fez
pra fase 1) na nota de decisão do vault antes de considerar ligar
`cfg.network.tree` como padrão pra todo mundo.

---

## Cobertura da spec (auto-revisão)

| Seção da spec (F2) | Task |
|---|---|
| Papéis e escolha do relay, fanout/profundidade | Task 2 |
| Protocolo `tree` (epoch, paiId, filhos) | Task 4 (envio), Task 5 (recepção) |
| `relayTo` / recodificação no relay | Task 3 |
| Interruptor `TREE_ENABLED` | Task 1, Task 9 |
| Recuperação (relay sai / conexão falha) | Task 7 |
| Demanda propaga pra cima | Task 6 |
| Fallback pra malha (sem candidato / overflow) | Task 2 |
| Como validar (§8) | Task 9, Step 4 |
