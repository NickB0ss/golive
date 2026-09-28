'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const yt = require('./youtube');
const registry = require('./index');

const ID = 'dQw4w9WgXcQ';
const ID2 = 'M7lc1UVf-VE';

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

// O ctx do reduce e so { from, isLeader }: ler hora ou sorte e defeito.
const ctxCliente = {
  from: '1', isLeader: false,
  get now() { throw new Error('reduce leu o relogio'); },
  get random() { throw new Error('reduce leu a sorte'); },
};

/** Faz o papel do servidor: validate na acao crua, prepare com a hora, reduce. */
function servidor(state, action, now) {
  const ctx = { from: '1', isLeader: false, peers: [{ id: '1', name: 'Ana' }], now, random: () => 0.5 };
  assert.equal(yt.validate(state, action, ctx), true, JSON.stringify(action));
  const pronta = yt.prepare(state, action, ctx);
  const { now: dn } = Date;
  Date.now = () => { throw new Error('reduce leu Date.now'); };
  try {
    return { pronta, state: yt.reduce(deepFreeze(state), pronta, ctxCliente) };
  } finally {
    Date.now = dn;
  }
}

test('metadados seguem o contrato e o registro aceita', () => {
  assert.equal(yt.type, 'youtube');
  assert.equal(yt.title, 'Vídeo do YouTube');
  assert.equal(yt.group, 'assistir');
  assert.equal(yt.size.aspect, 16 / 9);
  assert.equal(registry.checkModule(yt).ok, true);
  assert.equal(registry.get('youtube').title, 'Vídeo do YouTube');
  assert.deepEqual(yt.init({ now: 5 }), { videoId: null, playing: false, pos: 0, at: null, rate: 1 });
});

test('load poe o video tocando do t= do link, na hora do servidor', () => {
  let s = yt.init({});
  const r = servidor(s, { kind: 'load', url: `https://youtu.be/${ID}?t=30` }, 1000);
  assert.deepEqual(r.pronta, { kind: 'load', videoId: ID, start: 30, at: 1000 });
  s = r.state;
  assert.deepEqual(s, { videoId: ID, playing: true, pos: 30, at: 1000, rate: 1 });
  assert.equal(yt.positionAt(s, 4000), 33);
  // videoId cru tambem vale; trocar de video recomeca
  s = servidor(s, { kind: 'load', videoId: ID2 }, 9000).state;
  assert.deepEqual(s, { videoId: ID2, playing: true, pos: 0, at: 9000, rate: 1 });
});

test('prepare ignora a hora do cliente e deixa passar a malformada', () => {
  const s = yt.init({});
  assert.deepEqual(yt.prepare(s, { kind: 'load', videoId: ID, at: 1 }, { now: 50 }), { kind: 'load', videoId: ID, start: 0, at: 50 });
  assert.deepEqual(yt.prepare(s, { kind: 'load', videoId: ID, at: 1 }, {}), { kind: 'load', videoId: ID, start: 0 });
  const ruim = { kind: 'nada' };
  assert.equal(yt.prepare(s, ruim, { now: 1 }), ruim);
});

test('pause usa a posicao de quem clicou, ou a do relogio', () => {
  let s = servidor(yt.init({}), { kind: 'load', videoId: ID }, 0).state;
  let r = servidor(s, { kind: 'pause', pos: 4.2 }, 5000);
  assert.deepEqual(r.state, { videoId: ID, playing: false, pos: 4.2, at: 5000, rate: 1 });
  assert.equal(yt.positionAt(r.state, 99999), 4.2);
  s = servidor(r.state, { kind: 'play' }, 8000).state;
  assert.deepEqual(s, { videoId: ID, playing: true, pos: 4.2, at: 8000, rate: 1 });
  r = servidor(s, { kind: 'pause' }, 10000);
  assert.equal(r.state.pos, 6.2);
  s = servidor(r.state, { kind: 'play', pos: 1 }, 11000).state;
  assert.equal(yt.positionAt(s, 12000), 2);
});

test('seek pula e mantem tocando ou pausado', () => {
  let s = servidor(yt.init({}), { kind: 'load', videoId: ID }, 0).state;
  s = servidor(s, { kind: 'seek', pos: 120 }, 1000).state;
  assert.deepEqual(s, { videoId: ID, playing: true, pos: 120, at: 1000, rate: 1 });
  s = servidor(s, { kind: 'pause' }, 2000).state;
  s = servidor(s, { kind: 'seek', pos: 10 }, 3000).state;
  assert.deepEqual(s, { videoId: ID, playing: false, pos: 10, at: 3000, rate: 1 });
});

test('ended e idempotente e ignora o fim de outro video', () => {
  let s = servidor(yt.init({}), { kind: 'load', videoId: ID }, 0).state;
  const outro = servidor(s, { kind: 'ended', videoId: ID2, pos: 3 }, 1000).state;
  assert.equal(outro, s, 'fim de outro video nao mexe');
  s = servidor(s, { kind: 'ended', videoId: ID, pos: 212 }, 212000).state;
  assert.deepEqual(s, { videoId: ID, playing: false, pos: 212, at: 212000, rate: 1 });
  const de_novo = servidor(s, { kind: 'ended', videoId: ID, pos: 212.3 }, 212400).state;
  assert.equal(de_novo, s, 'segundo aviso de fim nao mexe');
});

test('validate recusa o que nao faz sentido', () => {
  const vazio = yt.init({});
  assert.equal(yt.validate(vazio, { kind: 'play' }), 'Nenhum vídeo');
  assert.equal(yt.validate(vazio, { kind: 'load', url: 'https://example.com' }), 'Link do YouTube não reconhecido');
  const tocando = servidor(vazio, { kind: 'load', videoId: ID }, 0).state;
  assert.equal(yt.validate(tocando, { kind: 'play' }), 'Já está tocando');
  assert.equal(yt.validate({ ...tocando, playing: false }, { kind: 'pause' }), 'Já está pausado');
  for (const ruim of [
    null, [], 'play', {}, { kind: 5 }, { kind: '__proto__' }, { kind: 'seek' }, { kind: 'seek', pos: -1 },
    { kind: 'seek', pos: 'x' }, { kind: 'seek', pos: Infinity }, { kind: 'pause', pos: NaN }, { kind: 'play', pos: 1e9 },
    { kind: 'ended', videoId: 'curto' }, { kind: 'load' }, { kind: 'load', videoId: 'x'.repeat(11) + '!' },
  ]) {
    assert.notEqual(yt.validate(tocando, ruim), true, JSON.stringify(ruim));
    assert.equal(yt.reduce(tocando, ruim, ctxCliente), tocando);
  }
});

test('reduce sem a hora do prepare nao mexe (o cliente nunca inventa hora)', () => {
  const s = yt.init({});
  assert.equal(yt.reduce(s, { kind: 'load', videoId: ID }, ctxCliente), s);
});

test('dois clientes aplicando o mesmo eco chegam ao mesmo estado', () => {
  const passos = [
    [{ kind: 'load', url: `https://www.youtube.com/watch?v=${ID}` }, 100],
    [{ kind: 'pause', pos: 3.3 }, 3500],
    [{ kind: 'seek', pos: 60 }, 4000],
    [{ kind: 'play' }, 5000],
  ];
  let serv = yt.init({});
  const ecos = [];
  for (const [a, now] of passos) {
    const r = servidor(serv, a, now);
    ecos.push(r.pronta);
    serv = r.state;
  }
  const cliente = ecos.reduce((s, a) => yt.reduce(s, JSON.parse(JSON.stringify(a)), ctxCliente), yt.init({}));
  assert.deepEqual(cliente, serv);
  assert.equal(yt.positionAt(cliente, 7000), 62);
});

test('summary', () => {
  assert.equal(yt.summary(yt.init({})), 'Nenhum vídeo');
  const s = { videoId: ID, playing: true, pos: 60, at: 0, rate: 1 };
  assert.equal(yt.summary(s, 5000), 'Tocando · 1:05');
  assert.equal(yt.summary({ ...s, playing: false }, 5000), 'Pausado · 1:00');
});
