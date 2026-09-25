'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const aovivo = require('./aovivo');
const registry = require('./index');

test('metadados e estado inicial', () => {
  assert.equal(aovivo.type, 'aovivo');
  assert.equal(aovivo.title, 'Ao vivo (Twitch)');
  assert.equal(aovivo.group, 'assistir');
  assert.equal(aovivo.prepare, undefined, 'ao vivo nao tem relogio');
  assert.equal(registry.checkModule(aovivo).ok, true);
  assert.deepEqual(aovivo.init({}), { channel: null });
});

test('set aceita link ou nome e guarda em minusculas', () => {
  let s = aovivo.init({});
  assert.equal(aovivo.validate(s, { kind: 'set', url: 'https://www.twitch.tv/Gaules' }), true);
  s = aovivo.reduce(s, { kind: 'set', url: 'https://www.twitch.tv/Gaules' }, { from: '1' });
  assert.deepEqual(s, { channel: 'gaules' });
  assert.equal(aovivo.validate(s, { kind: 'set', channel: 'GAULES' }), 'Já é esse canal');
  s = aovivo.reduce(s, { kind: 'set', channel: 'alanzoka' }, { from: '1' });
  assert.deepEqual(s, { channel: 'alanzoka' });
  s = aovivo.reduce(s, { kind: 'clear' }, { from: '1' });
  assert.deepEqual(s, { channel: null });
  assert.equal(aovivo.validate(s, { kind: 'clear' }), 'Nenhum canal');
});

test('recusa canal invalido e acao malformada', () => {
  const s = aovivo.init({});
  for (const ruim of [null, {}, { kind: 'set' }, { kind: 'set', channel: 'ab' }, { kind: 'set', url: 'https://example.com/x' }, { kind: 'play' }]) {
    assert.notEqual(aovivo.validate(s, ruim), true, JSON.stringify(ruim));
    assert.equal(aovivo.reduce(s, ruim, {}), s);
  }
});

test('playerUrl leva o parent e escapa o que precisa', () => {
  assert.equal(aovivo.playerUrl('gaules', 'localhost'), 'https://player.twitch.tv/?channel=gaules&parent=localhost&autoplay=true&muted=false');
  assert.match(aovivo.playerUrl('gaules', 'a b'), /parent=localhost/);
  assert.equal(aovivo.summary({ channel: 'x_y' }), 'twitch.tv/x_y');
  assert.equal(aovivo.summary({ channel: null }), 'Nenhum canal');
});
