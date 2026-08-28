'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createSignalingServer, createRateLimiter } = require('./signaling-core');

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

test('close() avisa os clientes com room-closed antes de derrubar o socket', async () => {
  const server = await createSignalingServer({ port: 0 });
  const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
  await new Promise((r) => a.once('open', r));
  a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
  await once(a, 'welcome');

  const b = new WebSocket(`ws://127.0.0.1:${server.port}`);
  await new Promise((r) => b.once('open', r));
  b.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Bruno' }));
  await once(b, 'welcome');

  const gotClosedA = once(a, 'room-closed');
  const gotClosedB = once(b, 'room-closed');
  const closedCodeA = new Promise((res) => a.once('close', (code, reason) => res({ code, reason: reason.toString() })));

  await server.close();

  await gotClosedA;
  await gotClosedB;
  const { code, reason } = await closedCodeA;
  assert.equal(code, 1001);
  assert.equal(reason, 'host-left');
});

// Versao com prazo: sem isto, uma regressao no encaminhamento faz o teste
// pendurar pra sempre em vez de falhar.
function onceWithin(ws, type, ms = 2000) {
  return Promise.race([
    once(ws, type),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`sem ${type} em ${ms}ms`)), ms).unref()),
  ]);
}

// view-state (e, na fase 2, tree) sao encaminhamento direto peer-a-peer,
// igual a offer/answer/ice: o servidor nao interpreta nada, so entrega ao
// destinatario carimbando quem mandou. Ver a spec de 2026-08-23, F1.3.
test('encaminha view-state e tree ao destinatario, com o from carimbado', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    const welcomeA = await once(a, 'welcome');

    const b = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => b.once('open', r));
    b.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Bruno' }));
    const welcomeB = await once(b, 'welcome');

    const viewStateAtA = onceWithin(a, 'view-state');
    b.send(JSON.stringify({ type: 'view-state', to: welcomeA.id, kind: 'screen', watching: false }));
    const viewState = await viewStateAtA;
    assert.equal(viewState.from, welcomeB.id);
    assert.equal(viewState.kind, 'screen');
    assert.equal(viewState.watching, false);

    const treeAtB = onceWithin(b, 'tree');
    a.send(JSON.stringify({ type: 'tree', to: welcomeB.id, kind: 'screen', epoch: 3, filhos: [] }));
    const tree = await treeAtB;
    assert.equal(tree.from, welcomeA.id);
    assert.equal(tree.epoch, 3);

    a.close();
    b.close();
  } finally {
    await server.close();
  }
});

test('createRateLimiter libera dentro do teto e corta no estouro', () => {
  const rl = createRateLimiter({ limit: 3, windowMs: 1000 });
  assert.equal(rl.hit(0), true);
  assert.equal(rl.hit(100), true);
  assert.equal(rl.hit(200), true);
  assert.equal(rl.hit(300), false); // 4a mensagem na mesma janela
});

test('createRateLimiter zera a contagem quando a janela vira', () => {
  const rl = createRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(rl.hit(0), true);
  assert.equal(rl.hit(10), true);
  assert.equal(rl.hit(20), false);
  assert.equal(rl.hit(1000), true); // janela nova
  assert.equal(rl.hit(1010), true);
  assert.equal(rl.hit(1020), false);
});

test('createRateLimiter padrao cobre a rajada de re-oferta do welcome', () => {
  // O teto default (MAX_MSGS_PER_SECOND = 300) tem de aguentar a rajada de
  // reingresso: ~115 frames numa sala de 6 com tela + camera (ver a conta em
  // signaling-core.js). 250 numa janela ainda passa; 350 nao.
  const rl = createRateLimiter({});
  for (let i = 0; i < 250; i += 1) assert.equal(rl.hit(i), true, `frame ${i} dentro do teto`);
  const rl2 = createRateLimiter({});
  let cortou = false;
  for (let i = 0; i < 350; i += 1) if (!rl2.hit(i)) cortou = true;
  assert.equal(cortou, true);
});

test('nao encaminha offer/ice para destino em outra sala', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'salaA', name: 'Ana' }));
    const welcomeA = await once(a, 'welcome');

    const b = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => b.once('open', r));
    b.send(JSON.stringify({ type: 'join', room: 'salaB', name: 'Bruno' }));
    const welcomeB = await once(b, 'welcome');

    let recebeu = false;
    b.on('message', (raw) => {
      if (JSON.parse(raw.toString()).type === 'offer') recebeu = true;
    });
    a.send(JSON.stringify({ type: 'offer', to: welcomeB.id, sdp: 'x' }));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(recebeu, false);
    assert.equal(welcomeA.id !== welcomeB.id, true);

    a.close();
    b.close();
  } finally {
    await server.close();
  }
});

test('encaminha offer normalmente para destino na mesma sala', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    const welcomeA = await once(a, 'welcome');

    const b = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => b.once('open', r));
    b.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Bruno' }));
    const welcomeB = await once(b, 'welcome');

    const offerAtB = onceWithin(b, 'offer');
    a.send(JSON.stringify({ type: 'offer', to: welcomeB.id, sdp: 'x' }));
    const offer = await offerAtB;
    assert.equal(offer.from, welcomeA.id);

    a.close();
    b.close();
  } finally {
    await server.close();
  }
});

test('fecha o socket que estoura o teto de mensagens por segundo', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    await once(a, 'welcome');

    const closed = new Promise((r) => a.once('close', (code) => r(code)));
    // Acima do teto de 300/s (ver MAX_MSGS_PER_SECOND): um loop de verdade
    // ainda e cortado.
    for (let i = 0; i < 500; i += 1) {
      a.send(JSON.stringify({ type: 'broadcast-state', live: true }));
    }
    const code = await closed;
    assert.equal(code, 1008);
  } finally {
    await server.close();
  }
});

test('heartbeat derruba o cliente que para de responder o pong', async () => {
  const server = await createSignalingServer({ port: 0, heartbeatMs: 50 });
  try {
    // autoPong: false = o cliente ignora o ping do servidor, simulando um
    // socket morto de rede (a ponta sumiu sem handshake de close).
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`, { autoPong: false });
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    await once(a, 'welcome');
    assert.equal(server.getPeerCount(), 1);

    await new Promise((r) => a.once('close', r)); // terminado pelo servidor
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(server.getPeerCount(), 0);
  } finally {
    await server.close();
  }
});

test('heartbeat mantem de pe o cliente que responde o pong', async () => {
  const server = await createSignalingServer({ port: 0, heartbeatMs: 40 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`); // autoPong padrao
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    await once(a, 'welcome');

    await new Promise((r) => setTimeout(r, 160)); // varios ciclos de ping
    assert.equal(server.getPeerCount(), 1);
    assert.equal(a.readyState, WebSocket.OPEN);
    a.close();
  } finally {
    await server.close();
  }
});

test('watchers e broadcast pra sala inteira, com o from carimbado', async () => {
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

    const c = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => c.once('open', r));
    c.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Carla' }));
    await once(c, 'welcome');

    const atB = onceWithin(b, 'watchers');
    const atC = onceWithin(c, 'watchers');
    a.send(JSON.stringify({ type: 'watchers', kind: 'screen', watchers: [{ id: '2', name: 'Bruno' }] }));

    const msgB = await atB;
    const msgC = await atC;
    assert.equal(msgB.from, '1');
    assert.equal(msgC.from, '1');
    assert.equal(msgB.kind, 'screen');
    assert.deepEqual(msgB.watchers, [{ id: '2', name: 'Bruno' }]);

    a.close();
    b.close();
    c.close();
  } finally {
    await server.close();
  }
});
