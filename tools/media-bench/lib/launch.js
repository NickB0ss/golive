'use strict';

/*
 * Argumentos que o launcher (run.js) passa ao main Electron. Separado do
 * parse do usuario (config.js): estes tres sao internos e validados com rigor
 * porque o main apaga a pasta de perfil ao sair.
 */

const path = require('path');

const PROFILE_PREFIX = 'golive-media-bench-';

function valueOf(argv, name) {
  const prefix = `--${name}=`;
  const hit = (argv || []).find((a) => typeof a === 'string' && a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * @returns {{ ok: boolean, errors: string[], configPath?: string, reportPath?: string, profileDir?: string }}
 */
function parseLaunchArgs(argv, tmpdir) {
  const errors = [];
  const configPath = valueOf(argv, 'bench-config');
  const reportPath = valueOf(argv, 'bench-report');
  const profileDir = valueOf(argv, 'bench-profile');
  if (!configPath || !path.isAbsolute(configPath) || !configPath.endsWith('.json')) {
    errors.push('--bench-config deve ser um caminho absoluto .json');
  }
  if (!reportPath || !path.isAbsolute(reportPath) || !reportPath.endsWith('.json')) {
    errors.push('--bench-report deve ser um caminho absoluto .json');
  }
  if (!profileDir || !path.isAbsolute(profileDir)
    || !isInside(tmpdir, profileDir) || !path.basename(profileDir).startsWith(PROFILE_PREFIX)) {
    errors.push(`--bench-profile deve ficar na pasta temporaria e se chamar ${PROFILE_PREFIX}*`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors, configPath, reportPath, profileDir };
}

module.exports = { PROFILE_PREFIX, parseLaunchArgs, isInside };
