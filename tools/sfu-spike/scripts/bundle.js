#!/usr/bin/env node
'use strict';

/*
 * Gera renderer/mediasoup-client.bundle.js (ignorado no git) a partir do
 * mediasoup-client instalado em node_modules. Sem bundler externo.
 *
 *   npm run bundle
 */

const fs = require('fs');
const path = require('path');
const { buildBundle } = require('../lib/bundler');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(__dirname, 'client-entry.js');
const OUT = path.join(ROOT, 'renderer', 'mediasoup-client.bundle.js');
// Pacotes que o grafo do mediasoup-client 3.24.4 inclui; mudou = revisar antes de empacotar (o bundle falha).
const EXPECTED_PACKAGES = ['@lukeed/uuid', 'awaitqueue', 'debug', 'events-alias', 'fake-mediastreamtrack', 'h264-profile-level-id', 'mediasoup-client', 'ms', 'sdp-transform'];

function main() {
  try {
    const clientPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'mediasoup-client', 'package.json'), 'utf8'));
    const code = buildBundle(ENTRY, { root: ROOT, expectPackages: EXPECTED_PACKAGES });
    fs.writeFileSync(OUT, code, 'utf8');
    console.log(`bundle: mediasoup-client ${clientPkg.version} -> ${path.relative(ROOT, OUT)} (${Math.round(code.length / 1024)} KiB)`);
    return 0;
  } catch (err) {
    console.error(`bundle falhou: ${err.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { main, OUT, EXPECTED_PACKAGES };
