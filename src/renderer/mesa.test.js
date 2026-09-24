'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mesa = require('./mesa');

const {
  WORLD, GAP, GRAB_MS, EMIT_HZ, MAX_WINDOWS,
  normRect, checkRect, overlaps, nearestFree,
  sanitizeMesa, createState, snapshot, applyMessage,
  createGrabs, shouldEmit, normCursor, normDragRect, createPointerStore, jsonBytes,
} = mesa;

function win(id, x, y, w = 200, h = 100, extra = {}) {
  return { id, type: 'nota', owner: '1', x, y, w, h, state: { text: '' }, ...extra };
}

// ---------------------------------------------------------------------------
// Retangulos
// ---------------------------------------------------------------------------

test('constantes batem com o contrato', () => {
  assert.deepEqual(WORLD, { w: 4800, h: 3000 });
  assert.equal(mesa.OVERSCROLL, 600);
  assert.equal(GAP, 16);
  assert.equal(MAX_WINDOWS, 32);
  assert.equal(GRAB_MS, 5000);
  assert.equal(EMIT_HZ, 20);
  assert.equal(mesa.MODES, undefined, 'Transmissao e Mesa sao vistas de cada um, nao estado da sala');
});

test('normRect arredonda e recusa o que nao e numero finito', () => {
  assert.deepEqual(normRect({ x: 10.4, y: 20.6, w: 100.5, h: 50 }), { x: 10, y: 21, w: 101, h: 50 });
  for (const bad of [null, 'x', {}, { x: '1', y: 1, w: 100, h: 100 }, { x: NaN, y: 0, w: 100, h: 100 },
    { x: 0, y: 0, w: Infinity, h: 100 }, { x: 0, y: 0, w: 100 }]) {
    assert.equal(normRect(bad), null, JSON.stringify(bad));
  }
});

test('checkRect exige tamanho minimo, maximo e retangulo dentro do mundo', () => {
  assert.equal(checkRect({ x: 0, y: 0, w: 200, h: 100 }), true);
  assert.equal(checkRect({ x: 4600, y: 2900, w: 200, h: 100 }), true, 'encostado no canto ainda vale');
  assert.equal(checkRect({ x: 0, y: 0, w: 10, h: 100 }), 'too-small');
  assert.equal(checkRect({ x: 0, y: 0, w: 200, h: 100 }, { minW: 300 }), 'too-small');
  assert.equal(checkRect({ x: 0, y: 0, w: 60, h: 60 }, { minW: 10, minH: 10 }), true, 'o minimo do tipo nunca fica abaixo do da mesa');
  assert.equal(checkRect({ x: 0, y: 0, w: 30, h: 60 }, { minW: 10, minH: 10 }), 'too-small');
  assert.equal(checkRect({ x: 0, y: 0, w: 4801, h: 100 }), 'too-big');
  assert.equal(checkRect({ x: -1, y: 0, w: 200, h: 100 }), 'out-of-world');
  assert.equal(checkRect({ x: 4601, y: 0, w: 200, h: 100 }), 'out-of-world');
  assert.equal(checkRect({ x: 0, y: 2901, w: 200, h: 100 }), 'out-of-world');
  assert.equal(checkRect(null), 'bad-rect');
});

test('overlaps: encostar na borda do vao nao e sobrepor', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(overlaps(a, { x: 50, y: 50, w: 100, h: 100 }), true);
  assert.equal(overlaps(a, { x: 100, y: 0, w: 100, h: 100 }), false, 'lado a lado, vao 0');
  assert.equal(overlaps(a, { x: 100, y: 0, w: 100, h: 100 }, 16), true, 'lado a lado, dentro do vao');
  assert.equal(overlaps(a, { x: 116, y: 0, w: 100, h: 100 }, 16), false, 'exatamente no vao');
  assert.equal(overlaps(a, { x: 0, y: 116, w: 100, h: 100 }, 16), false);
});

test('nearestFree devolve o proprio lugar quando ele ja esta livre', () => {
  assert.deepEqual(nearestFree([win('a', 0, 0)], { x: 1000, y: 1000, w: 200, h: 100 }), { x: 1000, y: 1000, w: 200, h: 100 });
});

test('nearestFree prende ao mundo quem pediu fora dele', () => {
  assert.deepEqual(nearestFree([], { x: -50, y: 2990, w: 200, h: 100 }), { x: 0, y: 2900, w: 200, h: 100 });
});

test('nearestFree acha o lugar livre mais perto, com o vao, e sem sobrepor', () => {
  const windows = [win('a', 1000, 1000, 400, 300)];
  // Pedido quase todo em cima de 'a', um pouco para a direita: o mais perto
  // e logo depois da borda direita (mais o vao).
  const got = nearestFree(windows, { x: 1300, y: 1050, w: 200, h: 100 });
  assert.deepEqual(got, { x: 1416, y: 1050, w: 200, h: 100 });
  assert.equal(overlaps(got, windows[0], GAP), false);
  // Um pouco para cima: sai por cima.
  assert.deepEqual(nearestFree(windows, { x: 1100, y: 950, w: 200, h: 100 }), { x: 1100, y: 884, w: 200, h: 100 });
});

test('nearestFree ignora a propria janela ao mover', () => {
  const windows = [win('a', 1000, 1000)];
  assert.deepEqual(nearestFree(windows, { x: 1010, y: 1000, w: 200, h: 100 }, { ignoreId: 'a' }), { x: 1010, y: 1000, w: 200, h: 100 });
});

test('nearestFree acha o vao entre duas janelas quando ele e o mais perto', () => {
  const windows = [win('a', 0, 0, 1000, 100), win('b', 1332, 0, 1000, 100)];
  // Entre 1016 e 1316 cabe 300 de largura, exatamente.
  assert.deepEqual(nearestFree(windows, { x: 1100, y: 0, w: 300, h: 100 }), { x: 1016, y: 0, w: 300, h: 100 });
});

test('nearestFree e deterministico no empate (menor y, depois menor x)', () => {
  const windows = [win('a', 1000, 1000, 100, 100)];
  const rect = { x: 1000, y: 1000, w: 100, h: 100 };
  const a = nearestFree(windows, rect, { gap: 0 });
  const b = nearestFree(windows.slice().reverse(), rect, { gap: 0 });
  assert.deepEqual(a, b);
  // Quatro saidas a 100 de distancia: a de menor y e a de cima.
  assert.deepEqual(a, { x: 1000, y: 900, w: 100, h: 100 });
});

test('nearestFree devolve null quando nao cabe em lugar nenhum', () => {
  assert.equal(nearestFree([win('a', 0, 0, 4800, 3000)], { x: 10, y: 10, w: 100, h: 100 }), null);
  assert.equal(nearestFree([], { x: 0, y: 0, w: 5000, h: 100 }), null);
  assert.equal(nearestFree([], null), null);
});

test('nearestFree com a mesa cheia de janelas termina rapido e acha um lugar livre', () => {
  const windows = [];
  for (let i = 0; i < 32; i += 1) windows.push(win(`w${i}`, (i % 8) * 600, Math.floor(i / 8) * 500, 580, 480));
  const t0 = process.hrtime.bigint();
  const got = nearestFree(windows, { x: 1300, y: 700, w: 300, h: 200 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(got, 'embaixo das quatro fileiras ainda cabe');
  for (const o of windows) assert.equal(overlaps(got, o, GAP), false);
  assert.ok(ms < 500, `levou ${ms} ms`);
});

// ---------------------------------------------------------------------------
// Estado e mensagens
// ---------------------------------------------------------------------------

test('createState cai na mesa vazia sem nada valido', () => {
  const vazia = { mesa: { seq: 0, leaderOnly: false, lockSize: false, windows: [] } };
  assert.deepEqual(createState(), vazia);
  assert.deepEqual(createState({ mesa: 'x' }), vazia);
  assert.equal('mode' in createState(), false);
});

test('sanitizeMesa tira janela invalida, repetida, sobreposta e o que passa do teto', () => {
  const raw = {
    seq: 7,
    leaderOnly: true,
    lockSize: 'sim', // so o booleano vale
    windows: [
      win('a', 0, 0),
      win('a', 500, 0), // id repetido
      win('b', 100, 50), // sobrepoe 'a'
      win('c', -10, 0), // fora do mundo
      { ...win('d', 800, 0), type: 'Nota!' }, // tipo com caractere invalido
      { ...win('e', 1200, 0), state: { f() {} } }, // funcao some no JSON, fica {}
      win('f', 1600, 0),
    ],
  };
  const got = sanitizeMesa(raw);
  assert.equal(got.seq, 7);
  assert.equal(got.leaderOnly, true);
  assert.equal(got.lockSize, false);
  assert.deepEqual(got.windows.map((w) => w.id), ['a', 'e', 'f']);
  assert.deepEqual(got.windows[1].state, {});

  const many = { windows: Array.from({ length: 40 }, (_, i) => win(`w${i}`, (i % 16) * 300, Math.floor(i / 16) * 200)) };
  assert.equal(sanitizeMesa(many).windows.length, MAX_WINDOWS);
});

test('sanitizeMesa passa cada janela pelo accept, que pode tirar ou ajustar', () => {
  const got = sanitizeMesa({ windows: [win('a', 0, 0), win('b', 500, 0)] }, {
    accept: (w) => (w.id === 'a' ? null : { ...w, owner: null }),
  });
  assert.deepEqual(got.windows.map((w) => [w.id, w.owner]), [['b', null]]);
});

test('applyMessage aplica add, place, remove e lock em ordem de seq', () => {
  let s = createState();
  const steps = [
    { type: 'mesa', op: 'add', seq: 1, by: '1', win: win('a', 0, 0) },
    { type: 'mesa', op: 'place', seq: 2, by: '1', id: 'a', x: 300, y: 400, w: 250, h: 120 },
    { type: 'mesa', op: 'lock', seq: 3, by: '1', leaderOnly: true },
    { type: 'mesa', op: 'lock', seq: 4, by: '1', lockSize: true },
  ];
  for (const msg of steps) {
    const r = applyMessage(s, msg);
    assert.equal(r.needSync, false);
    s = r.state;
  }
  assert.equal(s.mesa.seq, 4);
  assert.equal(s.mesa.leaderOnly, true, 'a segunda trava nao mexe na primeira');
  assert.equal(s.mesa.lockSize, true);
  assert.deepEqual(s.mesa.windows[0], { ...win('a', 300, 400, 250, 120) });

  const r = applyMessage(s, { type: 'mesa', op: 'remove', seq: 5, by: '1', id: 'a' });
  assert.deepEqual(r.state.mesa.windows, []);
  assert.equal(r.state.mesa.seq, 5);
  const destrava = applyMessage(r.state, { type: 'mesa', op: 'lock', seq: 6, leaderOnly: false, lockSize: true });
  assert.deepEqual([destrava.state.mesa.leaderOnly, destrava.state.mesa.lockSize], [false, true]);
});

test('applyMessage nunca muta o estado anterior', () => {
  const s0 = createState({ mesa: { seq: 1, windows: [win('a', 0, 0)] } });
  const copia = JSON.parse(JSON.stringify(s0));
  applyMessage(s0, { type: 'mesa', op: 'place', seq: 2, id: 'a', x: 900, y: 900, w: 200, h: 100 });
  applyMessage(s0, { type: 'mesa', op: 'remove', seq: 2, id: 'a' });
  applyMessage(s0, { type: 'mesa', op: 'lock', seq: 2, leaderOnly: true });
  assert.deepEqual(s0, copia);
});

test('applyMessage: seq ja visto e ignorado, seq pulado pede sync', () => {
  const s = createState({ mesa: { seq: 5, windows: [win('a', 0, 0)] } });
  const velho = applyMessage(s, { type: 'mesa', op: 'remove', seq: 5, id: 'a' });
  assert.equal(velho.state, s);
  assert.equal(velho.needSync, false);
  assert.equal(velho.stale, true);

  const buraco = applyMessage(s, { type: 'mesa', op: 'remove', seq: 7, id: 'a' });
  assert.equal(buraco.state, s);
  assert.equal(buraco.needSync, true);
});

test('applyMessage pede sync quando a mensagem nao casa com o estado', () => {
  const s = createState({ mesa: { seq: 0, windows: [win('a', 0, 0)] } });
  for (const msg of [
    { type: 'mesa', op: 'remove', seq: 1, id: 'nao-existe' },
    { type: 'mesa', op: 'add', seq: 1, win: win('a', 900, 0) },
    { type: 'mesa', op: 'place', seq: 1, id: 'a', x: 'x', y: 0, w: 100, h: 100 },
    { type: 'mesa', op: 'act', seq: 1, id: 'a', action: {} }, // sem modulo 'nota' registrado aqui
    { type: 'mesa', op: 'desconhecida', seq: 1 },
  ]) {
    assert.equal(applyMessage(s, msg, { getModule: () => null }).needSync, true, JSON.stringify(msg));
  }
});

test('applyMessage aplica act pelo reduce do modulo, com o mesmo contexto do servidor', () => {
  const vistos = [];
  const mod = {
    reduce(state, action, ctx) {
      vistos.push(ctx);
      return { n: state.n + action.add };
    },
  };
  const s = createState({ mesa: { seq: 0, windows: [{ ...win('a', 0, 0), type: 'conta', state: { n: 1 } }] } });
  const r = applyMessage(s, { type: 'mesa', op: 'act', seq: 1, id: 'a', by: '3', isLeader: true, action: { add: 2 } }, { getModule: () => mod });
  assert.equal(r.needSync, false);
  assert.deepEqual(r.state.mesa.windows[0].state, { n: 3 });
  assert.deepEqual(vistos, [{ from: '3', isLeader: true }]);
  assert.deepEqual(s.mesa.windows[0].state, { n: 1 }, 'o anterior fica como estava');
});

test('applyMessage: reduce que lanca pede sync em vez de derrubar', () => {
  const s = createState({ mesa: { windows: [win('a', 0, 0)] } });
  const r = applyMessage(s, { type: 'mesa', op: 'act', seq: 1, id: 'a', action: {} }, {
    getModule: () => ({ reduce() { throw new Error('bug'); } }),
  });
  assert.equal(r.needSync, true);
});

test('applyMessage aceita o retrato do mesa-sync e ignora o que nao e da mesa', () => {
  const s = createState();
  assert.equal(applyMessage(s, { type: 'room-mode', mode: 'mesa' }).state, s, 'room-mode nao existe mais');
  const r = applyMessage(s, { type: 'mesa-sync', mesa: { seq: 9, leaderOnly: false, lockSize: true, windows: [win('z', 10, 10)] } });
  assert.equal(r.state.mesa.seq, 9);
  assert.equal(r.state.mesa.lockSize, true);
  assert.deepEqual(r.state.mesa.windows.map((w) => w.id), ['z']);
});

test('snapshot devolve o formato do fio', () => {
  const s = createState({ mesa: { seq: 2, leaderOnly: true, windows: [win('a', 0, 0)] } });
  assert.deepEqual(snapshot(s), { seq: 2, leaderOnly: true, lockSize: false, windows: [win('a', 0, 0)] });
});

// ---------------------------------------------------------------------------
// Vez por janela
// ---------------------------------------------------------------------------

test('grabs: so uma pessoa tem a vez, e ela vence em GRAB_MS', () => {
  const g = createGrabs();
  assert.deepEqual(g.take('a', 'ana', 1000), { ok: true });
  assert.deepEqual(g.take('a', 'bia', 2000), { ok: false, holder: 'ana' });
  assert.deepEqual(g.take('a', 'ana', 2000), { ok: true }, 'pedir de novo renova');
  assert.equal(g.holder('a', 2000 + GRAB_MS - 1), 'ana');
  assert.equal(g.holder('a', 2000 + GRAB_MS), null, 'venceu');
  assert.deepEqual(g.take('a', 'bia', 2000 + GRAB_MS), { ok: true });
});

test('grabs: renew so para quem tem a vez, e empurra o prazo', () => {
  const g = createGrabs();
  g.take('a', 'ana', 0);
  assert.equal(g.renew('a', 'bia', 100), false);
  assert.equal(g.renew('a', 'ana', 4000), true);
  assert.equal(g.holder('a', 8999), 'ana');
  assert.equal(g.holder('a', 9000), null);
  assert.equal(g.renew('a', 'ana', 9000), false, 'vencida nao renova');
});

test('grabs: release, dropPeer, drop e list', () => {
  const g = createGrabs({ ms: 100 });
  g.take('a', 'ana', 0);
  g.take('b', 'ana', 0);
  g.take('c', 'bia', 0);
  assert.equal(g.release('c', 'ana'), false, 'so quem tem solta');
  assert.deepEqual(g.list(50).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(g.dropPeer('ana'), ['a', 'b']);
  assert.equal(g.release('c', 'bia'), true);
  g.set('d', 'caio', 0);
  g.drop('d');
  assert.deepEqual(g.list(50), []);
  g.set('e', 'caio', 0);
  assert.equal(g.release('e'), true, 'sem `by` solta de quem for (lado do cliente)');
});

// ---------------------------------------------------------------------------
// mesa-drag e cursor
// ---------------------------------------------------------------------------

test('shouldEmit segura em 20 Hz e deixa o primeiro sair', () => {
  assert.equal(shouldEmit(0, 1000), true);
  assert.equal(shouldEmit(1000, 1049), false);
  assert.equal(shouldEmit(1000, 1050), true);
  assert.equal(shouldEmit(1000, 1100, 0), false);
});

test('normCursor aceita a folga da vista e recusa o resto', () => {
  assert.deepEqual(normCursor({ x: -600, y: 3600 }), { x: -600, y: 3600 });
  assert.deepEqual(normCursor({ x: 10.6, y: 0 }), { x: 11, y: 0 });
  assert.equal(normCursor({ x: -601, y: 0 }), null);
  assert.equal(normCursor({ x: '1', y: 0 }), null);
  assert.equal(normCursor(null), null);
});

test('normDragRect deixa passar por cima, mas nao muito longe da borda', () => {
  assert.deepEqual(normDragRect({ x: -100, y: 0, w: 200, h: 100 }), { x: -100, y: 0, w: 200, h: 100 });
  assert.equal(normDragRect({ x: -700, y: 0, w: 200, h: 100 }), null);
  assert.equal(normDragRect({ x: 0, y: 0, w: 1, h: 100 }), null);
});

test('createPointerStore guarda o ultimo ponto e esquece pelo relogio de quem desenha', () => {
  const s = createPointerStore();
  s.apply('ana', { x: 1, y: 2 }, 0);
  s.apply('ana', { x: 3, y: 4 }, 100);
  s.apply('bia', { x: 5, y: 6 }, 100);
  assert.deepEqual(s.active(500), [{ from: 'ana', x: 3, y: 4, age: 400 }, { from: 'bia', x: 5, y: 6, age: 400 }]);
  assert.deepEqual(s.active(1100), []);
  s.drop('ana');
  assert.deepEqual(s.active(200).map((p) => p.from), ['bia']);
});

test('jsonBytes conta bytes UTF-8 e da infinito para o que nao vira JSON', () => {
  assert.equal(jsonBytes({ a: 'é' }), JSON.stringify({ a: 'é' }).length + 1);
  const ciclo = {};
  ciclo.eu = ciclo;
  assert.equal(jsonBytes(ciclo), Infinity);
  assert.equal(jsonBytes(undefined), Infinity);
});
