'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;

test('overlay contem somente a lousa e pinta os tracos na cor de quem enviou', () => {
  const html = fs.readFileSync(path.join(root, 'overlay.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'overlay.js'), 'utf8');
  assert.match(html, /<canvas id="lousa"><\/canvas>/);
  assert.doesNotMatch(html, /<(?:header|button|input|video)\b/i);
  assert.match(script, /const cor = annotate\.colorFor\(item\.from\)/);
  assert.doesNotMatch(script, /const cor = annotate\.colorOf\(item\)/);
});
