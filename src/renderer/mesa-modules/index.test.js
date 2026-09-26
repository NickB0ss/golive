'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const registry = require('./index');
const { jsonBytes } = require('../mesa');

function modulo(extra = {}) {
  return {
    type: 'teste',
    title: 'Teste',
    group: 'ferramentas',
    size: { w: 200, h: 100, minW: 100, minH: 50, aspect: null },
    maxStateBytes: 1024,
    init: () => ({ n: 0 }),
    validate: () => true,
    reduce: (s) => ({ n: s.n + 1 }),
    ...extra,
  };
}

test('os embutidos tela e camera e a nota de exemplo estao registrados', () => {
  const tela = registry.get('tela');
  const camera = registry.get('camera');
  assert.equal(tela.media, true);
  assert.equal(camera.media, true);
  assert.equal(tela.reduce, undefined, 'janela de midia nao tem act');
  assert.deepEqual(tela.init({ by: '7' }), { peerId: '7', kind: 'screen' });
  assert.deepEqual(camera.init({ by: '7' }), { peerId: '7', kind: 'camera' });
  assert.equal(registry.get('nota').group, 'ferramentas');
  assert.equal(registry.get('nao-existe'), null);
  assert.equal(registry.get(42), null);
});

test('nenhum arquivo da pasta quebrou ao carregar', () => {
  assert.deepEqual(registry.loadErrors.filter((e) => registry.MODULE_NAMES.includes(e.name)), []);
});

test('todo arquivo de modulo na pasta esta em MODULE_NAMES (senao o servidor nao o carrega)', () => {
  const files = fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'index.js')
    .map((f) => f.slice(0, -3))
    .filter((name) => !registry.HELPER_NAMES.includes(name));
  for (const name of files) assert.ok(registry.MODULE_NAMES.includes(name), `${name}.js fora de MODULE_NAMES`);
});

test('list poe os modulos na ordem da lista, e addable deixa tela e camera de fora', () => {
  const types = registry.list().map((m) => m.type);
  assert.ok(types.includes('tela') && types.includes('camera') && types.includes('nota'));
  const add = registry.addable().map((m) => m.type);
  assert.ok(add.includes('nota'));
  assert.ok(!add.includes('tela') && !add.includes('camera'));
  const naLista = types.filter((t) => registry.MODULE_NAMES.includes(t));
  assert.deepEqual(naLista, registry.MODULE_NAMES.filter((t) => naLista.includes(t)));
});

test('checkModule recusa o que foge do contrato', () => {
  for (const [extra, motivo] of [
    [{ type: 'Com Espaco' }, 'type'],
    [{ title: '' }, 'title'],
    [{ group: 'outro' }, 'group'],
    [{ size: { w: 100, h: 100, minW: 200, minH: 10 } }, 'size'],
    [{ size: { w: 100, h: 100, minW: 10, minH: 10, aspect: -1 } }, 'aspect'],
    [{ maxStateBytes: 0 }, 'maxStateBytes'],
    [{ init: null }, 'init'],
    [{ reduce: undefined }, 'reduce'],
    [{ prepare: 'x' }, 'prepare'],
    [{ secret: true }, 'secret sem view'],
    [{ secret: 'sim', view: () => ({}) }, 'secret'],
    [{ migrate: 1 }, 'migrate'],
    [{ timeoutAt: {} }, 'timeoutAt'],
  ]) {
    const res = registry.checkModule(modulo(extra));
    assert.equal(res.ok, false, motivo);
  }
  assert.equal(registry.checkModule(null).ok, false);
});

test('checkModule marca secret so quando o modulo tem view', () => {
  assert.equal(registry.checkModule(modulo()).module.secret, false);
  const res = registry.checkModule(modulo({ secret: true, view: (st) => st, migrate: (st) => st, timeoutAt: () => null }));
  assert.equal(res.ok, true);
  assert.equal(res.module.secret, true);
});

test('checkModule aplica o teto do estado', () => {
  assert.equal(registry.checkModule(modulo({ maxStateBytes: 10 ** 9 })).module.maxStateBytes, registry.MAX_STATE_BYTES_CAP);
  assert.equal(registry.checkModule(modulo({ maxStateBytes: 1 })).module.maxStateBytes, 64);
});

test('register aceita modulo novo e recusa invalido sem lancar', () => {
  assert.equal(registry.register(modulo({ type: 'testereg' })), true);
  assert.equal(registry.get('testereg').title, 'Teste');
  assert.equal(registry.register(modulo({ type: 'testeruim', group: 'x' })), false);
  assert.equal(registry.get('testeruim'), null);
});

test('get acha o que se registrou sozinho no mapa cru (os <script> do renderer)', () => {
  global.GoLive.mesaModules.testecru = modulo({ type: 'testecru' });
  assert.equal(registry.get('testecru').type, 'testecru');
  // Modulo quebrado no mapa cru: fica de fora e nao volta a cada get.
  global.GoLive.mesaModules.testecru2 = modulo({ type: 'testecru2', init: 1 });
  assert.equal(registry.get('testecru2'), null);
  assert.equal(global.GoLive.mesaModules.testecru2, undefined);
});

test('loadFrom pula arquivo ausente e anota o que quebra, sem lancar', () => {
  const fake = (p) => {
    if (p === '/m/bom.js') return modulo({ type: 'bom' });
    if (p === '/m/nomeerrado.js') return modulo({ type: 'outro' });
    throw new SyntaxError('Unexpected token');
  };
  fake.resolve = (p) => {
    if (p === './sumiu.js') throw Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' });
    return `/m/${p.slice(2)}`;
  };
  const antes = registry.loadErrors.length;
  assert.deepEqual(registry.loadFrom(['sumiu', 'bom', 'quebrado', 'nomeerrado'], fake), ['bom']);
  const novos = registry.loadErrors.slice(antes).map((e) => e.name);
  assert.deepEqual(novos, ['quebrado', 'nomeerrado']);
});

test('todo modulo registrado nasce com estado JSON dentro do proprio teto', () => {
  const ctx = { now: 1000, by: '1', from: '1', isLeader: true, peers: [{ id: '1', name: 'Ana' }], random: () => 0.5 };
  for (const mod of registry.list()) {
    const state = mod.init(ctx);
    assert.ok(jsonBytes(state) <= mod.maxStateBytes, `${mod.type}: estado inicial passa do teto`);
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state, `${mod.type}: estado inicial nao e JSON puro`);
  }
});

test('o registro e o mesmo pelo renderer (GoLive.mesaRegistry)', () => {
  assert.equal(global.GoLive.mesaRegistry, registry);
  assert.ok(path.basename(require.resolve('./index')) === 'index.js');
});
