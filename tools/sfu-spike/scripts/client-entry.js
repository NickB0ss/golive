'use strict';

// Entrada do bundle do navegador: expoe o mediasoup-client em um global unico.
// So este arquivo conhece o pacote; a pagina usa globalThis.SfuSpikeClient.
const client = require('mediasoup-client');

globalThis.SfuSpikeClient = { Device: client.Device, version: client.version };
