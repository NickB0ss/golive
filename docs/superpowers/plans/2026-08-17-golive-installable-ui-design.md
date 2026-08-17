# GoLive LAN — instalador, servidor embutido e múltiplos transmissores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o GoLive LAN instalável e usável por alguém sem conhecimento técnico: servidor de sinalização embutido no app (sem terminal/Node separado), instalador NSIS, e suporte a múltiplas pessoas transmitindo ao mesmo tempo na mesma sala.

**Architecture:** Extrai a lógica hoje presa em `server/signaling.js` (CLI) para um módulo reutilizável (`signaling-core.js`) que o processo principal do Electron também pode chamar. Dois módulos novos e puros (`network.js`, `firewall.js`) cuidam de achar o IP certo pra mostrar e liberar a porta no firewall do Windows. O renderer ganha uma tela de "Criar sala / Entrar em sala" no lugar do formulário único, e o modelo de peer na malha WebRTC passa de uma `RTCPeerConnection` por peer para duas (`outConn`/`inConn`), o que corrige a segunda pessoa que começa a transmitir derrubar a primeira.

**Tech Stack:** Electron 32, `ws` (WebSocket), Node.js `child_process`/`os` (built-in), `node:test` + `node:assert/strict` para os módulos testáveis fora do Electron, `electron-builder` (target NSIS).

## Global Constraints

- Windows-only: o projeto já depende de `desktopCapturer` (Electron) e Radmin VPN; não há suporte a Mac/Linux neste trabalho.
- Fora de escopo: SFU/servidor de mídia central, TURN/STUN, sub-salas (o campo "sala" é removido — cada host é um grupo único).
- Sem framework de teste automatizado para Electron/renderer (WebRTC só existe no browser) — esses fluxos têm passos de teste manual explícitos em vez de testes automatizados. Os três módulos novos que são JS puro (`signaling-core.js`, `network.js`, `firewall.js`) usam `node:test`.
- Regra de firewall sempre nomeada `GoLive` (sem porta no nome); portas antigas não são removidas automaticamente ao trocar de porta.
- Prioridade de endereço pra mostrar ao host: IP começando com `26.` (Radmin) > faixa `100.64.0.0/10` (Tailscale) > qualquer IPv4 não-interna > `null` (aviso, mas a sala sobe mesmo assim).

---

### Task 1: Extrair `server/signaling-core.js`

**Files:**
- Create: `server/signaling-core.js`
- Create: `server/signaling-core.test.js`
- Modify: `server/signaling.js` (linhas 13-144 viram um wrapper CLI fino)
- Modify: `package.json` (adiciona script `"test": "node --test"`)

**Interfaces:**
- Produces: `createSignalingServer({ port }) -> Promise<{ wss: WebSocketServer, port: number, close: () => Promise<void> }>`. Rejeita com um `Error` cujo `.code === 'EADDRINUSE'` se a porta já estiver em uso (Task 4 depende disso pro fallback de porta).
- Produces: `listAddresses()` continua em `printAddresses`-style dentro de `signaling.js` (não muda — Task 2 extrai a detecção de endereço separadamente pro `main.js` usar).

- [ ] **Step 1: Escrever o teste que falha**

```js
// server/signaling-core.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createSignalingServer } = require('./signaling-core');

function once(ws, type) {
  return new Promise((resolve) => {
    function onMessage(raw) {
      const msg = JSON.parse(raw.toString());
      if (msg.type === type) {
        ws.off('message', onMessage);
        resolve(msg);
      }
    }
    ws.on('message', onMessage);
  });
}

test('apresenta dois peers um ao outro na mesma sala', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await once(a, 'open').catch(() => {});
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    const welcomeA = await once(a, 'welcome');
    assert.equal(welcomeA.peers.length, 0);

    const b = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => b.once('open', r));
    const joinedA = once(a, 'peer-joined');
    b.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Bruno' }));
    const welcomeB = await once(b, 'welcome');
    assert.equal(welcomeB.peers[0].name, 'Ana');

    const peerJoinedMsg = await joinedA;
    assert.equal(peerJoinedMsg.name, 'Bruno');

    a.close();
    b.close();
  } finally {
    await server.close();
  }
});

test('rejeita com EADDRINUSE quando a porta ja esta ocupada', async () => {
  const first = await createSignalingServer({ port: 0 });
  try {
    await assert.rejects(
      createSignalingServer({ port: first.port }),
      (err) => err.code === 'EADDRINUSE'
    );
  } finally {
    await first.close();
  }
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test server/signaling-core.test.js`
Expected: FAIL — `Cannot find module './signaling-core'`

- [ ] **Step 3: Criar `server/signaling-core.js`**

Extraído de `server/signaling.js` (linhas 13-142 atuais), sem mudar comportamento — só troca o bind síncrono do `WebSocketServer` por uma `Promise` que resolve em `listening` e rejeita em `error` (necessário pra Task 4 detectar `EADDRINUSE` sem crashar o processo principal):

```js
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

    /** @type {Map<string, {ws: import('ws').WebSocket, name: string, room: string}>} */
    const peers = new Map();
    let nextId = 1;

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
              peers.set(id, { ws, name, room });
              joined = true;
              log(`+ ${name} (#${id}) entrou na sala "${room}"`);
              send(ws, { type: 'welcome', id, peers: roomPeers(room, id) });
              broadcastToRoom(room, id, { type: 'peer-joined', id, name });
              break;
            }

            case 'offer':
            case 'answer':
            case 'ice': {
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
      });
    });
  });
}

module.exports = { createSignalingServer };
```

- [ ] **Step 4: Reescrever `server/signaling.js` como CLI fino**

```js
/*
 * CLI do servidor de sinalizacao do GoLive LAN.
 *
 * Rode em UMA maquina so, e todo mundo aponta pro IP Radmin dela.
 *   node server/signaling.js
 */

const os = require('os');
const { createSignalingServer } = require('./signaling-core');

const PORT = Number(process.env.PORT) || 9000;

function printAddresses(port) {
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
  console.log(`  escutando na porta ${port}`);
  console.log('');
  console.log('  Passe um destes enderecos pros seus amigos:');
  for (const c of candidates) {
    const isRadmin = c.address.startsWith('26.');
    const isTailscale = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(c.address);
    const tag = isRadmin ? '  <-- Radmin VPN' : isTailscale ? '  <-- Tailscale' : '';
    console.log(`    ws://${c.address}:${port}${tag}`);
  }
  console.log('');
  console.log('  Se ninguem conectar, libere a porta no firewall do Windows:');
  console.log(`    netsh advfirewall firewall add rule name="GoLive" dir=in action=allow protocol=TCP localport=${port}`);
  console.log('');
}

createSignalingServer({ port: PORT })
  .then((server) => printAddresses(server.port))
  .catch((err) => {
    console.error('Nao consegui subir o servidor:', err.message);
    process.exit(1);
  });
```

- [ ] **Step 5: Adicionar script de teste ao `package.json`**

Em `package.json:6-10`, dentro de `"scripts"`, adicionar:

```json
"test": "node --test"
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npm test`
Expected: PASS — 2 testes em `server/signaling-core.test.js`

- [ ] **Step 7: Commit**

```bash
git add server/signaling-core.js server/signaling-core.test.js server/signaling.js package.json
git commit -m "refactor: extract signaling-core from signaling.js CLI"
```

---

### Task 2: `src/main/network.js` — detecção de endereço

**Files:**
- Create: `src/main/network.js`
- Create: `src/main/network.test.js`

**Interfaces:**
- Produces: `listAddresses(interfaces = os.networkInterfaces()) -> Array<{ address: string, iface: string, kind: 'radmin'|'tailscale'|'lan' }>`
- Produces: `pickAddress(interfaces = os.networkInterfaces()) -> { address: string, iface: string, kind: string } | null`
- Consumed by Task 4 (`main.js`, handler `room:host`).

- [ ] **Step 1: Escrever o teste que falha**

```js
// src/main/network.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { listAddresses, pickAddress } = require('./network');

const fakeInterfaces = {
  'Ethernet': [{ family: 'IPv4', internal: false, address: '192.168.0.14' }],
  'Radmin VPN': [{ family: 'IPv4', internal: false, address: '26.13.45.201' }],
  'Loopback': [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
  'Tailscale': [{ family: 'IPv4', internal: false, address: '100.90.10.5' }],
};

test('listAddresses ignora loopback e classifica radmin/tailscale/lan', () => {
  const list = listAddresses(fakeInterfaces);
  assert.equal(list.length, 3);
  const byAddress = Object.fromEntries(list.map((a) => [a.address, a.kind]));
  assert.equal(byAddress['192.168.0.14'], 'lan');
  assert.equal(byAddress['26.13.45.201'], 'radmin');
  assert.equal(byAddress['100.90.10.5'], 'tailscale');
});

test('pickAddress prioriza radmin sobre tailscale e lan', () => {
  const picked = pickAddress(fakeInterfaces);
  assert.equal(picked.address, '26.13.45.201');
  assert.equal(picked.kind, 'radmin');
});

test('pickAddress devolve null quando so ha loopback', () => {
  const picked = pickAddress({ Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] });
  assert.equal(picked, null);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test src/main/network.test.js`
Expected: FAIL — `Cannot find module './network'`

- [ ] **Step 3: Implementar `src/main/network.js`**

```js
/*
 * Deteccao de endereco pro host mostrar aos amigos. Extraido/adaptado de
 * printAddresses (server/signaling.js).
 */

const os = require('os');

const TAILSCALE_RE = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

function classify(address) {
  if (address.startsWith('26.')) return 'radmin';
  if (TAILSCALE_RE.test(address)) return 'tailscale';
  return 'lan';
}

/** Lista candidatos IPv4 nao-internos, classificados. */
function listAddresses(interfaces = os.networkInterfaces()) {
  const out = [];
  for (const [iface, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs || []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      out.push({ iface, address: addr.address, kind: classify(addr.address) });
    }
  }
  return out;
}

const PRIORITY = { radmin: 0, tailscale: 1, lan: 2 };

/** Melhor candidato pra mostrar ao host: radmin > tailscale > lan > null. */
function pickAddress(interfaces = os.networkInterfaces()) {
  const list = listAddresses(interfaces);
  if (!list.length) return null;
  return [...list].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind])[0];
}

module.exports = { listAddresses, pickAddress };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test src/main/network.test.js`
Expected: PASS — 3 testes

- [ ] **Step 5: Commit**

```bash
git add src/main/network.js src/main/network.test.js
git commit -m "feat: add network address detection module"
```

---

### Task 3: `src/main/firewall.js` — liberar a porta

**Files:**
- Create: `src/main/firewall.js`
- Create: `src/main/firewall.test.js`

**Interfaces:**
- Produces: `ensureFirewallRule(port, { exec } = {}) -> Promise<{ ok: boolean, manualCommand?: string }>`. O segundo argumento (`exec`, assinatura `(cmd: string) => Promise<{stdout: string}>`) é injetável só para teste; em produção usa `child_process.exec` promisificado, sem exigir nada de quem chama.
- Consumed by Task 4 (`main.js`, handler `room:host`).

- [ ] **Step 1: Escrever o teste que falha**

```js
// src/main/firewall.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ensureFirewallRule } = require('./firewall');

function fakeExec(script) {
  const calls = [];
  const exec = async (cmd) => {
    calls.push(cmd);
    return script(cmd, calls.length);
  };
  return { exec, calls };
}

test('nao pede elevacao se a regra ja cobre a porta', async () => {
  const { exec, calls } = fakeExec((cmd) => {
    if (cmd.includes('show rule')) {
      return { stdout: 'Rule Name: GoLive\nLocalPort: 9000\n' };
    }
    throw new Error('nao deveria chamar Start-Process');
  });

  const result = await ensureFirewallRule(9000, { exec });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
});

test('eleva e confirma quando a regra nao existe', async () => {
  let created = false;
  const { exec } = fakeExec((cmd) => {
    if (cmd.includes('show rule')) {
      return created
        ? { stdout: 'Rule Name: GoLive\nLocalPort: 9000\n' }
        : { stdout: 'No rules match the specified criteria.\n' };
    }
    if (cmd.includes('Start-Process')) {
      created = true;
      return { stdout: '' };
    }
    throw new Error(`comando inesperado: ${cmd}`);
  });

  const result = await ensureFirewallRule(9000, { exec });
  assert.deepEqual(result, { ok: true });
});

test('devolve comando manual quando a elevacao falha', async () => {
  const { exec } = fakeExec((cmd) => {
    if (cmd.includes('show rule')) return { stdout: 'No rules match the specified criteria.\n' };
    if (cmd.includes('Start-Process')) throw new Error('UAC cancelado');
    throw new Error(`comando inesperado: ${cmd}`);
  });

  const result = await ensureFirewallRule(9000, { exec });
  assert.equal(result.ok, false);
  assert.match(result.manualCommand, /netsh advfirewall firewall add rule name="GoLive".*localport=9000/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test src/main/firewall.test.js`
Expected: FAIL — `Cannot find module './firewall'`

- [ ] **Step 3: Implementar `src/main/firewall.js`**

```js
/*
 * Libera a porta do GoLive no firewall do Windows. Consulta primeiro sem
 * elevacao; so pede UAC se a regra realmente nao existir ainda.
 */

const { exec: execCb } = require('child_process');
const { promisify } = require('util');

const defaultExec = promisify(execCb);
const RULE_NAME = 'GoLive';

function manualCommandFor(port) {
  return `netsh advfirewall firewall add rule name="${RULE_NAME}" dir=in action=allow protocol=TCP localport=${port}`;
}

async function ruleCoversPort(port, exec) {
  let stdout = '';
  try {
    ({ stdout } = await exec(`netsh advfirewall firewall show rule name="${RULE_NAME}"`));
  } catch {
    return false;
  }
  if (/No rules match/i.test(stdout)) return false;
  const ports = [...stdout.matchAll(/LocalPort:\s*(.+)/gi)].flatMap((m) =>
    m[1].split(',').map((p) => p.trim())
  );
  return ports.includes(String(port));
}

/** @returns {Promise<{ ok: boolean, manualCommand?: string }>} */
async function ensureFirewallRule(port, { exec = defaultExec } = {}) {
  const manualCommand = manualCommandFor(port);

  if (await ruleCoversPort(port, exec)) return { ok: true };

  const netshArgs = `advfirewall firewall add rule name="${RULE_NAME}" dir=in action=allow protocol=TCP localport=${port}`;
  const psCommand = `Start-Process netsh -ArgumentList '${netshArgs}' -Verb RunAs -WindowStyle Hidden -Wait`;
  try {
    await exec(`powershell -Command "${psCommand}"`);
  } catch {
    return { ok: false, manualCommand };
  }

  if (await ruleCoversPort(port, exec)) return { ok: true };
  return { ok: false, manualCommand };
}

module.exports = { ensureFirewallRule, RULE_NAME };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test src/main/firewall.test.js`
Expected: PASS — 3 testes

- [ ] **Step 5: Commit**

```bash
git add src/main/firewall.js src/main/firewall.test.js
git commit -m "feat: add firewall rule module with injectable exec for testing"
```

---

### Task 4: `src/main.js` + `src/preload.js` — servidor embutido e IPC `room:host`

**Files:**
- Modify: `src/main.js` (adiciona lógica depois da linha 21, e um novo handler IPC depois da linha 110)
- Modify: `src/preload.js` (adiciona `hostRoom` depois da linha 14)

**Interfaces:**
- Consumes: `createSignalingServer` (Task 1), `pickAddress` (Task 2), `ensureFirewallRule` (Task 3).
- Produces: IPC handler `room:host` invocável do renderer como `window.golive.hostRoom({ name })`, devolvendo:
  ```ts
  { ok: true, port: number, address: string | null, firewall: { ok: boolean, manualCommand?: string }, addressWarning?: string }
  | { ok: false, error: string }
  ```
  Consumido por Task 6 (`app.js`).

- [ ] **Step 1: Adicionar estado do servidor embutido e função de porta livre em `src/main.js`**

Depois da linha 26 (`let win = null;`), adicionar:

```js
const { createSignalingServer } = require('../server/signaling-core');
const { pickAddress } = require('./main/network');
const { ensureFirewallRule } = require('./main/firewall');

/** Servidor de sinalizacao embutido, quando este processo esta hospedando. */
let embeddedServer = null;

async function findFreeServer(startPort = 9000, endPort = 9010) {
  for (let port = startPort; port <= endPort; port++) {
    try {
      return await createSignalingServer({ port });
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  const err = new Error('PORTS_EXHAUSTED');
  err.code = 'PORTS_EXHAUSTED';
  throw err;
}

async function closeEmbeddedServer() {
  if (!embeddedServer) return;
  await embeddedServer.close();
  embeddedServer = null;
}
```

(mover o `require('path')` já existente na linha 12 não muda; os `require`s novos ficam logo abaixo dele, junto com os outros — reorganizar o topo do arquivo pra manter os `require`s juntos é aceitável, mas não obrigatório; o bloco acima pode ficar onde está.)

- [ ] **Step 2: Fechar o servidor embutido ao sair, em `src/main.js`**

Modificar o handler existente (linhas 75-77):

```js
app.on('window-all-closed', () => {
  closeEmbeddedServer();
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 3: Adicionar o handler IPC `room:host`**

Depois do handler `sources:select` (linha 110), adicionar:

```js
ipcMain.handle('room:host', async (_event, { name }) => {
  try {
    if (embeddedServer) await closeEmbeddedServer();
    embeddedServer = await findFreeServer();

    const firewall = await ensureFirewallRule(embeddedServer.port);
    const picked = pickAddress();

    return {
      ok: true,
      port: embeddedServer.port,
      address: picked ? `${picked.address}:${embeddedServer.port}` : null,
      firewall,
      addressWarning: picked ? undefined : 'Radmin/Tailscale não detectado',
    };
  } catch (err) {
    return { ok: false, error: err.code === 'PORTS_EXHAUSTED' ? 'PORTS_EXHAUSTED' : err.message };
  }
});
```

(o parâmetro `name` não é usado no main process — a identidade do host é tratada no renderer/signaling, igual a qualquer outro peer — mas fica na assinatura porque é o contrato definido no spec e o preload já o repassa.)

- [ ] **Step 4: Expor `hostRoom` em `src/preload.js`**

Depois da linha 14 (dentro do objeto passado a `exposeInMainWorld`):

```js
  /** Sobe o servidor de sinalizacao embutido e devolve o endereco pronto. */
  hostRoom: (payload) => ipcRenderer.invoke('room:host', payload),
```

- [ ] **Step 5: Testar manualmente**

Não há como testar IPC/Electron com `node:test` sem um runtime de browser. Verificação manual:

1. `npm start`.
2. Abrir o DevTools do renderer (não há atalho de menu — usar `win.webContents.openDevTools()` temporariamente em `createWindow()`, ou pular pra Task 6 que já expõe isso na UI).
3. No console do DevTools: `await window.golive.hostRoom({ name: 'teste' })` deve devolver `{ ok: true, port: 9000, address: '<algum IP>:9000' | null, firewall: {...} }`.
4. Rodar de novo o mesmo comando (segunda instância do app, ou chamar duas vezes): a segunda chamada deve devolver porta `9001` (fallback), não erro.

Remover qualquer `openDevTools()` temporário adicionado só pra este teste antes do commit.

- [ ] **Step 6: Commit**

```bash
git add src/main.js src/preload.js
git commit -m "feat: embed signaling server and expose room:host IPC handler"
```

---

### Task 5: Malha WebRTC — suportar múltiplos transmissores simultâneos

**Files:**
- Modify: `src/renderer/app.js` (linhas 18-19, 163-343, 415-431, 464-479)
- Test: manual (documentado no Step 5 abaixo — WebRTC só roda em contexto de browser real)

**Interfaces:**
- Produces: `peers: Map<string, { id, name, live, outConn: RTCPeerConnection|null, inConn: RTCPeerConnection|null }>` — novo formato do estado de peer, usado por Task 6/7 (nenhuma delas lê o campo `pc` antigo).
- Mensagem `ice` sobre o wire ganha um campo `dir: 'out' | 'in'` indicando de qual conexão do remetente veio o candidato (o servidor de sinalização já repassa qualquer campo extra sem alteração — ver `server/signaling-core.js`, `case 'offer'/'answer'/'ice'` — então nenhuma mudança é necessária no servidor).

- [ ] **Step 1: Trocar o estado de peer (linhas 18-19)**

```js
/** peerId -> { id, name, live, outConn, inConn } */
const peers = new Map();
```

- [ ] **Step 2: Reescrever a criação de conexões (linhas 248-281, funções `addPeer`/`ensureConnection`)**

```js
function addPeer(id, name) {
  if (!peers.has(id)) peers.set(id, { id, name, live: false, outConn: null, inConn: null });
}

/** Cria uma RTCPeerConnection nova pro papel dado ('out' = eu envio, 'in' = eu recebo). */
function makeConnection(peerId, dir) {
  const pc = new RTCPeerConnection(RTC_CONFIG);

  pc.addEventListener('icecandidate', (event) => {
    if (event.candidate) signal({ type: 'ice', to: peerId, dir, candidate: event.candidate });
  });

  if (dir === 'in') {
    pc.addEventListener('track', (event) => {
      const peer = peers.get(peerId);
      showTile(peerId, peer ? peer.name : peerId, event.streams[0]);
    });
  }

  pc.addEventListener('connectionstatechange', () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState) && dir === 'in') {
      removeTile(peerId);
    }
    renderPeers();
  });

  return pc;
}

/** Conexao pela qual EU envio minha tela pra este peer. */
function ensureOutConn(peerId) {
  let peer = peers.get(peerId);
  if (!peer) {
    addPeer(peerId, `#${peerId}`);
    peer = peers.get(peerId);
  }
  if (!peer.outConn) peer.outConn = makeConnection(peerId, 'out');
  return peer.outConn;
}

/** Conexao pela qual EU recebo a tela deste peer. Sempre recriada numa
 * offer nova, porque cada sessao de transmissao usa credenciais ICE novas. */
function ensureInConn(peerId) {
  let peer = peers.get(peerId);
  if (!peer) {
    addPeer(peerId, `#${peerId}`);
    peer = peers.get(peerId);
  }
  if (peer.inConn) {
    peer.inConn.close();
    removeTile(peerId);
  }
  peer.inConn = makeConnection(peerId, 'in');
  return peer.inConn;
}
```

- [ ] **Step 3: Reescrever `handleSignal` (linhas 163-246)**

```js
async function handleSignal(msg) {
  switch (msg.type) {
    case 'welcome': {
      myId = msg.id;
      for (const p of msg.peers) addPeer(p.id, p.name);
      renderPeers();
      break;
    }

    case 'peer-joined': {
      addPeer(msg.id, msg.name);
      renderPeers();
      if (localStream) await offerTo(msg.id);
      break;
    }

    case 'peer-left': {
      const peer = peers.get(msg.id);
      if (peer) {
        peer.outConn?.close();
        peer.inConn?.close();
        peers.delete(msg.id);
        removeTile(msg.id);
        renderPeers();
      }
      break;
    }

    case 'offer': {
      const pc = ensureInConn(msg.from);
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signal({ type: 'answer', to: msg.from, sdp: pc.localDescription });
      break;
    }

    case 'answer': {
      const peer = peers.get(msg.from);
      if (!peer?.outConn) return;
      await peer.outConn.setRemoteDescription(msg.sdp);
      applyEncoding();
      break;
    }

    case 'ice': {
      const peer = peers.get(msg.from);
      if (!peer || !msg.candidate) return;
      // Candidato da outConn do remetente chega na minha inConn, e vice-versa.
      const target = msg.dir === 'out' ? peer.inConn : peer.outConn;
      if (!target) return;
      try {
        await target.addIceCandidate(msg.candidate);
      } catch {
        /* candidato tardio, ignorar */
      }
      break;
    }

    case 'broadcast-state': {
      const peer = peers.get(msg.id);
      if (peer) {
        peer.live = msg.live;
        if (!msg.live && peer.inConn) {
          peer.inConn.close();
          peer.inConn = null;
        }
      }
      if (!msg.live) removeTile(msg.id);
      renderPeers();
      break;
    }
  }
}
```

- [ ] **Step 4: Atualizar `offerTo`, `applyEncoding`, `stopShare`, `renderPeers`, e o handler de `close` do WebSocket**

`offerTo` (linhas 284-302) — trocar `ensureConnection(peerId)` por `ensureOutConn(peerId)`, resto igual:

```js
async function offerTo(peerId) {
  const pc = ensureOutConn(peerId);
  const q = quality();

  for (const track of localStream.getTracks()) {
    const transceiver = pc.addTransceiver(track, {
      direction: 'sendonly',
      streams: [localStream],
      sendEncodings: track.kind === 'video'
        ? [{ maxBitrate: q.bitrate, maxFramerate: q.fps }]
        : undefined,
    });
    if (track.kind === 'video') preferCodec(transceiver, q.codec);
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signal({ type: 'offer', to: peerId, sdp: pc.localDescription });
}
```

`applyEncoding` (linhas 329-343) — iterar só `outConn`:

```js
function applyEncoding() {
  const q = quality();
  for (const peer of peers.values()) {
    if (!peer.outConn) continue;
    for (const sender of peer.outConn.getSenders()) {
      if (!sender.track || sender.track.kind !== 'video') continue;
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = q.bitrate;
      params.encodings[0].maxFramerate = q.fps;
      params.degradationPreference = 'maintain-framerate';
      sender.setParameters(params).catch(() => {});
    }
  }
}
```

`stopShare` (linhas 415-431) — fechar só `outConn` de cada peer (a transmissão de quem eu recebo não deve cair só porque eu parei a minha):

```js
function stopShare() {
  if (!localStream) return;
  localStream.getTracks().forEach((t) => t.stop());
  localStream = null;

  for (const peer of peers.values()) {
    if (!peer.outConn) continue;
    peer.outConn.close();
    peer.outConn = null;
  }

  removeTile('me');
  signal({ type: 'broadcast-state', live: false });
  el.share.classList.remove('hidden');
  el.stop.classList.add('hidden');
  stopStatsLoop();
}
```

`renderPeers` (linhas 464-479) — estado da bolinha reflete qualquer uma das duas conexões:

```js
function renderPeers() {
  el.peerList.innerHTML = '';
  if (!peers.size) {
    el.peerList.innerHTML = '<li class="muted">so voce por aqui</li>';
    return;
  }
  for (const peer of peers.values()) {
    const li = document.createElement('li');
    const state = peer.inConn?.connectionState || peer.outConn?.connectionState;
    li.innerHTML = `
      <span class="dot ${state === 'connected' ? 'ok' : state ? 'warn' : ''}"></span>
      ${escapeHtml(peer.name)}
      ${peer.live ? '<em>ao vivo</em>' : ''}`;
    el.peerList.appendChild(li);
  }
}
```

Handler de `close` do WebSocket (linha 157, dentro do listener registrado em `el.connect`) — trocar `peer.pc?.close()` por:

```js
    for (const peer of peers.values()) {
      peer.outConn?.close();
      peer.inConn?.close();
    }
```

`updateStats` (linhas 498-529) — trocar as três ocorrências de `peer.pc` por `peer.outConn` (condição do loop, `peer.pc.getStats()`, e a leitura permanece igual — só a fonte muda).

- [ ] **Step 5: Testar manualmente (duas instâncias do app)**

Não há teste automatizado possível aqui — `RTCPeerConnection` só existe em contexto de renderer/browser real. Procedimento:

1. `npm run server` numa máquina (ou `localhost` mesmo, pra teste local com duas instâncias do Electron).
2. Abrir duas instâncias de `npm start`, cada uma conectando na mesma sala com nomes diferentes.
3. Peer A clica "Compartilhar tela". Confirmar que o vídeo aparece no grid de B.
4. Enquanto A ainda transmite, B também clica "Compartilhar tela". Confirmar que **ambos os vídeos continuam aparecendo dos dois lados** — este é o bug que o refactor corrige; antes dele, a segunda oferta derrubava a primeira.
5. B clica "Parar transmissão". Confirmar que o vídeo de A pra B continua intacto (só o de B some).
6. Abrir uma terceira instância, entrar na sala depois que A já está transmitindo. Confirmar que o terceiro recebe o vídeo de A.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/app.js
git commit -m "fix: support concurrent broadcasters via separate outConn/inConn per peer"
```

---

### Task 6: Tela inicial — "Criar sala" / "Entrar em sala"

**Files:**
- Modify: `src/renderer/index.html` (linhas 12-38, tela `#setup`)
- Modify: `src/renderer/app.js` (linhas 27-161, atalhos de DOM + fluxo de conexão)
- Modify: `src/renderer/style.css` (novas classes `.tabs`, `.tab`, `.setup-loading`)

**Interfaces:**
- Consumes: `window.golive.hostRoom({ name }) -> Promise<{ ok, port, address, firewall, addressWarning } | { ok: false, error }>` (Task 4).
- Produces: variável de módulo `hostInfo: { port, address, firewall, addressWarning } | null` em `app.js`, lida por Task 7 pra desenhar o painel "Sala ativa".

- [ ] **Step 1: Reescrever a tela `#setup` em `src/renderer/index.html` (linhas 12-38)**

```html
<!-- ============ TELA DE ENTRADA ============ -->
<section id="setup" class="setup">
  <div class="setup-card">
    <h1>GoLive <span>LAN</span></h1>
    <p class="sub">Compartilhamento de tela 1080p60 direto entre os PCs, pela VPN.</p>

    <div class="tabs">
      <button id="tab-host" class="tab active" type="button">Criar sala</button>
      <button id="tab-join" class="tab" type="button">Entrar em sala</button>
    </div>

    <div id="pane-host" class="pane">
      <label>
        Seu nome
        <input id="host-name" type="text" placeholder="seu apelido" spellcheck="false" />
      </label>
      <button id="btn-host" class="primary">Criar sala</button>
      <p id="host-status" class="hint"></p>
      <p id="host-error" class="error"></p>
    </div>

    <div id="pane-join" class="pane hidden">
      <label>
        Endereço da sala
        <input id="in-server" type="text" placeholder="26.0.0.1 ou ws://26.0.0.1:9000" spellcheck="false" />
      </label>
      <label>
        Seu nome
        <input id="in-name" type="text" placeholder="seu apelido" spellcheck="false" />
      </label>
      <button id="btn-connect" class="primary">Conectar</button>
      <p id="setup-error" class="error"></p>
    </div>
  </div>
</section>
```

(o campo `#in-room` some — sem sub-salas, ver Global Constraints.)

- [ ] **Step 2: Atalhos de DOM e alternância de abas em `src/renderer/app.js`**

Substituir o bloco `el = {...}` (linhas 31-55) — remover `room`, adicionar os elementos novos:

```js
const el = {
  setup: $('setup'),
  main: $('main'),
  tabHost: $('tab-host'),
  tabJoin: $('tab-join'),
  paneHost: $('pane-host'),
  paneJoin: $('pane-join'),
  hostName: $('host-name'),
  btnHost: $('btn-host'),
  hostStatus: $('host-status'),
  hostError: $('host-error'),
  server: $('in-server'),
  name: $('in-name'),
  connect: $('btn-connect'),
  setupError: $('setup-error'),
  connDot: $('conn-dot'),
  connText: $('conn-text'),
  peerList: $('peer-list'),
  res: $('sel-res'),
  fps: $('sel-fps'),
  bitrate: $('in-bitrate'),
  bitrateLabel: $('lbl-bitrate'),
  codec: $('sel-codec'),
  audio: $('chk-audio'),
  share: $('btn-share'),
  stop: $('btn-stop'),
  stats: $('stats'),
  grid: $('grid'),
  picker: $('picker'),
  pickerGrid: $('picker-grid'),
  pickerCancel: $('picker-cancel'),
};

function selectTab(tab) {
  const isHost = tab === 'host';
  el.tabHost.classList.toggle('active', isHost);
  el.tabJoin.classList.toggle('active', !isHost);
  el.paneHost.classList.toggle('hidden', !isHost);
  el.paneJoin.classList.toggle('hidden', isHost);
}

el.tabHost.addEventListener('click', () => selectTab('host'));
el.tabJoin.addEventListener('click', () => selectTab('join'));
```

Ajustar o bloco de `localStorage` (linhas 57-68) — remover `room`:

```js
const saved = JSON.parse(localStorage.getItem('golive') || '{}');
el.server.value = saved.server || '';
el.name.value = saved.name || '';
el.hostName.value = saved.hostName || saved.name || '';

function persist() {
  localStorage.setItem(
    'golive',
    JSON.stringify({ server: el.server.value, name: el.name.value, hostName: el.hostName.value })
  );
}
```

- [ ] **Step 3: Fatorar a conexão WebSocket em `connectTo(url, name)` e usá-la nos dois fluxos**

Substituir o listener de `el.connect` (linhas 117-161) por uma função reutilizável mais um listener fino, e adicionar o listener de `el.btnHost`:

```js
/** peerId 'me' usa a mesma conexao de sinalizacao pros dois fluxos. */
let hostInfo = null; // { port, address, firewall, addressWarning } | null, ver Task 7

function connectTo(url, name) {
  el.setupError.textContent = '';
  try {
    ws = new WebSocket(url);
  } catch {
    el.setupError.textContent = 'Endereco invalido.';
    return;
  }

  ws.addEventListener('open', () => {
    persist();
    signal({ type: 'join', room: 'geral', name: name || 'anonimo' });
    el.setup.classList.add('hidden');
    el.main.classList.remove('hidden');
    setConnState('ok', 'conectado');
  });

  ws.addEventListener('message', (event) => handleSignal(JSON.parse(event.data)));

  ws.addEventListener('error', () => {
    el.setupError.textContent =
      'Nao consegui conectar. Confira o IP, se o servidor esta rodando e se a porta esta liberada no firewall.';
    el.connect.disabled = false;
    el.connect.textContent = 'Conectar';
    el.btnHost.disabled = false;
    el.btnHost.textContent = 'Criar sala';
  });

  ws.addEventListener('close', () => {
    setConnState('bad', 'desconectado');
    el.connect.disabled = false;
    el.connect.textContent = 'Conectar';
    for (const peer of peers.values()) {
      peer.outConn?.close();
      peer.inConn?.close();
    }
    peers.clear();
    renderPeers();
  });
}

el.connect.addEventListener('click', () => {
  let url = el.server.value.trim();
  if (!url) return (el.setupError.textContent = 'Informe o endereco do servidor.');
  if (!/^wss?:\/\//.test(url)) url = `ws://${url}`;
  if (!/:\d+$/.test(url)) url += ':9000';

  el.connect.disabled = true;
  el.connect.textContent = 'Conectando...';
  connectTo(url, el.name.value.trim());
});

el.btnHost.addEventListener('click', async () => {
  el.hostError.textContent = '';
  el.btnHost.disabled = true;
  el.btnHost.textContent = 'Preparando sala...';
  el.hostStatus.textContent = 'Preparando sala...';

  const name = el.hostName.value.trim() || 'anonimo';
  const result = await window.golive.hostRoom({ name });

  if (!result.ok) {
    el.hostError.textContent =
      result.error === 'PORTS_EXHAUSTED'
        ? 'Todas as portas 9000-9010 estao ocupadas. Feche outras instancias do GoLive e tente de novo.'
        : `Nao consegui subir a sala: ${result.error}`;
    el.btnHost.disabled = false;
    el.btnHost.textContent = 'Criar sala';
    el.hostStatus.textContent = '';
    return;
  }

  hostInfo = { port: result.port, address: result.address, firewall: result.firewall, addressWarning: result.addressWarning };
  el.hostStatus.textContent = result.firewall.ok ? '' : 'Liberando firewall...';
  connectTo(`ws://127.0.0.1:${result.port}`, name);
});
```

Nota: `el.hostStatus` mostra `'Liberando firewall...'` só quando `firewall.ok` é `false` no momento em que a resposta chega — como `hostRoom` já esperou o `ensureFirewallRule` internamente (Task 4), esse texto serve de contexto pro aviso permanente que a Task 7 desenha no painel da sidebar, não como um spinner em andamento. Se quiser o texto intermediário real durante o `await`, isso exigiria um evento de progresso do main process; fora de escopo deste plano (a UI já não trava — o botão mostra "Preparando sala..." disabled enquanto a Promise resolve).

- [ ] **Step 4: CSS para as abas em `src/renderer/style.css`**

Adicionar ao final do arquivo:

```css
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  background: var(--bg-inset, #161a22);
  border-radius: 8px;
  padding: 4px;
}

.tab {
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
}

.tab.active {
  background: var(--accent, #3b82f6);
  opacity: 1;
}

.pane.hidden {
  display: none;
}

.hint {
  opacity: 0.7;
  font-size: 0.85em;
  min-height: 1.2em;
}
```

(usar as variáveis de cor já existentes no arquivo se os nomes `--bg-inset`/`--accent` não baterem — conferir o `:root` do `style.css` antes de colar e ajustar pros nomes reais.)

- [ ] **Step 5: Testar manualmente**

1. `npm start`. Confirmar que a tela inicial abre na aba "Criar sala".
2. Clicar em "Entrar em sala": o formulário antigo (endereço + nome) aparece.
3. Voltar pra "Criar sala", preencher nome, clicar "Criar sala": botão desabilita, mostra "Preparando sala...", e a tela principal abre conectada via `127.0.0.1`.
4. Em outra máquina (ou segunda instância local), colar o IP mostrado (ver Task 7) na aba "Entrar em sala" e confirmar que aparece na lista de peers do host.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/index.html src/renderer/app.js src/renderer/style.css
git commit -m "feat: replace single connect form with Criar sala / Entrar em sala"
```

---

### Task 7: Painel "Sala ativa" + avisos de firewall/endereço

**Files:**
- Modify: `src/renderer/index.html` (sidebar, depois da linha 48 — `<h2>Na sala</h2>`)
- Modify: `src/renderer/app.js` (função nova `renderHostPanel()`, chamada onde `hostInfo` é setado)
- Modify: `src/renderer/style.css` (novas classes `.host-panel`, `.warn-box`)

**Interfaces:**
- Consumes: `hostInfo` (Task 6, `app.js`).

- [ ] **Step 1: Adicionar o container do painel em `src/renderer/index.html`**

Depois de `<div class="brand">GoLive <span>LAN</span></div>` (linha 43), adicionar:

```html
<div id="host-panel" class="host-panel hidden"></div>
```

- [ ] **Step 2: Implementar `renderHostPanel()` em `src/renderer/app.js`**

```js
function renderHostPanel() {
  const panel = document.getElementById('host-panel');
  if (!hostInfo) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }

  panel.classList.remove('hidden');
  const addressLine = hostInfo.address
    ? `<div class="host-address">${hostInfo.address} <button id="btn-copy-address" class="ghost small">Copiar</button></div>`
    : '';

  const warnings = [];
  if (hostInfo.addressWarning) {
    warnings.push(
      `<div class="warn-box">${escapeHtml(hostInfo.addressWarning)} — endereço abaixo só funciona na mesma rede local.</div>`
    );
  }
  if (!hostInfo.firewall.ok) {
    warnings.push(`
      <div class="warn-box">
        Não consegui liberar a porta no firewall automaticamente.
        <code>${escapeHtml(hostInfo.firewall.manualCommand)}</code>
        <button id="btn-copy-firewall" class="ghost small">Copiar comando</button>
      </div>`);
  }

  panel.innerHTML = `
    <h2>Sala ativa</h2>
    ${addressLine}
    <p class="hint">Se você fechar o GoLive, a sala cai pra todo mundo.</p>
    ${warnings.join('')}`;

  document.getElementById('btn-copy-address')?.addEventListener('click', () => {
    navigator.clipboard.writeText(hostInfo.address);
  });
  document.getElementById('btn-copy-firewall')?.addEventListener('click', () => {
    navigator.clipboard.writeText(hostInfo.firewall.manualCommand);
  });
}
```

- [ ] **Step 3: Chamar `renderHostPanel()` nos pontos certos**

No listener de `el.btnHost` (Task 6, Step 3), logo depois de `hostInfo = {...}`:

```js
  hostInfo = { port: result.port, address: result.address, firewall: result.firewall, addressWarning: result.addressWarning };
  renderHostPanel();
```

No listener `ws.addEventListener('close', ...)` dentro de `connectTo` (Task 6, Step 3) — quando a conexão cai e a tela volta pro setup, também é hora de limpar o painel se este processo era o host (evita mostrar "Sala ativa" com um endereço morto se o usuário reconectar como convidado depois):

```js
  ws.addEventListener('close', () => {
    setConnState('bad', 'desconectado');
    el.connect.disabled = false;
    el.connect.textContent = 'Conectar';
    for (const peer of peers.values()) {
      peer.outConn?.close();
      peer.inConn?.close();
    }
    peers.clear();
    renderPeers();
    hostInfo = null;
    renderHostPanel();
  });
```

- [ ] **Step 4: CSS em `src/renderer/style.css`**

```css
.host-panel {
  margin: 12px 0 20px;
  padding: 12px;
  border-radius: 8px;
  background: var(--bg-inset, #161a22);
}

.host-panel.hidden {
  display: none;
}

.host-address {
  font-family: monospace;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.warn-box {
  margin-top: 8px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(234, 179, 8, 0.15);
  border: 1px solid rgba(234, 179, 8, 0.4);
  font-size: 0.85em;
}

.warn-box code {
  display: block;
  margin: 6px 0;
  word-break: break-all;
}

.ghost.small {
  padding: 2px 8px;
  font-size: 0.85em;
}
```

- [ ] **Step 5: Testar manualmente**

1. Criar sala numa máquina sem VPN ativa (Radmin/Tailscale desligados): confirmar que aparece o aviso amarelo "Radmin/Tailscale não detectado" junto do IP de LAN.
2. Com a VPN ativa: confirmar que o painel mostra o IP `26.x.x.x` e o botão "Copiar" copia o endereço certo (colar em outro lugar pra conferir).
3. Simular falha de firewall — rodar o app sem privilégios de admin numa conta que sempre nega o UAC, cancelar o prompt: confirmar que o aviso amarelo com o comando manual aparece e o botão "Copiar comando" funciona.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/index.html src/renderer/app.js src/renderer/style.css
git commit -m "feat: show active room panel with address and firewall warnings"
```

---

### Task 8: Instalador NSIS

**Files:**
- Modify: `package.json` (bloco `"build"`, linhas 18-29)
- Modify: `README.md` (seção "Gerar o .exe pros amigos", linhas 94-103)

**Interfaces:**
- Nenhuma — só configuração de build.

- [ ] **Step 1: Trocar o alvo de build em `package.json`**

Substituir o bloco `"build"` (linhas 18-29):

```json
  "build": {
    "appId": "com.golive.lan",
    "productName": "GoLive LAN",
    "files": [
      "src/**/*",
      "server/**/*",
      "package.json"
    ],
    "win": {
      "target": "nsis"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "shortcutName": "GoLive LAN"
    }
  }
```

`package.json` também precisa excluir os arquivos `*.test.js` novos do pacote final (eles não são usados em runtime). Adicionar ao array `"files"`:

```json
    "files": [
      "src/**/*",
      "!src/**/*.test.js",
      "server/**/*",
      "!server/**/*.test.js",
      "package.json"
    ],
```

- [ ] **Step 2: Rodar o build e verificar**

Run: `npm run dist`
Expected: gera `dist/GoLive LAN Setup 0.1.0.exe` (não mais um portátil).

- [ ] **Step 3: Testar manualmente o instalador**

1. Rodar o `.exe` gerado: confirma prompt do NSIS (não é one-click), permite escolher diretório.
2. Instalar: confirmar atalho criado na Área de Trabalho e no Menu Iniciar, nomeado "GoLive LAN".
3. Abrir pelo atalho: app funciona normalmente.
4. Desinstalar pelo Painel de Controle / Configurações do Windows: confirmar remoção limpa (sem sobra de arquivos no diretório de instalação).

- [ ] **Step 4: Atualizar `README.md` (linhas 94-103)**

```markdown
## Gerar o instalador pros amigos

Pra ninguém precisar instalar Node:

```bash
npm run dist
```

Sai um instalador em `dist/GoLive LAN Setup <versão>.exe`. Ele cria atalho
na Área de Trabalho e no Menu Iniciar, e desinstala normalmente pelo painel
do Windows. Quem só quer transmitir/assistir não precisa mais de Node — o
servidor de sinalização agora sobe embutido no próprio app quando alguém
clica em **Criar sala** (ver "Como usar" abaixo).
```

- [ ] **Step 5: Commit**

```bash
git add package.json README.md
git commit -m "build: switch installer target from portable exe to NSIS"
```

---

### Task 9: Atualizar README com o novo fluxo (Criar sala / Entrar em sala)

**Files:**
- Modify: `README.md` (seção "Como usar", linhas 65-92, e nota de banda com múltiplos transmissores)

**Interfaces:**
- Nenhuma — só documentação.

- [ ] **Step 1: Reescrever a seção "Como usar" em `README.md` (linhas 65-92)**

```markdown
## Como usar

**1. Alguém da turma clica em "Criar sala"** na tela inicial do GoLive.
O app sobe o servidor de sinalização embutido, libera a porta no firewall
(pode pedir uma confirmação do Windows na primeira vez) e mostra um
endereço pronto pra copiar:

```
Sala ativa
26.13.45.201:9000              [Copiar]
```

Sem terminal, sem instalar Node à parte, sem digitar porta.

**2. Todo mundo mais abre o GoLive** e clica em "Entrar em sala", cola o
endereço (`26.x.x.x` — a porta é opcional, assume `:9000`), escolhe um
nome e clica em Conectar.

Quem quiser transmitir clica em **Compartilhar tela**, escolhe monitor ou
janela, e pronto. Mais de uma pessoa pode transmitir ao mesmo tempo na
mesma sala.

Duplo clique em qualquer vídeo expande pra tela cheia.

**Se você fechar o GoLive no PC que criou a sala, a sala cai pra todo
mundo** — não há como transferir a sala pra outra máquina no meio da
sessão.
```

- [ ] **Step 2: Atualizar a tabela de banda (linhas 20-25) com a nota de múltiplos transmissores**

Depois da tabela existente (linha 25), adicionar:

```markdown
Isso é por transmissor: com duas pessoas transmitindo ao mesmo tempo, o
**download de cada espectador** também dobra (uma cópia de cada
transmissão chegando).
```

- [ ] **Step 3: Revisar o README inteiro por referências ao fluxo antigo**

Grep por `npm run server` e `sala` no README pra confirmar que nenhuma outra seção ainda descreve o formulário único antigo ou o campo de sala manual.

Run: `grep -n "npm run server\|campo.*sala\|Sala\b" README.md`
Expected: só aparece na seção de "Instalação" opcional pra quem quer rodar servidor dedicado (que continua válida — Task 1 manteve `server/signaling.js` como CLI), e no novo painel "Sala ativa".

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update README for embedded server and multi-broadcaster flow"
```

---

## Self-Review

**Cobertura do spec:**
- §1 (servidor embutido) → Task 1 (extração) + Task 4 (integração no main process).
- §2 (detecção de endereço) → Task 2.
- §3 (firewall) → Task 3.
- §4 (interface: Criar sala / Entrar em sala, painel Sala ativa) → Tasks 6 e 7.
- §5 (múltiplos transmissores) → Task 5.
- §6 (instalador NSIS) → Task 8.
- Seção de testes manuais do spec → distribuída nos Steps de teste manual de cada task (Tasks 4, 5, 6, 7, 8) e cobre todos os itens listados no spec original.
- Nota de banda pra múltiplos transmissores → Task 9, Step 2.

**Placeholders:** nenhum "TBD"/"similar a"/"adicionar validação apropriada" — todo código é completo e colável.

**Consistência de tipos:** `hostRoom({ name }) -> { ok, port, address, firewall, addressWarning }` é o mesmo formato em Task 4 (produtor) e Tasks 6-7 (consumidores). `peers` Map com `{ outConn, inConn }` é o mesmo formato entre Task 5 (produtor) e o resto do `app.js` que já usava `peers` antes (Tasks 6-7 só leem `hostInfo`, não tocam no formato de `peers`). `ensureFirewallRule(port, { exec })` e `pickAddress(interfaces)` batem entre Tasks 2-3 (produtores) e Task 4 (consumidor).
