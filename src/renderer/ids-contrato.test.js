'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const idsContratados = require('./ids-contrato.json');
const IDS_DINAMICOS = new Set([
  'settings-language',
  'settings-language-note',
]);

function idsDoArquivo(arquivo) {
  const fonte = fs.readFileSync(path.join(__dirname, arquivo), 'utf8');
  return new Set([...fonte.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
}

test('o renderer preserva os ids do contrato', () => {
  const idsDoIndex = idsDoArquivo('index.html');
  const idsDoUi = idsDoArquivo('ui.js');
  const sumidosDoIndex = idsContratados.filter((id) => !IDS_DINAMICOS.has(id) && !idsDoIndex.has(id));
  const sumidosDoUi = [...IDS_DINAMICOS].filter((id) => !idsDoUi.has(id));

  assert.deepEqual(sumidosDoIndex, [], `ids removidos do index.html: ${sumidosDoIndex.join(', ')}`);
  assert.deepEqual(sumidosDoUi, [], `ids dinamicos removidos do ui.js: ${sumidosDoUi.join(', ')}`);
});
