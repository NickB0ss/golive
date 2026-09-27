'use strict';

/* Segredo do Truco: nenhuma mensagem do servidor leva mão alheia, monte ou
 * carta encoberta. Exercita add, state, sync, timeout, drop e migração. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createSignalingServer } = require('./signaling-core');
require('../src/renderer/mesa-modules/truco');
require('../src/renderer/mesa-modules/index');

function cliente(porta) {
  const ws = new WebSocket(`ws://127.0.0.1:${porta}`);
  const entrada = [];
  const espera = new Set();
  ws.on('message', (raw) => {
    const mensagem = JSON.parse(raw);
    entrada.push(mensagem);
    for (const esperaAtual of [...espera]) {
      if (!esperaAtual.f(mensagem)) continue;
      espera.delete(esperaAtual);
      clearTimeout(esperaAtual.t);
      esperaAtual.ok(mensagem);
    }
  });
  ws.on('error', () => {});

  const pessoa = {
    ws,
    entrada,
    id: null,
    open() {
      return new Promise((ok, nao) => {
        ws.once('open', ok);
        ws.once('error', nao);
      });
    },
    wait(filtro, rotulo, desde = entrada.length) {
      const existente = entrada.slice(desde).find(filtro);
      if (existente) return Promise.resolve(existente);
      return new Promise((ok, nao) => {
        const atual = {
          f: filtro,
          ok,
          t: setTimeout(() => {
            espera.delete(atual);
            nao(new Error(`${rotulo} não chegou`));
          }, 5000)
        };
        espera.add(atual);
      });
    },
    send(mensagem) {
      ws.send(JSON.stringify(mensagem));
    },
    async join(nome, extra = {}) {
      pessoa.send({ type: 'join', room: 'truco', name: nome, ...extra });
      const boasVindas = await pessoa.wait((m) => m.type === 'welcome', 'welcome', 0);
      pessoa.id = boasVindas.id;
    },
    async mesa() {
      const sincronizada = pessoa.wait((m) => m.type === 'mesa-sync', 'sync');
      pessoa.send({ type: 'mesa-view', on: true });
      return (await sincronizada).mesa;
    },
    async act(id, action) {
      const resposta = pessoa.wait((m) => {
        const estado = m.type === 'mesa' && m.op === 'state' && m.id === id && m.by === pessoa.id;
        const negada = m.type === 'mesa-denied' && m.op === 'act';
        return estado || negada;
      }, action.kind);
      pessoa.send({ type: 'mesa', op: 'act', id, action });
      return resposta;
    }
  };
  return pessoa;
}

function estados(clienteAtual, id) {
  return clienteAtual.entrada.flatMap((mensagem) => {
    if (mensagem.type === 'mesa' && mensagem.id === id) {
      return [mensagem.op === 'add' ? mensagem.win.state : mensagem.state];
    }
    if ((mensagem.type === 'mesa-sync' || mensagem.type === 'room-migrating') && mensagem.mesa) {
      return mensagem.mesa.windows.filter((janela) => janela.id === id).map((janela) => janela.state);
    }
    return [];
  }).filter(Boolean);
}

function semSegredo(clienteAtual, cartas, rotulo, id) {
  const fio = clienteAtual.entrada.map((mensagem) => JSON.stringify(mensagem)).join('\n');
  assert.equal(fio.includes('"deck"'), false, `${rotulo}: monte no fio`);
  for (const carta of cartas) {
    assert.equal(fio.includes(`"${carta}"`), false, `${rotulo}: recebeu ${carta}`);
  }
  for (const estado of estados(clienteAtual, id)) {
    assert.equal(estado.hand?.deck, undefined, `${rotulo}: deck na view`);
  }
}

test('truco filtra mao e baralho em add, state, sync e migracao', async (t) => {
  const servidor = await createSignalingServer({
    port: 0,
    ownerToken: 'truco',
    roomId: 'truco-segredo',
    resumeGraceMs: 80
  });
  let fechado = false;
  const ana = cliente(servidor.port);
  const bia = cliente(servidor.port);
  const otavio = cliente(servidor.port);
  const pessoas = [ana, bia, otavio];
  t.after(async () => {
    for (const pessoa of pessoas) pessoa.ws.close();
    if (!fechado) await servidor.close();
  });

  await Promise.all(pessoas.map((pessoa) => pessoa.open()));
  await ana.join('Ana', { ownerToken: 'truco', clientId: 'a' });
  await bia.join('Bia', { clientId: 'b' });
  await otavio.join('Otávio', { clientId: 'o' });
  await Promise.all(pessoas.map((pessoa) => pessoa.mesa()));

  const adicionada = ana.wait(
    (m) => m.type === 'mesa' && m.op === 'add' && m.win?.type === 'truco',
    'add'
  );
  ana.send({ type: 'mesa', op: 'add', win: { type: 'truco', x: 100, y: 100, w: 720, h: 460 } });
  const id = (await adicionada).win.id;
  await ana.act(id, { kind: 'sit', seat: 0 });
  await bia.act(id, { kind: 'sit', seat: 1 });
  const distribuida = await ana.act(id, { kind: 'deal' });
  const cartasAna = distribuida.state.hand.cards.slice();
  const estadoBia = await bia.wait((m) => m.type === 'mesa' && m.op === 'state'
    && m.id === id && m.seq === distribuida.seq, 'estado Bia');
  const cartasBia = estadoBia.state.hand.cards.slice();
  assert.equal(cartasAna.length, 3);
  assert.equal(cartasBia.length, 3);
  assert.equal(distribuida.action, undefined);
  const cedo = await otavio.act(id, { kind: 'timeout' });
  assert.equal(cedo.reason, 'early');

  await Promise.all(pessoas.map((pessoa) => pessoa.mesa()));
  semSegredo(ana, cartasBia, 'Ana', id);
  semSegredo(bia, cartasAna, 'Bia', id);
  semSegredo(otavio, cartasAna.concat(cartasBia), 'Observador', id);

  const jogadorDaVez = (estado) => estado.hand.turn === 0 ? ana : bia;
  let estado = distribuida.state;
  estado = (await jogadorDaVez(estado).act(id, { kind: 'play', index: 0 })).state;
  estado = (await jogadorDaVez(estado).act(id, { kind: 'play', index: 0 })).state;
  const terceiro = jogadorDaVez(estado);
  const janelaTerceiro = (await terceiro.mesa()).windows.find((janela) => janela.id === id);
  const escondida = janelaTerceiro.state.hand.cards[0];
  const inicio = new Map(pessoas.map((pessoa) => [pessoa, pessoa.entrada.length]));
  const coberta = await terceiro.act(id, { kind: 'play', index: 0, covered: true });
  assert.equal(coberta.state.hand.table.at(-1).covered, true);
  assert.equal(coberta.state.hand.table.at(-1).card, undefined);
  for (const pessoa of pessoas.filter((pessoa) => pessoa !== terceiro)) {
    await pessoa.wait((m) => m.type === 'mesa' && m.op === 'state' && m.id === id
      && m.seq === coberta.seq, 'carta encoberta', inicio.get(pessoa));
    const mensagens = pessoa.entrada.slice(inicio.get(pessoa)).map((m) => JSON.stringify(m)).join('\n');
    assert.equal(mensagens.includes(`"${escondida}"`), false, 'carta encoberta vazou');
  }

  const migrando = bia.wait((m) => m.type === 'room-migrating', 'migração', 0);
  fechado = true;
  await servidor.close({ migrate: true });
  const semente = (await migrando).mesa.windows.find((janela) => janela.id === id).state;
  assert.equal(semente.hand, null);
  const texto = JSON.stringify(semente);
  for (const carta of cartasAna.concat(cartasBia)) {
    assert.equal(texto.includes(`"${carta}"`), false, 'migração levou carta privada');
  }
});
