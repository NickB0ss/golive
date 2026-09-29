'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const idsContratados = require('./ids-contrato.json');

test('index.html preserva os ids do contrato', () => {
  const indexPath = path.join(__dirname, 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const idsAtuais = new Set([...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const sumidos = idsContratados.filter((id) => !idsAtuais.has(id));

  assert.deepEqual(sumidos, [], `ids removidos do index.html: ${sumidos.join(', ')}`);
});
