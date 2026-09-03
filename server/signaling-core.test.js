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

// Espera a proxima mensagem 'chat' que casa com `pred`. Necessario porque
// join/leave broadcast uma linha de sistema pra sala INTEIRA: um peer que ja
// esta na sala pode receber a linha de "fulano entrou" no meio de um
// `await`, e um `once(ws, 'chat')` cru pegaria essa linha em vez da mensagem
// (ou da linha de sistema) que o teste realmente quer.
function onceChatWhere(ws, pred) {
  return new Promise((resolve) => {
    function onMessage(raw) {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'chat' && pred(msg)) {
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

test('JSON valido que nao e objeto nao derruba o servidor (null, numero, array, string)', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    // Um unico frame `null` fazia `msg.type` lancar num null; a excecao
    // subia como uncaught e matava o processo de quem hospeda a sala.
    for (const frame of ['null', '42', '"oi"', '[1,2,3]', 'true']) a.send(frame);

    // Se o servidor caiu, este join nunca recebe welcome.
    const b = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => b.once('open', r));
    b.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Bruno' }));
    const welcome = await once(b, 'welcome');
    assert.equal(welcome.type, 'welcome');

    a.close();
    b.close();
  } finally {
    await server.close();
  }
});

test('watchers e kind chegam limitados no rebroadcast (anti-amplificacao)', async () => {
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

    const atB = onceWithin(b, 'watchers');
    a.send(
      JSON.stringify({
        type: 'watchers',
        kind: 'x'.repeat(5000),
        watchers: Array.from({ length: 5000 }, (_, i) => ({ id: String(i) })),
      })
    );
    const msg = await atB;
    assert.ok(msg.watchers.length <= 64, `watchers cortado, veio ${msg.watchers.length}`);
    assert.ok(msg.kind.length <= 64, `kind cortado, veio ${msg.kind.length}`);

    a.close();
    b.close();
  } finally {
    await server.close();
  }
});

test('fuzz: frames aleatorios (bytes, JSON torto, tipos desconhecidos) nao derrubam o servidor', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    function mulberry32(seed) {
      return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const rand = mulberry32(1234567);
    const pool = [
      '', '{', '}', '[]', 'null', 'true', '0', '"x"', 'NaN',
      '{"type":42}', '{"type":{}}', '{"type":"join","room":{}}',
      '{"type":"join","name":123}', '{"type":"offer"}', '{"type":"ice","to":null}',
      '{"type":"ice","to":["a","b"]}', '{"type":"watchers","watchers":"nope"}',
      '{"type":"' + 'z'.repeat(200) + '"}', '{"type":"broadcast-state","live":{}}',
      '\u0000\u0001\u0002', '{"type":"join","avatar":42}',
    ];

    const noisy = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => noisy.once('open', r));
    for (let i = 0; i < 200; i += 1) {
      const s = pool[Math.floor(rand() * pool.length)];
      noisy.send(rand() < 0.5 ? s : Buffer.from(s));
    }

    // O servidor sobreviveu se um cliente novo ainda entra e negocia.
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana' }));
    const wa = await once(a, 'welcome');
    assert.equal(wa.type, 'welcome');

    const b = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => b.once('open', r));
    b.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Bruno' }));
    await once(b, 'welcome');
    const introB = await once(a, 'peer-joined');
    assert.equal(introB.name, 'Bruno');

    noisy.close();
    a.close();
    b.close();
  } finally {
    await server.close();
  }
});

test('PIN da sala: join com o PIN certo entra, com o errado ou sem PIN e negado (B3)', async () => {
  const server = await createSignalingServer({ port: 0, pin: '4821' });
  try {
    // PIN certo -> welcome normal
    const ok = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => ok.once('open', r));
    ok.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana', pin: '4821' }));
    const welcome = await once(ok, 'welcome');
    assert.equal(welcome.type, 'welcome');

    // PIN errado -> join-denied e o socket fecha, nao entra na sala
    const bad = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => bad.once('open', r));
    const deniedMsg = onceWithin(bad, 'join-denied');
    const closed = new Promise((r) => bad.once('close', (code) => r(code)));
    bad.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Intruso', pin: '0000' }));
    const denied = await deniedMsg;
    assert.equal(denied.reason, 'pin');
    assert.equal(await closed, 1008);

    // sem PIN nenhum -> tambem negado
    const nopin = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => nopin.once('open', r));
    const deniedMsg2 = onceWithin(nopin, 'join-denied');
    nopin.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Distraido' }));
    assert.equal((await deniedMsg2).reason, 'pin');

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(server.getPeerCount(), 1, 'so a Ana entrou');

    ok.close();
  } finally {
    await server.close();
  }
});

test('PIN da sala: tentativa errada de um intruso nao afeta quem ja esta dentro (B3)', async () => {
  const server = await createSignalingServer({ port: 0, pin: '1234' });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana', pin: '1234' }));
    await once(a, 'welcome');

    const intruso = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => intruso.once('open', r));
    intruso.send(JSON.stringify({ type: 'join', room: 'geral', name: 'X', pin: 'zzzz' }));
    await onceWithin(intruso, 'join-denied');

    // Bruno entra certo e a Ana ve o peer-joined dele -- a sala segue viva
    const b = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => b.once('open', r));
    const introB = once(a, 'peer-joined');
    b.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Bruno', pin: '1234' }));
    await once(b, 'welcome');
    assert.equal((await introB).name, 'Bruno');

    a.close();
    b.close();
  } finally {
    await server.close();
  }
});

test('sem PIN configurado, join com um campo pin qualquer segue entrando (compat)', async () => {
  const server = await createSignalingServer({ port: 0 });
  try {
    const a = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((r) => a.once('open', r));
    a.send(JSON.stringify({ type: 'join', room: 'geral', name: 'Ana', pin: 'ignorado' }));
    assert.equal((await once(a, 'welcome')).type, 'welcome');
    a.close();
  } finally {
    await server.close();
  }
});

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

    const ecoA = onceChatWhere(a, (m) => !m.system);
    const ecoB = onceChatWhere(b, (m) => !m.system);
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

    const linhaSistema = onceChatWhere(a, (m) => m.system && m.event === 'leave');
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
    await once(ana, 'welcome');

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
    // once(dono, 'chat') pegaria uma linha de join/leave que caisse antes;
    // filtra pela linha de sistema de stop-share, sem enfraquecer as asserts.
    const sysLineDono = onceChatWhere(dono, (m) => m.system && m.event === 'stop-share');
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
