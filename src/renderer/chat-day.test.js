'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const uiSource = fs.readFileSync(path.join(__dirname, 'ui.js'), 'utf8');

test('separador de dia reseta agrupamento quando e inserido', () => {
  const separator = /function appendDaySeparatorIfNeeded\(ts\) \{([\s\S]*?)\n  \}/.exec(uiSource);
  assert.ok(separator, 'appendDaySeparatorIfNeeded nao encontrado em ui.js');
  assert.match(separator[1], /if \(key === lastChatDayKey\) return;/);
  assert.match(separator[1], /lastChatDayKey = key;[\s\S]*lastChatAuthorId = null;/);

  const appendEntry = /function appendEntry\(entry\) \{([\s\S]*?)\n  \}/.exec(uiSource);
  assert.ok(appendEntry, 'appendEntry nao encontrado em ui.js');
  assert.ok(
    appendEntry[1].indexOf('appendDaySeparatorIfNeeded(entry.ts)') < appendEntry[1].indexOf('appendMessage(entry)'),
    'o separador deve ser processado antes da mensagem'
  );
});
