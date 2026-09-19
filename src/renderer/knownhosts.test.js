'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PORT,
  MAX_KNOWN_HOSTS,
  isValidIPv4,
  isValidIPv6,
  normalizeAddress,
  addHost,
  removeHost,
  loadList,
  mergeRoomSources,
} = require('./knownhosts');

test('normalizeAddress: IPv4 sem porta cai no padrao do app', () => {
  const r = normalizeAddress('192.168.1.5');
  assert.deepEqual(r, { host: '192.168.1.5', port: DEFAULT_PORT, address: `192.168.1.5:${DEFAULT_PORT}` });
});

test('normalizeAddress: IPv4 com porta explicita', () => {
  const r = normalizeAddress('192.168.1.5:9007');
  assert.deepEqual(r, { host: '192.168.1.5', port: 9007, address: '192.168.1.5:9007' });
});

test('normalizeAddress: aceita ws:// e wss:// na frente (como o resto do app aceita)', () => {
  assert.equal(normalizeAddress('ws://192.168.1.5:9000').address, '192.168.1.5:9000');
  assert.equal(normalizeAddress('wss://192.168.1.5').address, `192.168.1.5:${DEFAULT_PORT}`);
});

test('normalizeAddress: IPv6 bracketed com e sem porta', () => {
  assert.deepEqual(normalizeAddress('[::1]:9000'), { host: '::1', port: 9000, address: '[::1]:9000' });
  assert.deepEqual(normalizeAddress('[::1]'), { host: '::1', port: DEFAULT_PORT, address: `[::1]:${DEFAULT_PORT}` });
});

test('normalizeAddress: IPv6 sem colchetes usa a porta padrao (nao da pra saber onde o host acaba)', () => {
  const r = normalizeAddress('fe80::1');
  assert.deepEqual(r, { host: 'fe80::1', port: DEFAULT_PORT, address: `[fe80::1]:${DEFAULT_PORT}` });
});

test('normalizeAddress: rejeita host invalido, porta fora de faixa e hostname (so IP)', () => {
  assert.equal(normalizeAddress('999.1.1.1'), null);
  assert.equal(normalizeAddress('192.168.1.5:70000'), null);
  assert.equal(normalizeAddress('192.168.1.5:0'), null);
  assert.equal(normalizeAddress('meuservidor.local'), null);
  assert.equal(normalizeAddress('192.168.01.1'), null, 'zero a esquerda e rejeitado');
  assert.equal(normalizeAddress(''), null);
  assert.equal(normalizeAddress(null), null);
  assert.equal(normalizeAddress(42), null);
});

test('isValidIPv4/isValidIPv6: sanidade basica', () => {
  assert.equal(isValidIPv4('10.0.0.1'), true);
  assert.equal(isValidIPv4('256.0.0.1'), false);
  assert.equal(isValidIPv6('2001:db8::1'), true);
  assert.equal(isValidIPv6('2001:db8:0:0:0:0:0:1'), true);
  assert.equal(isValidIPv6('nao-e-ip'), false);
});

test('addHost: normaliza, e endereco invalido nao muda a lista (mesma referencia)', () => {
  const list = [];
  const next = addHost(list, 'lixo-invalido', 1000);
  assert.equal(next, list);
});

test('addHost: dedup por endereco canonico -- so atualiza lastSeenAt', () => {
  let list = addHost([], '192.168.1.5:9000', 1000);
  list = addHost(list, 'ws://192.168.1.5:9000', 2000); // mesma maquina, escrita diferente
  assert.equal(list.length, 1);
  assert.equal(list[0].address, '192.168.1.5:9000');
  assert.equal(list[0].lastSeenAt, 2000);
});

test('addHost: um sucesso mais antigo nao regride o lastSeenAt de um mais novo', () => {
  let list = addHost([], '192.168.1.5:9000', 5000);
  list = addHost(list, '192.168.1.5:9000', 1000); // replay antigo
  assert.equal(list[0].lastSeenAt, 5000);
});

test('addHost: teto -- descarta o mais antigo quando a lista esta cheia', () => {
  let list = [];
  for (let i = 0; i < MAX_KNOWN_HOSTS; i += 1) {
    list = addHost(list, `10.0.0.${i + 1}:9000`, i); // lastSeenAt crescente: 10.0.0.1 e o mais antigo
  }
  assert.equal(list.length, MAX_KNOWN_HOSTS);
  const novo = addHost(list, '10.0.0.200:9000', MAX_KNOWN_HOSTS + 100);
  assert.equal(novo.length, MAX_KNOWN_HOSTS, 'teto nao pode crescer');
  assert.ok(!novo.some((h) => h.address === '10.0.0.1:9000'), 'o mais antigo (menor lastSeenAt) sai');
  assert.ok(novo.some((h) => h.address === '10.0.0.200:9000'), 'o novo entra');
});

test('addHost: ordem final e por ultimo sucesso, mais recente primeiro', () => {
  let list = addHost([], '10.0.0.1:9000', 1000);
  list = addHost(list, '10.0.0.2:9000', 3000);
  list = addHost(list, '10.0.0.3:9000', 2000);
  assert.deepEqual(list.map((h) => h.address), ['10.0.0.2:9000', '10.0.0.3:9000', '10.0.0.1:9000']);
});

test('removeHost: tira da lista pelo endereco (canonico ou digitado de novo)', () => {
  let list = addHost([], '10.0.0.1:9000', 1000);
  list = addHost(list, '10.0.0.2:9000', 2000);
  const next = removeHost(list, 'ws://10.0.0.1:9000');
  assert.deepEqual(next.map((h) => h.address), ['10.0.0.2:9000']);
});

test('removeHost: endereco ausente e no-op', () => {
  const list = addHost([], '10.0.0.1:9000', 1000);
  const next = removeHost(list, '10.0.0.9:9000');
  assert.deepEqual(next, list);
});

test('loadList: valida item a item, descarta o que estiver torto sem custar os outros', () => {
  const incoming = [
    { address: '10.0.0.1:9000', lastSeenAt: 1000 },
    { address: 'lixo' }, // invalido
    null, // invalido
    42, // invalido
    { address: '10.0.0.2:9000' }, // sem lastSeenAt -- cai em 0
    { address: '10.0.0.1:9000', lastSeenAt: 500 }, // duplicado, mais antigo -- nao regride
  ];
  const list = loadList(incoming);
  assert.equal(list.length, 2);
  const byAddr = Object.fromEntries(list.map((h) => [h.address, h.lastSeenAt]));
  assert.equal(byAddr['10.0.0.1:9000'], 1000);
  assert.equal(byAddr['10.0.0.2:9000'], 0);
});

test('loadList: nao-array vira lista vazia', () => {
  assert.deepEqual(loadList(undefined), []);
  assert.deepEqual(loadList('nao e array'), []);
});

test('loadList: respeita o teto mesmo vindo de config com mais de MAX_KNOWN_HOSTS entradas', () => {
  const incoming = [];
  for (let i = 0; i < MAX_KNOWN_HOSTS + 5; i += 1) {
    incoming.push({ address: `10.0.1.${i + 1}:9000`, lastSeenAt: i });
  }
  const list = loadList(incoming);
  assert.equal(list.length, MAX_KNOWN_HOSTS);
  // os 5 mais antigos (menor lastSeenAt) devem ter saido
  assert.ok(!list.some((h) => h.address === '10.0.1.1:9000'));
  assert.ok(list.some((h) => h.address === `10.0.1.${MAX_KNOWN_HOSTS + 5}:9000`));
});

test('mergeRoomSources: sem duplicar quando as duas fontes acham a mesma sala (chave IP:porta)', () => {
  const beacon = [{ name: 'sala do beacon', address: '192.168.1.5:9000', peers: 2 }];
  const probed = [{ name: 'sala da sonda (mesma maquina)', address: '192.168.1.5:9000', peers: 99 }];
  const merged = mergeRoomSources(beacon, probed);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'sala do beacon', 'beacon vence o empate');
});

test('mergeRoomSources: soma o que so a sonda achou (ex: Tailscale)', () => {
  const beacon = [{ name: 'sala A', address: '192.168.1.5:9000' }];
  const probed = [{ name: 'sala B (so a sonda achou)', address: '100.90.10.5:9000' }];
  const merged = mergeRoomSources(beacon, probed);
  assert.equal(merged.length, 2);
  assert.ok(merged.some((r) => r.address === '100.90.10.5:9000'));
});

test('mergeRoomSources: listas vazias/ausentes nao lancam', () => {
  assert.deepEqual(mergeRoomSources(undefined, undefined), []);
  assert.deepEqual(mergeRoomSources([], []), []);
});
