'use strict';

/* E2E do segredo do Quiz: a escolha de Ana nao chega a Bia antes da
 * revelacao; depois que ambas respondem, o resultado chega sem a acao crua. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createSignalingServer } = require('./signaling-core');
require('../src/renderer/mesa-modules/index');

const espera = 4000;
function cliente(porta, nome, sala) {
  const ws = new WebSocket(`ws://127.0.0.1:${porta}`);
  const mensagens = [];
  const c = { ws, mensagens, id: null };
  ws.on('message', (raw) => mensagens.push(JSON.parse(raw.toString())));
  c.ate = (pred, texto) => new Promise((resolve, reject) => {
    const inicio = Date.now();
    const timer = setInterval(() => {
      const achou = mensagens.slice().reverse().find(pred);
      if (achou) { clearInterval(timer); resolve(achou); }
      else if (Date.now() - inicio > espera) { clearInterval(timer); reject(new Error(texto)); }
    }, 5);
    timer.unref?.();
  });
  c.envia = (m) => { ws.send(JSON.stringify(m)); };
  c.entra = async () => {
    c.envia({ type: 'join', room: sala, name: nome, clientId: `quiz-${nome}` });
    const w = await c.ate((m) => m.type === 'welcome', 'welcome');
    c.id = w.id;
    return w;
  };
  c.mesa = async () => {
    c.envia({ type: 'mesa-view', on: true });
    return (await c.ate((m) => m.type === 'mesa-sync', 'mesa-sync')).mesa;
  };
  c.acao = async (id, action) => {
    c.envia({ type: 'mesa', op: 'act', id, action });
    return c.ate((m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.by === c.id,
      `estado da acao ${action.kind}`);
  };
  return c;
}

test('Quiz nao vaza respostas no eco, no sync nem antes de todos responderem', async (t) => {
  const servidor = await createSignalingServer({ port: 0, roomId: 'quiz-segredo', ownerToken: 'segredo' });
  const ana = cliente(servidor.port, 'Ana', 'quiz-segredo');
  const bia = cliente(servidor.port, 'Bia', 'quiz-segredo');
  t.after(async () => {
    ana.ws.close();
    bia.ws.close();
    await servidor.close();
  });
  await Promise.all([new Promise((r) => ana.ws.once('open', r)), new Promise((r) => bia.ws.once('open', r))]);
  ana.entra = async () => {
    ana.envia({ type: 'join', room: 'quiz-segredo', name: 'Ana', ownerToken: 'segredo', clientId: 'quiz-Ana' });
    const w = await ana.ate((m) => m.type === 'welcome', 'welcome');
    ana.id = w.id;
    return w;
  };
  await ana.entra();
  await bia.entra();
  await ana.mesa();
  await bia.mesa();
  ana.envia({ type: 'mesa', op: 'add', win: { type: 'quiz', x: 100, y: 100, w: 560, h: 460 } });
  const add = await ana.ate((m) => m.type === 'mesa' && m.op === 'add' && m.win?.type === 'quiz', 'add do quiz');
  const id = add.win.id;
  const antesDaResposta = ana.mensagens.filter((m) => m.type === 'mesa' && m.win?.id === id);
  assert.ok(antesDaResposta.length > 0);
  assert.equal(JSON.stringify(antesDaResposta).includes('"certa"'), false);
  assert.equal(JSON.stringify(antesDaResposta).includes('"ordens"'), false);
  assert.equal(add.win.state.question.alternativas.length, 4);
  const antesDaAcaoDaAna = ana.mensagens.length;
  const antes = bia.mensagens.length;
  const deAna = await ana.acao(id, { kind: 'answer', option: 0 });
  await bia.ate((m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.seq === deAna.seq, 'estado da Bia');
  const novosDaBia = bia.mensagens.slice(antes).filter((m) => m.type === 'mesa' && m.id === id);
  assert.ok(novosDaBia.length > 0);
  assert.equal(JSON.stringify(novosDaBia).includes('"answer":0'), false);
  assert.equal(JSON.stringify(novosDaBia).includes('"history":[{"round"'), false);
  assert.equal(JSON.stringify(novosDaBia).includes('"certa"'), false);
  assert.equal(JSON.stringify(novosDaBia).includes('"ordens"'), false);
  const novosDaAna = ana.mensagens.slice(antesDaAcaoDaAna).filter((m) => m.type === 'mesa' && m.id === id);
  assert.equal(JSON.stringify(novosDaAna).includes('"certa"'), false);
  assert.equal(JSON.stringify(novosDaAna).includes('"ordens"'), false);
  const deBia = await bia.acao(id, { kind: 'answer', option: 1 });
  assert.equal(deBia.action, undefined);
  assert.equal(deBia.state.history.length, 1);
  assert.equal(deBia.state.history[0].results.length, 2);
  assert.equal(Number.isInteger(deBia.state.history[0].certa), true);
  const retrato = await bia.mesa();
  assert.equal(retrato.windows.find((w) => w.id === id).state.history.length, 1);
});
