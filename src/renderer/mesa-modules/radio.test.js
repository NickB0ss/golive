'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const radio = require('./radio');
const registry = require('./index');
const { jsonBytes } = require('../mesa');

const A = 'dQw4w9WgXcQ';
const B = 'M7lc1UVf-VE';
const C = 'aaaaaaaaaaa';

const PEERS3 = [{ id: '1', name: 'Ana' }, { id: '2', name: 'Bia' }, { id: '3', name: 'Caio' }];

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

/** Servidor: validate (acao crua) -> prepare -> reduce com ctx de cliente. */
function servidor(state, action, { from = '1', isLeader = false, now = 1000, peers = PEERS3 } = {}) {
  const ctx = { from, isLeader, peers, now, random: () => 0.5 };
  const ok = radio.validate(state, action, ctx);
  if (ok !== true) return { denied: ok, state };
  const pronta = JSON.parse(JSON.stringify(radio.prepare(state, action, ctx)));
  const ctxReduce = {
    from, isLeader,
    get now() { throw new Error('reduce leu o relogio'); },
    get peers() { throw new Error('reduce leu ctx.peers (so o servidor tem)'); },
  };
  return { pronta, state: radio.reduce(deepFreeze(state), pronta, ctxReduce) };
}

function roda(state, passos) {
  for (const [action, opts] of passos) {
    const r = servidor(state, action, opts);
    assert.equal(r.denied, undefined, `${JSON.stringify(action)}: ${r.denied}`);
    state = r.state;
  }
  return state;
}

test('metadados, registro e estado inicial', () => {
  assert.equal(radio.type, 'radio');
  assert.equal(radio.title, 'Rádio da sala');
  assert.equal(radio.group, 'assistir');
  assert.equal(registry.checkModule(radio).ok, true);
  assert.deepEqual(radio.init({}), { current: null, queue: [], playing: false, pos: 0, at: null, rate: 1, votes: [], failed: [], seq: 0 });
});

test('a primeira musica ja toca; as outras entram na fila com o nome de quem pos', () => {
  let s = radio.init({});
  let r = servidor(s, { kind: 'add', url: `https://music.youtube.com/watch?v=${A}`, name: 'falso' }, { from: '2', now: 500 });
  assert.equal(r.pronta.name, 'Bia', 'o nome vem da sala, nao do cliente');
  s = r.state;
  assert.deepEqual(s.current, { id: 'r1', videoId: A, title: '', by: '2', name: 'Bia' });
  assert.equal(s.playing, true);
  assert.equal(s.at, 500);
  s = roda(s, [[{ kind: 'add', url: `https://youtu.be/${B}?t=10` }, { from: '3' }], [{ kind: 'add', url: C }, {}]]);
  assert.deepEqual(s.queue.map((it) => [it.id, it.videoId, it.by]), [['r2', B, '3'], ['r3', C, '1']]);
  assert.equal(radio.positionAt(s, 2500), 2);
});

test('ended avanca so uma vez (cada PC avisa) e usa o t= da proxima', () => {
  let s = roda(radio.init({}), [[{ kind: 'add', url: A }], [{ kind: 'add', url: `https://youtu.be/${B}?t=10` }]]);
  const r = servidor(s, { kind: 'ended', videoId: A, id: 'r1' }, { now: 200000 });
  s = r.state;
  assert.equal(s.current.videoId, B);
  assert.equal(s.pos, 10);
  assert.equal(s.at, 200000);
  assert.equal(s.playing, true);
  const atrasado = servidor(s, { kind: 'ended', videoId: A, id: 'r1' }, { now: 200300 }).state;
  assert.equal(atrasado, s, 'o fim da anterior nao pula a atual');
  // fim da ultima: para e esvazia
  s = servidor(s, { kind: 'ended', videoId: B }, { now: 300000 }).state;
  assert.equal(s.current, null);
  assert.equal(s.playing, false);
});

test('a mesma musica duas vezes seguidas: o id impede pular a repeticao', () => {
  let s = roda(radio.init({}), [[{ kind: 'add', url: A }], [{ kind: 'add', url: A }]]);
  s = servidor(s, { kind: 'ended', videoId: A, id: 'r1' }).state;
  assert.equal(s.current.id, 'r2');
  const atrasado = servidor(s, { kind: 'ended', videoId: A, id: 'r1' }).state;
  assert.equal(atrasado.current.id, 'r2');
});

test('failed pula e marca a que nao deixa tocar fora do YouTube', () => {
  let s = roda(radio.init({}), [[{ kind: 'add', url: A }], [{ kind: 'add', url: B }]]);
  s = roda(s, [[{ kind: 'title', id: 'r1', title: 'Musica A' }]]);
  s = servidor(s, { kind: 'failed', videoId: A, id: 'r1' }, { now: 5000 }).state;
  assert.equal(s.current.videoId, B);
  assert.deepEqual(s.failed, [{ videoId: A, title: 'Musica A' }]);
  const de_novo = servidor(s, { kind: 'failed', videoId: A, id: 'r1' }).state;
  assert.equal(de_novo, s, 'idempotente');
});

test('skip e remove: quem pos ou o lider', () => {
  let s = roda(radio.init({}), [[{ kind: 'add', url: A }, { from: '2' }], [{ kind: 'add', url: B }, { from: '2' }], [{ kind: 'add', url: C }, { from: '3' }]]);
  assert.equal(servidor(s, { kind: 'skip' }, { from: '3' }).denied, 'Só quem pôs ou o líder pula; vote para pular');
  assert.equal(servidor(s, { kind: 'remove', id: 'r2' }, { from: '3' }).denied, 'Só quem pôs ou o líder tira');
  s = servidor(s, { kind: 'remove', id: 'r3' }, { from: '3' }).state;
  assert.deepEqual(s.queue.map((it) => it.id), ['r2']);
  s = servidor(s, { kind: 'skip' }, { from: '2', now: 7000 }).state;
  assert.equal(s.current.id, 'r2');
  assert.equal(s.pos, 0);
  assert.equal(s.at, 7000);
  // lider tira a atual: avanca (fila vazia -> nada)
  s = servidor(s, { kind: 'remove', id: 'r2' }, { from: '9', isLeader: true }).state;
  assert.equal(s.current, null);
  assert.equal(servidor(s, { kind: 'remove', id: 'r2' }).denied, 'Essa música já saiu');
});

test('vote-skip: maioria das pessoas da sala, contada no servidor', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(radio.votesNeeded), [1, 2, 2, 3, 3]);
  let s = roda(radio.init({}), [[{ kind: 'add', url: A }, { from: '1' }], [{ kind: 'add', url: B }, { from: '1' }]]);
  let r = servidor(s, { kind: 'vote-skip', need: 1 }, { from: '2' });
  assert.equal(r.pronta.need, 2, 'need do cliente nao vale');
  s = r.state;
  assert.deepEqual(s.votes, ['2']);
  assert.equal(s.current.videoId, A);
  assert.equal(servidor(s, { kind: 'vote-skip' }, { from: '2' }).denied, 'Você já votou');
  s = servidor(s, { kind: 'vote-skip' }, { from: '3', now: 9000 }).state;
  assert.equal(s.current.videoId, B, '2 de 3 pula');
  assert.deepEqual(s.votes, [], 'votos zeram na troca');
});

test('vote-skip: voto de quem saiu da sala nao conta mais', () => {
  let s = roda(radio.init({}), [[{ kind: 'add', url: A }], [{ kind: 'add', url: B }]]);
  const quatro = [...PEERS3, { id: '4', name: 'Duda' }];
  s = servidor(s, { kind: 'vote-skip' }, { from: '4', peers: quatro }).state;
  s = servidor(s, { kind: 'vote-skip' }, { from: '2', peers: quatro }).state;
  assert.deepEqual(s.votes, ['4', '2'], '2 de 4 ainda nao e maioria');
  // A Duda saiu: sobram 3, precisa de 2, mas o voto dela caiu.
  s = servidor(s, { kind: 'vote-skip' }, { from: '3', peers: PEERS3 }).state;
  assert.equal(s.current.videoId, B);
});

test('move reordena a fila', () => {
  let s = roda(radio.init({}), [[{ kind: 'add', url: A }], [{ kind: 'add', url: A }], [{ kind: 'add', url: B }], [{ kind: 'add', url: C }]]);
  s = servidor(s, { kind: 'move', id: 'r4', to: 0 }).state;
  assert.deepEqual(s.queue.map((it) => it.id), ['r4', 'r2', 'r3']);
  s = servidor(s, { kind: 'move', id: 'r4', to: 49 }).state;
  assert.deepEqual(s.queue.map((it) => it.id), ['r2', 'r3', 'r4']);
  assert.equal(servidor(s, { kind: 'move', id: 'r1', to: 0 }).denied, 'Essa música não está na fila');
});

test('play e pause com o relogio do servidor', () => {
  let s = roda(radio.init({}), [[{ kind: 'add', url: A }, { now: 0 }]]);
  s = servidor(s, { kind: 'pause' }, { now: 30000 }).state;
  assert.equal(s.playing, false);
  assert.equal(s.pos, 30);
  assert.equal(servidor(s, { kind: 'pause' }).denied, 'Já está pausado');
  s = servidor(s, { kind: 'play' }, { now: 40000 }).state;
  assert.equal(radio.positionAt(s, 41000), 31);
  assert.equal(servidor(radio.init({}), { kind: 'play' }).denied, 'Nada para tocar');
});

test('title so preenche vazio', () => {
  let s = roda(radio.init({}), [[{ kind: 'add', url: A }], [{ kind: 'title', id: 'r1', title: ' Primeiro\n titulo ' }]]);
  assert.equal(s.current.title, 'Primeiro titulo');
  const antes = s;
  s = servidor(s, { kind: 'title', id: 'r1', title: 'Outro' }).state;
  assert.equal(s, antes);
});

test('fila cheia em 50, e o estado cheio cabe no teto do registro', () => {
  let s = radio.init({});
  for (let i = 0; i <= radio.MAX_QUEUE; i++) {
    s = roda(s, [[{ kind: 'add', url: A }, { from: 'peer-com-id-longo-000000000000' }]]);
    s = roda(s, [[{ kind: 'title', id: `r${i + 1}`, title: 'T'.repeat(radio.MAX_TITLE) }]]);
  }
  assert.equal(s.queue.length, radio.MAX_QUEUE);
  assert.equal(servidor(s, { kind: 'add', url: B }).denied, 'Fila cheia (máx. 50)');
  assert.ok(jsonBytes(s) <= registry.get('radio').maxStateBytes, `estado cheio: ${jsonBytes(s)} bytes`);
});

test('malformadas: validate recusa e reduce nao mexe', () => {
  const s = roda(radio.init({}), [[{ kind: 'add', url: A }]]);
  for (const ruim of [
    null, [], 'add', {}, { kind: 'add' }, { kind: 'add', url: 'https://example.com' }, { kind: 'remove', id: 'x' },
    { kind: 'move', id: 'r1', to: -1 }, { kind: 'move', id: 'r1', to: 1.5 }, { kind: 'failed', videoId: 'x' },
    { kind: 'ended' }, { kind: 'title', id: 'r1', title: '' }, { kind: 'pause', pos: -3 }, { kind: 'nada' },
  ]) {
    assert.notEqual(radio.validate(s, ruim, { from: '1' }), true, JSON.stringify(ruim));
    assert.equal(radio.reduce(s, ruim, { from: '1' }), s);
  }
});

test('summary', () => {
  assert.equal(radio.summary(radio.init({})), 'Fila vazia');
  let s = roda(radio.init({}), [[{ kind: 'add', url: A }, { now: 0 }], [{ kind: 'add', url: B }], [{ kind: 'title', id: 'r1', title: 'Hino' }]]);
  assert.equal(radio.summary(s, 65000), 'Tocando: Hino · 1:05 · +1 na fila');
});
