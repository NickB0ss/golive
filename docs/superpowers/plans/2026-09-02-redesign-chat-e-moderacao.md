# Redesign + Chat + Poderes do Dono da Sala — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescrever a interface do GoLive LAN (Lobby + Sala) mantendo toda a lógica de transporte intacta, e adicionar chat de texto na sala e três poderes de moderação pro dono (parar transmissão, expulsar, banir).

**Architecture:** O servidor de sinalização (`server/signaling-core.js`) ganha identidade de dono (token), um relay de chat com histórico de 50 mensagens e um handler de moderação autorizado só no servidor — os três testáveis sem UI, com socket real (`ws`), no mesmo estilo dos testes que já existem no arquivo. `src/renderer/index.html`, `style.css` e `ui.js` são reescritos: a maior parte de `ui.js` (grade de vídeo, fullscreen, PiP, diálogo de compartilhar, aba de configurações) é **portada verbatim** — comportamento intacto, só reempacotada no arquivo novo — porque a spec já decidiu que essas peças ficam "idênticas em comportamento, re-vestidas". O que é novo de verdade (lista de membros com coroa e menu de moderação, painel de chat, diálogos de criar/entrar em sala) é escrito do zero. `app.js` não é refatorado: ganha handlers novos pras mensagens novas do protocolo e chama os pontos de entrada novos do `ui.js`, sem perder nenhum dos que já usa.

**Tech Stack:** Electron (sem bundler, scripts via `<script>`), `node --test` + `node:assert/strict` pros módulos puros e pro servidor de sinalização (sobe socket real via `ws`), CSS custom properties, Web Audio API (síntese, sem arquivo de áudio).

## Global Constraints

- **Sem bundler**: scripts carregados via `<script>` em `index.html`, na ordem de dependência já existente. `ui.js` continua um arquivo único (o projeto já decidiu não fatiar arquivos grandes — ver item D1 do `STATUS.md` — e essa política vale aqui também).
- Cada módulo se expõe como `window.GoLive.<nome>` dentro de uma IIFE; módulos puros terminam com `if (typeof module !== 'undefined') module.exports = ...` pra rodar em `node --test`.
- **Nada de `backdrop-filter`.** Só `transform` e `opacity` são animados — nenhuma outra propriedade CSS leva `transition`.
- Paleta (valores exatos, calculados por contraste — ver a spec §4.3): `--bg:#0E0F13 --s1:#16181D --s2:#1D2026 --s3:#262A32 --s4:#323742`, `--line:rgba(255,255,255,.08) --line2:rgba(255,255,255,.14)`, `--tx:#E8EAED --tx2:#9AA0AA --tx3:#868D9B`, `--act:#4F46E5` (hover `#6257EB`), `--live:#FF4D4F`, `--warn:#F5B544`, `--danger:#C92A33`.
- Motion: `--dur-fast:120ms --dur-base:180ms --dur-slow:240ms`, `--ease-out:cubic-bezier(.2,.8,.3,1) --ease-in-out:cubic-bezier(.4,0,.2,1)`. `prefers-reduced-motion: reduce` zera todas as durações.
- Alvo mínimo de toque: 44px, exceto a tabela de Estatísticas (12px tabular, linha de 28px — única exceção).
- `root.GoLive.ui` mantém as assinaturas atuais (`grid.*`, `rooms.render`, `stageHeader.*`, `settings.*`, `picker.open`) inalteradas; `members.render` ganha um quinto argumento opcional; `members.renderBanned` e `chat.*` são novos. Nenhuma chamada existente em `app.js` para essas funções muda de forma sem que a task correspondente atualize o `app.js` junto.
- **Autorização de moderação só existe no servidor.** O cliente nunca decide se um `moderate` é aceito — só o `signaling-core.js`, comparando `peer.owner`.
- **IP de loopback nunca entra na lista de bans por IP** (o dono conecta em `127.0.0.1`; banir por loopback baniria o próprio dono). Peer de loopback é banido só pelo `clientId`.
- Chat: 500 caracteres por mensagem, 5 mensagens/s por peer (limitador próprio, não o global de 300/s), histórico de 50 (mensagens + linhas de sistema juntas), só em memória.
- `npm test` (`node --test`) e `npm run lint` (`eslint .`) continuam em zero erros ao fim de cada task que toca arquivo testado ou lintado.

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `server/signaling-core.js` | modificar | dono (token), chat + histórico de 50, moderação, lista de bans, limitador de chat |
| `server/signaling-core.test.js` | modificar | testes das três frentes acima |
| `src/main.js` | modificar (`room:host`, linha ~436) | gera e devolve o `ownerToken` |
| `src/renderer/config.js` | modificar | `clientId` persistente, `soundsEnabled` |
| `src/renderer/config.test.js` | modificar | testes dos dois campos acima |
| `src/renderer/status.js` | modificar (`REASON_LABELS`) | rótulos de degradação em linguagem de usuário |
| `src/renderer/status.test.js` | modificar (linhas 50, 51, 88, 89) | corrige os quatro asserts que citavam o texto antigo |
| `src/renderer/sound.js` | modificar | quatro sons novos + interruptor + regra de foco/throttle do chat |
| `src/renderer/index.html` | reescrever | Lobby, diálogos de Criar/Entrar, Sala (palco + coluna de membros/banidos/chat), Configurações, Compartilhar |
| `src/renderer/style.css` | reescrever | tokens, botões, Lobby, Sala (coluna direita, moderação, chat) — grade/tile/fullscreen/PiP/picker/settings/stats herdam os tokens novos sem precisar de edição própria |
| `src/renderer/ui.js` | reescrever | contrato da spec §11; a maior parte é porte verbatim das funções já testadas manualmente; `members`, `chat` e os diálogos de sala são novos |
| `src/renderer/app.js` | modificar (handlers novos, sem refatoração) | manda `clientId`/`ownerToken` no join; trata `chat`/`moderated`/`banned-list`/`join-denied:banned`; liga os menus de moderação e o compose do chat; dispara os sons novos |

`src/preload.js` **não muda** — `room:host` já é um `ipcRenderer.invoke` genérico; o campo novo (`ownerToken`) viaja na mesma resposta, sem método de ponte novo.

---

## Task 1: `signaling-core.js` — identidade do dono

**Files:**
- Modify: `server/signaling-core.js`
- Test: `server/signaling-core.test.js`

**Interfaces:**
- Consumes: nada de tasks anteriores (primeira task da Fase 1).
- Produces: `createSignalingServer({ port, pin, ownerToken, heartbeatMs })` — `ownerToken` novo, opcional. Peers carregam `owner: boolean`. `welcome.peers[]` e `peer-joined` carregam `owner` por peer. Tasks 2 e 3 leem `peer.owner` pra autorizar.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao fim de `server/signaling-core.test.js` (antes dos testes de `createRateLimiter`, que já ficam no fim do arquivo):

```js
test('join com o ownerToken certo marca o peer como dono; sem token ou errado, nao marca', async () => {
  const server = await createSignalingServer({ port: 0, ownerToken: 'segredo-do-dono' });
  try {
    const dono = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => dono.once('open', r));
    dono.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Nicolas', ownerToken: 'segredo-do-dono' }));
    const welcomeDono = await once(dono, 'welcome');
    assert.equal(welcomeDono.owner, true);

    const semToken = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => semToken.once('open', r));
    const joinedDono = once(dono, 'peer-joined');
    semToken.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    const welcomeAna = await once(semToken, 'welcome');
    assert.equal(welcomeAna.owner, false);
    assert.equal((await joinedDono).owner, false);
    // A Ana ve o Nicolas na lista de peers ja presentes, marcado como dono.
    assert.equal(welcomeAna.peers.find((p) => p.name === 'Nicolas').owner, true);

    const tokenErrado = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => tokenErrado.once('open', r));
    tokenErrado.send(JSON.stringify({ type: 'join', room: 'geral', name: 'X', ownerToken: 'chute' }));
    assert.equal((await once(tokenErrado, 'welcome')).owner, false);

    dono.close();
    semToken.close();
    tokenErrado.close();
  } finally {
    await server.close();
  }
});

test('sem ownerToken configurado no servidor, ninguem vira dono mesmo mandando um token', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana', ownerToken: 'qualquer-coisa' }));
    assert.equal((await once(a, 'welcome')).owner, false);
    a.close();
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- --test-name-pattern="ownerToken|dono"`
Expected: FAIL — `welcome.owner` é `undefined`, não `true`/`false`.

- [ ] **Step 3: Implementar**

Em `server/signaling-core.js`, dentro de `createSignalingServer`, logo abaixo da linha que normaliza `roomPin`:

```js
  const roomPin = pin != null && String(pin) !== '' ? String(pin) : null;
  // Token de dono (opcional). Gerado pelo main.js e devolvido so pro
  // renderer de quem criou a sala -- nunca sai da maquina. Comparado por
  // igualdade estrita: string vazia/null nunca marca dono.
  const ownerTok = typeof ownerToken === 'string' && ownerToken !== '' ? ownerToken : null;
```

(A desestruturação do parâmetro de `createSignalingServer` ganha `ownerToken = null` junto de `pin = null`.)

Dentro do handler `case 'join':`, logo depois da checagem de PIN e antes de montar `peers.set(...)`:

```js
      const owner = Boolean(ownerTok) && msg.ownerToken === ownerTok;
```

E a montagem do peer e as duas mensagens de resposta passam a carregar isso:

```js
      peers.set(id, { ws, name, room, avatar, owner });
      joined = true;
      log(`+ ${name} (#${id}) entrou na sala "${room}"${owner ? ' (dono)' : ''}`);
      send(ws, { type: 'welcome', id, owner, peers: roomPeers(room, id) });
      broadcastToRoom(room, id, { type: 'peer-joined', id, name, avatar, owner });
```

`roomPeers` precisa devolver `owner` em cada entrada:

```js
    function roomPeers(room, exceptId) {
      const out = [];
      for (const [id, peer] of peers) {
        if (peer.room === room && id !== exceptId) out.push({ id, name: peer.name, avatar: peer.avatar, owner: peer.owner });
      }
      return out;
    }
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- --test-name-pattern="ownerToken|dono"`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira** (o `roomPeers`/`peer-joined` mudaram de forma — confirmar que nenhum teste antigo assumia a ausência do campo `owner`)

Run: `npm test`
Expected: PASS, todos os testes existentes de `signaling-core.test.js` e `signaling-e2e.test.js` continuam verdes (eles fazem `assert.equal(welcomeB.peers[0].name, ...)` por campo, não `assert.deepEqual` do objeto inteiro — um campo a mais não quebra nada).

- [ ] **Step 6: Commit**

```bash
git add server/signaling-core.js server/signaling-core.test.js
git commit -m "feat(sinalizacao): identidade do dono da sala via token

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `signaling-core.js` — chat, histórico de 50, linhas de sistema

**Files:**
- Modify: `server/signaling-core.js`
- Test: `server/signaling-core.test.js`

**Interfaces:**
- Consumes: nada da Task 1 diretamente (chat funciona pra qualquer peer, dono ou não), mas reusa `peers`/`broadcastToRoom`/`send`/`createRateLimiter` já existentes no arquivo.
- Produces: uma função interna `pushSystemLine(room, event, actor, target)` que a Task 3 (moderação) também chama. `welcome.chat` (array com até 50 entradas). Mensagens `{type:'chat', ...}` (texto e sistema) broadcast pra sala inteira.

- [ ] **Step 1: Escrever os testes que falham**

```js
test('chat: eco pra sala inteira, INCLUSIVE quem mandou, com id/from/name/ts carimbados pelo servidor', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    await once(a, 'welcome');

    const b = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => b.once('open', r));
    b.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Bruno' }));
    await once(b, 'welcome');

    const ecoA = once(a, 'chat');
    const ecoB = once(b, 'chat');
    a.send(JSON.stringify({ type: 'chat', text: 'oi gente', id: 'forjado', from: 'forjado', ts: 1 }));

    const [msgA, msgB] = await Promise.all([ecoA, ecoB]);
    assert.equal(msgA.text, 'oi gente');
    assert.equal(msgA.name, 'Ana');
    assert.notEqual(msgA.from, 'forjado'); // o servidor carimba from = id da conexao, nao o que o cliente mandou
    assert.equal(msgA.id, msgB.id); // mesma mensagem, mesmo id, pros dois lados
    assert.equal(typeof msgA.ts, 'number');

    a.close();
    b.close();
  } finally {
    await server.close();
  }
});

test('chat: corta em 500 caracteres, descarta nao-string e mensagem vazia', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    await once(a, 'welcome');

    const longa = 'x'.repeat(600);
    const eco = once(a, 'chat');
    a.send(JSON.stringify({ type: 'chat', text: longa }));
    assert.equal((await eco).text.length, 500);

    a.send(JSON.stringify({ type: 'chat', text: 42 })); // nao-string
    a.send(JSON.stringify({ type: 'chat', text: '   ' })); // so espaco
    a.send(JSON.stringify({ type: 'chat', text: 'depois' }));
    assert.equal((await once(a, 'chat')).text, 'depois'); // a proxima que chega e a valida -- as duas descartadas nunca ecoam

    a.close();
  } finally {
    await server.close();
  }
});

test('chat: 5 mensagens por segundo por peer, estouro nao derruba o socket', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    await once(a, 'welcome');

    const recebidas = [];
    a.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'chat' && !m.system) recebidas.push(m);
    });
    for (let i = 0; i < 8; i += 1) a.send(JSON.stringify({ type: 'chat', text: `m${i}` }));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(recebidas.length, 5);
    assert.equal(a.readyState, WebSocket.OPEN); // o limite de chat NAO fecha o socket (diferente do flood global)

    a.close();
  } finally {
    await server.close();
  }
});

test('chat: welcome carrega o historico (ate 50), circular, com linhas de sistema de entrada/saida', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    await once(a, 'welcome');
    const eco = once(a, 'chat');
    a.send(JSON.stringify({ type: 'chat', text: 'primeira' }));
    await eco;

    const b = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => b.once('open', r));
    b.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Bruno' }));
    const welcomeB = await once(b, 'welcome');

    assert.ok(Array.isArray(welcomeB.chat));
    // A Ana entrando tambem gerou uma linha de sistema, antes da mensagem de texto.
    const eventos = welcomeB.chat.map((e) => e.system ? `sys:${e.event}` : `msg:${e.text}`);
    assert.deepEqual(eventos, ['sys:join', 'msg:primeira']);

    a.close();
    b.close();
  } finally {
    await server.close();
  }
});

test('chat: quem sai da sala gera linha de sistema "leave" pra quem ficou', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    await once(a, 'welcome');
    const b = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => b.once('open', r));
    b.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Bruno' }));
    await once(b, 'welcome');

    const linhaSistema = once(a, 'chat');
    b.close();
    const msg = await linhaSistema;
    assert.equal(msg.system, true);
    assert.equal(msg.event, 'leave');
    assert.equal(msg.actor, 'Bruno');

    a.close();
  } finally {
    await server.close();
  }
});

test('chat e moderate de quem nunca deu join sao descartados em silencio', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    // Nao manda 'join'. Um 'chat' sem join previo nao pode lancar nem ecoar.
    a.send(JSON.stringify({ type: 'chat', text: 'fantasma' }));
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(a.readyState, WebSocket.OPEN);
    a.close();
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npm test -- --test-name-pattern="chat"`
Expected: FAIL — `case 'chat'` ainda não existe no `switch`, `welcome.chat` é `undefined`.

- [ ] **Step 3: Implementar**

Dentro de `createSignalingServer`, junto das outras estruturas por-sala (o arquivo hoje é single-room de fato — `room` é sempre `'geral'` na prática, mas o código já trata `room` como chave; o histórico segue o mesmo modelo implícito de sala única usado por `peers`/`roomPeers` hoje, sem introduzir um `Map` por sala que nada mais usa):

```js
  const CHAT_HISTORY_MAX = 50;
  const chatHistory = []; // ring buffer -- mensagens de texto e linhas de sistema juntas
  const chatRateLimiters = new Map(); // peerId -> limiter, 5 msg/s

  function pushChatEntry(entry) {
    chatHistory.push(entry);
    if (chatHistory.length > CHAT_HISTORY_MAX) chatHistory.shift();
  }

  /** Linha de sistema (entrada/saida/moderacao). `target` e omitido pra
   * join/leave -- o `actor` JA e quem entrou ou saiu. Broadcast pra sala
   * inteira e guardado no historico, igual a uma mensagem de texto. */
  function pushSystemLine(room, event, actor, target) {
    const entry = { type: 'chat', system: true, event, actor, ...(target ? { target } : {}), ts: Date.now() };
    pushChatEntry(entry);
    broadcastToRoom(room, null, entry);
  }
```

`broadcastToRoom(room, exceptId, payload)` hoje pula `exceptId`; linhas de sistema vão pra sala inteira sem exceção, então `pushSystemLine` passa `null` — e `broadcastToRoom` já trata `id !== exceptId` como sempre verdadeiro quando `exceptId` é `null` (nenhum `id` de peer é `null`), então nenhuma mudança é necessária nessa função.

No `case 'join':`, logo após `send(ws, { type: 'welcome', ... })` (a Task 1 já adicionou `owner` ali — agora entra `chat`):

```js
      send(ws, { type: 'welcome', id, owner, peers: roomPeers(room, id), chat: chatHistory.slice() });
      broadcastToRoom(room, id, { type: 'peer-joined', id, name, avatar, owner });
      pushSystemLine(room, 'join', name);
```

No `switch (msg.type)`, um `case` novo (perto de `broadcast-state`, mesma família de "mensagens interpretadas pelo servidor"):

```js
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
```

E no handler `ws.on('close', ...)`, que já tem `me` e já faz `broadcastToRoom(me.room, id, { type: 'peer-left', id })`, mais uma linha:

```js
        ws.on('close', () => {
          const me = peers.get(id);
          if (!me) return;
          peers.delete(id);
          chatRateLimiters.delete(id);
          log(`- ${me.name} (#${id}) saiu da sala "${me.room}"`);
          broadcastToRoom(me.room, id, { type: 'peer-left', id });
          pushSystemLine(me.room, 'leave', me.name);
        });
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npm test -- --test-name-pattern="chat"`
Expected: PASS

- [ ] **Step 5: Suíte inteira**

Run: `npm test`
Expected: PASS. Atenção especial ao teste "apresenta dois peers um ao outro" — ele fazia `assert.equal(welcomeA.peers.length, 0)`, que ainda vale; nenhum teste existente lia `chatHistory` ou dependia da ausência do campo `chat`.

- [ ] **Step 6: Commit**

```bash
git add server/signaling-core.js server/signaling-core.test.js
git commit -m "feat(sinalizacao): chat com historico de 50 e linhas de sistema

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `signaling-core.js` — moderação (parar transmissão, expulsar, banir)

**Files:**
- Modify: `server/signaling-core.js`
- Test: `server/signaling-core.test.js`

**Interfaces:**
- Consumes: `peer.owner` (Task 1), `pushSystemLine` (Task 2).
- Produces: `case 'moderate'` no switch. `{type:'moderated', action, by}` só pro alvo. `{type:'banned-list', list}` só pro dono. `welcome.banned` (só quando o peer que entra é dono). `join-denied: {reason:'banned'}`.

- [ ] **Step 1: Escrever os testes que falham**

```js
test('moderate de quem NAO e dono e ignorado, qualquer que seja a acao', async () => {
  const server = await createSignalingServer({ port: 0, ownerToken: 'segredo' });
  try {
    const dono = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => dono.once('open', r));
    dono.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Nicolas', ownerToken: 'segredo' }));
    const { id: donoId } = await once(dono, 'welcome');

    const ana = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => ana.once('open', r));
    ana.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    const { id: anaId } = await once(ana, 'welcome');

    // Ana (nao-dona) tenta expulsar o dono -- tem que ser ignorado.
    ana.send(JSON.stringify({ type: 'moderate', action: 'kick', target: donoId }));
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(dono.readyState, WebSocket.OPEN);

    dono.close();
    ana.close();
  } finally {
    await server.close();
  }
});

test('moderate mirando o proprio dono e ignorado (um id errado nao pode expulsar o host)', async () => {
  const server = await createSignalingServer({ port: 0, ownerToken: 'segredo' });
  try {
    const dono = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => dono.once('open', r));
    dono.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Nicolas', ownerToken: 'segredo' }));
    const { id: donoId } = await once(dono, 'welcome');

    dono.send(JSON.stringify({ type: 'moderate', action: 'kick', target: donoId }));
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(dono.readyState, WebSocket.OPEN);

    dono.close();
  } finally {
    await server.close();
  }
});

test('stop-share: so o alvo recebe "moderated", a sala inteira ve a linha de sistema', async () => {
  const server = await createSignalingServer({ port: 0, ownerToken: 'segredo' });
  try {
    const dono = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => dono.once('open', r));
    dono.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Nicolas', ownerToken: 'segredo' }));
    await once(dono, 'welcome');

    const joao = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => joao.once('open', r));
    joao.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Joao' }));
    const { id: joaoId } = await once(joao, 'welcome');

    const moderatedJoao = once(joao, 'moderated');
    const sysLineDono = once(dono, 'chat');
    dono.send(JSON.stringify({ type: 'moderate', action: 'stop-share', target: joaoId }));

    const mod = await moderatedJoao;
    assert.equal(mod.action, 'stop-share');
    assert.equal(mod.by, 'Nicolas');
    const sys = await sysLineDono;
    assert.equal(sys.event, 'stop-share');
    assert.equal(sys.actor, 'Nicolas');
    assert.equal(sys.target, 'Joao');
    assert.equal(joao.readyState, WebSocket.OPEN); // pedido, nao bloqueio -- o socket continua aberto

    dono.close();
    joao.close();
  } finally {
    await server.close();
  }
});

test('kick: o alvo recebe "moderated" e o socket fecha com 1008', async () => {
  const server = await createSignalingServer({ port: 0, ownerToken: 'segredo' });
  try {
    const dono = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => dono.once('open', r));
    dono.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Nicolas', ownerToken: 'segredo' }));
    await once(dono, 'welcome');

    const joao = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => joao.once('open', r));
    joao.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Joao' }));
    const { id: joaoId } = await once(joao, 'welcome');

    const fechou = new Promise((resolve) => joao.once('close', (code) => resolve(code)));
    dono.send(JSON.stringify({ type: 'moderate', action: 'kick', target: joaoId }));
    assert.equal(await fechou, 1008);

    dono.close();
  } finally {
    await server.close();
  }
});

test('ban: alvo e recusado ao tentar entrar de novo (mesmo clientId); unban readmite', async () => {
  const server = await createSignalingServer({ port: 0, ownerToken: 'segredo' });
  try {
    const dono = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => dono.once('open', r));
    dono.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Nicolas', ownerToken: 'segredo' }));
    await once(dono, 'welcome');

    const lucas1 = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => lucas1.once('open', r));
    lucas1.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Lucas', clientId: 'client-lucas' }));
    const { id: lucasId } = await once(lucas1, 'welcome');

    const listaBan = once(dono, 'banned-list');
    dono.send(JSON.stringify({ type: 'moderate', action: 'ban', target: lucasId }));
    const lista = await listaBan;
    assert.equal(lista.list.length, 1);
    assert.equal(lista.list[0].name, 'Lucas');
    const banKey = lista.list[0].key;

    // Mesmo clientId, endereco de loopback (todo teste conecta em 127.0.0.1):
    // so o clientId e observavel aqui, e e o que barra o rejoin.
    const lucas2 = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => lucas2.once('open', r));
    const negado = onceWithin(lucas2, 'join-denied');
    lucas2.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Lucas', clientId: 'client-lucas' }));
    assert.equal((await negado).reason, 'banned');

    dono.send(JSON.stringify({ type: 'moderate', action: 'unban', target: banKey }));
    await new Promise((r) => setTimeout(r, 60));
    const lucas3 = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => lucas3.once('open', r));
    lucas3.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Lucas', clientId: 'client-lucas' }));
    assert.equal((await once(lucas3, 'welcome')).type, 'welcome'); // readmitido

    dono.close();
    lucas3.close();
  } finally {
    await server.close();
  }
});

test('so o dono recebe welcome.banned; quem nao e dono recebe lista vazia', async () => {
  const server = await createSignalingServer({ port: 0, ownerToken: 'segredo' });
  try {
    const dono = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => dono.once('open', r));
    dono.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Nicolas', ownerToken: 'segredo' }));
    const welcomeDono = await once(dono, 'welcome');
    assert.deepEqual(welcomeDono.banned, []);

    const ana = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => ana.once('open', r));
    ana.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    const welcomeAna = await once(ana, 'welcome');
    assert.deepEqual(welcomeAna.banned, []);

    dono.close();
    ana.close();
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npm test -- --test-name-pattern="moderate|stop-share|kick|ban"`
Expected: FAIL — `case 'moderate'` não existe.

- [ ] **Step 3: Implementar**

Junto das outras estruturas por-servidor:

```js
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
```

No `case 'join':`, a checagem de ban entra **antes** da checagem de PIN (um banido não deve nem saber se acertaria o PIN) e o `clientId` do remetente passa a ser guardado no peer, pro `close` conseguir montar as mesmas chaves se o dono banir depois de o peer já estar dentro:

```js
            case 'join': {
              if (joined) return;
              const clientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 100) : null;
              const remoteAddress = ws._socket?.remoteAddress || null;
              if (findBan(banKeysFor({ address: remoteAddress, clientId }))) {
                send(ws, { type: 'join-denied', reason: 'banned' });
                ws.close(1008, 'banned');
                return;
              }
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
              pushSystemLine(room, 'join', name);
              break;
            }
```

E um `case` novo no switch:

```js
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
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npm test -- --test-name-pattern="moderate|stop-share|kick|ban"`
Expected: PASS

- [ ] **Step 5: Suíte inteira + lint**

Run: `npm test && npm run lint`
Expected: PASS, 0 erros. (`ws._socket?.remoteAddress` é a mesma forma de acessar o socket TCP que o resto do arquivo já usa implicitamente via `ws`; conferir que o lint não acusa acesso a propriedade privada — se acusar, o `eslint.config.js` já tem exceção pra padrões internos do `ws` em outros arquivos do projeto, aplicar a mesma.)

- [ ] **Step 6: Commit**

```bash
git add server/signaling-core.js server/signaling-core.test.js
git commit -m "feat(sinalizacao): moderacao do dono -- parar transmissao, expulsar, banir

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `main.js` — gerar e devolver o `ownerToken`

**Files:**
- Modify: `src/main.js` (handler `room:host`, por volta da linha 436)

**Interfaces:**
- Consumes: `createSignalingServer({ port, pin, ownerToken })` (Task 1).
- Produces: `room:host` devolve `{ ok, port, address, pin, ownerToken, firewall, addressWarning }` — `ownerToken` é o campo novo, consumido pela Task 5 (`app.js`, ao montar `hostInfo`).

Não há teste automatizado pra `main.js` (roda em processo Electron, fora do `node --test`) — a verificação é a checklist manual da Task 18.

- [ ] **Step 1: Implementar**

Em `src/main.js`, dentro do handler `ipcMain.handle('room:host', ...)`:

```js
ipcMain.handle('room:host', async (_event, { name, advertise, protect } = {}) => {
  try {
    if (embeddedServer) await closeEmbeddedServer();
    const pin = protect ? String(1000 + Math.floor(Math.random() * 9000)) : null;
    // Token de dono (novo): gerado por sala, nunca sai desta maquina -- so
    // volta pro renderer que criou a sala, que o reenvia no proprio 'join'.
    const ownerToken = require('crypto').randomUUID();
    embeddedServer = await findFreeServer((port) => createSignalingServer({ port, pin, ownerToken }));
    hostedRoomPin = pin;

    const firewall = await ensureFirewallRule(embeddedServer.port);
    const picked = pickAddress();
    const address = picked ? `${picked.address}:${embeddedServer.port}` : null;

    hostedRoomName = name || 'anônimo';
    await ensureDiscoveryStarted();
    if (advertise && address) {
      advertiseHostedRoom();
    } else {
      discovery.stopAdvertising();
    }

    return {
      ok: true,
      port: embeddedServer.port,
      address,
      pin,
      ownerToken,
      firewall,
      addressWarning: picked ? undefined : 'Radmin/Tailscale não detectado',
    };
  } catch (err) {
    return { ok: false, error: err.code === 'PORTS_EXHAUSTED' ? 'PORTS_EXHAUSTED' : err.message };
  }
});
```

(Só duas linhas novas — a geração do `ownerToken` e o campo extra no `return` — o resto do handler é idêntico ao de hoje.)

Conferir o topo do arquivo: se `require('crypto')` já existe importado com outro nome (o projeto usa `crypto` nativo em outros pontos — ex. o PIN não usa `crypto`, mas verificar se há um `const crypto = require('crypto')` global no arquivo antes de adicionar um `require` inline repetido). Se já houver, usar `crypto.randomUUID()` direto em vez do `require` inline acima.

- [ ] **Step 2: Verificar manualmente**

Run: `npm start`, criar uma sala, abrir o DevTools do processo principal (ou checar o log) e confirmar que `room:host` não lança. (Verificação completa de que o token chega até o `join` é a Task 18 — aqui só confirma que o processo principal não quebra.)

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat(main): gera o ownerToken da sala ao hospedar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `config.js` — `clientId` persistente e preferência de som

**Files:**
- Modify: `src/renderer/config.js`
- Test: `src/renderer/config.test.js`

**Interfaces:**
- Produces: `GoLive.config.DEFAULTS.soundsEnabled === true`. `load(rawJson)` devolve sempre um `clientId` (string não vazia) e um `soundsEnabled` (boolean) — gera o `clientId` quando ausente/inválido, sem depender de estado externo além do que já está em `rawJson`.
- Consumes: nada de tasks anteriores.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar a `src/renderer/config.test.js`:

```js
test('load sem clientId gera um novo; load com clientId existente preserva', () => {
  const fresh = load(null);
  assert.match(fresh.clientId, /^[0-9a-f-]{36}$/);

  const saved = serialize({ ...fresh, clientId: 'ja-existia' });
  assert.equal(load(saved).clientId, 'ja-existia');
});

test('soundsEnabled: default true, e preserva false quando salvo', () => {
  assert.equal(load(null).soundsEnabled, true);
  const saved = serialize({ ...DEFAULTS, soundsEnabled: false });
  assert.equal(load(saved).soundsEnabled, false);
});

test('config antigo sem soundsEnabled nem clientId carrega com os defaults novos, sem quebrar', () => {
  const antigo = JSON.stringify({ v: 1, name: 'Nicolas' });
  const cfg = load(antigo);
  assert.equal(cfg.name, 'Nicolas');
  assert.equal(cfg.soundsEnabled, true);
  assert.match(cfg.clientId, /^[0-9a-f-]{36}$/);
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npm test -- --test-name-pattern="clientId|soundsEnabled"`
Expected: FAIL — `load(null).clientId` é `undefined`.

- [ ] **Step 3: Implementar**

No topo de `src/renderer/config.js`, uma função de geração que funciona tanto no renderer (`crypto` global do browser) quanto em `node --test`:

```js
  function randomId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return require('crypto').randomUUID();
  }
```

Em `DEFAULTS`, adicionar `soundsEnabled: true` (o `clientId` **não** entra em `DEFAULTS` com um valor fixo — teria o mesmo valor pra toda instalação sem `rawJson`; ele é gerado dentro de `load`):

```js
  const DEFAULTS = {
    v: 1,
    name: '',
    avatar: null,
    soundsEnabled: true,
    quality: qualityFromPreset(DEFAULT_QUALITY_PRESET),
    camera: { /* ... inalterado ... */ },
    network: { /* ... inalterado ... */ },
  };
```

Em `load(rawJson)`, dois campos novos no objeto devolvido:

```js
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
      avatar: typeof parsed.avatar === 'string' ? parsed.avatar : DEFAULTS.avatar,
      clientId: typeof parsed.clientId === 'string' && parsed.clientId ? parsed.clientId : randomId(),
      soundsEnabled: typeof parsed.soundsEnabled === 'boolean' ? parsed.soundsEnabled : DEFAULTS.soundsEnabled,
      quality: loadQuality(parsed.quality),
      camera: mergeSection(DEFAULTS.camera, parsed.camera),
      network: { ...mergeSection(DEFAULTS.network, parsed.network), tree: true },
    };
  }
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npm test -- --test-name-pattern="clientId|soundsEnabled|config"`
Expected: PASS — incluindo os testes já existentes (`load com null devolve os defaults` precisa ser conferido: como `clientId` agora é sempre gerado, esse teste específico, se comparava `deepEqual(cfg, DEFAULTS)`, quebra porque `DEFAULTS` não tem `clientId`. Ajustar esse teste existente pra excluir `clientId` da comparação:)

```js
test('load com null devolve os defaults', () => {
  const cfg = load(null);
  const { clientId, ...resto } = cfg;
  assert.deepEqual(resto, DEFAULTS);
  assert.match(clientId, /^[0-9a-f-]{36}$/);
});
```

- [ ] **Step 5: Suíte inteira**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: `app.js` — persistir o `clientId` gerado na primeira execução**

`cfg` é montado uma vez no topo de `app.js` (`let cfg = config.load(localStorage.getItem('golive'));`) mas só é salvo de volta quando alguma mudança dispara `persist()`. Sem gravar de imediato, um `clientId` recém-gerado se perde a cada reinício até a pessoa mexer em alguma configuração — e a chave de ban depende dele ser estável. Alterar a linha logo abaixo da declaração de `cfg`:

```js
  let cfg = config.load(localStorage.getItem('golive'));
  localStorage.setItem('golive', config.serialize(cfg)); // grava de imediato -- garante que um clientId novo sobrevive ao proximo reinicio
```

(A função `persist()` já existente faz exatamente isso; usar `persist()` no lugar da linha acima é equivalente e mais idiomático — usar `persist()` se a declaração de `cfg` já estiver abaixo de onde `persist` é definida no arquivo; caso contrário, manter a chamada direta a `localStorage.setItem` como acima.)

- [ ] **Step 7: Verificar manualmente**

Run: `npm start`. Abrir o DevTools do renderer, `localStorage.getItem('golive')` deve mostrar um `clientId` já no primeiro lançamento, sem precisar mexer em nada.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/config.js src/renderer/config.test.js src/renderer/app.js
git commit -m "feat(config): clientId persistente e preferencia de sons

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: `status.js` — rótulos de degradação em linguagem de usuário

**Files:**
- Modify: `src/renderer/status.js`
- Modify: `src/renderer/status.test.js` (linhas 50, 51, 88, 89 — únicos quatro asserts que citam o texto antigo)

**Interfaces:**
- Consumes/Produces: nada muda de forma — `REASON_LABELS`, `degradeReason`, `roomStatus` mantêm exatamente a mesma assinatura. Só o **conteúdo** de `REASON_LABELS` muda.

- [ ] **Step 1: Corrigir os quatro asserts que quebram**

Em `src/renderer/status.test.js`, o teste `'precedencia dos motivos: encoder vence malha, malha vence sala'` (linha 48) tem, nas linhas 50-51:

```js
  assert.match(roomStatus({ ...live, softwareEncoder: true, meshFallback: true, presetDegraded: true }).label, /encoder/);
  assert.match(roomStatus({ ...live, meshFallback: true, presetDegraded: true }).label, /retransmissor/);
```

Trocar por:

```js
  assert.match(roomStatus({ ...live, softwareEncoder: true, meshFallback: true, presetDegraded: true }).label, /aceleração/);
  assert.match(roomStatus({ ...live, meshFallback: true, presetDegraded: true }).label, /recebendo de você/);
```

O teste `'precedencia com auto: encoder e malha vencem auto, auto vence sala'` (linha 86) tem, nas linhas 88-89, o mesmo par — mesma troca:

```js
  assert.match(roomStatus({ ...base, softwareEncoder: true }).label, /aceleração/);
  assert.match(roomStatus({ ...base, meshFallback: true }).label, /recebendo de você/);
```

As linhas 45 e 52 (`/sala cheia/`) e 82/100 (`/limite/i`) **não mudam** — os rótulos `sala` e `auto` continuam contendo essas palavras.

- [ ] **Step 2: Rodar e confirmar que os quatro (agora) falham contra o código atual**

Run: `npm test -- --test-name-pattern="precedencia"`
Expected: FAIL — o código ainda produz `'encoder em software'`/`'sem retransmissor'`, que não batem com `/aceleração/`/`/recebendo de você/`.

- [ ] **Step 3: Implementar**

Em `src/renderer/status.js`:

```js
  const REASON_LABELS = {
    encoder: 'sem aceleração de vídeo',
    malha: 'muita gente recebendo de você',
    auto: 'seu PC no limite',
    sala: 'sala cheia',
  };
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npm test -- --test-name-pattern="precedencia|sala cheia|limite"`
Expected: PASS

- [ ] **Step 5: Suíte inteira**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/status.js src/renderer/status.test.js
git commit -m "feat(status): rotulos de degradacao em linguagem de usuario

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: `sound.js` — os quatro sons novos, interruptor, regra de foco

**Files:**
- Modify: `src/renderer/sound.js`

Sem arquivo de teste: o módulo de hoje (`playJoinSound`/`playLeaveSound`) também não tem — depende de `AudioContext`, que não existe em `node --test`. Verificação é manual (Task 18), como já era pros dois sons existentes.

**Interfaces:**
- Consumes: nada de outras tasks.
- Produces: `GoLive.sound.setEnabled(bool)`, `playChatSound()`, `playLiveSound()`, `playStoppedSound()`, `playRemovedSound()` — chamadas pela Task 17 (`app.js`).

- [ ] **Step 1: Implementar**

Reescrever `src/renderer/sound.js` por inteiro:

```js
// src/renderer/sound.js
'use strict';

(function (root) {
  let audioCtx = null;
  let enabled = true;
  let lastChatSoundAt = 0;
  const CHAT_SOUND_MIN_GAP_MS = 2000;

  function getAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function tone(freqFrom, freqTo, duration, gainPeak) {
    if (!enabled) return;
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqFrom, now);
    osc.frequency.linearRampToValueAtTime(freqTo, now + duration);

    gain.gain.setValueAtTime(gainPeak, now);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  function playJoinSound() {
    tone(440, 660, 0.12, 0.15);
  }

  function playLeaveSound() {
    tone(660, 440, 0.12, 0.15);
  }

  // Mensagem nova no chat: dois blips curtos, o som mais discreto do
  // conjunto. So toca com a janela do GoLive fora de foco (se voce esta
  // olhando a coluna, ja viu a mensagem chegar) e no maximo 1x a cada 2s --
  // uma conversa rapida nao pode virar uma rajada de beeps.
  function playChatSound() {
    if (!enabled) return;
    if (document.hasFocus()) return;
    const now = Date.now();
    if (now - lastChatSoundAt < CHAT_SOUND_MIN_GAP_MS) return;
    lastChatSoundAt = now;
    tone(660, 660, 0.05, 0.10);
    setTimeout(() => tone(880, 880, 0.05, 0.10), 70);
  }

  // Alguem comecou a transmitir -- o aviso mais util do conjunto: quinta
  // subindo, pra quem esta de olho no jogo e nao na janela do GoLive.
  function playLiveSound() {
    tone(523, 784, 0.20, 0.15);
  }

  // O dono parou a SUA transmissao -- toca so pro alvo (app.js decide
  // quem chama). A sala ve a linha no chat, sem som.
  function playStoppedSound() {
    tone(587, 392, 0.22, 0.16);
  }

  // Voce foi expulso ou banido -- grave e o mais longo do conjunto, porque
  // a tela pode voltar pro lobby sozinha enquanto voce olhava outra coisa.
  function playRemovedSound() {
    tone(440, 220, 0.34, 0.18);
  }

  function setEnabled(value) {
    enabled = Boolean(value);
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.sound = {
    playJoinSound,
    playLeaveSound,
    playChatSound,
    playLiveSound,
    playStoppedSound,
    playRemovedSound,
    setEnabled,
  };
})(window);
```

- [ ] **Step 2: Verificar manualmente**

Adiar pra Task 17 (quando `app.js` já dispara os sons nos pontos certos) — sem integração, não há como ouvir nenhum deles ainda.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/sound.js
git commit -m "feat(sons): quatro sons novos, interruptor e regra de foco do chat

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: `index.html` — reescrita completa

**Files:**
- Modify: `src/renderer/index.html` (reescrita completa)

**Interfaces:**
- Produces: todos os `id`s que as Tasks 9-16 (CSS e `ui.js`) consomem via `getElementById`.

- [ ] **Step 1: Reescrever `index.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:" />
<title>GoLive LAN</title>
<link rel="stylesheet" href="style.css" />
</head>
<body>

<div id="update-banner" class="update-banner hidden">
  <span id="update-banner-text"></span>
  <button id="update-banner-action" class="primary small hidden" type="button">Reiniciar e instalar</button>
  <div id="update-progress" class="update-progress hidden"><div id="update-progress-fill" class="update-progress-fill"></div></div>
</div>

<div id="toast" class="toast hidden"><span id="toast-text"></span></div>

<!-- ============ LOBBY (fora de sala) ============ -->
<div id="lobby-view" class="lobby">
  <header class="lobby-header">
    <span class="app-brand-badge">GL</span>
    <span class="app-brand-name">GoLive LAN</span>
    <button id="btn-check-update" class="icon-btn-inline" title="Buscar atualizações" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 17l4 4 4-4M12 12v9"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>
    </button>
    <button id="btn-open-settings" class="icon-btn-inline" title="Configurações" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    </button>
  </header>

  <div class="lobby-hero">
    <button id="btn-create-room" class="primary lobby-hero-btn" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Criar sala
    </button>
    <button id="btn-join-address" class="secondary lobby-hero-btn" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      Entrar numa sala
    </button>
  </div>

  <section class="lobby-rooms">
    <h2 class="rooms-title">
      Salas abertas na sua rede
      <button id="btn-refresh-discovery" class="icon-btn-inline" title="Atualizar lista de salas" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
      </button>
    </h2>
    <ul id="room-list-live" class="room-list"></ul>
  </section>

  <div class="user-panel">
    <button id="user-panel-avatar" class="user-avatar" type="button" title="Abrir perfil nas configurações">
      <img id="user-panel-avatar-img" class="hidden" alt="" />
      <span id="user-panel-avatar-fallback"></span>
    </button>
    <button id="user-panel-name" class="user-panel-name" type="button" title="Abrir perfil nas configurações"></button>
    <button id="btn-open-settings-2" class="icon-btn" title="Configurações" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    </button>
  </div>
</div>

<!-- ============ DIALOGO: CRIAR SALA ============ -->
<div id="dialog-create-room" class="modal hidden">
  <div class="modal-box dialog-box">
    <h2>Criar sala</h2>
    <label class="check-inline">
      <input id="chk-protect-room" type="checkbox" />
      <span>Proteger a sala com um PIN</span>
    </label>
    <p class="dialog-hint">Gera um PIN de 4 dígitos que quem quiser entrar vai precisar digitar.</p>
    <p id="create-room-error" class="error"></p>
    <div class="dialog-actions">
      <button id="btn-create-room-cancel" class="ghost" type="button">Cancelar</button>
      <button id="btn-create-room-confirm" class="primary" type="button">Criar</button>
    </div>
  </div>
</div>

<!-- ============ DIALOGO: ENTRAR NUMA SALA ============ -->
<div id="dialog-join-room" class="modal hidden">
  <div class="modal-box dialog-box">
    <h2>Entrar numa sala</h2>
    <div class="dialog-field">
      <label for="in-server">Endereço da sala</label>
      <input id="in-server" type="text" placeholder="26.0.0.1 ou ws://26.0.0.1:9000" spellcheck="false" />
    </div>
    <div id="join-pin-field" class="dialog-field hidden">
      <label for="in-pin">PIN da sala</label>
      <input id="in-pin" type="text" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="4 dígitos" spellcheck="false" />
    </div>
    <p id="setup-error" class="error"></p>
    <div class="dialog-actions">
      <button id="btn-join-room-cancel" class="ghost" type="button">Cancelar</button>
      <button id="btn-connect" class="primary" type="button">Conectar</button>
    </div>
  </div>
</div>

<!-- ============ SALA (dentro de sala) ============ -->
<div id="room-view" class="room hidden">
  <main class="stage">
    <header id="stage-header" class="stage-header hidden">
      <span id="stage-status-dot" class="stage-status-dot"></span>
      <span id="stage-room-name" class="stage-room-name"></span>
      <span id="stage-room-address" class="stage-room-address"></span>
      <span id="stage-room-pin" class="stage-room-pin hidden"></span>
      <span id="stage-status-badge" class="stage-status-badge hidden"></span>
      <button id="btn-copy-address" class="ghost small">Copiar</button>
      <button id="btn-toggle-side" class="icon-btn-inline" title="Recolher coluna" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </header>
    <div id="stage-warning" class="warn-box hidden"></div>
    <div id="grid" class="grid">
      <div class="empty">Entre ou crie uma sala pra começar.</div>
    </div>
    <div class="control-bar">
      <button id="btn-toggle-share" class="primary control-btn" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        Compartilhar tela
      </button>
      <button id="btn-toggle-camera" class="secondary control-btn" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
        Câmera
      </button>
      <button id="btn-pause-share" class="secondary control-btn hidden" type="button" title="Ctrl+Alt+P">
        <svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="4" height="14" rx="1"/><rect x="13" y="5" width="4" height="14" rx="1"/></svg>
        Pausar
      </button>
      <button id="btn-disconnect" class="ghost control-btn control-btn-end" type="button">Sair da sala</button>
    </div>
  </main>

  <!-- ============ COLUNA: MEMBROS + BANIDOS + CHAT ============ -->
  <aside id="room-side" class="room-side">
    <div class="room-side-section">
      <h2 class="members-title">Na sala</h2>
      <ul id="peer-list" class="peer-list"></ul>
    </div>
    <div id="banned-section" class="room-side-section hidden">
      <h2 class="members-title">Banidos</h2>
      <ul id="banned-list" class="banned-list"></ul>
    </div>
    <div class="room-side-section chat-section">
      <h2 class="members-title">Chat</h2>
      <div id="chat-messages" class="chat-messages" role="log" aria-live="polite"></div>
      <div id="chat-offline-bar" class="offbar hidden">Reconectando — o que você escrever agora não vai sair.</div>
      <form id="chat-compose" class="chat-compose">
        <label for="chat-input" class="visually-hidden">Mensagem para a sala</label>
        <textarea id="chat-input" rows="1" placeholder="Escreva pra sala…" maxlength="500"></textarea>
        <span id="chat-input-count" class="chat-input-count hidden"></span>
      </form>
    </div>
  </aside>
</div>

<!-- ============ MENU DE MODERACAO (flutuante, reposicionado por ui.js) ============ -->
<div id="member-menu" class="member-menu hidden" role="menu"></div>

<!-- ============ DIALOGO: CONFIRMAR BANIMENTO ============ -->
<div id="dialog-ban" class="modal hidden">
  <div class="modal-box dialog-box">
    <h2 id="dialog-ban-title">Banir da sala?</h2>
    <p id="dialog-ban-text"></p>
    <div class="dialog-actions">
      <button id="btn-ban-cancel" class="ghost" type="button">Cancelar</button>
      <button id="btn-ban-confirm" class="destructive" type="button">Banir</button>
    </div>
  </div>
</div>

<!-- ============ MODAL DE CONFIGURACOES ============ -->
<div id="settings-modal" class="modal hidden">
  <div class="modal-box settings-box">
    <nav class="settings-nav">
      <button class="settings-cat active" data-cat="profile">Perfil</button>
      <button class="settings-cat" data-cat="voice">Voz e Vídeo</button>
      <button class="settings-cat" data-cat="network">Rede</button>
      <button class="settings-cat" data-cat="stats">Estatísticas</button>
    </nav>
    <div class="settings-content">
      <section id="settings-profile" class="settings-pane"></section>
      <section id="settings-voice" class="settings-pane hidden"></section>
      <section id="settings-network" class="settings-pane hidden"></section>
      <section id="settings-stats" class="settings-pane hidden"></section>
    </div>
    <button id="btn-close-settings" class="modal-close" title="Fechar" type="button">×</button>
  </div>
</div>

<!-- ============ SELETOR DE FONTE + AUDIO (inalterado) ============ -->
<div id="picker" class="modal hidden">
  <div class="modal-box picker-box">
    <h2>O que você quer compartilhar?</h2>
    <div id="picker-tabs" class="picker-tabs">
      <button class="picker-tab active" data-tab="screen" type="button">Telas</button>
      <button class="picker-tab" data-tab="window" type="button">Janelas</button>
      <button id="picker-refresh" class="picker-refresh" type="button" title="Procurar de novo">
        Atualizar
      </button>
    </div>
    <p id="picker-window-hint" class="picker-hint hidden">
      Pra jogos, prefira compartilhar a tela inteira — capturar só a janela é
      mais pesado e não funciona em fullscreen exclusivo.
    </p>
    <div id="picker-grid" class="picker-grid"></div>

    <h3>Qualidade</h3>
    <div class="settings-field">
      <select id="picker-quality-preset"></select>
      <small id="picker-quality-bandwidth"></small>
    </div>

    <h3>Áudio</h3>
    <div id="audio-mode" class="audio-mode">
      <label class="check-inline"><input type="checkbox" id="share-sound" checked /> Compartilhar som</label>
      <label class="check-inline hidden" id="share-discord-row">
        <input type="checkbox" id="share-discord" /> Incluir o som do Discord também
      </label>
    </div>

    <div class="picker-actions">
      <button id="picker-cancel" class="ghost" type="button">Cancelar</button>
      <button id="btn-go-live" class="primary" type="button" disabled>Ir ao vivo</button>
    </div>
  </div>
</div>

<script src="config.js"></script>
<script src="signaling.js"></script>
<script src="tree.js"></script>
<script src="mesh.js"></script>
<script src="ui.js"></script>
<script src="sound.js"></script>
<script src="queue.js"></script>
<script src="status.js"></script>
<script src="encodehealth.js"></script>
<script src="encodediag.js"></script>
<script src="autoquality.js"></script>
<script src="rxstats.js"></script>
<script src="peerquality.js"></script>
<script src="app.js"></script>
</body>
</html>
```

Notas pra quem revisar esta task:

- `#btn-open-settings` existe **duas vezes** (cabeçalho e painel de perfil) — mantém o padrão que o `index.html` de hoje já usa pro botão de configurações acessível de dois lugares; o segundo tem `id="btn-open-settings-2"` porque IDs não repetem, e a Task 17 liga os dois ao mesmo handler.
- `#chk-protect-room` mudou de "checkbox solto entre botões do Lobby" (hoje) pra dentro do `#dialog-create-room` — igual à decisão 3 do mapa de continuidade da spec.
- `#in-server`/`#in-pin`/`#btn-connect`/`#setup-error` são os **mesmos IDs de hoje**, só realocados pra dentro do `#dialog-join-room` — a Task 17 não precisa mudar os seletores que `app.js` já usa pra eles, só a lógica de abrir/fechar o diálogo.
- `#peer-list` mantém o ID de hoje — `renderMembers`/`ui.members.render` continuam escrevendo nele sem mudança de seletor.
- `#member-menu` é um único elemento reaproveitado pra qualquer membro (como o `#picker`/`#settings-modal` — um modal, conteúdo trocado por JS), não um menu por linha.

- [ ] **Step 2: Verificar visualmente**

Run: `npm start`
Expected: a janela abre sem exceção de parsing. O app ainda não funciona ponta a ponta (Tasks 9-17 faltam) — isto só confirma que o HTML carrega.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.html
git commit -m "feat(interface): novo HTML -- lobby, dialogos, sala com chat e moderacao

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: `style.css` — tokens, motion e controles base

**Files:**
- Modify: `src/renderer/style.css` (linhas 15-172 de hoje — bloco `:root`, reset, `button`, `.primary`/`.ghost`/`.danger`/`.small`/`.error`/`.hint`)

**Interfaces:**
- Produces: todo token (`--bg`, `--s1`..`--s4`, `--tx`..`--tx3`, `--act`, `--live`, `--warn`, `--danger`, `--dur-*`, `--ease-*`) que as Tasks 10-11 (e o restante do arquivo, que herda sem edição) consomem.

- [ ] **Step 1: Substituir o bloco `:root` e os controles base**

Nas linhas 15-172 atuais de `src/renderer/style.css` (do `:root {` até o fim de `.hint`), substituir por:

```css
:root {
  /* Superficies -- elevacao por luminosidade, nunca por blur. */
  --bg:  #0E0F13;
  --s1:  #16181D;
  --s2:  #1D2026;
  --s3:  #262A32;
  --s4:  #323742;
  --surface-modal: var(--s1);

  --line:  rgba(255, 255, 255, 0.08);
  --line2: rgba(255, 255, 255, 0.14);

  --tx:  #E8EAED;
  --tx2: #9AA0AA;
  --tx3: #868D9B; /* rotulo 10-11px, hora, dica -- 5.33:1 sobre --s1, 4.89:1 sobre --s2 */

  /* Cor semantica -- tres papeis, nunca decorativo (ver a spec, secao 4.1).
     --act e --live sao os dois unicos acentos que competem por atencao;
     --danger so preenche o botao de confirmar banimento, nunca e acento. */
  --act:      #4F46E5;
  --act-hover:#6257EB;
  --live:     #FF4D4F;
  --warn:     #F5B544;
  --danger:   #C92A33;

  --live-dim:   rgba(255, 77, 79, 0.14);
  --warn-dim:   rgba(245, 181, 68, 0.13);
  --danger-dim: rgba(201, 42, 51, 0.13);

  --r-xs: 6px;
  --r-sm: 10px;
  --r-md: 14px;
  --r-lg: 18px;
  --r-full: 999px;

  --s-1: 4px;  --s-2: 8px;   --s-3: 12px;
  --s-4: 16px; --s-5: 24px;  --s-6: 32px;  --s-7: 48px;

  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.40);
  --shadow-2: 0 1px 2px rgba(0, 0, 0, 0.30), 0 8px 24px rgba(0, 0, 0, 0.35);
  --shadow-3: 0 1px 3px rgba(0, 0, 0, 0.40), 0 16px 48px rgba(0, 0, 0, 0.50);

  --ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--act);

  /* Motion -- so transform/opacity sao animados em qualquer regra do
     arquivo inteiro (a mesma razao fisica do veto ao backdrop-filter:
     essas duas rodam no compositor sem repintar camada, e nao disputam
     com o encoder). */
  --dur-fast: 120ms;
  --dur-base: 180ms;
  --dur-slow: 240ms;
  --ease-out:    cubic-bezier(0.2, 0.8, 0.3, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);

  /* Aliases -- mantidos pra qualquer regra do arquivo (grade/tile/
     fullscreen/PiP/picker/settings/stats, intactos nesta reescrita) que
     ainda referencia os nomes antigos de superficie/texto/acento. */
  --bg-app: var(--bg);
  --bg-panel: var(--s1);
  --bg-rail: var(--bg);
  --bg-inset: var(--s2);
  --text: var(--tx);
  --text-1: var(--tx);
  --text-2: var(--tx2);
  --text-3: var(--tx3);
  --muted: var(--tx2);
  --accent: var(--act);
  --good: var(--live);
  --bad: var(--danger);
  --radius: var(--r-sm);
  --surface-0: var(--bg);
  --surface-1: var(--s1);
  --surface-2: var(--s2);
  --surface-3: var(--s3);
  --surface-4: var(--s4);
  --line-subtle: var(--line);
  --line-strong: var(--line2);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}

* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--bg);
  color: var(--tx);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  overflow: hidden;
  user-select: none;
}
::selection { background: var(--act); color: #fff; }

.hidden { display: none !important; }
.visually-hidden {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}

/* Botoes: alvo minimo 44px (ver a spec, secao 4.4) em todos, exceto a
   tabela de Estatisticas -- a unica excecao aos 44px do arquivo inteiro. */
button {
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  min-height: 44px;
  padding: 0 16px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  background: transparent;
  color: var(--tx);
  transition: background-color var(--dur-fast) var(--ease-in-out),
              border-color var(--dur-fast) var(--ease-in-out),
              color var(--dur-fast) var(--ease-in-out),
              transform var(--dur-fast) var(--ease-out);
}
button:disabled { opacity: 0.5; cursor: default; }
button:active:not(:disabled) { transform: scale(0.97); transition-duration: 0ms; }
button svg { width: 17px; height: 17px; flex: none; }

:where(button, .icon-btn, .icon-btn-inline, .room-row, .source-card, .picker-tab, .settings-cat, input, select, textarea):focus-visible {
  outline: 2px solid var(--act);
  outline-offset: 2px;
  box-shadow: none;
}

/* Uma primaria colorida por tela, nunca duas (ver a spec, secao 4.5). */
.primary { background: var(--act); border-color: var(--act); color: #fff; }
.primary:hover:not(:disabled) { background: var(--act-hover); border-color: var(--act-hover); }

.secondary { background: var(--s3); border-color: var(--line2); color: var(--tx); }
.secondary:hover:not(:disabled) { background: var(--s4); }

.ghost { background: transparent; border-color: var(--line2); color: var(--tx2); }
.ghost:hover:not(:disabled) { color: var(--tx); border-color: var(--tx3); background: var(--s3); }

/* Destrutivo e fundo preenchido, nao ghost com texto vermelho -- ao
   contrario do sistema antigo. So aparece dentro de um dialogo de
   confirmacao (banir); nunca como acento solto na interface (ver spec 4.1
   e 4.5 -- --live e --danger sao dois vermelhos com papeis diferentes). */
.destructive { background: var(--danger); border-color: var(--danger); color: #fff; }
.destructive:hover:not(:disabled) { background: #B3242D; border-color: #B3242D; }

.small { min-height: 36px; padding: 0 12px; font-size: 0.85em; }

.error { color: var(--danger); margin-top: 10px; font-size: 13px; line-height: 1.5; }
.hint { color: var(--tx2); font-size: 0.85em; min-height: 1.2em; }

.check-inline { display: flex; align-items: center; gap: 8px; font-weight: 400; font-size: 13px; cursor: pointer; }
.check-inline input { accent-color: var(--act); width: 16px; height: 16px; }
```

Notas:

- O `.danger` de hoje (ghost com hover vermelho, usado só em `#btn-disconnect`) **não existe mais** — "Sair da sala" agora usa `.ghost`. `.destructive` é a classe nova, usada só no botão "Banir" do `#dialog-ban`.
- Os aliases (`--bg-app`, `--text-1`, `--surface-0` etc.) existem **só** pra o restante do arquivo (linhas ~191 em diante — layout de grade/tile/fullscreen/PiP/picker/settings/stats) continuar funcionando **sem edição própria**: essas seções já usam essas variáveis hoje, e como os aliases apontam pros tokens novos, toda a superfície herda a paleta nova automaticamente. As Tasks 10-11 reescrevem só o que precisa de estrutura nova (Lobby, Sala, membros, chat); o resto do arquivo (grade, tile, fullscreen, PiP, picker, modal de configurações, tabela de estatísticas, `warn-box`, `live-pulse`) fica **exatamente como está hoje**, sem tocar.

- [ ] **Step 2: Verificar visualmente**

Run: `npm start`
Expected: o app abre com o fundo escuro novo; os botões existentes (que ainda não foram re-marcados com as classes novas — isso é a Task 10) podem estar com aparência inconsistente até a Task 10 terminar. Sem erro no console.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/style.css
git commit -m "feat(estilo): tokens de cor/motion novos e controles base

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: `style.css` — Lobby e diálogos

**Files:**
- Modify: `src/renderer/style.css` (acrescenta um bloco novo; as regras antigas de `.rooms-col`/`.app`/`.members-col`/`.room-row`/`.rooms-actions`/`.join-address-form`/`.protect-room-row`/`.rooms-title`/`.rooms-subtitle` do arquivo de hoje são **removidas** — pertenciam ao layout de três colunas que este redesign substitui)

**Interfaces:**
- Consumes: tokens da Task 9.
- Produces: classes usadas pelos IDs do `#lobby-view`, `#dialog-create-room` e `#dialog-join-room` da Task 8.

- [ ] **Step 1: Remover as regras antigas de layout de três colunas**

Remover do `style.css` as regras: `.app`, `.rooms-col, .members-col`, `.app-brand` (mantém `.app-brand-badge`/`.app-brand-name`, reaproveitados no cabeçalho do Lobby), `.rooms-title`, `.room-list, .peer-list` (mantém `.peer-list` sozinho — ainda usado na Sala; `.room-list` também é reaproveitado, ver abaixo), `.rooms-subtitle`, `.room-row` e todas as regras aninhadas (`.room-row.active`, `.room-info`, `.room-connect`, `.room-delete` etc.), `.rooms-actions`, `.room-action-btn`, `.join-address-form`, `.protect-room-row`, `.room-lock`.

`.user-panel`, `.user-avatar`, `.user-panel-name`, `.icon-btn`, `.icon-btn-inline` **ficam** — a Task 8 reaproveita esses seletores no painel de perfil do Lobby.

- [ ] **Step 2: Acrescentar o bloco novo**

```css
/* ============ LOBBY ============ */

.lobby {
  height: 100vh;
  max-width: 560px;
  margin: 0 auto;
  padding: var(--s-5) var(--s-4);
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}

.lobby-header {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.app-brand-badge {
  width: 30px; height: 30px; border-radius: var(--r-sm);
  background: var(--act); color: #fff; font-weight: 700; font-size: 13px;
  display: flex; align-items: center; justify-content: center; flex: none;
}
.app-brand-name { font-weight: 700; font-size: 15px; margin-right: auto; }
.icon-btn-inline {
  width: 32px; height: 32px; min-height: 0; padding: 0; border-radius: var(--r-xs);
  color: var(--tx2); background: transparent; border: none;
}
.icon-btn-inline svg { width: 15px; height: 15px; }
.icon-btn-inline:hover { background: var(--s3); color: var(--tx); }
.icon-btn-inline.spin svg { animation: spin 600ms linear; }

.lobby-hero {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-3);
}
.lobby-hero-btn { padding: 0 var(--s-4); height: 56px; font-size: 14.5px; }

.lobby-rooms { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--s-3); }
.rooms-title {
  display: flex; align-items: center; gap: var(--s-2);
  font-size: 12px; text-transform: uppercase; letter-spacing: .04em;
  color: var(--tx3); font-weight: 700; margin: 0;
}
.room-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1;
  display: flex; flex-direction: column; gap: 1px; background: var(--s1);
  border: 1px solid var(--line); border-radius: var(--r-md); }
.room-row {
  display: flex; align-items: center; gap: var(--s-3);
  padding: var(--s-3) var(--s-4); min-height: 44px;
  border-bottom: 1px solid var(--line);
}
.room-row:last-child { border-bottom: none; }
.room-info { display: flex; align-items: center; gap: var(--s-2); min-width: 0; flex: 1; }
.room-item-text { min-width: 0; flex: 1; }
.room-name { font-weight: 600; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.room-meta { font-size: 12px; color: var(--tx2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.room-lock { font-size: 0.9em; opacity: .8; flex: none; }
.room-connect { min-height: 36px; padding: 0 14px; font-size: 12.5px; }
.room-connect:disabled { color: var(--live); opacity: 1; cursor: default; }
.room-connect.cooldown { opacity: .4; cursor: not-allowed; }
.room-list .muted { color: var(--tx3); padding: var(--s-4); text-align: center; list-style: none; }

.user-panel {
  display: flex; align-items: center; gap: var(--s-2);
  padding: var(--s-2) var(--s-3); background: var(--s1);
  border: 1px solid var(--line); border-radius: var(--r-md);
}
.user-avatar {
  width: 36px; height: 36px; border-radius: 50%; overflow: hidden; flex: none;
  min-height: 0; padding: 0; background: var(--s4); border: none;
  display: flex; align-items: center; justify-content: center;
  color: var(--tx2); font-weight: 700;
}
.user-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.user-panel-name {
  font-weight: 600; font-size: 13.5px; flex: 1; text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: transparent; border: none; min-height: 0; padding: 0; color: var(--tx);
}
.icon-btn {
  width: 40px; height: 40px; min-height: 0; padding: 0; border-radius: var(--r-sm);
  background: transparent; color: var(--tx2); border: none;
}
.icon-btn:hover { background: var(--s3); color: var(--tx); }
.icon-btn.active { background: var(--s4); color: var(--tx); }

/* ============ DIALOGOS (criar sala / entrar / banir) ============ */

.dialog-box { width: min(380px, 90vw); padding: var(--s-5); }
.dialog-box h2 { margin: 0 0 var(--s-3); font-size: 17px; }
.dialog-hint { color: var(--tx2); font-size: 12.5px; line-height: 1.55; margin: var(--s-2) 0 0; }
.dialog-field { margin-bottom: var(--s-3); }
.dialog-field label { display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; }
.dialog-field input {
  width: 100%; min-height: 44px; padding: 0 12px; border-radius: var(--r-sm);
  background: var(--s2); border: 1px solid var(--line2); color: var(--tx); font-size: 14px;
}
.dialog-actions { display: flex; justify-content: flex-end; gap: var(--s-2); margin-top: var(--s-4); }

@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
```

- [ ] **Step 2: Verificar visualmente**

Run: `npm start`
Expected: o Lobby renderiza com as duas ações grandes, a lista de salas (vazia até a descoberta rodar) e o painel de perfil. Os diálogos ainda não abrem (isso é ligado na Task 17) — conferir que abrindo o DevTools e rodando `document.getElementById('dialog-create-room').classList.remove('hidden')` manualmente, o diálogo aparece formatado corretamente.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/style.css
git commit -m "feat(estilo): layout do lobby e dos dialogos de criar/entrar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: `style.css` — Sala, membros, moderação, chat

**Files:**
- Modify: `src/renderer/style.css` (acrescenta um bloco novo; remove `.rooms-col, .members-col` residual se ainda não removido pela Task 10 — os dois seletores compartilhavam regra — e `.stage-room-pin`/`.members-title` são mantidos, reaproveitados aqui)

**Interfaces:**
- Consumes: tokens da Task 9. `.grid`, `.tile`, `.tile-menu`, `.pip-*`, `.warn-box`, `.stage-status-*`, `.live-pulse` **não são tocados nesta task nem em nenhuma outra** — continuam exatamente como estão hoje no arquivo, herdando a paleta nova só porque os tokens que eles referenciam (`var(--live)`, `var(--surface-*)`, `var(--r-*)`) mudaram de valor na Task 9.

- [ ] **Step 1: Acrescentar o bloco novo**

```css
/* ============ SALA ============ */

.room { display: flex; height: 100vh; }
.stage { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }

.stage-header {
  display: flex; align-items: center; gap: var(--s-3);
  padding: var(--s-3) var(--s-4); border-bottom: 1px solid var(--line);
  background: var(--s1);
}
.stage-status-dot { width: 8px; height: 8px; border-radius: var(--r-full); background: var(--tx3); flex: none; }
.stage-status-dot[data-level="live"] { background: var(--live); }
.stage-status-dot[data-level="degraded"] { background: var(--warn); }
.stage-status-dot[data-level="paused"] { background: var(--tx3); }
.stage-room-name { font-weight: 650; font-size: 14.5px; }
.stage-room-address { font-size: 12px; color: var(--tx2); font-variant-numeric: tabular-nums; }
.stage-room-pin { font-size: 12px; color: var(--warn); }
.stage-status-badge {
  font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: var(--r-full);
  background: var(--warn-dim); color: var(--warn);
}
#btn-toggle-side { margin-left: auto; }

.control-bar {
  display: flex; align-items: center; gap: var(--s-2);
  padding: var(--s-3) var(--s-4); border-top: 1px solid var(--line); background: var(--s1);
}
.control-btn { min-width: 0; }
.control-btn-end { margin-left: auto; }

.room-side {
  width: 300px; flex: none; display: flex; flex-direction: column;
  border-left: 1px solid var(--line); background: var(--s1); overflow: hidden;
  transition: width var(--dur-slow) var(--ease-in-out), opacity var(--dur-base) var(--ease-in-out);
}
.room-side.collapsed { width: 0; opacity: 0; border-left: none; }

.room-side-section { border-bottom: 1px solid var(--line); }
.members-title {
  margin: 0; padding: var(--s-3) var(--s-3) var(--s-2);
  font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
  color: var(--tx3); font-weight: 700;
}

.peer-list, .banned-list { list-style: none; margin: 0; padding: 0 var(--s-2) var(--s-2); max-height: 176px; overflow-y: auto; }
.peer-list li, .banned-list li {
  display: flex; align-items: center; gap: var(--s-2);
  min-height: 44px; padding: 0 var(--s-2); border-radius: var(--r-sm); position: relative;
}
.peer-list li:hover, .banned-list li:hover { background: var(--s2); }
.peer-list .muted { color: var(--tx3); }
.peer-list li.self { color: var(--tx2); }

.peer-avatar-wrap { position: relative; flex: none; }
.peer-avatar {
  width: 28px; height: 28px; border-radius: 50%; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 11px;
}
.peer-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.peer-avatar.on { box-shadow: 0 0 0 2px var(--live); }
.banned-list .peer-avatar { opacity: .5; }

.peer-name { font-weight: 550; font-size: 13px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.peer-you-tag { color: var(--tx3); font-weight: 400; font-size: 10.5px; }
.peer-crown { color: var(--warn); font-size: 12px; }
.peer-live-badge {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--live-dim); color: #FF8385;
  border-radius: var(--r-xs); padding: 2px 6px; font-size: 9.5px; font-weight: 700;
  letter-spacing: .03em; margin-left: auto;
}
.peer-live-badge svg { width: 9px; height: 9px; }

.member-menu-btn {
  margin-left: auto; width: 28px; height: 28px; min-height: 0; padding: 0;
  border-radius: var(--r-xs); background: transparent; color: var(--tx2); border: none;
  flex: none;
}
.member-menu-btn:hover { background: var(--s3); color: var(--tx); }

.member-menu {
  position: fixed; z-index: 50; background: var(--s2); border: 1px solid var(--line2);
  border-radius: var(--r-md); padding: 5px; width: 210px; box-shadow: var(--shadow-3);
}
.member-menu-item {
  display: flex; align-items: center; gap: 9px; min-height: 38px; padding: 0 9px;
  border-radius: var(--r-xs); font-size: 12.5px; color: var(--tx); cursor: pointer;
}
.member-menu-item:hover { background: var(--s3); }
.member-menu-item svg { width: 15px; height: 15px; flex: none; }
.member-menu-item.warn { color: var(--warn); }
.member-menu-item.danger { color: #FF8385; }
.member-menu-sep { height: 1px; background: var(--line); margin: 5px 4px; }
.member-menu-hint { font-size: 10px; color: var(--tx3); padding: 4px 9px 5px; line-height: 1.45; }

.banned-readmit {
  margin-left: auto; font-size: 10.5px; font-weight: 600; color: var(--act);
  border: 1px solid var(--line2); border-radius: var(--r-xs); padding: 3px 8px;
  background: transparent; min-height: 0;
}
.banned-readmit:hover { background: var(--s3); }

/* ---- Chat ---- */

.chat-section { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.chat-messages { flex: 1; min-height: 0; overflow-y: auto; padding: 0 var(--s-2) var(--s-2); display: flex; flex-direction: column; gap: 2px; }

.chat-line { display: flex; gap: 9px; padding: 3px var(--s-2); }
.chat-line.grouped { padding-top: 0; }
.chat-line .chat-avatar-slot { width: 28px; flex: none; }
.chat-line .chat-avatar { width: 28px; height: 28px; border-radius: 50%; overflow: hidden; }
.chat-line .chat-body { min-width: 0; flex: 1; }
.chat-line .chat-head { display: flex; align-items: baseline; gap: 7px; }
.chat-author { font-size: 12.5px; font-weight: 650; color: var(--tx); }
.chat-time { font-size: 10px; color: var(--tx3); }
.chat-text { font-size: 12.5px; line-height: 1.5; color: #D3D7DD; margin-top: 1px; word-break: break-word; }

.chat-sys {
  display: flex; align-items: center; gap: 7px; padding: 4px var(--s-3);
  font-size: 11px; line-height: 1.4; color: var(--tx3);
}
.chat-sys svg { width: 12px; height: 12px; flex: none; }
.chat-sys.warn { color: var(--warn); }
.chat-sys.danger { color: #FF8385; }

.chat-compose {
  margin: var(--s-2); background: var(--s2); border: 1px solid var(--line2);
  border-radius: var(--r-sm); padding: 9px 11px; display: flex; align-items: flex-end; gap: 6px;
  transition: border-color var(--dur-fast) var(--ease-in-out), box-shadow var(--dur-fast) var(--ease-in-out);
}
.chat-compose:focus-within { border-color: var(--act); box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.22); }
.chat-compose textarea {
  flex: 1; resize: none; background: transparent; border: none; color: var(--tx);
  font-family: inherit; font-size: 12.5px; line-height: 1.4; max-height: 88px;
}
.chat-compose textarea:focus { outline: none; }
.chat-input-count { font-size: 10px; color: var(--tx3); flex: none; }
.chat-compose.disabled { opacity: .6; pointer-events: none; }

.offbar {
  background: var(--warn-dim); color: var(--warn); font-size: 11px;
  padding: 7px var(--s-3); border-top: 1px solid rgba(245, 181, 68, 0.2);
}
```

- [ ] **Step 2: Verificar visualmente**

Run: `npm start`, criar uma sala. A tela da Sala deve mostrar palco + barra de controle rotulada embaixo + coluna direita com "Na sala" e "Chat" (banidos escondido, sem ninguém banido ainda). Sem chat funcionando ainda (Task 15/17) — só o layout estático.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/style.css
git commit -m "feat(estilo): layout da sala -- membros, moderacao, chat

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: `ui.js` — esqueleto do módulo + porte verbatim (grade, fullscreen, PiP, avatares)

**Files:**
- Modify: `src/renderer/ui.js` (reescrita completa do arquivo — mas a maior parte do conteúdo é cópia byte-a-byte do arquivo de hoje)

**Interfaces:**
- Produces: `grid.showTile`, `grid.removeTile`, `grid.setPainting`, `grid.setWatchers` — assinaturas **idênticas** às de hoje. `escapeHtml`, `avatarColorFor`, `avatarInnerHtml`, `SHARE_ICON`, `CAMERA_ICON`, `tileKindIcon` — usados pelas Tasks 14 e 15 (membros e chat reusam os mesmos avatares dos tiles). `getOrCreateAudioState` (interna, portada junto do bloco de fullscreen/PiP) — a Task 14 usa ela pra oferecer "Silenciar" no menu de membro com o mesmo estado de áudio que o menu do tile já usa.

- [ ] **Step 1: Criar o arquivo com o cabeçalho e o `$`**

```js
// src/renderer/ui.js
'use strict';

(function (root) {
  const $ = (id) => document.getElementById(id);
  const configApi = root.GoLive.config;

  const QUALITY_PRESET_LABELS = {
    '720p30': '720p · 30 fps',
    '720p60': '720p · 60 fps',
    '1080p30': '1080p · 30 fps',
    '1080p60': '1080p · 60 fps (padrão)',
    '1440p30': '1440p · 30 fps',
    '1440p60': '1440p · 60 fps',
  };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  const gridEl = $('grid');
```

- [ ] **Step 2: Portar verbatim o bloco de grade/tile/fullscreen/PiP/avatares**

Copiar, **sem nenhuma alteração de comportamento**, do `src/renderer/ui.js` de hoje (versão anterior a esta reescrita — recuperável com `git show HEAD:src/renderer/ui.js` a partir do commit da Task 11), as seguintes declarações, na mesma ordem em que aparecem hoje:

- o comentário e as três constantes `PIP_MIN_W`/`PIP_MAX_W_RATIO`/`PIP_DEFAULT_W`/`PIP_MARGIN_PX` e `FULLSCREEN_IDLE_MS`;
- as funções `scheduleFullscreenIdle`, `clearFullscreenIdle`, `getPlaybackAudioContext`, `getOrCreateAudioState`, `ensureTileAudio`, `releaseTileAudio`, `toggleTileFullscreen`, `applyPainting`, `setPainting`, `renderTileWatchers`, `setWatchers`, `showTile`, `removeTile`, `closePipMenu`, `switchFullscreenFocus`, `ensurePipLayout`, `applyPipLayout`, `clampPipLayout`, `buildPipThumb`, `openPipPicker`, `renderPipStrip`, `closeTileMenu`, `openTileMenu`;
- a constante `AVATAR_PALETTE` e as funções `avatarColorFor`, `avatarInnerHtml`;
- as constantes `SHARE_ICON`, `CAMERA_ICON` e a função `tileKindIcon`.

Nenhuma dessas funções lê ou escreve tokens CSS por nome (`--surface-*` etc.) diretamente em JS — elas manipulam classes (`tile`, `fullscreen`, `pip-*`) cujo estilo já veio junto no arquivo `style.css` de hoje, preservado sem edição. **Não renomear nenhuma função nem variável interna.** O comando pra conferir que a cópia é exata:

```bash
git show HEAD:src/renderer/ui.js | sed -n '42,667p' > /tmp/porte-esperado.txt
sed -n '/PIP_MIN_W/,/^  function tileKindIcon/p' src/renderer/ui.js | sed '$d' > /tmp/porte-atual.txt
diff /tmp/porte-esperado.txt /tmp/porte-atual.txt
```

Expected: sem diferença (ajustar as âncoras do `sed` do lado "atual" se a reescrita tiver introduzido alguma linha em branco a mais/menos — o que importa é que o teor de cada função seja idêntico, não a formatação exata do `diff`).

- [ ] **Step 3: Verificar visualmente**

Run: `npm start`, criar uma sala e compartilhar a tela (ou pedir pra alguém entrar e compartilhar). O tile aparece, fullscreen com duplo clique funciona, o menu do tile (botão direito) abre. Isso confirma que o porte não quebrou nada — o comportamento tem que ser indistinguível do app antes desta reescrita.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/ui.js
git commit -m "feat(ui): esqueleto do modulo novo -- grade, fullscreen e pip portados

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 13: `ui.js` — Lobby: lista de salas + diálogos de criar/entrar

**Files:**
- Modify: `src/renderer/ui.js`

**Interfaces:**
- Consumes: `escapeHtml` (Task 12).
- Produces: `rooms.render({ onSelect, activeAddress, liveRooms, isOnCooldown })` — assinatura **idêntica** à de hoje. `dialogs.openCreateRoom({ onConfirm })`, `dialogs.openJoinRoom({ onConnect, showPinField })`, `dialogs.closeCreateRoom()`, `dialogs.closeJoinRoom()` — novos, consumidos pela Task 17 (`app.js`).

- [ ] **Step 1: Portar verbatim `fillRoomList`/`renderRooms`**

Copiar sem alteração as constantes `CONNECT_ICON`/`CONNECTED_ICON` e as funções `fillRoomList`/`renderRooms` do arquivo de hoje. `renderRooms` já escreve em `roomListLiveEl = $('room-list-live')`, ID mantido pela Task 8.

- [ ] **Step 2: Escrever os diálogos novos**

```js
  // ---------- Dialogo: Criar sala ----------
  const dlgCreateEl = $('dialog-create-room');
  let onCreateConfirm = null;

  function openCreateRoom({ onConfirm }) {
    $('create-room-error').textContent = '';
    $('chk-protect-room').checked = false;
    onCreateConfirm = onConfirm;
    dlgCreateEl.classList.remove('hidden');
    focusFirstInteractive(dlgCreateEl);
  }
  function closeCreateRoom() {
    dlgCreateEl.classList.add('hidden');
    restoreFocusAfterModal();
    onCreateConfirm = null;
  }
  function setCreateRoomError(text) {
    $('create-room-error').textContent = text || '';
  }
  $('btn-create-room-cancel').addEventListener('click', closeCreateRoom);
  $('btn-create-room-confirm').addEventListener('click', () => {
    onCreateConfirm?.({ protect: $('chk-protect-room').checked });
  });
  dlgCreateEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCreateRoom(); });

  // ---------- Dialogo: Entrar numa sala ----------
  const dlgJoinEl = $('dialog-join-room');
  let onJoinConnect = null;

  function openJoinRoom({ onConnect, address, showPinField = false }) {
    $('setup-error').textContent = '';
    $('in-server').value = address || '';
    $('in-pin').value = '';
    $('join-pin-field').classList.toggle('hidden', !showPinField);
    onJoinConnect = onConnect;
    dlgJoinEl.classList.remove('hidden');
    focusFirstInteractive(dlgJoinEl);
  }
  function closeJoinRoom() {
    dlgJoinEl.classList.add('hidden');
    restoreFocusAfterModal();
    onJoinConnect = null;
  }
  function setJoinRoomPinVisible(visible) {
    $('join-pin-field').classList.toggle('hidden', !visible);
  }
  $('btn-join-room-cancel').addEventListener('click', closeJoinRoom);
  $('btn-connect').addEventListener('click', () => {
    onJoinConnect?.({ address: $('in-server').value.trim(), pin: $('in-pin').value.trim() || null });
  });
  dlgJoinEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeJoinRoom(); });
```

(`focusFirstInteractive`/`restoreFocusAfterModal` são portadas verbatim na Task 16 — como `ui.js` é montado como um único arquivo, a ordem de definição dentro da IIFE não importa pra `function` declarations, mas se a Task 16 ainda não tiver rodado, declarar aqui uma versão mínima temporária e substituí-la quando a Task 16 chegar; na prática, como as tasks são aplicadas em sequência sobre o mesmo arquivo, seguir a ordem do plano evita a duplicação.)

- [ ] **Step 2: Expor as funções novas**

(A montagem final de `root.GoLive.ui` só acontece na Task 16, quando todas as peças existem — esta task só declara as funções.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/ui.js
git commit -m "feat(ui): lista de salas do lobby e dialogos de criar/entrar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 14: `ui.js` — lista de membros, coroa, menu de moderação, banidos

**Files:**
- Modify: `src/renderer/ui.js`

**Interfaces:**
- Consumes: `avatarColorFor`, `avatarInnerHtml`, `escapeHtml` (Task 12).
- Produces: `members.render(peers, self, qualityTags, opts)` — as três primeiras posições **idênticas** à assinatura de hoje; `opts` é o quarto argumento **opcional**: `{ ownerId, myId, onModerate }`. `members.renderBanned(list, { onUnban })` — novo.

- [ ] **Step 1: Escrever `buildMemberRow` (substitui a versão de hoje) e `renderMembers`**

```js
  const peerListEl = $('peer-list');
  const memberMenuEl = $('member-menu');

  function closeMemberMenu() {
    memberMenuEl.classList.add('hidden');
    memberMenuEl.innerHTML = '';
  }
  document.addEventListener('click', (e) => {
    if (!memberMenuEl.contains(e.target) && !e.target.closest('.member-menu-btn')) closeMemberMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMemberMenu(); });

  const MODERATE_ICONS = {
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
    'stop-share': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="2" y1="2" x2="22" y2="18"/></svg>',
    kick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 17l5-5-5-5"/><line x1="21" y1="12" x2="9" y2="12"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/></svg>',
    ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>',
  };

  /** "Silenciar" no menu de membro e LOCAL -- mesmo mecanismo que o menu de
   * contexto do tile ja usa hoje (getOrCreateAudioState + um GainNode por
   * tile, sem passar pelo servidor). setMuted() e a peca que faltava pra
   * reusar isso fora de openTileMenu: as duas UIs (tile e membro) chamam a
   * mesma funcao sobre o mesmo `state`, entao mutar por um lugar reflete no
   * outro. Colocar logo apos getOrCreateAudioState, portada na Task 12. */
  function setMuted(id, muted) {
    const state = getOrCreateAudioState(id);
    state.muted = muted;
    if (state.gain) state.gain.gain.value = muted ? 0 : state.volume;
  }
  function isMuted(id) {
    return getOrCreateAudioState(id).muted;
  }

  /** Abre o menu do membro `id` ancorado no botao clicado. `isOwner` decide
   * se aparecem os tres poderes de moderacao ou so "Silenciar" (ver a spec,
   * secao 8.2 -- item desabilitado nao aparece, so ensina o que falta).
   * `onModerate` so e chamado pras acoes que passam pelo servidor
   * (stop-share/kick/ban); "Silenciar" nunca chega la. */
  function openMemberMenu(btn, id, name, isOwner, onModerate) {
    const rect = btn.getBoundingClientRect();
    memberMenuEl.innerHTML = `
      <div class="member-menu-item" role="menuitem" data-mute="1">${MODERATE_ICONS.mute} ${isMuted(id) ? 'Reativar som' : 'Silenciar'}</div>
      ${isOwner ? `
        <div class="member-menu-sep"></div>
        <div class="member-menu-item warn" role="menuitem" data-action="stop-share">${MODERATE_ICONS['stop-share']} Parar transmissão</div>
        <div class="member-menu-item" role="menuitem" data-action="kick">${MODERATE_ICONS.kick} Expulsar da sala</div>
        <div class="member-menu-item danger" role="menuitem" data-action="ban">${MODERATE_ICONS.ban} Banir da sala</div>
        <div class="member-menu-hint">Expulso pode voltar. Banido não, enquanto a sala existir.</div>
      ` : ''}
    `;
    memberMenuEl.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;
    memberMenuEl.style.top = `${rect.bottom + 4}px`;
    memberMenuEl.classList.remove('hidden');
    memberMenuEl.querySelector('[data-mute]').addEventListener('click', () => {
      setMuted(id, !isMuted(id));
      closeMemberMenu();
    });
    for (const item of memberMenuEl.querySelectorAll('[data-action]')) {
      item.addEventListener('click', () => {
        onModerate?.(item.dataset.action, id, name);
        closeMemberMenu();
      });
    }
    memberMenuEl.querySelector('[role="menuitem"]')?.focus();
  }

  function buildMemberRow({ id, name, avatar, borderClass, live, isSelf, pulsing, qualityTag, isOwner, canModerate, onModerate }) {
    const li = document.createElement('li');
    if (isSelf) li.classList.add('self');
    li.innerHTML = `
      <span class="peer-avatar-wrap">
        <span class="peer-avatar${borderClass ? ` ${borderClass}` : ''}" style="background:${avatarColorFor(id)}">${avatarInnerHtml(id, name, avatar)}</span>
      </span>
      <span class="peer-name">${escapeHtml(name)}</span>
      ${isSelf ? '<span class="peer-you-tag">você</span>' : ''}
      ${isOwner ? '<span class="peer-crown" title="Dono da sala">♛</span>' : ''}
      ${qualityTag ? `<span class="member-quality-tag">${escapeHtml(qualityTag)}</span>` : ''}
      ${live
        ? `<span class="peer-live-badge live-pulse${pulsing ? ' pulsing' : ''}" title="Compartilhando tela">${SHARE_ICON}<em>AO VIVO</em></span>`
        : ''
      }
      ${!isSelf ? `<button class="member-menu-btn" type="button" aria-label="Opções de ${escapeHtml(name)}">⋮</button>` : ''}
    `;
    if (!isSelf) {
      li.querySelector('.member-menu-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openMemberMenu(e.currentTarget, id, name, canModerate, onModerate);
      });
    }
    return li;
  }

  function renderMembers(peers, self, qualityTags, { ownerId, myId, onModerate } = {}) {
    peerListEl.innerHTML = '';
    if (!self && !peers.size) {
      peerListEl.innerHTML = '<li class="muted">você não está em nenhuma sala</li>';
      return;
    }
    let pulseTaken = false;
    const claimPulse = (live) => {
      if (!live || pulseTaken) return false;
      pulseTaken = true;
      return true;
    };
    const iAmOwner = ownerId != null && myId != null && ownerId === myId;

    if (self) {
      peerListEl.appendChild(
        buildMemberRow({
          id: 'me',
          name: self.name || 'anônimo',
          avatar: self.avatar,
          live: self.live,
          isSelf: true,
          pulsing: claimPulse(self.live),
          isOwner: iAmOwner,
        })
      );
    }
    for (const peer of peers.values()) {
      const state = peer.inConns?.screen?.connectionState || peer.outConns?.screen?.connectionState
        || peer.inConns?.camera?.connectionState || peer.outConns?.camera?.connectionState;
      const borderClass = state === 'connected' ? 'ok' : state ? 'warn' : '';
      peerListEl.appendChild(
        buildMemberRow({
          id: peer.id,
          name: peer.name,
          avatar: peer.avatar,
          borderClass,
          live: peer.live,
          pulsing: claimPulse(peer.live),
          qualityTag: qualityTags?.get(peer.id) || '',
          isOwner: ownerId != null && peer.id === ownerId,
          canModerate: iAmOwner,
          onModerate,
        })
      );
    }
  }

  // ---------- Banidos ----------
  const bannedSectionEl = $('banned-section');
  const bannedListEl = $('banned-list');

  function renderBanned(list, { onUnban } = {}) {
    bannedSectionEl.classList.toggle('hidden', !list || !list.length);
    bannedListEl.innerHTML = '';
    for (const entry of list || []) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="peer-avatar" style="background:${avatarColorFor(entry.key)}">${avatarInnerHtml(entry.key, entry.name, null)}</span>
        <span class="peer-name">${escapeHtml(entry.name)}</span>
        <button class="banned-readmit" type="button">Readmitir</button>
      `;
      li.querySelector('.banned-readmit').addEventListener('click', () => onUnban?.(entry.key));
      bannedListEl.appendChild(li);
    }
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/ui.js
git commit -m "feat(ui): lista de membros com coroa, menu de moderacao e banidos

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 15: `ui.js` — painel de chat

**Files:**
- Modify: `src/renderer/ui.js`

**Interfaces:**
- Consumes: `avatarColorFor`, `avatarInnerHtml`, `escapeHtml` (Task 12).
- Produces: `chat.render({ onSend })`, `chat.append(entry)`, `chat.setHistory(entries)`, `chat.setEnabled(bool)`. `entry` é `{ id, from, name, text, ts }` (mensagem) ou `{ system: true, event, actor, target?, ts }` (linha de sistema) — o mesmo formato que a Task 2/3 do servidor produz.

- [ ] **Step 1: Escrever o módulo de chat**

```js
  // ---------- Chat ----------
  const chatMessagesEl = $('chat-messages');
  const chatComposeEl = $('chat-compose');
  const chatInputEl = $('chat-input');
  const chatCountEl = $('chat-input-count');
  const chatOfflineBarEl = $('chat-offline-bar');
  let lastChatAuthorId = null; // pra saber quando agrupar (mesmo autor em sequencia)
  let onChatSend = null;

  const SYSTEM_ICONS = {
    join: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
    leave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    'stop-share': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="2" y1="2" x2="22" y2="18"/></svg>',
    kick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 17l5-5-5-5"/><line x1="21" y1="12" x2="9" y2="12"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/></svg>',
    ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>',
    unban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
  };
  const SYSTEM_LABELS = {
    join: (actor) => `${actor} entrou`,
    leave: (actor) => `${actor} saiu`,
    'stop-share': (actor, target) => `${actor} parou a transmissão de ${target}`,
    kick: (actor, target) => `${actor} expulsou ${target}`,
    ban: (actor, target) => `${actor} baniu ${target}`,
    unban: (actor, target) => `${actor} readmitiu ${target}`,
  };
  const SYSTEM_TONE = { 'stop-share': 'warn', kick: 'danger', ban: 'danger' };

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function appendSystemLine(entry) {
    const div = document.createElement('div');
    const tone = SYSTEM_TONE[entry.event] || '';
    div.className = `chat-sys${tone ? ` ${tone}` : ''}`;
    const label = SYSTEM_LABELS[entry.event]?.(entry.actor, entry.target) || entry.event;
    div.innerHTML = `${SYSTEM_ICONS[entry.event] || ''} ${escapeHtml(label)}`;
    chatMessagesEl.appendChild(div);
    lastChatAuthorId = null; // proxima mensagem de texto nao agrupa com o que veio antes de uma linha de sistema
  }

  function appendMessage(entry) {
    const grouped = lastChatAuthorId === entry.from;
    lastChatAuthorId = entry.from;
    const div = document.createElement('div');
    div.className = `chat-line${grouped ? ' grouped' : ''}`;
    div.innerHTML = `
      <span class="chat-avatar-slot">${grouped ? '' : `<span class="chat-avatar" style="background:${avatarColorFor(entry.from)}; display:flex; align-items:center; justify-content:center; border-radius:50%; width:28px; height:28px; color:#fff; font-weight:700; font-size:11px;">${avatarInnerHtml(entry.from, entry.name, entry.avatar || null)}</span>`}</span>
      <span class="chat-body">
        ${grouped ? '' : `<span class="chat-head"><span class="chat-author">${escapeHtml(entry.name)}</span><span class="chat-time">${formatTime(entry.ts)}</span></span>`}
        <span class="chat-text">${escapeHtml(entry.text)}</span>
      </span>
    `;
    chatMessagesEl.appendChild(div);
  }

  function appendEntry(entry) {
    if (entry.system) appendSystemLine(entry);
    else appendMessage(entry);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function append(entry) {
    appendEntry(entry);
  }

  function setHistory(entries) {
    chatMessagesEl.innerHTML = '';
    lastChatAuthorId = null;
    for (const entry of entries || []) appendEntry(entry);
  }

  function setEnabled(enabled) {
    chatInputEl.disabled = !enabled;
    chatComposeEl.classList.toggle('disabled', !enabled);
    chatOfflineBarEl.classList.toggle('hidden', enabled);
  }

  function sendCurrentInput() {
    const text = chatInputEl.value.trim();
    if (!text) return;
    onChatSend?.(text);
    chatInputEl.value = '';
    chatCountEl.classList.add('hidden');
  }

  function render({ onSend }) {
    onChatSend = onSend;
    chatInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendCurrentInput();
      }
    });
    chatInputEl.addEventListener('input', () => {
      const len = chatInputEl.value.length;
      chatCountEl.textContent = `${len}/500`;
      chatCountEl.classList.toggle('hidden', len < 400);
    });
  }
```

`entry.avatar` na mensagem de chat: o servidor **não** manda avatar na mensagem (a spec, seção 7.1, decide reusar o avatar de quem já está na sala) — `appendMessage` recebe `entry.avatar || null` porque `app.js` (Task 17) é quem resolve o avatar a partir do registro de peers antes de chamar `chat.append`/`chat.setHistory`, e passa `null` pra quem já saiu da sala (cai pra inicial, como a spec prevê).

- [ ] **Step 2: Commit**

```bash
git add src/renderer/ui.js
git commit -m "feat(ui): painel de chat -- agrupamento, avatar, linhas de sistema

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 16: `ui.js` — cabeçalho da sala, configurações, compartilhar, exportação final

**Files:**
- Modify: `src/renderer/ui.js`

**Interfaces:**
- Produces: `stageHeader.set`, `stageHeader.clear`, `stageHeader.setStatus` — assinaturas **idênticas**, com um efeito colateral novo (alternar `#lobby-view`/`#room-view`). `settings.open`, `settings.close`, `settings.setStatsHtml` — `open` ganha a seção de som na aba "Voz e Vídeo" e `deps.onSoundsChange`/`getConfig().soundsEnabled`. `picker.open` — porte verbatim. A montagem final de `root.GoLive.ui`.

- [ ] **Step 1: Portar verbatim `moveIndicator`, `syncSettingsIndicator`, `stopSettingsCameraPreview`, `startSettingsCameraPreview`, `closeSettings`, `focusFirstInteractive`, `restoreFocusAfterModal`, `bandwidthLine`, `renderProfilePreview`**

Copiar exatamente como estão hoje, sem alteração.

- [ ] **Step 2: Reescrever `setStageStatus`/`setStageHeader`/`clearStageHeader`**

```js
  const lobbyViewEl = $('lobby-view');
  const roomViewEl = $('room-view');

  function setStageStatus({ level, label }) {
    const dot = $('stage-status-dot');
    const badge = $('stage-status-badge');
    dot.dataset.level = level;
    if (label) {
      badge.textContent = label;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function setStageHeader({ name, address, pin }) {
    $('stage-header').classList.remove('hidden');
    $('stage-room-name').textContent = name;
    $('stage-room-address').textContent = address || '';
    const pinEl = $('stage-room-pin');
    if (pin) {
      pinEl.textContent = `🔒 PIN ${pin}`;
      pinEl.classList.remove('hidden');
    } else {
      pinEl.classList.add('hidden');
    }
    // Troca de tela: Lobby fora, Sala dentro -- unico ponto de alternancia
    // entre as duas (ver a spec, secao 5). clearStageHeader faz o inverso.
    lobbyViewEl.classList.add('hidden');
    roomViewEl.classList.remove('hidden');
  }

  function clearStageHeader() {
    $('stage-header').classList.add('hidden');
    $('stage-room-name').textContent = '';
    $('stage-room-address').textContent = '';
    $('stage-room-pin').classList.add('hidden');
    $('stage-status-badge').classList.add('hidden');
    roomViewEl.classList.add('hidden');
    lobbyViewEl.classList.remove('hidden');
  }
```

- [ ] **Step 3: Reescrever `openSettings` — acrescentar o interruptor de sons na aba "Voz e Vídeo"**

Copiar o `openSettings` de hoje e acrescentar, dentro de `settingsPanes.voice.innerHTML`, depois do bloco de `<video id="settings-camera-preview">`:

```js
    settingsPanes.voice.innerHTML = `
      <h3>Câmera</h3>
      <div class="settings-field">
        <label for="settings-camera-device">Dispositivo</label>
        <select id="settings-camera-device"></select>
      </div>
      <div class="settings-field">
        <video id="settings-camera-preview" autoplay playsinline muted></video>
      </div>
      <h3>Sons</h3>
      <div class="settings-field">
        <label class="check-inline"><input id="settings-sounds" type="checkbox" /> Sons do app</label>
        <small>Entrada, saída, chat, transmissão começando e avisos de moderação.</small>
      </div>`;
```

E, no corpo de `openSettings`, junto de `$('settings-advertise').checked = config.network.advertise;`:

```js
    $('settings-sounds').checked = config.soundsEnabled;
```

E junto dos outros `addEventListener` de configurações:

```js
    $('settings-sounds').addEventListener('change', () => {
      deps.onSoundsChange($('settings-sounds').checked);
    });
```

O resto de `openSettings` (perfil, rede, estatísticas, câmera) fica **idêntico** ao de hoje.

- [ ] **Step 4: Portar verbatim `setStatsHtml` e o bloco inteiro do diálogo de compartilhar**

Copiar sem alteração: `setStatsHtml`, e todas as declarações de `renderPickerGrid` até `openPicker` (a seção "Dialogo de compartilhar" inteira, incluindo `pickerEl`, `pickerGridEl`, `pickerTabsEl` e todas as funções que vêm depois delas até o fim do arquivo de hoje).

- [ ] **Step 5: Montar a exportação final**

```js
  root.GoLive.ui = {
    escapeHtml,
    grid: { showTile, removeTile, setPainting, setWatchers },
    rooms: { render: renderRooms },
    dialogs: {
      openCreateRoom, closeCreateRoom, setCreateRoomError,
      openJoinRoom, closeJoinRoom, setJoinRoomPinVisible,
      openBan, closeBan,
    },
    stageHeader: { set: setStageHeader, clear: clearStageHeader, setStatus: setStageStatus },
    settings: { open: openSettings, close: closeSettings, setStatsHtml },
    picker: { open: openPicker },
    members: { render: renderMembers, renderBanned },
    chat: { render, append, setHistory, setEnabled },
  };
})(window);
```

(`dialogs.openBan`/`closeBan` — o diálogo de confirmar banimento — faltou detalhar: escrever agora, junto desta task, seguindo o mesmo padrão de `openCreateRoom`/`openJoinRoom`:)

```js
  const dlgBanEl = $('dialog-ban');
  let onBanConfirm = null;

  function openBan({ name, onConfirm }) {
    $('dialog-ban-title').textContent = `Banir ${name} da sala?`;
    $('dialog-ban-text').textContent = `${name} sai agora e não consegue entrar de novo enquanto esta sala existir. Você pode readmitir depois, na lista de membros.`;
    onBanConfirm = onConfirm;
    dlgBanEl.classList.remove('hidden');
    // Foco no Cancelar, nao no botao destrutivo (ver a spec, secao 8.3).
    $('btn-ban-cancel').focus();
  }
  function closeBan() {
    dlgBanEl.classList.add('hidden');
    restoreFocusAfterModal();
    onBanConfirm = null;
  }
  $('btn-ban-cancel').addEventListener('click', closeBan);
  $('btn-ban-confirm').addEventListener('click', () => { onBanConfirm?.(); closeBan(); });
  dlgBanEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBan(); });
```

- [ ] **Step 6: Verificar visualmente**

Run: `npm start`. Abrir Configurações → Voz e Vídeo: o checkbox "Sons do app" aparece marcado por padrão. Abrir o diálogo de compartilhar: idêntico a antes desta reescrita.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/ui.js
git commit -m "feat(ui): cabecalho da sala, som nas configuracoes, dialogo de ban, exportacao final

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 17: `app.js` — integração: protocolo novo, diálogos, moderação, chat, sons

**Files:**
- Modify: `src/renderer/app.js` (várias frentes pequenas; nenhuma refatoração)

**Interfaces:**
- Consumes: tudo das Tasks 1-16.

- [ ] **Step 1: Mandar `clientId` e `ownerToken` no `join`**

Na linha (hoje ~1074) `session.sig.send({ type: 'join', room: 'geral', name: name || 'anônimo', avatar: cfg.avatar || null, pin: pin || undefined });`, acrescentar:

```js
          session.sig.send({
            type: 'join', room: 'geral', name: name || 'anônimo', avatar: cfg.avatar || null,
            pin: pin || undefined, clientId: cfg.clientId, ownerToken: hostInfo?.ownerToken || undefined,
          });
```

E em `hostRoomFlow` (linha ~730), acrescentar `ownerToken` ao `hostInfo`:

```js
    hostInfo = { port: result.port, address: result.address, pin: result.pin || null, ownerToken: result.ownerToken || null, firewall: result.firewall, addressWarning: result.addressWarning };
```

- [ ] **Step 2: Guardar `ownerId` da sessão e passar pra `renderMembersPanel`**

`app.js` já tem `let myId = null;` (linha 34), preenchido a partir de `welcome.id` (linha 1453) — este é o identificador que `renderMembers`/`buildMemberRow` usam pra "quem sou eu" (junto com o id local fixo `'me'` que os PRÓPRIOS tiles/linha da lista usam pra si mesmos; são dois ids diferentes e não devem ser confundidos: `myId` é o id que o servidor deu a esta conexão, `'me'` é a chave local fixa que `buildMemberRow`/`showTile` sempre usaram pra "a própria linha"). Acrescentar, junto de `let myId = null;`:

```js
  let ownerId = null; // 'me' quando EU sou o dono, ou o id do peer marcado owner:true
```

E, junto de onde `myId = null;` já é resetado ao encerrar uma sessão (linha ~126), resetar `ownerId` também:

```js
    myId = null;
    ownerId = null;
```

No `case 'welcome':` (linha ~1452, onde `myId = msg.id;` já está), logo abaixo:

```js
      case 'welcome': {
        myId = msg.id;
        ownerId = msg.owner ? 'me' : (msg.peers.find((p) => p.owner)?.id ?? null);
```

No `case 'peer-joined':`, por completude (hoje quem cria a sala é sempre o primeiro peer, então isto não deveria disparar na prática, mas o campo precisa ser tratado):

```js
        if (msg.owner) ownerId = msg.id;
```

Em `renderMembersPanel()` (linha ~933), a chamada a `ui.members.render` ganha o quarto argumento:

```js
    ui.members.render(session ? session.mesh.peers : new Map(), currentSelfInfo(), tags, {
      ownerId,
      myId: 'me',
      onModerate: (action, targetId, targetName) => sendModerate(action, targetId, targetName),
    });
```

(`myId: 'me'` aqui é deliberado — é a chave que `buildMemberRow` espera pra comparar com o `id` de cada linha, e a própria linha do usuário já é montada com `id: 'me'` dentro de `renderMembers`. Não confundir com o `myId` de módulo usado no Step acima, que é o id de conexão do servidor.)

- [ ] **Step 3: `sendModerate` — abre confirmação só pra banir, manda os outros direto**

"Silenciar" **não** passa por aqui — a Task 14 já resolve o mute inteiramente dentro de `ui.js` (mesmo `getOrCreateAudioState`/`GainNode` que o menu do tile usa), então `onModerate` só é chamado com `'stop-share'`, `'kick'` ou `'ban'`:

```js
  function sendModerate(action, targetId, targetName) {
    if (!currentSession) return;
    if (action === 'ban') {
      ui.dialogs.openBan({
        name: targetName,
        onConfirm: () => currentSession.sig.send({ type: 'moderate', action: 'ban', target: targetId }),
      });
      return;
    }
    currentSession.sig.send({ type: 'moderate', action, target: targetId });
  }
```

- [ ] **Step 4: Tratar `chat`, `moderated`, `banned-list`, e a extensão de `join-denied`**

No switch de `handleSignal`, novos `case`s:

```js
      case 'chat': {
        if (msg.system) {
          // Kick/ban/stop-share ja sao tratados do lado do ALVO via
          // 'moderated' (Step 5, abaixo) -- esta linha de sistema e so o
          // registro visivel pra sala inteira, sem acao adicional aqui.
          ui.chat.append(msg);
          break;
        }
        // msg.from e o id de conexao carimbado pelo SERVIDOR -- compara com
        // o myId de modulo (Step 2), nao com a chave local fixa 'me'.
        const isMine = msg.from === myId;
        const peer = isMine ? null : mesh.peers.get(msg.from);
        ui.chat.append({ ...msg, avatar: isMine ? cfg.avatar : (peer?.avatar || null) });
        // playChatSound() ja verifica sozinha foco da janela e o teto de
        // 1x/2s (Task 7) -- aqui so falta nao tocar pra propria mensagem.
        if (!isMine) sound.playChatSound();
        break;
      }
      case 'moderated': {
        if (msg.action === 'stop-share') {
          if (localStream) stopShare(); // reusa o caminho que ja existe pra parar de compartilhar
          sound.playStoppedSound();
          showToast(`${msg.by} parou sua transmissão.`);
        } else {
          sound.playRemovedSound();
          // 'kick'/'ban': o servidor ja fecha o socket em seguida (1008) --
          // o onClose padrao (H1/room-closed) cuida de voltar pro lobby.
          showToast(msg.action === 'ban' ? `${msg.by} baniu você da sala.` : `${msg.by} expulsou você da sala.`);
        }
        break;
      }
      case 'banned-list': {
        ui.members.renderBanned(msg.list, {
          onUnban: (key) => currentSession?.sig.send({ type: 'moderate', action: 'unban', target: key }),
        });
        break;
      }
```

O `case 'join-denied':` já existe (linha ~1615) e guarda `session.joinDenied = msg.reason || 'pin'` — não muda. Quem trata isso é o `onClose` da sessão (linha ~1104-1116), que hoje é:

```js
          if (session.joinDenied) {
            clearTimeout(retryTimer);
            retryTimer = null;
            currentSession = null;
            teardownSession(session);
            if (!orphanSession) ui.stageHeader.clear();
            $('setup-error').textContent =
              session.joinDenied === 'pin'
                ? 'PIN incorreto ou ausente. Confira o PIN da sala e tente de novo.'
                : 'A sala recusou a entrada.';
            $('join-address-form').classList.remove('hidden');
```

Duas mudanças aqui: o texto genérico do `else` vira específico pro caso `banned`, e a última linha — que reabre o form inline antigo — **não existe mais** desde a Task 8 (`#join-address-form` foi substituído por `#dialog-join-room`). Trocar por:

```js
          if (session.joinDenied) {
            clearTimeout(retryTimer);
            retryTimer = null;
            currentSession = null;
            teardownSession(session);
            if (!orphanSession) ui.stageHeader.clear();
            const reason = session.joinDenied;
            ui.dialogs.openJoinRoom({
              address: reason === 'banned' || reason === 'pin' ? $('in-server').value : undefined,
              showPinField: reason === 'pin',
              onConnect: ({ address, pin }) => {
                if (!address) return;
                ui.dialogs.closeJoinRoom();
                const url = address.startsWith('ws://') || address.startsWith('wss://') ? address : `ws://${address}`;
                joinRoom(url, cfg.name, undefined, undefined, 0, pin);
              },
            });
            $('setup-error').textContent =
              reason === 'pin' ? 'PIN incorreto ou ausente. Confira o PIN da sala e tente de novo.'
              : reason === 'banned' ? 'Você foi banido desta sala.'
              : 'A sala recusou a entrada.';
```

(O diálogo reabre já com o endereço preenchido pra a pessoa não ter que redigitar; `onConnect` repete o mesmo corpo do Step 7 abaixo — se preferir não duplicar, extrair um `function handleJoinConnect({ address, pin }) { ... }` compartilhado entre os dois pontos antes de fechar esta task.)

- [ ] **Step 5: `welcome` — aplicar `chat` e `banned` recebidos**

No handler de `'welcome'`, junto de onde `selfIsOwner`/`ownerId` foram gravados (Step 2):

```js
        ui.chat.setHistory((msg.chat || []).map((entry) => entry.system
          ? entry
          : { ...entry, avatar: mesh.peers.get(entry.from)?.avatar || (entry.from === 'me' ? cfg.avatar : null) }));
        if (msg.owner) ui.members.renderBanned(msg.banned || [], {
          onUnban: (key) => currentSession?.sig.send({ type: 'moderate', action: 'unban', target: key }),
        });
```

- [ ] **Step 6: Ligar o compose do chat**

Perto de onde os outros `ui.*` de sala são inicializados (junto do wiring de `btn-toggle-share` etc.):

```js
  ui.chat.render({
    onSend: (text) => currentSession?.sig.send({ type: 'chat', text }),
  });
```

- [ ] **Step 7: Ligar os diálogos de Criar/Entrar sala**

Substituir os listeners antigos de `btn-create-room`/`btn-join-address` (que hoje abrem/fecham o form inline) por:

```js
  $('btn-create-room').addEventListener('click', () => {
    ui.dialogs.openCreateRoom({
      onConfirm: async ({ protect }) => {
        $('chk-protect-room').checked = protect;
        ui.dialogs.closeCreateRoom();
        await hostRoomFlow();
      },
    });
  });

  $('btn-join-address').addEventListener('click', () => {
    ui.dialogs.openJoinRoom({
      onConnect: ({ address, pin }) => {
        if (!address) return;
        ui.dialogs.closeJoinRoom();
        const url = address.startsWith('ws://') || address.startsWith('wss://') ? address : `ws://${address}`;
        joinRoom(url, cfg.name, undefined, undefined, 0, pin);
      },
    });
  });
```

(`hostRoomFlow`, `joinRoom` já existem e não mudam de assinatura — só o caminho que os chama antes de abrir o form inline muda pra abrir o diálogo modal.)

- [ ] **Step 8: Sons — "alguém começou a transmitir" e interruptor**

No handler `case 'broadcast-state':` (onde `peer.live = msg.live` já é gravado), acrescentar, só quando `live` vira `true` (e não éramos nós):

```js
      case 'broadcast-state': {
        const peer = mesh.peers.get(msg.id);
        const wasLive = peer?.live;
        if (peer) peer.live = msg.live;
        if (!msg.live) ui.grid.removeTile(msg.id, emptyMessage());
        else if (!wasLive) sound.playLiveSound();
        renderMembersPanel();
        break;
      }
```

E, junto de onde `openSettings` é chamado (`$('btn-open-settings').addEventListener(...)`, e também no `$('btn-open-settings-2')` novo — Task 8 criou um segundo botão de configurações no Lobby):

```js
      onSoundsChange: (enabled) => {
        cfg = { ...cfg, soundsEnabled: enabled };
        persist();
        sound.setEnabled(enabled);
      },
```

(acrescentar essa entrada ao objeto `deps` já passado pra `ui.settings.open`, junto de `onNameChange`/`onAvatarChange`/etc.)

E, na inicialização do módulo (perto de onde `cfg` é lido pela primeira vez), aplicar a preferência salva:

```js
  sound.setEnabled(cfg.soundsEnabled);
```

`$('btn-open-settings-2')` precisa do mesmo listener que `$('btn-open-settings')` — ou disparar o clique do primeiro:

```js
  $('btn-open-settings-2')?.addEventListener('click', () => $('btn-open-settings').click());
```

- [ ] **Step 9: Botão de recolher a coluna direita**

```js
  $('btn-toggle-side').addEventListener('click', () => {
    $('room-side').classList.toggle('collapsed');
  });
```

- [ ] **Step 10: Rodar a suíte inteira e o lint**

Run: `npm test && npm run lint`
Expected: PASS, 0 erros. (`app.js` não tem arquivo de teste próprio — isto confirma que nenhuma mudança aqui quebrou os módulos puros que `app.js` consome, como `config.js`/`status.js`/`mesh.js`/`tree.js`.)

- [ ] **Step 11: Commit**

```bash
git add src/renderer/app.js
git commit -m "feat(app): liga protocolo novo -- moderacao, chat, dialogos e sons

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 18: Checklist manual + fechamento

**Files:** nenhum arquivo novo — esta task só verifica.

- [ ] **Step 1: Suíte automatizada completa**

```bash
npm test
npm run lint
```

Expected: `npm test` — todos os testes passam (incluindo os ~15 novos das Tasks 1-3 e 5, e os quatro corrigidos da Task 6). `npm run lint` — 0 erros (os 10 avisos pré-existentes de `require-atomic-updates` são esperados e não bloqueiam, conforme o `STATUS.md` já registra).

- [ ] **Step 2: Checklist manual — rodar o app de verdade**

Run: `npm start` (subir uma segunda instância pra testar com dois participantes reais — outra cópia do repo, ou `npm start` de novo em outra pasta do mesmo checkout, entrando pelo endereço `127.0.0.1:<porta>`)

- [ ] Criar sala pelo diálogo novo (com e sem "Proteger com PIN"); confirmar que o PIN aparece no cabeçalho quando ligado
- [ ] Segunda instância entra pelo diálogo "Entrar numa sala"; confirmar que o campo de PIN só aparece quando a sala pede
- [ ] Lista de membros: a coroa aparece no dono (nas duas instâncias, cada uma vendo a coroa no lugar certo); o ⋮ só mostra "Silenciar" pra quem não é dono
- [ ] Dono: parar a transmissão de alguém compartilhando — a pessoa recebe o toast e o compartilhamento para; ela consegue compartilhar de novo (não é bloqueio)
- [ ] Dono: expulsar alguém — sai sem confirmação, consegue entrar de novo
- [ ] Dono: banir alguém — pede confirmação com foco no Cancelar; a pessoa não consegue reentrar; aparece em "Banidos"; "Readmitir" libera o reingresso
- [ ] Chat: mensagens de dois participantes agrupam corretamente por autor, avatar aparece na primeira de cada grupo; linha de sistema aparece pra entrada/saída/cada ação de moderação
- [ ] Derrubar a sinalização (fechar o firewall, ou matar o processo do host) com o chat aberto: o compose desabilita e a faixa âmbar aparece; reconectando, o histórico de 50 chega de novo sem duplicar
- [ ] Os quatro sons novos tocam nos momentos certos; o interruptor "Sons do app" em Configurações › Voz e Vídeo corta todos de uma vez, inclusive entrada/saída
- [ ] Navegar a Sala inteira só de teclado: Tab alcança o ⋮ de cada membro, Enter abre o menu, setas navegam, Escape fecha e devolve o foco ao ⋮; o diálogo de banir tem foco inicial no Cancelar
- [ ] Ligar "Efeitos visuais reduzidos" no Windows (Configurações do Sistema) e reabrir o app: nada anima (mensagem de chat aparece sem fade, menu sem transição)
- [ ] Fullscreen com PiP arrastável, strip, fixar, menu de escolha — comportamento idêntico ao app antes desta reescrita (a Task 12 portou essas funções verbatim; isto confirma que a cópia não introduziu regressão)
- [ ] Diálogo de compartilhar (abas, preset de qualidade, áudio) — idêntico a antes
- [ ] Aba Estatísticas em Configurações — números em fonte tabular, layout denso preservado

- [ ] **Step 3: `npm run dist` (build completo) não faz parte desta spec**

Não rodar — já está registrado no `STATUS.md` como item separado, fora do escopo desta spec (validar um build de instalador é tarefa do B2/B1, não deste redesign).

- [ ] **Step 4: Atualizar `STATUS.md`**

Acrescentar uma entrada em "Já lançado" ou "Em andamento" (conforme o estado da branch no momento) descrevendo: redesign completo (Lobby/Sala, paleta índigo/vermelho/âmbar), chat de texto com histórico de 50, três poderes de moderação do dono (parar transmissão, expulsar, banir) com token de dono no protocolo de sinalização, quatro sons novos. Seguir o estilo de prosa corrida que o `STATUS.md` já usa nas entradas anteriores — não lista de bullets soltos.

- [ ] **Step 5: Commit final**

```bash
git add STATUS.md
git commit -m "docs(status): redesign, chat e moderacao em dia no STATUS.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Nota sobre o que fica de fora

Igual à seção 17 da spec: transferência de dono, ban persistente em disco, histórico de chat em disco, anexos/emoji/edição de mensagem, chat privado, menção `@`, qualquer mudança em `mesh.js`/`tree.js`/`autoquality.js`, extração de módulo de `app.js`, upgrade de Electron. Nenhuma task deste plano toca nesses itens — se alguma delas parecer necessária durante a implementação, é sinal de que o escopo está vazando pra fora do que a spec fechou, e vale parar e perguntar antes de continuar.
