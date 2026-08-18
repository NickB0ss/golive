'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { listAddresses, pickAddress } = require('./network');

const fakeInterfaces = {
  'Ethernet': [{ family: 'IPv4', internal: false, address: '192.168.0.14' }],
  'Radmin VPN': [{ family: 'IPv4', internal: false, address: '26.13.45.201' }],
  'Loopback': [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
  'Tailscale': [{ family: 'IPv4', internal: false, address: '100.90.10.5' }],
};

test('listAddresses ignora loopback e classifica radmin/tailscale/lan', () => {
  const list = listAddresses(fakeInterfaces);
  assert.equal(list.length, 3);
  const byAddress = Object.fromEntries(list.map((a) => [a.address, a.kind]));
  assert.equal(byAddress['192.168.0.14'], 'lan');
  assert.equal(byAddress['26.13.45.201'], 'radmin');
  assert.equal(byAddress['100.90.10.5'], 'tailscale');
});

test('pickAddress prioriza radmin sobre tailscale e lan', () => {
  const picked = pickAddress(fakeInterfaces);
  assert.equal(picked.address, '26.13.45.201');
  assert.equal(picked.kind, 'radmin');
});

test('pickAddress devolve null quando so ha loopback', () => {
  const picked = pickAddress({ Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] });
  assert.equal(picked, null);
});
