'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const lista = require('./lista');

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

const ctxCliente = {
  from: '1', isLeader: false, peers: [],
  get now() { throw new Error('reduce leu o relogio'); },
  get random() { throw new Error('reduce leu a sorte'); },
};

function semRelogioNemSorte(fn) {
  const { now } = Date;
  const { random } = Math;
  Date.now = () => { throw new Error('reduce leu Date.now'); };
  Math.random = () => { throw new Error('reduce leu Math.random'); };
  try { return fn(); } finally { Date.now = now; Math.random = random; }
}

function aplica(state, actions) {
  for (const a of actions) {
    const ok = lista.validate(state, a, ctxCliente);
    assert.equal(ok, true, `${JSON.stringify(a)}: ${ok}`);
    state = lista.reduce(deepFreeze(state), a, ctxCliente);
  }
  return state;
}

function tres() {
  return aplica(lista.init({}), [
    { kind: 'add', text: 'Refri' }, { kind: 'add', text: 'Pizza' }, { kind: 'add', text: 'Gelo' },
  ]);
}

const MALFORMADAS = [
  null, undefined, 0, 'add', [], {}, { kind: 1 }, { kind: 'hasOwnProperty' }, { kind: '__proto__' },
  { kind: 'add' }, { kind: 'add', text: 5 }, { kind: 'add', text: '  ' }, { kind: 'add', text: 'x'.repeat(81) },
  { kind: 'add', text: 'x'.repeat(1e6) }, { kind: 'check', id: 1 }, { kind: 'check', id: 1, done: 'sim' },
  { kind: 'check', id: 0, done: true }, { kind: 'check', id: '1', done: true }, { kind: 'check', id: 99, done: true },
  { kind: 'check', id: 1.5, done: true }, { kind: 'check', id: Infinity, done: true },
  { kind: 'edit', id: 1 }, { kind: 'edit', id: 1, text: '' }, { kind: 'edit', id: 99, text: 'a' },
  { kind: 'remove' }, { kind: 'remove', id: -1 }, { kind: 'remove', id: 99 },
  { kind: 'move', id: 1 }, { kind: 'move', id: 1, to: -1 }, { kind: 'move', id: 1, to: 3 },
  { kind: 'move', id: 1, to: '0' }, { kind: 'move', id: 99, to: 0 }, { kind: 'move', id: 1, to: 40 },
  { kind: 'title' }, { kind: 'title', text: 3 }, { kind: 'title', text: 'x'.repeat(41) },
  { kind: 'clearDone' }, // nada marcado
];

test('init: lista vazia', () => {
  const s = lista.init({ now: 1, random: () => 0 });
  assert.deepEqual(s, { title: '', items: [], nextId: 1 });
  assert.equal(lista.summary(s), 'Lista: vazia');
});

test('metadados seguem o contrato', () => {
  assert.equal(lista.type, 'lista');
  assert.equal(lista.title, 'Lista');
  assert.equal(lista.group, 'ferramentas');
});

test('adicionar da ids em sequencia; marcar leva o valor', () => {
  let s = tres();
  assert.deepEqual(s.items.map((it) => it.id), [1, 2, 3]);
  s = aplica(s, [
    { kind: 'check', id: 2, done: true },
    { kind: 'check', id: 2, done: true }, // clique repetido nao desmarca
    { kind: 'title', text: ' Quem traz o quê ' },
  ]);
  assert.deepEqual(s.items[1], { id: 2, text: 'Pizza', done: true });
  assert.equal(lista.summary(s), 'Quem traz o quê: 1 de 3 feitos');
  s = aplica(s, [{ kind: 'check', id: 2, done: false }]);
  assert.equal(s.items[1].done, false);
});

test('editar e apagar pelo id', () => {
  const s = aplica(tres(), [
    { kind: 'edit', id: 3, text: 'Gelo\t(2 sacos)' },
    { kind: 'remove', id: 1 },
    { kind: 'add', text: 'Copos' },
  ]);
  assert.deepEqual(s.items, [
    { id: 2, text: 'Pizza', done: false },
    { id: 3, text: 'Gelo (2 sacos)', done: false },
    { id: 4, text: 'Copos', done: false },
  ]);
  // Id apagado nao volta a ser usado.
  assert.equal(s.nextId, 5);
});

test('reordenar move o item para a posicao pedida', () => {
  let s = aplica(tres(), [{ kind: 'move', id: 3, to: 0 }]);
  assert.deepEqual(s.items.map((it) => it.text), ['Gelo', 'Refri', 'Pizza']);
  s = aplica(s, [{ kind: 'move', id: 3, to: 2 }]);
  assert.deepEqual(s.items.map((it) => it.text), ['Refri', 'Pizza', 'Gelo']);
  const f = deepFreeze(s);
  assert.equal(lista.reduce(f, { kind: 'move', id: 1, to: 0 }), f);
});

test('apagar os marcados', () => {
  const s = aplica(tres(), [
    { kind: 'check', id: 1, done: true }, { kind: 'check', id: 3, done: true }, { kind: 'clearDone' },
  ]);
  assert.deepEqual(s.items.map((it) => it.id), [2]);
  assert.equal(lista.validate(s, { kind: 'clearDone' }), 'Nenhum item marcado');
});

test('item que outra pessoa apagou: recusa e reduce nao muda nada', () => {
  const s = deepFreeze(aplica(tres(), [{ kind: 'remove', id: 2 }]));
  for (const a of [{ kind: 'check', id: 2, done: true }, { kind: 'edit', id: 2, text: 'x' }, { kind: 'move', id: 2, to: 0 }]) {
    assert.equal(lista.validate(s, a), 'Esse item não existe mais');
    assert.equal(lista.reduce(s, a), s);
  }
});

test('tetos de itens e de texto', () => {
  let s = lista.init({});
  for (let i = 0; i < lista.MAX_ITEMS; i++) s = lista.reduce(s, { kind: 'add', text: `Item ${i}` });
  assert.equal(s.items.length, lista.MAX_ITEMS);
  assert.equal(lista.validate(s, { kind: 'add', text: 'X' }), `A lista está cheia (máx. ${lista.MAX_ITEMS})`);
  assert.equal(lista.reduce(deepFreeze(s), { kind: 'add', text: 'X' }), s);
  assert.equal(lista.validate(lista.init({}), { kind: 'add', text: 'x'.repeat(lista.MAX_TEXT) }), true);
  assert.equal(
    lista.validate(lista.init({}), { kind: 'add', text: 'x'.repeat(lista.MAX_TEXT + 1) }),
    `Item longo demais (máx. ${lista.MAX_TEXT})`,
  );
  // Titulo vazio pode: volta ao "Lista" do resumo.
  assert.equal(lista.validate(s, { kind: 'title', text: '' }), true);
});

test('acao malformada e recusada com motivo e nunca lanca', () => {
  const s = deepFreeze(tres());
  for (const a of MALFORMADAS) {
    const r = lista.validate(s, a, ctxCliente);
    assert.equal(typeof r, 'string', JSON.stringify(a));
    if (a && a.kind === 'clearDone') continue; // forma certa, so sem efeito
    assert.equal(lista.reduce(s, a, ctxCliente), s, JSON.stringify(a));
  }
});

test('mesma sequencia da o mesmo estado, sem relogio nem sorte', () => {
  const acoes = [
    { kind: 'add', text: 'A' }, { kind: 'add', text: 'B' }, { kind: 'check', id: 1, done: true },
    { kind: 'move', id: 2, to: 0 }, { kind: 'edit', id: 1, text: 'A2' }, { kind: 'add', text: 'C' },
    { kind: 'clearDone' }, { kind: 'title', text: 'Mapas' },
  ];
  const a = semRelogioNemSorte(() => aplica(lista.init({}), acoes));
  const b = semRelogioNemSorte(() => aplica(lista.init({}), acoes));
  assert.deepEqual(a, b);
  assert.deepEqual(a.items, [{ id: 2, text: 'B', done: false }, { id: 3, text: 'C', done: false }]);
});

test('estado no pior caso cabe em maxStateBytes', () => {
  const item = { id: Number.MAX_SAFE_INTEGER, text: '€'.repeat(lista.MAX_TEXT), done: false };
  const s = {
    title: '€'.repeat(lista.MAX_TITLE),
    items: new Array(lista.MAX_ITEMS).fill(item),
    nextId: Number.MAX_SAFE_INTEGER,
  };
  assert.ok(Buffer.byteLength(JSON.stringify(s)) <= lista.maxStateBytes);
});
