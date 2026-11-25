'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NATIVE_BUILD_FILES = [
  path.join('build', 'Release', 'golive_audio.node'),
];

// Executaveis auxiliares: ainda nao entram no pacote (P4.1), entao a ausencia
// so e informada, nunca bloqueia o `npm run dist`.
const NATIVE_OPTIONAL_FILES = [
  path.join('build', 'Release', process.platform === 'win32' ? 'golive-media.exe' : 'golive-media'),
];

function missingNativeBuilds(rootDir) {
  return NATIVE_BUILD_FILES
    .map((relativePath) => path.join(rootDir, relativePath))
    .filter((filePath) => !fs.existsSync(filePath));
}

function missingOptionalNativeBuilds(rootDir) {
  return NATIVE_OPTIONAL_FILES
    .map((relativePath) => path.join(rootDir, relativePath))
    .filter((filePath) => !fs.existsSync(filePath));
}

function beforeBuild(context) {
  const missing = missingNativeBuilds(context.appDir);
  if (missing.length > 0) {
    throw new Error(
      `Addon nativo ausente: ${missing.join(', ')}. Rode npm run build:native antes de executar npm run dist.`,
    );
  }
  // O electron-builder trata retorno falsy como "node_modules resolvido por
  // fora" e pula o install/rebuild dele (app-builder-lib/out/packager.js).
  return true;
}

module.exports = { beforeBuild, missingNativeBuilds, missingOptionalNativeBuilds };
