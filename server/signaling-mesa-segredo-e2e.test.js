'use strict';
/*
 * Teste ponta a ponta da informacao escondida da Mesa (contrato:
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secao 8), com a
 * Batalha naval (`mesa-modules/batalha.js`) como o jogo `secret` de prova.
 *
 * O servidor sobe de verdade e clientes `ws` reais falam o protocolo. A
 * pergunta central: o socket de quem NAO e dono dos navios recebe, em
 * alguma mensagem (eco de add, `op: 'state'`, `mesa-sync`,
 * `room-migrating`), alguma casa de navio que ainda nao foi afundada? Nao
 * pode.
 *
 * Mesma regra do signaling-mesa-e2e: "nao chegou X" e afirmado depois de
 * uma barreira (o eco de um 'ice' enderecado a si mesmo). O relogio do
 * servidor e adiantado trocando `Date.now` (o servidor roda neste mesmo
 * processo), nunca esperando o prazo de verdade.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createSignalingServer } = require('./signaling-core');
const batalha = require('../src/renderer/mesa-modules/batalha');
require('../src/renderer/mesa-modules/index');

const DEADLINE_MS = 5000;

let nonceSeq = 0;

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
    async entra(name, extra = {}) {
      cliente.envia({ type: 'join', room: 'geral', name, ...extra });
      const welcome = await cliente.esperaMsg((m) => m.type === 'welcome', 'welcome');
      cliente.id = welcome.id;
      return welcome;
    },
    async barreira() {
      nonceSeq += 1;
      const marca = `eco-${rotulo}-${nonceSeq}`;
      cliente.envia({ type: 'ice', to: cliente.id, candidate: marca });
      return cliente.esperaMsg((m) => m.candidate === marca, `barreira ${marca}`);
    },
    async abreMesa() {
      const retrato = cliente.esperaNova((m) => m.type === 'mesa-sync', 'mesa-sync');
      cliente.envia({ type: 'mesa-view', on: true });
      return (await retrato).mesa;
    },
    /** Poe a batalha na mesa e devolve o eco do add (para este cliente). */
    async poeBatalha(x = 100, y = 100) {
      return cliente.poeJogo('batalha', 720, 460, x, y);
    },
    /** Poe um jogo secreto e devolve o eco do add para quem o criou. */
    async poeJogo(type, w, h, x = 100, y = 100) {
      const r = cliente.esperaNova((m) => (m.type === 'mesa' && m.op === 'add' && m.by === cliente.id)
        || (m.type === 'mesa-denied' && m.op === 'add'), 'resposta do add');
      cliente.envia({ type: 'mesa', op: 'add', win: { type, x, y, w, h } });
      return r;
    },
    /** Uma jogada: espera o `op: 'state'` dela (quem esta na Mesa) ou a recusa. */
    async joga(id, action) {
      const r = cliente.esperaNova((m) => (m.type === 'mesa' && m.op === 'state' && m.id === id && m.by === cliente.id)
        || (m.type === 'mesa-denied' && m.op === 'act'), `resposta de ${action.kind}`);
      cliente.envia({ type: 'mesa', op: 'act', id, action });
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

/** Ana (lider) e Bia sentadas, Caio assistindo, todos na Mesa, partida
 * comecada. Devolve a janela e a frota da Ana (a que a view dela mostra). */
async function partida(p, opts = {}) {
  const s = await p.servidor({ ownerToken: 'segredo', ...opts });
  const ana = await p.cliente(s, 'ana');
  const bia = await p.cliente(s, 'bia');
  const caio = await p.cliente(s, 'caio');
  await ana.entra('Ana', { ownerToken: 'segredo', clientId: 'cli-ana' });
  await bia.entra('Bia', { clientId: 'cli-bia' });
  await caio.entra('Caio', { clientId: 'cli-caio' });
  await ana.abreMesa();
  await bia.abreMesa();
  await caio.abreMesa();
  const add = await ana.poeBatalha();
  const id = add.win.id;
  await ana.joga(id, { kind: 'sit', seat: 0 });
  await bia.joga(id, { kind: 'sit', seat: 1 });
  await ana.joga(id, { kind: 'ready' });
  const pronto = await bia.joga(id, { kind: 'ready' });
  assert.equal(pronto.state.phase, 'play');
  const minha = await ana.esperaMsg((m) => m.op === 'state' && m.seq === pronto.seq, 'estado da Ana');
  const frotaAna = minha.state.boards[0].ships.map((n) => n.cells);
  const frotaBia = pronto.state.boards[1].ships.map((n) => n.cells);
  assert.equal(frotaAna.length, 5);
  assert.equal(frotaBia.length, 5);
  return { s, ana, bia, caio, id, frotaAna, frotaBia };
}

/** Todo estado de batalha que chegou num socket: eco de add, op state,
 * mesa-sync e room-migrating. */
function estadosDeBatalha(cliente) {
  const out = [];
  for (const m of cliente.entrada) {
    if (m.type === 'mesa' && m.op === 'add' && m.win?.type === 'batalha') out.push(m.win.state);
    if (m.type === 'mesa' && m.op === 'state') out.push(m.state);
    if ((m.type === 'mesa-sync' || m.type === 'room-migrating') && m.mesa) {
      for (const w of m.mesa.windows) if (w.type === 'batalha') out.push(w.state);
    }
  }
  return out;
}

/** Todos os retratos de uma janela secreta que chegaram a este socket. */
function estadosDoJogo(cliente, id) {
  const out = [];
  for (const m of cliente.entrada) {
    if (m.type === 'mesa' && m.op === 'add' && m.win?.id === id) out.push(m.win.state);
    if (m.type === 'mesa' && m.op === 'state' && m.id === id) out.push(m.state);
    if ((m.type === 'mesa-sync' || m.type === 'room-migrating') && m.mesa) {
      const w = m.mesa.windows.find((win) => win.id === id);
      if (w) out.push(w.state);
    }
  }
  return out;
}

function cartasNoEstado(valor, out = []) {
  if (typeof valor === 'string' && /^(?:[2-9TJQKA][shdc])$/.test(valor)) out.push(valor);
  else if (Array.isArray(valor)) for (const x of valor) cartasNoEstado(x, out);
  else if (valor && typeof valor === 'object') for (const x of Object.values(valor)) cartasNoEstado(x, out);
  return out;
}

/** Em cada mensagem do pôquer, só há cartas públicas, do próprio lugar ou
 * as que o showdown mandou revelar. Nenhum baralho pode cruzar o fio. */
function semSegredoPoquer(cliente, id) {
  const estados = estadosDoJogo(cliente, id);
  assert.ok(estados.length > 0, `${cliente.rotulo}: nenhum estado de pôquer`);
  for (const st of estados) {
    const texto = JSON.stringify(st);
    assert.equal(texto.includes('"deck"'), false, `${cliente.rotulo}: baralho do pôquer no fio`);
    const h = st.hand;
    if (!h) continue;
    const permitidas = new Set(h.board || []);
    const meu = h.ids?.indexOf(cliente.id) ?? -1;
    for (let i = 0; i < (h.holes || []).length; i += 1) {
      const podeVer = i === meu || h.result?.shown?.includes(i);
      if (podeVer) for (const c of h.holes[i] || []) permitidas.add(c);
      else assert.equal(h.holes[i], null, `${cliente.rotulo}: cartas fechadas da cadeira ${i}`);
    }
    for (const r of Object.values(h.result?.hands || {})) for (const c of r.cards || []) permitidas.add(c);
    for (const c of cartasNoEstado(st)) assert.ok(permitidas.has(c), `${cliente.rotulo}: carta ${c} fora da regra`);
  }
}

/** No blackjack, a carta fechada só aparece com `revealed`; o sapato não
 * aparece nem por outro campo escondido. */
function semSegredoBlackjack(cliente, id) {
  const estados = estadosDoJogo(cliente, id);
  assert.ok(estados.length > 0, `${cliente.rotulo}: nenhum estado de blackjack`);
  for (const st of estados) {
    const texto = JSON.stringify(st);
    assert.equal(/"shoe"\s*:/.test(texto), false, `${cliente.rotulo}: sapato no fio`);
    const dealer = st.dealer || { cards: [] };
    if (!dealer.revealed) assert.equal(dealer.cards?.[1] ?? null, null, `${cliente.rotulo}: fechada da banca antes da hora`);
    const permitidas = new Set((dealer.cards || []).filter(Boolean));
    for (const h of st.hands || []) for (const c of h.cards || []) permitidas.add(c);
    for (const c of cartasNoEstado(st)) assert.ok(permitidas.has(c), `${cliente.rotulo}: carta ${c} fora da mesa`);
  }
}

function pessoaPorId(pessoas, id) {
  const pessoa = pessoas.find((p) => p.id === id);
  assert.ok(pessoa, `pessoa da cadeira ${id}`);
  return pessoa;
}

/** O socket nunca viu um navio da frota da cadeira `seat` que ainda nao
 * afundou: nem na view (estrutura), nem em lugar nenhum do fio (texto).
 * `podeVer` sao os navios que esse socket VE de direito (os proprios): se
 * um deles calhar de ocupar as mesmas casas de um navio do outro, a busca
 * por texto nao vale para aquele navio. */
function semSegredo(cliente, frota, seat, oque, podeVer = []) {
  const linhas = cliente.entrada.map((m) => JSON.stringify(m));
  const texto = linhas.join('\n');
  assert.equal(/"fleets":\[[^\]]*\[\d/.test(texto), false, `${oque}: frota crua no fio`);
  const estados = estadosDeBatalha(cliente);
  assert.ok(estados.length > 0, `${oque}: nenhum estado chegou`);
  for (const st of estados) {
    for (const navio of st.boards?.[seat]?.ships || []) {
      if (!navio.sunk && !st.result) assert.fail(`${oque}: viu navio inteiro da cadeira ${seat}: ${JSON.stringify(navio)}`);
    }
  }
  const legit = new Set(podeVer.map((c) => JSON.stringify(c)));
  for (const st of estados) {
    for (const n of st.boards?.[seat]?.ships || []) if (n.sunk) legit.add(JSON.stringify(n.cells));
  }
  for (const casas of frota) {
    const k = JSON.stringify(casas);
    if (legit.has(k)) continue;
    assert.equal(texto.includes(k), false, `${oque}: casas ${k} no fio: ${linhas.find((x) => x.includes(k))}`);
  }
}

test('o socket da Bia nunca recebe os navios da Ana (ecos, mesa-sync), nem o do Caio', async (t) => {
  const p = palco(t);
  const { ana, bia, caio, id, frotaAna, frotaBia } = await partida(p);

  // Ana afunda o destroier da Bia; a Bia atira na agua e num navio da Ana.
  const destroier = frotaBia[4];
  const navioAna = new Set(frotaAna.flat());
  const aguaAna = Array.from({ length: 100 }, (_, x) => x).filter((x) => !navioAna.has(x));
  let st = await ana.joga(id, { kind: 'fire', cell: destroier[0] });
  assert.equal(st.state.last.hit, true);
  assert.equal(st.action, undefined, 'op state nao leva a acao');
  st = await bia.joga(id, { kind: 'fire', cell: frotaAna[0][0] });
  assert.equal(st.state.last.hit, true);
  await ana.joga(id, { kind: 'fire', cell: destroier[1] });
  st = await bia.joga(id, { kind: 'fire', cell: aguaAna[0] });
  assert.equal(st.state.boards[1].left, 4, 'o destroier da Bia afundou');

  // Retratos pedidos no meio (sync e reabrir a Mesa) tambem vem filtrados.
  const sync = bia.esperaNova((m) => m.type === 'mesa-sync', 'sync da Bia');
  bia.envia({ type: 'mesa-sync' });
  const retrato = (await sync).mesa.windows.find((w) => w.id === id).state;
  assert.equal(retrato.boards[1].ships.length, 5, 'a Bia ve a propria frota no sync');
  assert.equal(retrato.boards[0].ships.length, 0);
  await caio.abreMesa();

  // O Caio (so assiste) ve o destroier afundado inteiro e mais nada.
  const doCaio = (await caio.abreMesa()).windows.find((w) => w.id === id).state;
  assert.deepEqual(doCaio.boards[1].ships, [{ size: 2, cells: destroier, sunk: true }]);
  assert.equal(doCaio.boards[0].ships.length, 0);
  assert.equal(doCaio.me.seat, -1);

  await bia.barreira();
  await caio.barreira();
  await ana.barreira();
  semSegredo(bia, frotaAna, 0, 'Bia', frotaBia);
  semSegredo(caio, frotaAna, 0, 'Caio', [destroier]);
  semSegredo(caio, frotaBia, 1, 'Caio');
  semSegredo(ana, frotaBia, 1, 'Ana', frotaAna);
  // Todos receberam o mesmo seq, cada um com o seu estado.
  const seqs = (c) => c.entrada.filter((m) => m.type === 'mesa' && m.op === 'state').map((m) => m.seq);
  assert.deepEqual(seqs(bia), seqs(ana));
  assert.deepEqual(seqs(caio), seqs(ana));
});

test('timeout antes do prazo e recusado com early; depois do prazo, o primeiro vale', async (t) => {
  const p = palco(t);
  const { ana, bia, caio, id } = await partida(p);
  const cedo = await caio.joga(id, { kind: 'timeout' });
  assert.equal(cedo.type, 'mesa-denied');
  assert.equal(cedo.reason, 'early');
  assert.ok(Number.isFinite(cedo.at) && cedo.at > Date.now());

  // Adianta o relogio do servidor para depois do prazo.
  const real = Date.now;
  Date.now = () => real() + batalha.TURN_MS + 1000;
  try {
    const vale = await caio.joga(id, { kind: 'timeout' });
    assert.equal(vale.type, 'mesa');
    assert.equal(vale.op, 'state');
    assert.equal(vale.state.last.seat, 0, 'o tiro sai pela Ana, que tinha a vez');
    assert.equal(vale.state.turn, 1);
    assert.equal(vale.state.boards[1].shots.length, 1);
    // O segundo, logo depois, ja chega antes do prazo novo.
    const segundo = await bia.joga(id, { kind: 'timeout' });
    assert.equal(segundo.reason, 'early');
  } finally {
    Date.now = real;
  }
  await ana.barreira();
});

test('quem sai de vez libera a cadeira: op state na batalha, op drop no jogo da velha', async (t) => {
  const p = palco(t);
  const { s, ana, bia, id } = await partida(p, { resumeGraceMs: 150 });
  const velhaAdd = ana.esperaNova((m) => m.type === 'mesa' && m.op === 'add' && m.win.type === 'velha', 'velha');
  bia.envia({ type: 'mesa', op: 'add', win: { type: 'velha', x: 2000, y: 100, w: 360, h: 360 } });
  const vid = (await velhaAdd).win.id;
  const sentou = ana.esperaNova((m) => m.type === 'mesa' && m.op === 'act' && m.id === vid, 'Bia senta na velha');
  bia.envia({ type: 'mesa', op: 'act', id: vid, action: { kind: 'sit', seat: 0 } });
  await sentou;

  // Queda (1006): a pessoa esta suspensa, na janela de retomada; a cadeira
  // continua dela.
  const antes = ana.entrada.length;
  bia.ws.terminate();
  const drop = ana.esperaNova((m) => m.type === 'mesa' && m.op === 'drop' && m.id === vid, 'drop da velha');
  const state = ana.esperaNova((m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.peer, 'state da batalha');
  const d = await drop;
  assert.equal(d.peer, bia.id);
  assert.equal(d.by, bia.id);
  assert.ok(ana.entrada.slice(antes).some((m) => m.type === 'peer-left'), 'o drop vem depois da janela de retomada');
  const st = await state;
  assert.equal(st.peer, bia.id);
  assert.deepEqual(st.state.seats, [ana.id, null]);
  assert.equal(st.state.me.seat, 0);

  // O drop aplicado no cliente (mesmo dropPeer) da o mesmo retrato do servidor.
  const retrato = await ana.abreMesa();
  assert.deepEqual(retrato.windows.find((w) => w.id === vid).state.seats, [null, null]);
  assert.equal(s.getPeerCount(), 2);
});

test('a retomada dentro do prazo nao tira ninguem da cadeira', async (t) => {
  const p = palco(t);
  const { s, ana, bia, id } = await partida(p, { resumeGraceMs: 60000 });
  bia.ws.terminate();
  await ana.barreira();
  assert.equal(s.getPeerCount(), 3, 'a Bia esta suspensa, ainda na sala');
  assert.equal(ana.entrada.some((m) => m.type === 'mesa' && m.op === 'state' && m.peer), false);
  const retrato = (await ana.abreMesa()).windows.find((w) => w.id === id).state;
  assert.deepEqual(retrato.seats, [ana.id, bia.id]);
});

test('depois da migracao o estado nao tem segredo: nem no room-migrating, nem no servidor novo', async (t) => {
  const p = palco(t);
  const { s, ana, bia, id, frotaAna, frotaBia } = await partida(p, { roomId: 'sala-batalha' });
  await ana.joga(id, { kind: 'fire', cell: frotaBia[0][0] });

  const migrando = bia.esperaMsg((m) => m.type === 'room-migrating', 'room-migrating');
  s.fechado = true;
  await s.close({ migrate: true });
  const msg = await migrando;
  const semente = msg.mesa.windows.find((w) => w.id === id);
  assert.ok(semente, 'a janela migra');
  assert.deepEqual(semente.state.fleets, [null, null]);
  assert.deepEqual(semente.state.shots, [[], []]);
  assert.equal(semente.state.phase, 'setup');
  const texto = JSON.stringify(msg);
  for (const casas of [...frotaAna, ...frotaBia]) assert.equal(texto.includes(JSON.stringify(casas)), false);

  // O sucessor semeia o servidor novo; as cadeiras antigas contam como livres.
  const novo = await p.servidor({ roomId: 'sala-batalha', initialMesa: msg.mesa, initialChatHistory: msg.chat });
  const bia2 = await p.cliente(novo, 'bia de novo');
  await bia2.entra('Bia');
  const st = (await bia2.abreMesa()).windows.find((w) => w.id === id).state;
  assert.deepEqual(st.seats, [null, null]);
  assert.deepEqual(st.boards.map((b) => b.ships.length), [0, 0]);
  const sentou = await bia2.joga(id, { kind: 'sit', seat: 1 });
  assert.equal(sentou.state.boards[1].ships.length, 5, 'frota nova, sorteada pelo servidor novo');
});

test('fleet mandada pelo cliente e ignorada: a frota e sempre a que o servidor sorteou', async (t) => {
  const p = palco(t);
  const s = await p.servidor();
  const ana = await p.cliente(s, 'ana');
  await ana.entra('Ana');
  await ana.abreMesa();
  const id = (await ana.poeBatalha()).win.id;
  const trapaca = [[0, 1, 2, 3, 4], [20, 21, 22, 23], [40, 41, 42], [60, 61, 62], [80, 81]];
  const st = await ana.joga(id, { kind: 'sit', seat: 0, fleet: trapaca });
  assert.notDeepEqual(st.state.boards[0].ships.map((n) => n.cells), trapaca);
});

test('pôquer: três sockets jogam até o showdown sem receber cartas alheias ou o baralho', async (t) => {
  const p = palco(t);
  const s = await p.servidor({ ownerToken: 'cartas-poquer' });
  const ana = await p.cliente(s, 'ana');
  const bia = await p.cliente(s, 'bia');
  const caio = await p.cliente(s, 'caio');
  const pessoas = [ana, bia, caio];
  await ana.entra('Ana', { ownerToken: 'cartas-poquer' });
  await bia.entra('Bia');
  await caio.entra('Caio');
  await Promise.all(pessoas.map((x) => x.abreMesa()));
  const id = (await ana.poeJogo('poquer', 720, 460)).win.id;
  await ana.joga(id, { kind: 'sit', seat: 0 });
  await bia.joga(id, { kind: 'sit', seat: 1 });
  await caio.joga(id, { kind: 'sit', seat: 2 });
  const inicial = await ana.joga(id, { kind: 'deal' });
  assert.equal(inicial.type, 'mesa', JSON.stringify(inicial));
  assert.ok(inicial.state?.hand, JSON.stringify(inicial));
  async function jogarAteShowdown(estado, passos = 0) {
    if (estado.state.hand.result || passos >= 30) return estado;
    const h = estado.state.hand;
    const quem = pessoaPorId(pessoas, h.ids[h.toAct]);
    const vista = await quem.esperaMsg((m) => m.type === 'mesa' && m.op === 'state' && m.id === id && m.seq === estado.seq,
      `estado do pôquer ${estado.seq}`);
    const proximo = await quem.joga(id, { kind: vista.state.me.canCheck ? 'check' : 'call' });
    assert.ok(proximo.state, JSON.stringify(proximo));
    return jogarAteShowdown(proximo, passos + 1);
  }
  const estado = await jogarAteShowdown(inicial);
  assert.ok(estado.state.hand.result, 'o showdown terminou');
  assert.equal(estado.state.hand.result.byFold, false);
  assert.deepEqual(estado.state.hand.result.shown.slice().sort(), [0, 1, 2]);
  await Promise.all(pessoas.map((x) => x.barreira()));
  for (const pessoa of pessoas) semSegredoPoquer(pessoa, id);
});

test('blackjack: três sockets jogam até a banca revelar sem receber fechada ou sapato', async (t) => {
  const p = palco(t);
  const s = await p.servidor({ ownerToken: 'cartas-blackjack' });
  const ana = await p.cliente(s, 'ana');
  const bia = await p.cliente(s, 'bia');
  const caio = await p.cliente(s, 'caio');
  const pessoas = [ana, bia, caio];
  await ana.entra('Ana', { ownerToken: 'cartas-blackjack' });
  await bia.entra('Bia');
  await caio.entra('Caio');
  await Promise.all(pessoas.map((x) => x.abreMesa()));
  const id = (await ana.poeJogo('blackjack', 680, 440)).win.id;
  await ana.joga(id, { kind: 'sit', seat: 0 });
  await bia.joga(id, { kind: 'sit', seat: 1 });
  let estado = await caio.joga(id, { kind: 'sit', seat: 2 });
  for (const pessoa of pessoas) estado = await pessoa.joga(id, { kind: 'bet', amount: 10 });
  let passos = 0;
  while (!(estado.state.phase === 'bets' && estado.state.round > 0 && estado.state.dealer.revealed) && passos < 20) {
    if (estado.state.phase === 'insurance') {
      const seat = estado.state.insurance.findIndex((v) => v === null);
      estado = await pessoaPorId(pessoas, estado.state.seats[seat]).joga(id, { kind: 'insurance', amount: 0 });
    } else if (estado.state.phase === 'play') {
      const mao = estado.state.hands[estado.state.turn];
      estado = await pessoaPorId(pessoas, estado.state.seats[mao.seat]).joga(id, { kind: 'stand' });
    } else {
      assert.fail(`fase inesperada: ${estado.state.phase}`);
    }
    passos += 1;
  }
  assert.equal(estado.state.phase, 'bets');
  assert.equal(estado.state.dealer.revealed, true, 'a banca revelou antes do pagamento');
  assert.ok(estado.state.hands.every((h) => h.result), 'todas as mãos receberam resultado');
  await Promise.all(pessoas.map((x) => x.barreira()));
  for (const pessoa of pessoas) semSegredoBlackjack(pessoa, id);
});

test('migração de pôquer e blackjack envia só sementes sem segredo', async (t) => {
  const p = palco(t);
  const s = await p.servidor({ ownerToken: 'migrar-cartas', roomId: 'cartas-migracao' });
  const ana = await p.cliente(s, 'ana');
  const bia = await p.cliente(s, 'bia');
  await ana.entra('Ana', { ownerToken: 'migrar-cartas' });
  await bia.entra('Bia');
  await ana.abreMesa();
  await bia.abreMesa();
  const poquer = (await ana.poeJogo('poquer', 720, 460)).win.id;
  const blackjack = (await ana.poeJogo('blackjack', 680, 440, 1000)).win.id;
  for (const id of [poquer, blackjack]) {
    await ana.joga(id, { kind: 'sit', seat: 0 });
    await bia.joga(id, { kind: 'sit', seat: 1 });
  }
  await ana.joga(poquer, { kind: 'deal' });
  await ana.joga(blackjack, { kind: 'bet', amount: 10 });
  await bia.joga(blackjack, { kind: 'bet', amount: 10 });
  const migrando = bia.esperaNova((m) => m.type === 'room-migrating', 'room-migrating das cartas');
  s.fechado = true;
  await s.close({ migrate: true });
  const msg = await migrando;
  const pokerSeed = msg.mesa.windows.find((w) => w.id === poquer).state;
  const blackjackSeed = msg.mesa.windows.find((w) => w.id === blackjack).state;
  assert.equal(pokerSeed.hand, null);
  assert.deepEqual(blackjackSeed.shoe, []);
  assert.deepEqual(blackjackSeed.hands, []);
  assert.deepEqual(blackjackSeed.dealer.cards, []);
  const texto = JSON.stringify(msg);
  assert.equal(texto.includes('"deck"'), false);
  assert.equal(/"shoe"\s*:\s*\[\s*"/.test(texto), false);
  assert.deepEqual(cartasNoEstado(msg), [], 'nenhuma carta migra');
});
