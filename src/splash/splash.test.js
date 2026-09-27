'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'splash.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'splash.css'), 'utf8');

test('splash usa o grafo Sinal, Sora e Geist Mono com reducao de movimento', () => {
  assert.match(html, /class="brand-wire"/);
  assert.match(html, /<h1 id="splash-name">GoLive<\/h1>/);
  assert.match(css, /font-family: 'Sora'/);
  assert.match(css, /font-family: 'Geist Mono'/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /wire-draw/);
});
