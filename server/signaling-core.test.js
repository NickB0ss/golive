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
