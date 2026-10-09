'use strict';

/** Dados publicos do runtime, sem carregar Electron nem ler variaveis de ambiente. */
function runtimeInfo({ versions = process.versions, platform = process.platform, arch = process.arch, appVersion = null, packaged = false } = {}) {
  return {
    appVersion,
    electron: versions.electron ?? null,
    node: versions.node ?? null,
    chrome: versions.chrome ?? null,
    platform,
    arch,
    packaged,
  };
}

module.exports = { runtimeInfo };
