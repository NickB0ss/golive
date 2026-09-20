'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MAX_CHAT_MESSAGES, pruneChatMessages } = require('./chatlimit');

function line(kind) {
  return {
    matches: (selector) => selector.includes(`.${kind}`),
    remove() { this.removed = true; },
  };
}

test('pruneChatMessages remove somente as mensagens mais antigas acima do teto', () => {
  const nodes = Array.from({ length: MAX_CHAT_MESSAGES + 2 }, () => line('chat-line'));
  const container = {
    querySelectorAll(selector) {
      return nodes.filter((node) => !node.removed && node.matches(selector));
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
  };

  assert.equal(pruneChatMessages(container), 2);
  assert.equal(container.querySelectorAll('.chat-line, .chat-sys').length, MAX_CHAT_MESSAGES);
  assert.equal(nodes[0].removed, true);
  assert.equal(nodes[1].removed, true);
  assert.equal(nodes.at(-1).removed, undefined);
});
