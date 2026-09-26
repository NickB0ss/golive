'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jam = require('./jam');
const { jsonBytes } = require('../mesa');

/** Congela tudo, ate o fundo: `reduce` que mutar o estado lanca (strict). */
function gelar(v) {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) gelar(v[k]);
    Object.freeze(v);
  }
  return v;
}

const CURTO = 'https://spotify.link/AbCdEf12345';
const ABERTO = 'https://open.spotify.com/socialsession/5ae7c0f6e1b24d9a';

test('link do Jam: os dois formatos, na forma canonica', () => {
  assert.equal(jam.parseJamUrl(CURTO), CURTO);
  assert.equal(jam.parseJamUrl(`  ${CURTO}  `), CURTO);
  assert.equal(jam.parseJamUrl(`${CURTO}/`), CURTO);
  assert.equal(jam.parseJamUrl(`${CURTO}?si=xyz#topo`), CURTO);
  assert.equal(jam.parseJamUrl('HTTPS://SPOTIFY.LINK/AbCdEf12345'), CURTO);
  assert.equal(jam.parseJamUrl('https://spotify.link:443/AbCdEf12345'), CURTO); // a porta padrao some
  assert.equal(jam.parseJamUrl(ABERTO), ABERTO);
  assert.equal(jam.parseJamUrl(`${ABERTO}?si=abc&context=x`), ABERTO);
  assert.equal(jam.parseJamUrl('https://open.spotify.com/intl-pt/socialsession/5ae7c0f6e1b24d9a'), ABERTO);
  assert.equal(jam.parseJamUrl('https://open.spotify.com/socialsession/1234abcd-5678-efab-9012-abcdef123456'),
    'https://open.spotify.com/socialsession/1234abcd-5678-efab-9012-abcdef123456');
});

test('link do Jam: o resto e recusado', () => {
  for (const ruim of [
    'spotify.link/AbCdEf12345', // sem esquema
    'http://spotify.link/AbCdEf12345',
    'https://user:pw@spotify.link/AbCdEf12345',
    'https://spotify.link:8443/AbCdEf12345',
    'https://spotify.link/',
    'https://spotify.link/ab', // curto demais
    'https://spotify.link/AbC/def',
    'https://spotify.link/AbC%2Fdef12',
    'https://spotify.link./AbCdEf12345',
    'https://spotify.link.evil.com/AbCdEf12345',
    'https://evil.com/spotify.link/AbCdEf12345',
    'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', // musica, nao Jam
    'https://open.spotify.com/socialsession/',
    'https://open.spotify.com/socialsession/abc', // id curto
    'https://open.spotify.com/socialsession/abc$def12',
    'https://open.spotify.com/socialsession/5ae7c0f6e1b24d9a/extra',
    'https://spotify.com/socialsession/5ae7c0f6e1b24d9a',
    'https://open.spotify.com.evil/socialsession/5ae7c0f6e1b24d9a',
    `https://spotify.link/AbCdEf12345 ${'x'}`,
    'https://spotify.link/Ab\nCdEf12345',
    'javascript:alert(1)',
    'spotify:socialsession:5ae7c0f6e1b24d9a',
    `https://spotify.link/${'a'.repeat(400)}`,
    '', 5, null, undefined, {},
  ]) {
    assert.equal(jam.parseJamUrl(ruim), null, String(ruim));
  }
});

test('nasce vazio', () => {
  assert.deepEqual(jam.init({}), { link: null, by: null, joined: [], rev: 0 });
  assert.equal(jam.summary(jam.init({})), 'Nenhum Jam ainda');
});

test('colar, entrar, sair, tirar: sem mutar o anterior', () => {
  const s0 = gelar(jam.init({}));
  const s1 = gelar(jam.reduce(s0, { kind: 'set', url: `${CURTO}?si=1` }, { from: '1' }));
  assert.deepEqual(s1, { link: CURTO, by: '1', joined: ['1'], rev: 1 });
  const s2 = gelar(jam.reduce(s1, gelar({ kind: 'join' }), { from: '2' }));
  assert.deepEqual(s2.joined, ['1', '2']);
  assert.equal(jam.summary(s2), 'Jam aberto · 2 pessoas entraram');
  const s3 = gelar(jam.reduce(s2, { kind: 'leave' }, { from: '1' }));
  assert.deepEqual(s3.joined, ['2']);
  assert.equal(jam.summary(s3), 'Jam aberto · 1 pessoa entrou');
  // Jam novo: a lista recomeca.
  const s4 = gelar(jam.reduce(s3, { kind: 'set', url: ABERTO }, { from: '3' }));
  assert.deepEqual(s4, { link: ABERTO, by: '3', joined: ['3'], rev: 4 });
  const s5 = jam.reduce(s4, { kind: 'clear' }, { from: '2' });
  assert.deepEqual(s5, { link: null, by: null, joined: [], rev: 5 });
});

test('validate da os motivos', () => {
  const s0 = jam.init({});
  const s1 = jam.reduce(s0, { kind: 'set', url: CURTO }, { from: '1' });
  assert.equal(jam.validate(s0, { kind: 'set', url: CURTO }, { from: '1' }), true);
  assert.match(jam.validate(s0, { kind: 'set', url: 'https://example.com/' }, { from: '1' }), /link do Jam/);
  assert.equal(typeof jam.validate(s1, { kind: 'set', url: `${CURTO}?si=2` }, { from: '2' }), 'string');
  assert.equal(typeof jam.validate(s0, { kind: 'join' }, { from: '2' }), 'string');
  assert.equal(typeof jam.validate(s0, { kind: 'clear' }, { from: '2' }), 'string');
  assert.equal(jam.validate(s1, { kind: 'join' }, { from: '2' }), true);
  assert.equal(typeof jam.validate(s1, { kind: 'join' }, { from: '1' }), 'string');
  assert.equal(jam.validate(s1, { kind: 'leave' }, { from: '1' }), true);
  assert.equal(typeof jam.validate(s1, { kind: 'leave' }, { from: '2' }), 'string');
  for (const ruim of [null, 5, [], {}, { kind: 'play' }, { kind: 5 }]) {
    assert.equal(typeof jam.validate(s1, ruim, { from: '1' }), 'string');
    assert.equal(jam.reduce(s1, ruim, { from: '1' }), s1);
  }
});

test('reduce repete as checagens de forma (entrar duas vezes, sem Jam, sem quem)', () => {
  const s0 = jam.init({});
  assert.equal(jam.reduce(s0, { kind: 'join' }, { from: '2' }), s0);
  const s1 = jam.reduce(s0, { kind: 'set', url: CURTO }, { from: '1' });
  assert.equal(jam.reduce(s1, { kind: 'join' }, { from: '1' }), s1);
  assert.equal(jam.reduce(s1, { kind: 'join' }, {}), s1);
  assert.equal(jam.reduce(s1, { kind: 'leave' }, { from: '9' }), s1);
  assert.equal(jam.reduce(s0, { kind: 'set', url: 'https://evil.com/' }, { from: '1' }), s0);
});

test('lista cheia e o pior estado cabem no teto', () => {
  let s = jam.reduce(jam.init({}), { kind: 'set', url: 'https://open.spotify.com/socialsession/' + 'a'.repeat(64) }, { from: '9'.repeat(16) });
  for (let i = 0; s.joined.length < jam.MAX_JOINED; i++) s = jam.reduce(s, { kind: 'join' }, { from: String(1e15 + i) });
  assert.equal(s.joined.length, jam.MAX_JOINED);
  assert.equal(typeof jam.validate(s, { kind: 'join' }, { from: '5' }), 'string');
  assert.equal(jam.reduce(s, { kind: 'join' }, { from: '5' }), s);
  assert.ok(jsonBytes(s) <= jam.maxStateBytes, `${jsonBytes(s)} bytes`);
});

test('dropPeer tira quem saiu da sala; quem nao estava, nada muda', () => {
  const s1 = jam.reduce(jam.reduce(jam.init({}), { kind: 'set', url: CURTO }, { from: '1' }), { kind: 'join' }, { from: '2' });
  const s2 = jam.dropPeer(gelar(s1), '1');
  assert.deepEqual(s2.joined, ['2']);
  assert.equal(jam.dropPeer(s2, '7'), s2);
});

test('deterministico: a mesma sequencia da o mesmo estado', () => {
  const seq = [
    [{ kind: 'set', url: CURTO }, '1'], [{ kind: 'join' }, '2'], [{ kind: 'join' }, '3'],
    [{ kind: 'leave' }, '2'], [{ kind: 'set', url: ABERTO }, '2'], [{ kind: 'join' }, '1'],
  ];
  const rodar = () => seq.reduce((s, [a, from]) => jam.reduce(s, a, { from }), jam.init({}));
  assert.deepEqual(rodar(), rodar());
  assert.deepEqual(rodar(), { link: ABERTO, by: '2', joined: ['2', '1'], rev: 6 });
});

test('esta no registro, no grupo assistir', () => {
  const reg = require('./index');
  assert.ok(reg.MODULE_NAMES.includes('jam'));
  const m = reg.get('jam');
  assert.equal(m.title, 'Spotify Jam');
  assert.equal(m.group, 'assistir');
});
