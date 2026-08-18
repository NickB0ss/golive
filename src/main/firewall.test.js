// src/main/firewall.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ensureFirewallRule } = require('./firewall');

function fakeExec(script) {
  const calls = [];
  const exec = async (cmd) => {
    calls.push(cmd);
    return script(cmd, calls.length);
  };
  return { exec, calls };
}

test('nao pede elevacao se a regra ja cobre a porta', async () => {
  const { exec, calls } = fakeExec((cmd) => {
    if (cmd.includes('show rule')) {
      return { stdout: 'Rule Name: GoLive\nLocalPort: 9000\n' };
    }
    throw new Error('nao deveria chamar Start-Process');
  });

  const result = await ensureFirewallRule(9000, { exec });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
});

test('eleva e confirma quando a regra nao existe', async () => {
  let created = false;
  const { exec } = fakeExec((cmd) => {
    if (cmd.includes('show rule')) {
      return created
        ? { stdout: 'Rule Name: GoLive\nLocalPort: 9000\n' }
        : { stdout: 'No rules match the specified criteria.\n' };
    }
    if (cmd.includes('Start-Process')) {
      created = true;
      return { stdout: '' };
    }
    throw new Error(`comando inesperado: ${cmd}`);
  });

  const result = await ensureFirewallRule(9000, { exec });
  assert.deepEqual(result, { ok: true });
});

test('devolve comando manual quando a elevacao falha', async () => {
  const { exec } = fakeExec((cmd) => {
    if (cmd.includes('show rule')) return { stdout: 'No rules match the specified criteria.\n' };
    if (cmd.includes('Start-Process')) throw new Error('UAC cancelado');
    throw new Error(`comando inesperado: ${cmd}`);
  });

  const result = await ensureFirewallRule(9000, { exec });
  assert.equal(result.ok, false);
  assert.match(result.manualCommand, /netsh advfirewall firewall add rule name="GoLive".*localport=9000/);
  assert.match(result.manualCommand, /profile=private,domain/);
  assert.match(result.manualCommand, /program="/);
});
