'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NATIVE_BUILD_FILES = [
  path.join('build', 'Release', 'golive_audio.node'),
];

function missingNativeBuilds(rootDir) {
  return NATIVE_BUILD_FILES
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

module.exports = { beforeBuild, missingNativeBuilds };
