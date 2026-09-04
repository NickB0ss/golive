'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isScreenSource, indexSourceDisplays, boundsFor } = require('./overlay');

const DISPLAYS = [
  { id: 2528732444, bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
  { id: 2779098405, bounds: { x: 2560, y: 0, width: 1920, height: 1080 } },
];

test('isScreenSource separa tela de janela', () => {
  assert.equal(isScreenSource('screen:0:0'), true);
  assert.equal(isScreenSource('window:1180244:0'), false);
  assert.equal(isScreenSource(''), false);
  assert.equal(isScreenSource(null), false);
  assert.equal(isScreenSource(undefined), false);
});

test('indexSourceDisplays casa cada tela com o display pelo display_id', () => {
  // O `<n>` do id `screen:<n>:0` NAO e o id de display -- e por isso que o
  // casamento sai do campo display_id, e nao de parsear a string.
  const sources = [
    { id: 'screen:0:0', display_id: '2779098405' },
    { id: 'screen:1:0', display_id: '2528732444' },
  ];
  const index = indexSourceDisplays(sources, DISPLAYS);
  assert.equal(index.get('screen:0:0'), '2779098405');
  assert.equal(index.get('screen:1:0'), '2528732444');
  assert.equal(index.size, 2);
});

test('indexSourceDisplays deixa janela de fora', () => {
  const sources = [
    { id: 'window:1180244:0', display_id: '' },
    { id: 'screen:0:0', display_id: '2528732444' },
  ];
  const index = indexSourceDisplays(sources, DISPLAYS);
  assert.deepEqual([...index.keys()], ['screen:0:0']);
});

test('indexSourceDisplays ignora tela sem display_id ou com display desconhecido', () => {
  const sources = [
    { id: 'screen:0:0', display_id: '' },
    { id: 'screen:1:0' },
    { id: 'screen:2:0', display_id: null },
    { id: 'screen:3:0', display_id: '999999' }, // monitor que sumiu da lista
  ];
  assert.equal(indexSourceDisplays(sources, DISPLAYS).size, 0);
});

test('indexSourceDisplays aguenta entrada torta sem lancar', () => {
  assert.equal(indexSourceDisplays(null, DISPLAYS).size, 0);
  assert.equal(indexSourceDisplays([], null).size, 0);
  assert.equal(indexSourceDisplays([null, undefined], DISPLAYS).size, 0);
});

test('boundsFor devolve o retangulo do display escolhido', () => {
  assert.deepEqual(boundsFor('2779098405', DISPLAYS), { x: 2560, y: 0, width: 1920, height: 1080 });
  // Compara como texto: o id vem numero do Electron e string do display_id.
  assert.deepEqual(boundsFor(2528732444, DISPLAYS), { x: 0, y: 0, width: 2560, height: 1440 });
});

test('boundsFor devolve null quando o display sumiu entre a escolha e o ao vivo', () => {
  // Monitor desligado, notebook desencaixado da dock: nao ha o que cobrir, e
  // a transmissao segue sem overlay em vez de quebrar.
  assert.equal(boundsFor('999999', DISPLAYS), null);
  assert.equal(boundsFor(null, DISPLAYS), null);
  assert.equal(boundsFor('2528732444', null), null);
  assert.equal(boundsFor('2528732444', []), null);
});

test('boundsFor recusa retangulo sem tamanho ou com numero torto', () => {
  const tortos = [
    { id: 1, bounds: { x: 0, y: 0, width: 0, height: 1080 } },
    { id: 2, bounds: { x: 0, y: 0, width: 1920, height: -5 } },
    { id: 3, bounds: { x: 0, y: 0, width: NaN, height: 1080 } },
    { id: 4, bounds: { x: '0', y: 0, width: 1920, height: 1080 } },
    { id: 5 },
  ];
  for (const d of tortos) {
    assert.equal(boundsFor(d.id, tortos), null, `display ${d.id} nao devia virar bounds`);
  }
});
