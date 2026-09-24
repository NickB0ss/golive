'use strict';
/*
 * Teste ponta a ponta da Mesa (spec 2026-09-24; contrato em
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md). O servidor sobe de
 * verdade e clientes `ws` reais falam o protocolo: mesa-view, mesa,
 * mesa-grab/release, mesa-drag, cursor, time e a mesa na migracao.
 *
 * Mesma regra do signaling-e2e: nenhuma espera por timer (fora a expiracao
 * da vez, que e o proprio assunto do teste). "Nao chegou X" e afirmado
 * depois de uma barreira: o eco de um 'ice' enderecado a si mesmo prova que
 * o servidor ja processou tudo que veio antes.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createSignalingServer } = require('./signaling-core');
const mesaModel = require('../src/renderer/mesa');
require('../src/renderer/mesa-modules/index');

const DEADLINE_MS = 5000;

let nonceSeq = 0;
function nonce(prefixo) {
  nonceSeq += 1;
  return `${prefixo}-${nonceSeq}`;
}

function criarCliente(port, rotulo) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const entrada = [];
  const espera = new Set();

  function reavaliar() {
    for (const w of Array.from(espera)) {
      const achou = w.pred(entrada);
      if (achou) {
        espera.delete(w);
        clearTimeout(w.prazo);
        w.resolve(achou);
      }
    }
  }

  ws.on('message', (raw) => {
    entrada.push(JSON.parse(raw.toString()));
    reavaliar();
  });
  ws.on('error', () => {});

  const cliente = {
    rotulo,
    ws,
    entrada,
    id: null,

    aberto() {
      if (ws.readyState === WebSocket.OPEN) return Promise.resolve(cliente);
      return new Promise((resolve, reject) => {
        ws.once('open', () => resolve(cliente));
        ws.once('error', reject);
      });
    },

    envia(msg) {
      ws.send(JSON.stringify(msg));
      return cliente;
    },

    esperaMsg(filtro, oque, desde = 0) {
      const achou = entrada.slice(desde).find(filtro);
      if (achou) return Promise.resolve(achou);
      return new Promise((resolve, reject) => {
        const w = { pred: (caixa) => caixa.slice(desde).find(filtro), resolve, reject };
        w.prazo = setTimeout(() => {
          espera.delete(w);
          reject(new Error(`${rotulo}: ${oque} nao chegou em ${DEADLINE_MS}ms`));
        }, DEADLINE_MS);
        if (typeof w.prazo.unref === 'function') w.prazo.unref();
        espera.add(w);
      });
    },

    /** Espera uma mensagem que chegue DEPOIS desta chamada, para nao
     * confundir a resposta nova com uma antiga igual. */
    esperaNova(filtro, oque) {
      return cliente.esperaMsg(filtro, oque, entrada.length);
    },

    esperaTipo(type) {
      return cliente.esperaMsg((m) => m.type === type, `mensagem ${type}`);
    },

    async entra(name, extra = {}) {
      cliente.envia({ type: 'join', room: 'geral', name, ...extra });
      const welcome = await cliente.esperaTipo('welcome');
      cliente.id = welcome.id;
      return welcome;
    },

    async barreira() {
      const marca = nonce(`eco-${rotulo}`);
      cliente.envia({ type: 'ice', to: cliente.id, candidate: marca });
      return cliente.esperaMsg((m) => m.candidate === marca, `barreira ${marca}`);
    },

    /** Abre a vista Mesa e devolve o retrato. */
    async abreMesa() {
      const retrato = cliente.esperaNova((m) => m.type === 'mesa-sync', 'mesa-sync');
      cliente.envia({ type: 'mesa-view', on: true });
      return (await retrato).mesa;
    },

    /** Manda uma operacao e espera o eco dela (para quem esta na Mesa) ou
     * a recusa. */
    async op(msg) {
      const resposta = cliente.esperaNova((m) => (m.type === 'mesa' && m.op === msg.op && m.by === cliente.id)
        || (m.type === 'mesa-denied' && m.op === msg.op), `resposta de ${msg.op}`);
      cliente.envia({ type: 'mesa', ...msg });
      return resposta;
    },

    msgs(type) {
      return entrada.filter((m) => m.type === type);
    },
  };

  return cliente;
}

function palco(t) {
  const servidores = [];
  const clientes = [];
  t.after(async () => {
    for (const c of clientes) {
      try {
        c.ws.close();
      } catch {
        /* ja fechando */
      }
    }
    for (const s of servidores) {
      if (s.fechado) continue;
      s.fechado = true;
      await s.close();
    }
  });
  return {
    async servidor(opts = {}) {
      const s = await createSignalingServer({ port: 0, ...opts });
      servidores.push(s);
      return s;
    },
    async cliente(servidor, rotulo) {
      const c = criarCliente(servidor.port, rotulo);
      clientes.push(c);
      await c.aberto();
      return c;
    },
  };
}

/** Sala com lider (Ana, dona pelo token) e Bia; os dois na Mesa. */
async function salaNaMesa(p, opts = {}) {
  const s = await p.servidor({ ownerToken: 'segredo', ...opts });
  const ana = await p.cliente(s, 'ana');
  const bia = await p.cliente(s, 'bia');
  await ana.entra('Ana', { ownerToken: 'segredo', clientId: 'cli-ana' });
  await bia.entra('Bia', { clientId: 'cli-bia' });
  await ana.abreMesa();
  await bia.abreMesa();
  return { s, ana, bia };
}

const nota = (x, y, w = 320, h = 240) => ({ type: 'nota', x, y, w, h });

// ---------------------------------------------------------------------------
// Vista Mesa: quem recebe o que
// ---------------------------------------------------------------------------

test('welcome nao leva a mesa, so mesaCount e quem esta na Mesa', async (t) => {
  const p = palco(t);
  const { s, ana } = await salaNaMesa(p);
  await ana.op({ op: 'add', win: nota(100, 100) });

  const caio = await p.cliente(s, 'caio');
  const welcome = await caio.entra('Caio');
  assert.equal(welcome.mesa, undefined);
  assert.equal(welcome.mode, undefined, 'nao existe tipo da sala');
  assert.equal(welcome.mesaCount, 1);
  assert.deepEqual(welcome.mesaViewers, [ana.id, welcome.peers.find((x) => x.name === 'Bia').id].sort((a, b) => a - b));
});

test('mesa-view on devolve o retrato e anuncia mesa-viewers; off para de mandar', async (t) => {
  const p = palco(t);
  const s = await p.servidor();
  const ana = await p.cliente(s, 'ana');
  const bia = await p.cliente(s, 'bia');
  await ana.entra('Ana');
  await bia.entra('Bia');

  const viuAna = bia.esperaMsg((m) => m.type === 'mesa-viewers' && m.peers.includes(ana.id), 'mesa-viewers com a Ana');
  const retrato = await ana.abreMesa();
  assert.deepEqual(retrato, { seq: 0, leaderOnly: false, lockSize: false, windows: [] });
  await viuAna;

  // Bia na Transmissao pode por na mesa ("Por na mesa" de um link do chat):
  // aceito, o eco vai so para quem esta na Mesa.
  const add = ana.esperaMsg((m) => m.type === 'mesa' && m.op === 'add', 'add da Bia');
  bia.envia({ type: 'mesa', op: 'add', win: nota(0, 0) });
  const msg = await add;
  assert.equal(msg.by, bia.id);
  assert.equal(msg.win.owner, bia.id);
  await bia.barreira();
  assert.deepEqual(bia.msgs('mesa'), [], 'quem esta na Transmissao nao recebe nada da mesa');

  // Ana sai da Mesa: a proxima operacao nao chega para ela.
  const saiu = bia.esperaMsg((m) => m.type === 'mesa-viewers' && m.peers.length === 0, 'mesa-viewers vazio');
  ana.envia({ type: 'mesa-view', on: false });
  await saiu;
  bia.envia({ type: 'mesa', op: 'place', id: msg.win.id, x: 500, y: 0, w: 320, h: 240 });
  await bia.barreira();
  await ana.barreira();
  assert.equal(ana.msgs('mesa').length, 1);
});

test('cursor e mesa-drag so chegam em quem esta na Mesa, com quem mandou', async (t) => {
  const p = palco(t);
  const { s, ana, bia } = await salaNaMesa(p);
  const caio = await p.cliente(s, 'caio');
  await caio.entra('Caio');

  const add = await ana.op({ op: 'add', win: nota(100, 100) });
  const cursor = bia.esperaTipo('cursor');
  ana.envia({ type: 'cursor', x: 1200.4, y: -50 });
  assert.deepEqual(await cursor, { type: 'cursor', x: 1200, y: -50, from: ana.id });

  const grab = bia.esperaTipo('mesa-grab');
  ana.envia({ type: 'mesa-grab', id: add.win.id });
  assert.deepEqual(await grab, { type: 'mesa-grab', id: add.win.id, by: ana.id });
  const drag = bia.esperaTipo('mesa-drag');
  ana.envia({ type: 'mesa-drag', id: add.win.id, x: 150, y: 120, w: 320, h: 240 });
  assert.deepEqual(await drag, { type: 'mesa-drag', id: add.win.id, x: 150, y: 120, w: 320, h: 240, by: ana.id });

  await ana.barreira();
  await caio.barreira();
  for (const type of ['cursor', 'mesa-grab', 'mesa-drag', 'mesa']) assert.deepEqual(caio.msgs(type), [], type);
  assert.deepEqual(ana.msgs('cursor'), [], 'o proprio ponteiro nao volta');
});

test('time devolve t0 com o relogio do servidor', async (t) => {
  const p = palco(t);
  const s = await p.servidor();
  const ana = await p.cliente(s, 'ana');
  await ana.entra('Ana');
  const antes = Date.now();
  ana.envia({ type: 'time', t0: 123.5 });
  const r = await ana.esperaTipo('time');
  assert.equal(r.t0, 123.5);
  assert.ok(r.server >= antes && r.server <= Date.now());
});

// ---------------------------------------------------------------------------
// Operacoes
// ---------------------------------------------------------------------------

test('add sobreposto e recusado com o lugar livre mais perto', async (t) => {
  const p = palco(t);
  const { ana, bia } = await salaNaMesa(p);
  const a = await ana.op({ op: 'add', win: nota(1000, 1000) });
  assert.equal(a.type, 'mesa');
  assert.equal(a.seq, 1);
  assert.deepEqual(a.win.state, { text: '', by: null, rev: 0 });

  const r = await bia.op({ op: 'add', win: nota(1100, 1000) });
  assert.equal(r.type, 'mesa-denied');
  assert.equal(r.reason, 'overlap');
  assert.deepEqual(r.fix, mesaModel.nearestFree([a.win], nota(1100, 1000), { gap: mesaModel.GAP }));
  assert.equal(mesaModel.overlaps(r.fix, a.win, mesaModel.GAP), false);

  const ok = await bia.op({ op: 'add', win: { ...r.fix, type: 'nota' } });
  assert.equal(ok.type, 'mesa');
  assert.equal(ok.seq, 2);
});

test('add recusa tipo desconhecido, retangulo ruim, fora do mundo e tela pedida pelo cliente', async (t) => {
  const p = palco(t);
  const { ana } = await salaNaMesa(p);
  assert.equal((await ana.op({ op: 'add', win: { type: 'foguete', x: 0, y: 0, w: 300, h: 300 } })).reason, 'unknown-type');
  assert.equal((await ana.op({ op: 'add', win: { type: 'nota', x: '0', y: 0, w: 300, h: 300 } })).reason, 'bad-rect');
  assert.equal((await ana.op({ op: 'add', win: nota(0, 0, 100, 100) })).reason, 'too-small');
  const fora = await ana.op({ op: 'add', win: nota(4700, 0) });
  assert.equal(fora.reason, 'out-of-world');
  assert.deepEqual(fora.fix, { x: 4480, y: 0, w: 320, h: 240 });
  assert.equal((await ana.op({ op: 'add', win: { type: 'tela', x: 0, y: 0, w: 640, h: 360 } })).reason, 'auto');
  assert.equal((await ana.op({ op: 'nada' })).reason, 'bad-request');
});

test('mesa passa de 32 janelas: recusa full; cota de 20 operacoes/s por pessoa', async (t) => {
  const p = palco(t);
  const { ana, bia } = await salaNaMesa(p);
  // Metade de cada um: 16 por pessoa cabe na cota de 20/s.
  for (let i = 0; i < 32; i += 1) {
    const quem = i % 2 ? bia : ana;
    const r = await quem.op({ op: 'add', win: nota((i % 12) * 400, Math.floor(i / 12) * 300, 160, 120) });
    assert.equal(r.type, 'mesa', `janela ${i}`);
  }
  assert.equal((await bia.op({ op: 'add', win: nota(0, 2000) })).reason, 'full');
  // Rajada de 25 de uma vez: as que passam da cota voltam como 'rate'.
  const desde = ana.entrada.length;
  for (let i = 0; i < 25; i += 1) ana.envia({ type: 'mesa', op: 'lock', leaderOnly: false });
  await ana.barreira();
  const rate = ana.entrada.slice(desde).filter((m) => m.type === 'mesa-denied' && m.reason === 'rate');
  assert.ok(rate.length >= 5, `so ${rate.length} recusas por cota`);
});

test('corrida de dois place no mesmo espaco: um assenta, o outro recebe o lugar livre', async (t) => {
  const p = palco(t);
  const { ana, bia } = await salaNaMesa(p);
  const a = await ana.op({ op: 'add', win: nota(0, 0) });
  const b = await bia.op({ op: 'add', win: nota(1000, 0) });

  const alvo = { x: 2000, y: 1000, w: 320, h: 240 };
  const ra = ana.esperaNova((m) => (m.type === 'mesa' && m.op === 'place' && m.by === ana.id) || m.type === 'mesa-denied', 'place da Ana');
  const rb = bia.esperaNova((m) => (m.type === 'mesa' && m.op === 'place' && m.by === bia.id) || m.type === 'mesa-denied', 'place da Bia');
  ana.envia({ type: 'mesa', op: 'place', id: a.win.id, ...alvo });
  bia.envia({ type: 'mesa', op: 'place', id: b.win.id, ...alvo });
  const [respA, respB] = await Promise.all([ra, rb]);

  const respostas = [respA, respB];
  const aceitas = respostas.filter((r) => r.type === 'mesa');
  const recusas = respostas.filter((r) => r.type === 'mesa-denied');
  assert.equal(aceitas.length, 1);
  assert.equal(recusas.length, 1);
  assert.equal(recusas[0].reason, 'overlap');
  assert.equal(mesaModel.overlaps(recusas[0].fix, alvo, mesaModel.GAP), false);

  // Os dois terminam com a mesma mesa, e sem sobreposicao.
  await ana.barreira();
  await bia.barreira();
  const [sa, sb] = [await ana.abreMesa(), await bia.abreMesa()];
  assert.deepEqual(sa, sb);
  assert.equal(mesaModel.overlaps(sa.windows[0], sa.windows[1], 0), false);
});

test('seq sem buraco: aplicar os ecos em ordem da o mesmo retrato do servidor', async (t) => {
  const p = palco(t);
  const { ana, bia } = await salaNaMesa(p);
  const a = await ana.op({ op: 'add', win: nota(0, 0) });
  const b = await bia.op({ op: 'add', win: nota(600, 0) });
  await ana.op({ op: 'place', id: a.win.id, x: 50, y: 400, w: 400, h: 300 });
  await bia.op({ op: 'act', id: b.win.id, action: { kind: 'set', text: 'oi' } });
  await ana.op({ op: 'lock', lockSize: true });
  await bia.op({ op: 'remove', id: a.win.id });
  await bia.barreira();

  const ecos = bia.msgs('mesa');
  assert.deepEqual(ecos.map((m) => m.seq), [1, 2, 3, 4, 5, 6]);
  let estado = mesaModel.createState();
  for (const m of ecos) {
    const r = mesaModel.applyMessage(estado, m);
    assert.equal(r.needSync, false, `seq ${m.seq}`);
    estado = r.state;
  }
  assert.deepEqual(mesaModel.snapshot(estado), await bia.abreMesa());
});

test('act da nota: todos veem o texto novo; texto grande e act em tela sao recusados', async (t) => {
  const p = palco(t);
  const { ana, bia } = await salaNaMesa(p);
  const n = await ana.op({ op: 'add', win: nota(0, 0) });

  const visto = ana.esperaMsg((m) => m.type === 'mesa' && m.op === 'act', 'act da Bia');
  const r = await bia.op({ op: 'act', id: n.win.id, action: { kind: 'set', text: 'placar: 3 x 1' } });
  assert.equal(r.type, 'mesa');
  const eco = await visto;
  assert.deepEqual(eco.action, { kind: 'set', text: 'placar: 3 x 1' });
  assert.equal(eco.isLeader, false);
  const mesa = await ana.abreMesa();
  assert.deepEqual(mesa.windows[0].state, { text: 'placar: 3 x 1', by: bia.id, rev: 1 });

  const grande = await bia.op({ op: 'act', id: n.win.id, action: { kind: 'set', text: 'x'.repeat(1001) } });
  assert.equal(grande.reason, 'invalid');
  assert.equal(typeof grande.detail, 'string');
  assert.equal((await bia.op({ op: 'act', id: 'nao-existe', action: {} })).reason, 'not-found');
  assert.equal((await bia.op({ op: 'act', id: n.win.id, action: [] })).reason, 'bad-request');
});

// ---------------------------------------------------------------------------
// Travas do lider
// ---------------------------------------------------------------------------

test('leaderOnly: so o lider poe, tira e move; act continua livre; so o lider trava', async (t) => {
  const p = palco(t);
  const { ana, bia } = await salaNaMesa(p);
  const n = await bia.op({ op: 'add', win: nota(0, 0) });

  assert.equal((await bia.op({ op: 'lock', leaderOnly: true })).reason, 'leader-only');
  const lock = await ana.op({ op: 'lock', leaderOnly: true });
  assert.deepEqual([lock.leaderOnly, lock.lockSize], [true, false]);

  assert.equal((await bia.op({ op: 'add', win: nota(1000, 0) })).reason, 'locked');
  assert.equal((await bia.op({ op: 'place', id: n.win.id, x: 10, y: 0, w: 320, h: 240 })).reason, 'locked');
  assert.equal((await bia.op({ op: 'remove', id: n.win.id })).reason, 'locked');
  bia.envia({ type: 'mesa-grab', id: n.win.id });
  const g = await bia.esperaMsg((m) => m.type === 'mesa-denied' && m.op === 'grab', 'grab recusado');
  assert.equal(g.reason, 'locked');
  assert.equal((await bia.op({ op: 'act', id: n.win.id, action: { kind: 'set', text: 'ainda escrevo' } })).type, 'mesa');

  assert.equal((await ana.op({ op: 'place', id: n.win.id, x: 10, y: 0, w: 320, h: 240 })).type, 'mesa');
  assert.equal((await ana.op({ op: 'add', win: nota(1000, 0) })).type, 'mesa');
});

test('lockSize: quem nao e lider move mas nao redimensiona', async (t) => {
  const p = palco(t);
  const { ana, bia } = await salaNaMesa(p);
  const n = await bia.op({ op: 'add', win: nota(0, 0) });
  const lock = await ana.op({ op: 'lock', lockSize: true });
  assert.deepEqual([lock.leaderOnly, lock.lockSize], [false, true]);

  assert.equal((await bia.op({ op: 'place', id: n.win.id, x: 500, y: 500, w: 320, h: 240 })).type, 'mesa', 'mover passa');
  assert.equal((await bia.op({ op: 'place', id: n.win.id, x: 500, y: 500, w: 400, h: 240 })).reason, 'size-locked');
  assert.equal((await bia.op({ op: 'add', win: nota(2000, 0) })).type, 'mesa', 'por continua livre');
  assert.equal((await ana.op({ op: 'place', id: n.win.id, x: 500, y: 500, w: 400, h: 300 })).type, 'mesa', 'o lider redimensiona');
});

// ---------------------------------------------------------------------------
// Vez por janela
// ---------------------------------------------------------------------------

test('vez por janela: quem tem a vez move; o outro recebe held com quem esta movendo', async (t) => {
  const p = palco(t);
  const { ana, bia } = await salaNaMesa(p);
  const n = await ana.op({ op: 'add', win: nota(0, 0) });

  ana.envia({ type: 'mesa-grab', id: n.win.id });
  await bia.esperaTipo('mesa-grab');
  bia.envia({ type: 'mesa-grab', id: n.win.id });
  const recusa = await bia.esperaMsg((m) => m.type === 'mesa-denied' && m.op === 'grab', 'grab recusado');
  assert.deepEqual(recusa, { type: 'mesa-denied', op: 'grab', id: n.win.id, reason: 'held', holder: ana.id });
  assert.equal((await bia.op({ op: 'place', id: n.win.id, x: 900, y: 0, w: 320, h: 240 })).reason, 'held');
  assert.equal((await bia.op({ op: 'remove', id: n.win.id })).reason, 'held');

  // Drag de quem nao tem a vez nao passa.
  bia.envia({ type: 'mesa-drag', id: n.win.id, x: 1, y: 1, w: 320, h: 240 });
  await bia.barreira();
  await ana.barreira();
  assert.deepEqual(ana.msgs('mesa-drag'), []);

  assert.equal((await ana.op({ op: 'place', id: n.win.id, x: 900, y: 0, w: 320, h: 240 })).type, 'mesa');
  const solta = bia.esperaTipo('mesa-release');
  ana.envia({ type: 'mesa-release', id: n.win.id });
  assert.deepEqual(await solta, { type: 'mesa-release', id: n.win.id });
  bia.envia({ type: 'mesa-grab', id: n.win.id });
  await ana.esperaMsg((m) => m.type === 'mesa-grab' && m.by === bia.id, 'grab da Bia');
});

test('vez por janela vence sem mesa-drag e e renovada por ele', async (t) => {
  const p = palco(t);
  const { ana, bia } = await salaNaMesa(p, { mesaGrabMs: 150 });
  const n = await ana.op({ op: 'add', win: nota(0, 0) });

  ana.envia({ type: 'mesa-grab', id: n.win.id });
  await bia.esperaTipo('mesa-grab');
  // Renovada a cada 60 ms por 300 ms: continua da Ana.
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 60));
    ana.envia({ type: 'mesa-drag', id: n.win.id, x: i, y: 0, w: 320, h: 240 });
  }
  await ana.barreira();
  bia.envia({ type: 'mesa-grab', id: n.win.id });
  assert.equal((await bia.esperaMsg((m) => m.type === 'mesa-denied' && m.op === 'grab', 'held')).holder, ana.id);

  // Sem drag, vence.
  await new Promise((r) => setTimeout(r, 200));
  bia.envia({ type: 'mesa-grab', id: n.win.id });
  await ana.esperaMsg((m) => m.type === 'mesa-grab' && m.by === bia.id, 'grab da Bia depois de vencer');
});

test('quem sai da sala ou fecha a Mesa solta a vez', async (t) => {
  const p = palco(t);
  const { s, ana, bia } = await salaNaMesa(p);
  const caio = await p.cliente(s, 'caio');
  await caio.entra('Caio');
  await caio.abreMesa();
  const n1 = await ana.op({ op: 'add', win: nota(0, 0) });
  const n2 = await ana.op({ op: 'add', win: nota(1000, 0) });

  bia.envia({ type: 'mesa-grab', id: n1.win.id });
  await ana.esperaTipo('mesa-grab');
  const solta1 = ana.esperaMsg((m) => m.type === 'mesa-release' && m.id === n1.win.id, 'release ao fechar a Mesa');
  bia.envia({ type: 'mesa-view', on: false });
  await solta1;

  caio.envia({ type: 'mesa-grab', id: n2.win.id });
  await ana.esperaMsg((m) => m.type === 'mesa-grab' && m.id === n2.win.id, 'grab do Caio');
  const solta2 = ana.esperaMsg((m) => m.type === 'mesa-release' && m.id === n2.win.id, 'release ao sair');
  const viewers = ana.esperaMsg((m) => m.type === 'mesa-viewers' && m.peers.length === 1, 'mesa-viewers sem o Caio');
  caio.ws.close(1000);
  await solta2;
  await viewers;
});

// ---------------------------------------------------------------------------
// Tela e camera: o servidor poe e tira
// ---------------------------------------------------------------------------

test('ir ao vivo poe a janela da tela; parar e sair tiram; camera igual', async (t) => {
  const p = palco(t);
  const { s, ana, bia } = await salaNaMesa(p);
  const caio = await p.cliente(s, 'caio');
  await caio.entra('Caio'); // Caio fica na Transmissao

  const addTela = ana.esperaMsg((m) => m.type === 'mesa' && m.op === 'add' && m.win.type === 'tela', 'janela da tela');
  caio.envia({ type: 'broadcast-state', live: true, paused: false });
  const tela = (await addTela).win;
  assert.equal(tela.owner, caio.id);
  assert.deepEqual(tela.state, { peerId: caio.id, kind: 'screen' });
  assert.equal(mesaModel.checkRect(tela), true);

  // Repetir o broadcast-state (pausa, limite) nao poe outra.
  caio.envia({ type: 'broadcast-state', live: true, paused: true });
  const addCam = ana.esperaMsg((m) => m.type === 'mesa' && m.op === 'add' && m.win.type === 'camera', 'janela da camera');
  caio.envia({ type: 'camera-state', on: true });
  const cam = (await addCam).win;
  assert.equal(mesaModel.overlaps(tela, cam, mesaModel.GAP), false);
  await caio.barreira();
  await ana.barreira();
  assert.equal(ana.msgs('mesa').filter((m) => m.op === 'add').length, 2);

  // Outra pessoa nao tira a tela de quem esta ao vivo; o lider tira.
  assert.equal((await bia.op({ op: 'remove', id: tela.id })).reason, 'not-yours');

  const tiraTela = ana.esperaMsg((m) => m.type === 'mesa' && m.op === 'remove' && m.id === tela.id, 'tira a tela');
  caio.envia({ type: 'broadcast-state', live: false });
  assert.equal((await tiraTela).by, caio.id);

  const tiraCam = ana.esperaMsg((m) => m.type === 'mesa' && m.op === 'remove' && m.id === cam.id, 'tira a camera ao sair');
  caio.ws.close(1000);
  await tiraCam;
  const mesa = await ana.abreMesa();
  assert.deepEqual(mesa.windows, []);
});

// ---------------------------------------------------------------------------
// Migracao
// ---------------------------------------------------------------------------

test('a mesa sobrevive a migracao: room-migrating leva a mesa, o sucessor a semeia', async (t) => {
  const p = palco(t);
  const antigo = await p.servidor({ roomId: 'sala-mesa', ownerToken: 'segredo' });
  const host = await p.cliente(antigo, 'host');
  const bia = await p.cliente(antigo, 'bia');
  await host.entra('Host', { ownerToken: 'segredo' });
  await bia.entra('Bia');
  await host.abreMesa();
  await bia.abreMesa();
  const n = await bia.op({ op: 'add', win: nota(200, 200) });
  await bia.op({ op: 'act', id: n.win.id, action: { kind: 'set', text: 'nao perde' } });
  await host.op({ op: 'lock', lockSize: true });
  bia.envia({ type: 'broadcast-state', live: true });
  await bia.esperaMsg((m) => m.type === 'mesa' && m.op === 'add' && m.win.type === 'tela', 'tela da Bia');

  const migrando = bia.esperaTipo('room-migrating');
  antigo.fechado = true;
  await antigo.close({ migrate: true });
  const msg = await migrando;
  assert.equal(msg.mode, undefined);
  assert.equal(msg.mesa.windows.length, 2);
  assert.ok(Number.isSafeInteger(msg.mesa.idFloor) && msg.mesa.idFloor > Number(bia.id));

  // O sucessor sobe o servidor novo com a mesa (o que o app.js faz com o
  // initialChatHistory) e todo mundo volta.
  const novo = await p.servidor({ roomId: 'sala-mesa', initialMesa: msg.mesa, initialChatHistory: msg.chat });
  const bia2 = await p.cliente(novo, 'bia de novo');
  const w = await bia2.entra('Bia');
  assert.equal(w.mesaCount, 1, 'a tela sai da semente; o servidor novo a poe de novo pelo broadcast-state');
  assert.ok(Number(w.id) >= msg.mesa.idFloor, 'id novo nao repete id da sala que caiu');
  const mesa = await bia2.abreMesa();
  assert.equal(mesa.lockSize, true);
  assert.equal(mesa.seq, msg.mesa.seq);
  assert.deepEqual(mesa.windows.map((x) => [x.id, x.type, x.owner, x.state.text]), [[n.win.id, 'nota', null, 'nao perde']]);

  const volta = bia2.esperaMsg((m) => m.type === 'mesa' && m.op === 'add' && m.win.type === 'tela', 'tela de volta');
  bia2.envia({ type: 'broadcast-state', live: true, bootstrap: true });
  assert.equal((await volta).win.state.peerId, bia2.id);
});
