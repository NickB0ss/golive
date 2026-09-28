'use strict';
/*
 * Teste ponta a ponta do rabisco em janela da Mesa (contrato,
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secao 10, "Quadro"):
 * o mesmo canal do rabisco sobre tela ('annotate'/'annotate-sync'), so que
 * endereçado a uma janela ('mesa:<id>') em vez de uma pessoa.
 *
 * O servidor sobe de verdade e clientes `ws` reais falam o protocolo (mesmo
 * padrao de server/signaling-mesa-segredo-e2e.test.js, harness proprio --
 * este arquivo nao e secret, entao nao precisa da parte de "visao filtrada
 * por pessoa").
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createSignalingServer } = require('./signaling-core');
require('../src/renderer/mesa-modules/index');

const DEADLINE_MS = 5000;

function criarCliente(port, rotulo) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const entrada = [];
  const espera = new Set();
  ws.on('message', (raw) => {
    entrada.push(JSON.parse(raw.toString()));
    for (const w of Array.from(espera)) {
      const achou = entrada.slice(w.desde).find(w.filtro);
      if (achou) {
        espera.delete(w);
        clearTimeout(w.prazo);
        w.resolve(achou);
      }
    }
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
        const w = { filtro, desde, resolve };
        w.prazo = setTimeout(() => {
          espera.delete(w);
          reject(new Error(`${rotulo}: ${oque} nao chegou em ${DEADLINE_MS}ms`));
        }, DEADLINE_MS);
        if (typeof w.prazo.unref === 'function') w.prazo.unref();
        espera.add(w);
      });
    },
    esperaNova(filtro, oque) {
      return cliente.esperaMsg(filtro, oque, entrada.length);
    },
    /** Nunca chega uma mensagem que bate `filtro` dentro de `ms`. */
    naoChega(filtro, oque, ms = 200) {
      const desde = entrada.length;
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          const achou = entrada.slice(desde).find(filtro);
          if (achou) reject(new Error(`${rotulo}: ${oque} nao devia ter chegado: ${JSON.stringify(achou)}`));
          else resolve();
        }, ms);
      });
    },
    async entra(name, extra = {}) {
      cliente.envia({ type: 'join', room: 'geral', name, ...extra });
      const welcome = await cliente.esperaMsg((m) => m.type === 'welcome', 'welcome');
      cliente.id = welcome.id;
      return welcome;
    },
    async abreMesa() {
      const retrato = cliente.esperaNova((m) => m.type === 'mesa-sync', 'mesa-sync');
      cliente.envia({ type: 'mesa-view', on: true });
      return (await retrato).mesa;
    },
    async poeQuadro(x = 100, y = 100) {
      const r = cliente.esperaNova((m) => (m.type === 'mesa' && m.op === 'add' && m.by === cliente.id)
        || (m.type === 'mesa-denied' && m.op === 'add'), 'resposta do add');
      cliente.envia({ type: 'mesa', op: 'add', win: { type: 'quadro', x, y, w: 640, h: 480 } });
      return r;
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

/** Ana, Bia e Caio na sala; so Ana e Bia na vista Mesa; Ana pos um Quadro. */
async function cena(p, opts = {}) {
  const s = await p.servidor({ ownerToken: 'segredo', ...opts });
  const ana = await p.cliente(s, 'ana');
  const bia = await p.cliente(s, 'bia');
  const caio = await p.cliente(s, 'caio');
  await ana.entra('Ana', { ownerToken: 'segredo', clientId: 'cli-ana' });
  await bia.entra('Bia', { clientId: 'cli-bia' });
  await caio.entra('Caio', { clientId: 'cli-caio' });
  await ana.abreMesa();
  await bia.abreMesa();
  const add = await ana.poeQuadro();
  const id = add.win.id;
  return { s, ana, bia, caio, id };
}

test('um traco vai so pra quem esta na vista Mesa, nunca pra quem mandou nem pra quem esta na Transmissao', async (t) => {
  const p = palco(t);
  const { ana, bia, caio, id } = await cena(p);

  const chegaEmBia = bia.esperaNova((m) => m.type === 'annotate' && m.surface === `mesa:${id}`, 'traco da Ana');
  const naoChegaEmAna = ana.naoChega((m) => m.type === 'annotate', 'eco pra quem mandou');
  const naoChegaEmCaio = caio.naoChega((m) => m.type === 'annotate', 'traco pra quem nao esta na Mesa');
  ana.envia({ type: 'annotate', surface: `mesa:${id}`, op: 'begin', id: 't1', x: 0.2, y: 0.3, width: 4, color: '#4adE80' });

  const msg = await chegaEmBia;
  assert.equal(msg.from, ana.id);
  assert.equal(msg.op, 'begin');
  assert.equal(msg.x, 0.2);
  await naoChegaEmAna;
  await naoChegaEmCaio;
});

test('quem entra na Mesa recebe o retrato de quem ja tem a janela aberta (annotate-sync)', async (t) => {
  const p = palco(t);
  const { s, ana, bia, id } = await cena(p);

  // Bia (ja na Mesa) manda o snapshot que tem pra Ana, endereçado por 'to'.
  const chegaEmAna = ana.esperaNova((m) => m.type === 'annotate-sync' && m.surface === `mesa:${id}`, 'sync');
  bia.envia({
    type: 'annotate-sync',
    to: ana.id,
    surface: `mesa:${id}`,
    items: [{ kind: 'stroke', id: 'x1', from: bia.id, width: 4, points: [[0.1, 0.1], [0.2, 0.2]] }],
  });
  const msg = await chegaEmAna;
  assert.equal(msg.from, bia.id);
  assert.equal(msg.items.length, 1);
  assert.equal(msg.items[0].from, bia.id);
  assert.equal(s.getPeerCount(), 3);
});

test('annotate-sync so passa entre quem esta na vista Mesa', async (t) => {
  const p = palco(t);
  const { ana, caio, id } = await cena(p);
  // Caio nao esta na Mesa: nem manda, nem recebe.
  const naoChega = ana.naoChega((m) => m.type === 'annotate-sync', 'sync de quem nao esta na Mesa');
  caio.envia({ type: 'annotate-sync', to: ana.id, surface: `mesa:${id}`, items: [] });
  await naoChega;
});

test('limpar tudo: so o dono da janela ou o lider da sala; o resto e ignorado em silencio', async (t) => {
  const p = palco(t);
  const { ana, bia, id } = await cena(p); // Ana e a lider (ownerToken); a janela e dela tambem

  // Bia (nao e dona nem lider) tenta limpar: ninguem recebe.
  const naoChegaEmAna = ana.naoChega((m) => m.type === 'annotate' && m.op === 'clear', 'clear indevido da Bia');
  bia.envia({ type: 'annotate', surface: `mesa:${id}`, op: 'clear', scope: 'all' });
  await naoChegaEmAna;

  // Ana (dona da janela e lider) limpa: a Bia recebe.
  const chegaEmBia = bia.esperaNova((m) => m.type === 'annotate' && m.op === 'clear' && m.surface === `mesa:${id}`, 'clear da Ana');
  ana.envia({ type: 'annotate', surface: `mesa:${id}`, op: 'clear', scope: 'all' });
  const msg = await chegaEmBia;
  assert.equal(msg.from, ana.id);
  assert.equal(msg.scope, 'all');
});

test('limpar tudo: quem nao e dono mas e lider da sala tambem pode', async (t) => {
  const p = palco(t);
  const s = await p.servidor({ ownerToken: 'segredo' });
  const ana = await p.cliente(s, 'ana'); // lider
  const bia = await p.cliente(s, 'bia'); // poe a janela (dona)
  await ana.entra('Ana', { ownerToken: 'segredo' });
  await bia.entra('Bia');
  await ana.abreMesa();
  await bia.abreMesa();
  const id = (await bia.poeQuadro()).win.id;

  const chegaEmBia = bia.esperaNova((m) => m.type === 'annotate' && m.op === 'clear', 'clear do lider');
  ana.envia({ type: 'annotate', surface: `mesa:${id}`, op: 'clear', scope: 'all' });
  const msg = await chegaEmBia;
  assert.equal(msg.from, ana.id);
});

test('janela fechada: a superficie some do ar, nada mais e repassado nela', async (t) => {
  const p = palco(t);
  const { ana, bia, id } = await cena(p);

  // Um traco antes de fechar funciona normalmente.
  const chegaAntes = bia.esperaNova((m) => m.type === 'annotate', 'traco antes de fechar');
  ana.envia({ type: 'annotate', surface: `mesa:${id}`, op: 'begin', id: 't1', x: 0.1, y: 0.1 });
  await chegaAntes;

  const removido = bia.esperaNova((m) => m.type === 'mesa' && m.op === 'remove' && m.id === id, 'remove');
  ana.envia({ type: 'mesa', op: 'remove', id });
  await removido;

  // Depois de fechada, nem traco nem sync chegam mais nela.
  const naoChegaTraco = bia.naoChega((m) => m.type === 'annotate', 'traco de janela fechada');
  ana.envia({ type: 'annotate', surface: `mesa:${id}`, op: 'begin', id: 't2', x: 0.5, y: 0.5 });
  await naoChegaTraco;

  const naoChegaSync = bia.naoChega((m) => m.type === 'annotate-sync', 'sync de janela fechada');
  ana.envia({ type: 'annotate-sync', to: bia.id, surface: `mesa:${id}`, items: [{ kind: 'stroke', id: 'x', from: ana.id, width: 4, points: [[0, 0]] }] });
  await naoChegaSync;
});

test('rabisco de tipo de janela sem `annotate: true` e ignorado (o batalha nao tem canal de rabisco)', async (t) => {
  const p = palco(t);
  const s = await p.servidor({ ownerToken: 'segredo' });
  const ana = await p.cliente(s, 'ana');
  const bia = await p.cliente(s, 'bia');
  await ana.entra('Ana', { ownerToken: 'segredo' });
  await bia.entra('Bia');
  await ana.abreMesa();
  await bia.abreMesa();
  const add = ana.esperaNova((m) => m.type === 'mesa' && m.op === 'add', 'add batalha');
  ana.envia({ type: 'mesa', op: 'add', win: { type: 'batalha', x: 100, y: 100, w: 720, h: 460 } });
  const id = (await add).win.id;

  const naoChega = bia.naoChega((m) => m.type === 'annotate', 'rabisco num tipo sem annotate');
  ana.envia({ type: 'annotate', surface: `mesa:${id}`, op: 'begin', id: 't1', x: 0.1, y: 0.1 });
  await naoChega;
});

test('quem nao esta na vista Mesa nao consegue endereçar rabisco a uma janela', async (t) => {
  const p = palco(t);
  const { bia, caio, id } = await cena(p);
  const naoChega = bia.naoChega((m) => m.type === 'annotate', 'rabisco de quem esta na Transmissao');
  caio.envia({ type: 'annotate', surface: `mesa:${id}`, op: 'begin', id: 't1', x: 0.1, y: 0.1 });
  await naoChega;
});
