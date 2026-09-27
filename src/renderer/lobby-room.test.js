'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { peopleForRoom } = require('./lobby-room');

test('peopleForRoom mostra no maximo quatro avatares e informa o restante', () => {
  const people = peopleForRoom({ peers: 6 });

  assert.equal(people.avatars.length, 4);
  assert.equal(people.extra, 2);
});

test('peopleForRoom nao inventa avatar quando o beacon nao informa pessoas', () => {
  const people = peopleForRoom({});

  assert.deepEqual(people, { avatars: [], extra: 0 });
});
