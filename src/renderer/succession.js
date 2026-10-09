'use strict';

// Adaptador Node para consumidores antigos. O navegador carrega o dominio
// canonico em ../shared/succession.js antes de app.js.
module.exports = module.require('../shared/succession');
