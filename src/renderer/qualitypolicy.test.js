'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { screenSenderLoad, normalizeEncodeHealth } = require('./qualitypolicy');
const config = require('./config');
const tree = require('./tree');

function peer(kinds = [], suspended = {}) {
  return { suspended, outConns: Object.fromEntries(kinds.map((kind) => [kind, {
    getSenders: () => [{ track: { kind: 'video', readyState: 'live' } }],
  }])) };
}

test('membros ociosos nao custam encode; plano e sender atual sao deduplicados', () => {
  for (const members of [4, 6]) {
    const peers = new Map(Array.from({ length: members }, (_, i) => [String(i), peer()]));
    peers.set('0', peer(['screen']));
    const assignments = new Map([...peers.keys()].map((id) => [id, {
      role: id === '0' ? 'relay' : 'folha',
    }]));
    const load = screenSenderLoad({ peers, localScreen: true, assignments });
    assert.equal(load.total, 1);
    assert.equal(config.qualityForLoad('1080p60', load.total).preset, '1080p60');
  }
});

test('tres ofertas planejadas desce antes de stats e antes de existir PC', () => {
  const peers = new Map(['a', 'b', 'c'].map((id) => [id, peer()]));
  const load = screenSenderLoad({ peers, localScreen: true });
  assert.equal(load.total, 3);
  assert.equal(config.qualityForLoad('1080p60', load.total).preset, '1080p30');
});

test('suspensao desejada exclui sender ainda com track; resume inclui sender ainda sem track', () => {
  const p = peer(['screen'], { screen: true });
  const peers = new Map([['a', p]]);
  assert.equal(screenSenderLoad({ peers, localScreen: true }).total, 0);
  p.outConns.screen.getSenders = () => [{ track: null }];
  p.suspended.screen = false;
  assert.equal(screenSenderLoad({ peers, localScreen: true }).total, 1);
  assert.equal(screenSenderLoad({ peers, localScreen: false }).total, 0);
});

test('relay paga filhos aqui, nao folhas atendidas por outro dispositivo nem camera', () => {
  const peers = new Map(['a', 'b', 'c'].map((id) => [id, peer(['camera'])]));
  peers.get('a').outConns['screen@origem1'] = peer(['screen']).outConns.screen;
  const relays = new Map([
    ['origem1', { role: 'relay', filhosIds: ['a', 'b'] }],
    ['origem2', { role: 'relay', filhosIds: ['a'] }],
    ['origem3', { role: 'folha', filhosIds: [] }],
  ]);
  const load = screenSenderLoad({ peers, relays });
  assert.equal(load.total, 3);
  assert.equal(load.byKind.get('screen@origem1'), 2);
  assert.equal(load.byKind.get('screen@origem2'), 1);
  peers.get('b').suspended['screen@origem1'] = true;
  assert.equal(screenSenderLoad({ peers, relays }).total, 2);
});

test('upstream continua contando enquanto relay alimenta descendants mesmo sem looking', () => {
  const p = { ...peer(['screen']), looking: false };
  const peers = new Map([['relay', p], ['folha', peer()]]);
  const assignments = new Map([
    ['relay', { role: 'relay', filhosIds: ['folha'] }],
    ['folha', { role: 'folha' }],
  ]);
  assert.equal(screenSenderLoad({ peers, localScreen: true, assignments }).total, 1);
  p.suspended.screen = true;
  assert.equal(screenSenderLoad({ peers, localScreen: true, assignments }).total, 0);
});

test('dois senders reais na mesma PC custam dois, plano nao soma terceiro', () => {
  const p = peer(['screen']);
  const sender = { track: { kind: 'video', readyState: 'live' } };
  p.outConns.screen.getSenders = () => [sender, sender, { ...sender }, { track: { kind: 'audio' } }];
  assert.equal(screenSenderLoad({ peers: new Map([['a', p]]), localScreen: true }).total, 2);
});

test('origem definitivamente encerrada nao planeja repasse; primeira oferta e recuperacao continuam planejadas', () => {
  const peers = new Map([
    ['origem', { ...peer(), live: true }], ['a', peer()], ['b', peer()],
  ]);
  const relays = new Map([['origem', { role: 'relay', filhosIds: ['a', 'b'], relayed: new Set() }]]);
  assert.equal(screenSenderLoad({ peers, relays }).total, 2, 'antes da primeira PC/stats');
  peers.get('origem').inStreams = {};
  assert.equal(screenSenderLoad({ peers, relays }).total, 2, 'falha transitoria preserva plano');
  peers.get('origem').live = false;
  assert.equal(screenSenderLoad({ peers, relays }).total, 0, 'fim definitivo elimina plano antigo');
});

test('normalizacao conserva load valido sem exigir campo de clientes antigos', () => {
  assert.equal(normalizeEncodeHealth({ msPerFrame: 20, load: 0.6 }).load, 0.6);
  assert.equal(normalizeEncodeHealth({ msPerFrame: 20, load: NaN }).load, null);
  assert.equal(normalizeEncodeHealth(null), null);
});

test('20ms a 30FPS tem folga, 20ms a 60FPS e penalizado; load tem precedencia', () => {
  for (const field of [{ fps: 30 }, { budgetMs: 1000 / 30 }, { load: 0.6, fps: 60 }]) {
    const candidates = [
      { id: '30', joinedAt: 2, rtt: 10, encodeHealth: { msPerFrame: 20, ...field } },
      { id: '60', joinedAt: 1, rtt: 1, encodeHealth: { msPerFrame: 20, fps: 60, load: 1.2 } },
    ];
    assert.equal(tree.computeTree('origem', candidates).get('30').role, 'relay');
  }
});
