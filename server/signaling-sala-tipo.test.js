'use strict';
/*
 * Tipo de sala: "Mesa" (padrao) ou "So transmissoes" (`mesa: false`). O
 * servidor sobe de verdade e clientes `ws` reais falam o protocolo. Toda
 * espera e por mensagem (nenhum timer): o eco de um 'ice' enderecado a si
 * mesmo serve de barreira para afirmar que algo NAO chegou.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createSignalingServer } = require('./signaling-core');

const DEADLINE_MS = 5000;

/** Cliente que guarda tudo o que chega, para nenhuma mensagem se perder. */
function abrirCliente(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const entrada = [];
  const esperas = new Set();
  ws.on('message', (raw) => {
    entrada.push(JSON.parse(raw.toString()));
    for (const espera of Array.from(esperas)) espera();
  });
  ws.on('error', () => {});
  const cliente = {
    ws,
    entrada,
    aberto: () => new Promise((resolve) => ws.once('open', () => resolve(cliente))),
    envia: (msg) => ws.send(JSON.stringify(msg)),
    espera(filtro) {
      return new Promise((resolve, reject) => {
        const prazo = setTimeout(() => reject(new Error('mensagem nao chegou')), DEADLINE_MS);
        const tentar = () => {
          const achou = entrada.find(filtro);
          if (!achou) return;
          clearTimeout(prazo);
          esperas.delete(tentar);
          resolve(achou);
        };
        esperas.add(tentar);
        tentar();
      });
    },
    esperaTipo: (tipo) => cliente.espera((msg) => msg.type === tipo),
  };
  return cliente;
}

async function entrar(servidor, nome) {
  const cliente = await abrirCliente(servidor.port).aberto();
  cliente.envia({ type: 'join', room: 'geral', name: nome, clientId: `c-${nome}` });
  cliente.welcome = await cliente.esperaTipo('welcome');
  return cliente;
}

/** Barreira: quando o eco volta, tudo enviado antes ja foi processado. */
async function barreira(cliente) {
  const id = cliente.welcome.id;
  const antes = cliente.entrada.length;
  cliente.envia({ type: 'ice', to: id, candidate: { c: 'barreira' } });
  await cliente.espera((msg, i) => msg.type === 'ice' && cliente.entrada.indexOf(msg) >= antes && i >= 0);
}

async function comServidor(opcoes, corpo) {
  const servidor = await createSignalingServer({ port: 0, ...opcoes });
  const abertos = [];
  try {
    await corpo(servidor, async (nome) => {
      const cliente = await entrar(servidor, nome);
      abertos.push(cliente);
      return cliente;
    });
  } finally {
    for (const cliente of abertos) cliente.ws.close();
    await servidor.close();
  }
}

test('sala so transmissoes: o welcome leva mesa:false', async () => {
  await comServidor({ mesa: false }, async (_servidor, entra) => {
    const ana = await entra('Ana');
    assert.equal(ana.welcome.mesa, false);
  });
});

test('sala com Mesa: o welcome omite o campo mesa (padrao e mesa:true explicito)', async () => {
  for (const opcoes of [{}, { mesa: true }, { mesa: 'talvez' }]) {
    await comServidor(opcoes, async (_servidor, entra) => {
      const ana = await entra('Ana');
      assert.equal('mesa' in ana.welcome, false);
    });
  }
});

test('sala so transmissoes: o probe-ok leva mesa:false', async () => {
  await comServidor({ mesa: false }, async (servidor) => {
    const sonda = await abrirCliente(servidor.port).aberto();
    sonda.envia({ type: 'probe' });
    const ok = await sonda.esperaTipo('probe-ok');
    assert.equal(ok.mesa, false);
  });
});

test('sala com Mesa: o probe-ok omite o campo mesa', async () => {
  await comServidor({}, async (servidor) => {
    const sonda = await abrirCliente(servidor.port).aberto();
    sonda.envia({ type: 'probe' });
    const ok = await sonda.esperaTipo('probe-ok');
    assert.equal('mesa' in ok, false);
  });
});

test('sala so transmissoes: recusa as operacoes da Mesa', async () => {
  await comServidor({ mesa: false }, async (_servidor, entra) => {
    const ana = await entra('Ana');
    ana.envia({ type: 'mesa', op: 'add', win: { type: 'notas', x: 0, y: 0, w: 320, h: 240 } });
    const add = await ana.espera((msg) => msg.type === 'mesa-denied' && msg.op === 'add');
    assert.equal(add.reason, 'disabled');
    ana.envia({ type: 'mesa', op: 'lock', leaderOnly: true });
    const trava = await ana.espera((msg) => msg.type === 'mesa-denied' && msg.op === 'lock');
    assert.equal(trava.reason, 'disabled');
    ana.envia({ type: 'mesa-grab', id: 'w1' });
    const grab = await ana.espera((msg) => msg.type === 'mesa-denied' && msg.op === 'grab');
    assert.equal(grab.reason, 'disabled');
    ana.envia({ type: 'mesa-view', on: true });
    const vista = await ana.espera((msg) => msg.type === 'mesa-denied' && msg.op === 'view');
    assert.equal(vista.reason, 'disabled');
    ana.envia({ type: 'mesa-sync' });
    const sync = await ana.espera((msg) => msg.type === 'mesa-denied' && msg.op === 'sync');
    assert.equal(sync.reason, 'disabled');
    await barreira(ana);
    assert.equal(ana.entrada.some((msg) => msg.type === 'mesa-sync'), false);
  });
});

test('sala so transmissoes: ir ao vivo nao poe janela na Mesa', async () => {
  await comServidor({ mesa: false }, async (_servidor, entra) => {
    const ana = await entra('Ana');
    const bia = await entra('Bia');
    ana.envia({ type: 'broadcast-state', live: true });
    await barreira(ana);
    await barreira(bia);
    assert.equal(ana.entrada.some((msg) => msg.type === 'mesa-count'), false);
    assert.equal(bia.entrada.some((msg) => msg.type === 'mesa-count'), false);
  });
});

test('sala com Mesa: ir ao vivo poe a janela da tela (controle do teste anterior)', async () => {
  await comServidor({}, async (_servidor, entra) => {
    const ana = await entra('Ana');
    ana.envia({ type: 'broadcast-state', live: true });
    const contagem = await ana.esperaTipo('mesa-count');
    assert.equal(contagem.count, 1);
  });
});

test('sala com Mesa: a operacao da Mesa continua sendo aceita', async () => {
  await comServidor({}, async (_servidor, entra) => {
    const ana = await entra('Ana');
    ana.envia({ type: 'mesa-view', on: true });
    await ana.esperaTipo('mesa-sync');
    assert.equal(ana.entrada.some((msg) => msg.type === 'mesa-denied'), false);
  });
});

test('a migracao carrega o tipo: room-migrating leva mesaEnabled:false so nas salas sem Mesa', async () => {
  for (const [opcoes, esperado] of [[{ mesa: false }, false], [{}, undefined]]) {
    await comServidor(opcoes, async (servidor, entra) => {
      await entra('Host');
      const bia = await entra('Bia');
      const migrando = bia.esperaTipo('room-migrating');
      const fechando = servidor.close({ migrate: true });
      const aviso = await migrando;
      await fechando;
      assert.equal(aviso.mesaEnabled, esperado);
    });
  }
});
