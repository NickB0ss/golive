'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../i18n');
const enquete = require('./enquete');

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

function ctxCliente(from = '1') {
  return {
    from, isLeader: false, peers: [],
    get now() { throw new Error('reduce leu o relogio'); },
    get random() { throw new Error('reduce leu a sorte'); },
  };
}

function semRelogioNemSorte(fn) {
  const { now } = Date;
  const { random } = Math;
  Date.now = () => { throw new Error('reduce leu Date.now'); };
  Math.random = () => { throw new Error('reduce leu Math.random'); };
  try { return fn(); } finally { Date.now = now; Math.random = random; }
}

/** Servidor: valida e prepara com quem mandou; o cliente reduz com a acao pronta. */
function servidor(state, action, from, isLeader = false) {
  const ctx = { from, isLeader, peers: [], now: 0, random: () => 0 };
  const ok = enquete.validate(state, action, ctx);
  assert.equal(ok, true, `${JSON.stringify(action)} de ${from}: ${ok}`);
  const pronta = enquete.prepare(state, action, ctx);
  // Outro cliente (id '99') aplica: o voto e de quem esta na acao, nao dele.
  return { pronta, state: enquete.reduce(deepFreeze(state), pronta, ctxCliente('99')) };
}

function roda(state, passos) {
  const prontas = [];
  for (const [action, from, isLeader] of passos) {
    const r = servidor(state, action, from, isLeader);
    prontas.push(r.pronta);
    state = r.state;
  }
  return { state, prontas };
}

const EDIT = { kind: 'edit', question: 'Pizza ou hambúrguer?', options: ['Pizza', 'Hambúrguer', 'Os dois'] };

function aberta() {
  return roda(enquete.init({ by: '1' }), [[EDIT, '1']]).state;
}

const MALFORMADAS = [
  null, undefined, true, 'vote', [], {}, { kind: 0 }, { kind: 'constructor' }, { kind: '__proto__' },
  { kind: 'vote' }, { kind: 'vote', option: -1 }, { kind: 'vote', option: 6 }, { kind: 'vote', option: 3 },
  { kind: 'vote', option: '0' }, { kind: 'vote', option: 0.5 }, { kind: 'vote', option: NaN },
  { kind: 'edit' }, { kind: 'edit', question: 'Q' }, { kind: 'edit', question: 'Q', options: 'a,b' },
  { kind: 'edit', question: 'Q', options: ['a'] }, { kind: 'edit', question: 'Q', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
  { kind: 'edit', question: 'Q', options: ['a', ''] }, { kind: 'edit', question: 'Q', options: ['a', 2] },
  { kind: 'edit', question: 'Q', options: ['a', 'A'] }, { kind: 'edit', question: '', options: ['a', 'b'] },
  { kind: 'edit', question: 'x'.repeat(121), options: ['a', 'b'] },
  { kind: 'edit', question: 'Q', options: ['a', 'x'.repeat(41)] },
  { kind: 'edit', question: 'Q', options: ['a', 'x'.repeat(1e6)] },
];

test('init guarda quem criou e vem sem pergunta', () => {
  const s = enquete.init({ by: '7', now: 1, random: () => 0 });
  assert.deepEqual(s, { question: '', options: ['mesa.enquete.sim', 'mesa.enquete.nao'], votes: [], closed: false, createdBy: '7' });
  assert.equal(enquete.summary(s), 'Enquete sem pergunta');
  assert.equal(enquete.init({}).createdBy, null);
});

test('metadados seguem o contrato', () => {
  assert.equal(enquete.type, 'enquete');
  assert.equal(enquete.title, 'Enquete');
  assert.equal(enquete.group, 'noite');
});

test('sem pergunta ninguem vota', () => {
  const s = enquete.init({ by: '1' });
  assert.equal(enquete.validate(s, { kind: 'vote', option: 0 }, { from: '2' }), 'mesa.enquete.semPergunta');
  assert.equal(enquete.reduce(deepFreeze(s), { kind: 'vote', option: 0, by: '2' }), s);
});

test('um voto por pessoa; trocar e tirar o voto', () => {
  const { state } = roda(aberta(), [
    [{ kind: 'vote', option: 0 }, '1'],
    [{ kind: 'vote', option: 0 }, '2'],
    [{ kind: 'vote', option: 1 }, '3'],
    [{ kind: 'vote', option: 2 }, '2'],
    [{ kind: 'unvote' }, '3'],
  ]);
  assert.deepEqual(state.votes, [{ by: '1', option: 0 }, { by: '2', option: 2 }]);
  assert.deepEqual(enquete.tally(state), [1, 0, 1]);
  assert.equal(enquete.voteOf(state, '2'), 2);
  assert.equal(enquete.voteOf(state, '3'), null);
  assert.equal(enquete.summary(state), 'Pizza ou hambúrguer? Pizza 1 · Hambúrguer 0 · Os dois 1');
  assert.equal(enquete.validate(state, { kind: 'vote', option: 0 }, { from: '1' }), 'mesa.enquete.jaVotouNessa');
  assert.equal(enquete.validate(state, { kind: 'unvote' }, { from: '3' }), 'mesa.enquete.naoVotou');
});

test('prepare grava quem mandou e ignora o by do cliente', () => {
  const s = aberta();
  assert.deepEqual(
    enquete.prepare(s, { kind: 'vote', option: 1, by: '666' }, { from: '4' }),
    { kind: 'vote', option: 1, by: '4' },
  );
  assert.deepEqual(enquete.prepare(s, { kind: 'unvote', by: '666' }, { from: '4' }), { kind: 'unvote', by: '4' });
  assert.deepEqual(enquete.prepare(s, { kind: 'vote', option: 1, by: '666' }, {}), { kind: 'vote', option: 1 });
});

test('sem by na acao, reduce usa ctx.from; sem nenhum dos dois, nada muda', () => {
  const s = deepFreeze(aberta());
  assert.deepEqual(enquete.reduce(s, { kind: 'vote', option: 1 }, ctxCliente('5')).votes, [{ by: '5', option: 1 }]);
  assert.equal(enquete.reduce(s, { kind: 'vote', option: 1 }, {}), s);
  assert.equal(enquete.reduce(s, { kind: 'vote', option: 1 }), s);
});

test('editar: so quem criou ou o lider, e so sem votos', () => {
  const s = enquete.init({ by: '1' });
  assert.equal(enquete.validate(s, EDIT, { from: '2' }), 'mesa.enquete.soQuemCriouOuLider');
  assert.equal(enquete.validate(s, EDIT, { from: '2', isLeader: true }), true);
  assert.equal(enquete.validate(s, EDIT), 'mesa.enquete.soQuemCriouOuLider');
  const votada = roda(aberta(), [[{ kind: 'vote', option: 0 }, '2']]).state;
  assert.equal(enquete.validate(votada, EDIT, { from: '1' }), 'mesa.enquete.jaTemVoto');
  assert.equal(enquete.reduce(deepFreeze(votada), EDIT), votada);
  // Janela sem dono conhecido: qualquer um edita.
  assert.equal(enquete.validate(enquete.init({}), EDIT, { from: '2' }), true);
});

test('edit limpa texto e recusa opcoes repetidas', () => {
  const { state } = roda(enquete.init({ by: '1' }), [[
    { kind: 'edit', question: '  Qual\n mapa? ', options: [' Dust ', 'Mirage'] }, '1',
  ]]);
  assert.equal(state.question, 'Qual mapa?');
  assert.deepEqual(state.options, ['Dust', 'Mirage']);
  assert.equal(
    enquete.validate(state, { kind: 'edit', question: 'Q', options: ['Dust', 'dust'] }, { from: '1' }),
    'mesa.enquete.opcoesRepetidas',
  );
});

test('encerrar: quem criou ou o lider; depois ninguem vota', () => {
  const s = roda(aberta(), [[{ kind: 'vote', option: 1 }, '2']]).state;
  assert.equal(enquete.validate(s, { kind: 'close' }, { from: '2' }), 'mesa.enquete.soQuemCriouOuLider');
  const fechada = roda(s, [[{ kind: 'close' }, '3', true]]).state;
  assert.equal(fechada.closed, true);
  assert.equal(enquete.summary(fechada), 'Pizza ou hambúrguer? Pizza 0 · Hambúrguer 1 · Os dois 0 (encerrada)');
  assert.equal(enquete.validate(fechada, { kind: 'vote', option: 0 }, { from: '4' }), 'mesa.enquete.encerrada');
  assert.equal(enquete.validate(fechada, { kind: 'unvote' }, { from: '2' }), 'mesa.enquete.encerrada');
  assert.equal(enquete.validate(fechada, { kind: 'close' }, { from: '1' }), 'mesa.enquete.jaEncerrada');
  assert.equal(enquete.reduce(deepFreeze(fechada), { kind: 'vote', option: 0, by: '4' }), fechada);
  const zerada = roda(fechada, [[{ kind: 'reset' }, '1']]).state;
  assert.deepEqual([zerada.closed, zerada.votes], [false, []]);
});

test('teto de votantes', () => {
  let s = aberta();
  for (let i = 1; i <= enquete.MAX_VOTERS; i++) s = enquete.reduce(s, { kind: 'vote', option: 0, by: String(i) });
  assert.equal(s.votes.length, enquete.MAX_VOTERS);
  const extra = { kind: 'vote', option: 0 };
  assert.equal(enquete.validate(s, extra, { from: '9999' }), 'mesa.enquete.votosDemais');
  assert.equal(enquete.reduce(deepFreeze(s), { ...extra, by: '9999' }), s);
  // Quem ja votou ainda troca.
  assert.equal(enquete.validate(s, { kind: 'vote', option: 1 }, { from: '1' }), true);
});

test('acao malformada e recusada com motivo e nunca lanca', () => {
  const s = deepFreeze(aberta());
  const ctx = { from: '1', isLeader: true, now: 0, random: () => 0 };
  for (const a of MALFORMADAS) {
    const r = enquete.validate(s, a, ctx);
    assert.equal(typeof r, 'string', JSON.stringify(a));
    assert.equal(enquete.reduce(s, a, ctxCliente('1')), s, JSON.stringify(a));
    enquete.prepare(s, a, ctx);
  }
});

test('mesma sequencia preparada da o mesmo estado, sem relogio nem sorte', () => {
  const { prontas, state } = roda(enquete.init({ by: '1' }), [
    [EDIT, '1'], [{ kind: 'vote', option: 0 }, '2'], [{ kind: 'vote', option: 1 }, '3'],
    [{ kind: 'vote', option: 2 }, '2'], [{ kind: 'unvote' }, '3'], [{ kind: 'close' }, '1'],
  ]);
  const aplica = (from) => () => prontas.reduce(
    (s, a) => enquete.reduce(deepFreeze(s), a, ctxCliente(from)), enquete.init({ by: '1' }),
  );
  const a = semRelogioNemSorte(aplica('2'));
  const b = semRelogioNemSorte(aplica('3'));
  assert.deepEqual(a, b);
  assert.deepEqual(a, state);
});

test('estado no pior caso cabe em maxStateBytes', () => {
  const id = '9'.repeat(enquete.MAX_PEER_ID);
  const s = {
    question: '€'.repeat(enquete.MAX_QUESTION),
    options: Array.from({ length: enquete.MAX_OPTIONS }, () => '€'.repeat(enquete.MAX_OPTION)),
    votes: Array.from({ length: enquete.MAX_VOTERS }, () => ({ by: id, option: 5 })),
    closed: false,
    createdBy: id,
  };
  assert.ok(Buffer.byteLength(JSON.stringify(s)) <= enquete.maxStateBytes);
});

test('opções padrão viajam como código e aparecem traduzidas', () => {
  const s = enquete.init({ by: '1' });
  assert.deepEqual(s.options, ['mesa.enquete.sim', 'mesa.enquete.nao']);
  assert.ok(s.options.every((o) => i18n.existe(o)));
  assert.equal(i18n.traduzirCodigo(s.options[0]), 'Sim');
  i18n.definirIdioma('es');
  try {
    assert.equal(i18n.traduzirCodigo(s.options[0]), 'Sí');
    assert.equal(i18n.traduzirCodigo(s.options[1]), 'No');
  } finally { i18n.definirIdioma('pt-BR'); }
});
