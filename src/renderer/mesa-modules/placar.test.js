'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const placar = require('./placar');

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

// ctx de cliente: sem hora e sem sorte. Ler qualquer um dos dois lanca.
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
    assert.equal(placar.validate(state, a, ctxCliente), true, JSON.stringify(a));
    state = placar.reduce(deepFreeze(state), a, ctxCliente);
  }
  return state;
}

const MALFORMADAS = [
  null, undefined, 0, 42, 'score', [], {}, { kind: 5 }, { kind: '' },
  { kind: 'constructor' }, { kind: '__proto__' }, { kind: 'toString' },
  { kind: 'score' }, { kind: 'score', team: 0 }, { kind: 'score', team: 0, delta: 2 },
  { kind: 'score', team: '0', delta: 1 }, { kind: 'score', team: -1, delta: 1 },
  { kind: 'score', team: 1.5, delta: 1 }, { kind: 'score', team: NaN, delta: 1 },
  { kind: 'score', team: Infinity, delta: 1 }, { kind: 'score', team: 0, delta: '1' },
  { kind: 'rename', team: 0 }, { kind: 'rename', team: 0, name: 7 },
  { kind: 'rename', team: 0, name: '   ' }, { kind: 'rename', team: 0, name: 'x'.repeat(25) },
  { kind: 'rename', team: 0, name: 'x'.repeat(10000) }, { kind: 'rename', team: 9, name: 'A' },
  { kind: 'teams', count: 1 }, { kind: 'teams', count: 5 }, { kind: 'teams', count: '3' },
  { kind: 'bestOf', n: 4 }, { kind: 'bestOf', n: 1 }, { kind: 'bestOf', n: 23 },
  { kind: 'bestOf', n: '3' }, { kind: 'bestOf' },
];

test('init comeca com dois times zerados e sem serie', () => {
  assert.deepEqual(placar.init({}), {
    teams: [{ name: 'Azul', score: 0 }, { name: 'Vermelho', score: 0 }],
    bestOf: null,
  });
});

test('metadados seguem o contrato', () => {
  assert.equal(placar.type, 'placar');
  assert.equal(placar.title, 'Placar');
  assert.equal(placar.group, 'noite');
  assert.ok(placar.size.w >= placar.size.minW && placar.size.h >= placar.size.minH);
  assert.equal(typeof placar.maxStateBytes, 'number');
});

test('+1 e -1 mexem no time certo e o resumo mostra o placar', () => {
  const s = aplica(placar.init({}), [
    { kind: 'score', team: 0, delta: 1 },
    { kind: 'score', team: 0, delta: 1 },
    { kind: 'score', team: 1, delta: 1 },
    { kind: 'score', team: 0, delta: 1 },
    { kind: 'score', team: 0, delta: -1 },
  ]);
  assert.deepEqual(s.teams.map((t) => t.score), [2, 1]);
  assert.equal(placar.summary(s), 'Azul 2 × 1 Vermelho');
});

test('placar nunca fica negativo', () => {
  const s = placar.init({});
  const a = { kind: 'score', team: 0, delta: -1 };
  assert.equal(placar.validate(s, a, ctxCliente), 'O placar não fica negativo');
  assert.equal(placar.reduce(deepFreeze(s), a, ctxCliente).teams[0].score, 0);
});

test('placar tem teto', () => {
  let s = placar.init({});
  s = { ...s, teams: [{ name: 'A', score: placar.MAX_SCORE }, s.teams[1]] };
  const a = { kind: 'score', team: 0, delta: 1 };
  assert.equal(placar.validate(s, a, ctxCliente), 'Placar no máximo');
  assert.equal(placar.reduce(deepFreeze(s), a, ctxCliente).teams[0].score, placar.MAX_SCORE);
});

test('renomear limpa espacos e caracteres de controle', () => {
  const s = aplica(placar.init({}), [{ kind: 'rename', team: 1, name: '  Os\nBrabos\t ' }]);
  assert.equal(s.teams[1].name, 'Os Brabos');
});

test('nome no teto passa; um a mais e recusado', () => {
  const s = placar.init({});
  assert.equal(placar.validate(s, { kind: 'rename', team: 0, name: 'x'.repeat(placar.MAX_NAME) }), true);
  assert.equal(
    placar.validate(s, { kind: 'rename', team: 0, name: 'x'.repeat(placar.MAX_NAME + 1) }),
    `Nome longo demais (máx. ${placar.MAX_NAME})`,
  );
});

test('zerar mantem os nomes', () => {
  const s = aplica(placar.init({}), [
    { kind: 'rename', team: 0, name: 'Nós' },
    { kind: 'score', team: 0, delta: 1 },
    { kind: 'reset' },
  ]);
  assert.deepEqual(s.teams, [{ name: 'Nós', score: 0 }, { name: 'Vermelho', score: 0 }]);
});

test('ate quatro times; tirar time corta os ultimos', () => {
  let s = aplica(placar.init({}), [{ kind: 'teams', count: 4 }, { kind: 'score', team: 3, delta: 1 }]);
  assert.deepEqual(s.teams.map((t) => t.name), ['Azul', 'Vermelho', 'Verde', 'Amarelo']);
  assert.equal(placar.summary(s), 'Azul 0 · Vermelho 0 · Verde 0 · Amarelo 1');
  s = aplica(s, [{ kind: 'teams', count: 3 }]);
  assert.equal(s.teams.length, 3);
  assert.equal(placar.validate(s, { kind: 'score', team: 3, delta: 1 }), 'Time inválido');
  assert.equal(placar.reduce(deepFreeze(s), { kind: 'score', team: 3, delta: 1 }), s);
});

test('melhor de 3 fecha em 2 vitorias e trava o +1', () => {
  const s = aplica(placar.init({}), [
    { kind: 'bestOf', n: 3 },
    { kind: 'score', team: 1, delta: 1 },
    { kind: 'score', team: 0, delta: 1 },
  ]);
  assert.equal(placar.summary(s), 'Azul 1 × 1 Vermelho (melhor de 3)');
  const fim = aplica(s, [{ kind: 'score', team: 1, delta: 1 }]);
  assert.equal(placar.winner(fim), 1);
  assert.equal(placar.summary(fim), 'Azul 1 × 2 Vermelho — Vermelho venceu');
  assert.equal(placar.validate(fim, { kind: 'score', team: 0, delta: 1 }), 'A série acabou; zere para recomeçar');
  assert.equal(placar.reduce(deepFreeze(fim), { kind: 'score', team: 0, delta: 1 }), fim);
  // -1 continua valendo (corrigir engano) e zerar recomeca.
  assert.equal(placar.validate(fim, { kind: 'score', team: 1, delta: -1 }), true);
  assert.equal(placar.winner(aplica(fim, [{ kind: 'reset' }])), -1);
  assert.equal(aplica(fim, [{ kind: 'bestOf', n: null }]).bestOf, null);
});

test('acao malformada e recusada com motivo e nunca lanca', () => {
  const s = deepFreeze(placar.init({}));
  for (const a of MALFORMADAS) {
    const r = placar.validate(s, a, ctxCliente);
    assert.equal(typeof r, 'string', JSON.stringify(a));
    assert.ok(r.length > 0);
    assert.equal(placar.reduce(s, a, ctxCliente), s, JSON.stringify(a));
  }
});

test('reduce e deterministico e nao le relogio nem sorte', () => {
  const acoes = [
    { kind: 'teams', count: 3 }, { kind: 'bestOf', n: 5 },
    { kind: 'score', team: 2, delta: 1 }, { kind: 'rename', team: 2, name: 'Roxo' },
    { kind: 'score', team: 0, delta: 1 }, { kind: 'score', team: 0, delta: -1 },
    { kind: 'reset' }, { kind: 'score', team: 1, delta: 1 },
  ];
  const a = semRelogioNemSorte(() => aplica(placar.init({}), acoes));
  const b = semRelogioNemSorte(() => aplica(placar.init({}), acoes));
  assert.deepEqual(a, b);
});

test('estado no pior caso cabe em maxStateBytes', () => {
  const nome = '€'.repeat(placar.MAX_NAME); // 3 bytes por unidade em UTF-8
  const s = {
    teams: Array.from({ length: placar.MAX_TEAMS }, () => ({ name: nome, score: placar.MAX_SCORE })),
    bestOf: placar.MAX_BEST_OF,
  };
  assert.ok(Buffer.byteLength(JSON.stringify(s)) <= placar.maxStateBytes);
});
