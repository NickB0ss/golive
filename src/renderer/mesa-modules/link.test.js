'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const link = require('./link');
const { jsonBytes } = require('../mesa');
const { linkDaMesa, dominioPublico } = require('../../main/linksexternos');

function gelar(v) {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) gelar(v[k]);
    Object.freeze(v);
  }
  return v;
}

test('parseLink: site https, normalizado', () => {
  assert.deepEqual(link.parseLink('https://example.com'), { url: 'https://example.com/', host: 'example.com' });
  assert.deepEqual(link.parseLink('  HTTPS://Pt.Wikipedia.org/wiki/Brasil#Hist  '), { url: 'https://pt.wikipedia.org/wiki/Brasil#Hist', host: 'pt.wikipedia.org' });
  // Dominio com acento vira punycode: e o que a janela mostra e confirma.
  assert.deepEqual(link.parseLink('https://pão.com.br/'), { url: 'https://xn--po-sia.com.br/', host: 'xn--po-sia.com.br' });
  assert.equal(link.parseLink('https://example.com:443/').url, 'https://example.com/');
});

test('parseLink: o resto e recusado', () => {
  for (const ruim of [
    'example.com', 'www.example.com/x', 'http://example.com/', 'ftp://example.com/', 'javascript:alert(1)',
    'data:text/html,oi', 'file:///C:/Windows/', 'https://user:pw@example.com/', 'https://user@example.com/',
    'https://example.com:8080/', 'https://127.0.0.1/', 'https://[::1]/', 'https://192.168.0.10/', 'https://3232235521/',
    'https://localhost/', 'https://app.localhost/', 'https://nas.local/', 'https://roteador/', 'https://example.123/',
    'https://exa mple.com/', 'https://example.com/a\tb', 'https://example.com\\@evil.com/', 'https://-x.com/',
    'https://example.com./', `https://example.com/${'a'.repeat(2100)}`, '', '   ', null, 5, {},
  ]) {
    assert.equal(link.parseLink(ruim), null, String(ruim));
  }
});

test('o modulo e o processo principal concordam', () => {
  for (const url of [
    'https://example.com/', 'https://pt.wikipedia.org/wiki/Brasil', 'http://example.com/', 'https://user@example.com/',
    'https://example.com:8443/', 'https://localhost/', 'https://10.0.0.1/', 'https://x.lan/', 'https://example.com./',
    'https://xn--po-sia.com.br/', 'https://a.b.c.d.example.co.uk/x?y=1#z', `https://example.com/${'a'.repeat(2100)}`,
  ]) {
    const l = link.parseLink(url);
    assert.equal(l ? l.url : null, linkDaMesa('link', url), url);
  }
  for (const h of ['example.com', 'com', 'localhost', '10.0.0.1', 'x.lan', 'a..b', '-a.com', 'xn--po-sia.com.br']) {
    assert.equal(link.dominioPublico(h), dominioPublico(h), h);
  }
});

test('colar, trocar o titulo, tirar: sem mutar o anterior', () => {
  const s0 = gelar(link.init({}));
  assert.equal(link.summary(s0), 'Nenhum link ainda');
  const s1 = gelar(link.reduce(s0, gelar({ kind: 'set', url: 'https://example.com/a', title: '  Regras\n do  jogo ' }), { from: '2' }));
  assert.deepEqual(s1, { url: 'https://example.com/a', host: 'example.com', title: 'Regras do jogo', by: '2', rev: 1 });
  assert.equal(link.summary(s1), 'Regras do jogo (example.com)');
  const s2 = gelar(link.reduce(s1, { kind: 'set', url: 'https://example.com/a', title: '' }, { from: '1' }));
  assert.equal(s2.title, null);
  assert.equal(link.summary(s2), 'example.com');
  const s3 = link.reduce(s2, { kind: 'clear' }, { from: '1' });
  assert.deepEqual(s3, { url: null, host: null, title: null, by: null, rev: 3 });
});

test('validate da os motivos; reduce ignora o que nao passa', () => {
  const s0 = link.init({});
  const s1 = link.reduce(s0, { kind: 'set', url: 'https://example.com/' }, { from: '1' });
  assert.equal(link.validate(s0, { kind: 'set', url: 'https://example.com/' }), true);
  assert.match(link.validate(s0, { kind: 'set', url: 'http://example.com/' }), /https/);
  assert.match(link.validate(s0, { kind: 'set', url: 'https://example.com/', title: 'x'.repeat(81) }), /Título/);
  assert.equal(link.validate(s0, { kind: 'set', url: 'https://example.com/', title: 'x'.repeat(80) }), true);
  assert.equal(link.validate(s0, { kind: 'set', url: 'https://example.com/', title: '😀'.repeat(80) }), true);
  assert.equal(typeof link.validate(s0, { kind: 'set', url: 'https://example.com/', title: 5 }), 'string');
  assert.equal(typeof link.validate(s1, { kind: 'set', url: 'https://example.com' }), 'string'); // igual
  assert.equal(link.validate(s1, { kind: 'set', url: 'https://example.com', title: 'Outro' }), true);
  assert.equal(typeof link.validate(s0, { kind: 'clear' }), 'string');
  for (const ruim of [null, [], 5, {}, { kind: 'open' }, { kind: 'set' }]) {
    assert.equal(typeof link.validate(s1, ruim), 'string');
    assert.equal(link.reduce(s1, ruim, { from: '1' }), s1);
  }
});

test('o pior estado cabe no teto', () => {
  const url = `https://${'a'.repeat(60)}.example.com/${'b'.repeat(1900)}`;
  const s = link.reduce(link.init({}), { kind: 'set', url, title: '"'.repeat(40) + '😀'.repeat(40) }, { from: '9'.repeat(16) });
  assert.ok(s.url, 'aceitou o endereco grande');
  assert.ok(jsonBytes(s) <= link.maxStateBytes, `${jsonBytes(s)} bytes`);
});

test('deterministico e no registro, no grupo ferramentas', () => {
  const seq = [[{ kind: 'set', url: 'https://a.com/' }, '1'], [{ kind: 'set', url: 'https://b.com/', title: 'B' }, '2'], [{ kind: 'clear' }, '1'], [{ kind: 'set', url: 'https://c.com/' }, '2']];
  const rodar = () => seq.reduce((s, [a, from]) => link.reduce(s, a, { from }), link.init({}));
  assert.deepEqual(rodar(), rodar());
  assert.deepEqual(rodar(), { url: 'https://c.com/', host: 'c.com', title: null, by: '2', rev: 4 });
  const reg = require('./index');
  assert.ok(reg.MODULE_NAMES.includes('link'));
  assert.equal(reg.get('link').group, 'ferramentas');
  assert.equal(reg.get('link').title, 'Link');
});
