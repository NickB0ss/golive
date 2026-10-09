'use strict';

/*
 * Argumentos internos que o launcher passa ao main Electron. Validados com
 * rigor porque o launcher (run.js) APAGA a pasta de perfil ao sair; o main so
 * a usa como userData.
 */

const path = require('path');

const PROFILE_PREFIX = 'golive-sfu-spike-';

function valueOf(argv, name) {
  const prefix = `--${name}=`;
  const hit = (argv || []).find((a) => typeof a === 'string' && a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function parseLaunchArgs(argv, tmpdir) {
  const errors = [];
  const configPath = valueOf(argv, 'spike-config');
  const reportPath = valueOf(argv, 'spike-report');
  const profileDir = valueOf(argv, 'spike-profile');
  if (!configPath || !path.isAbsolute(configPath) || !configPath.endsWith('.json')) errors.push('--spike-config deve ser um caminho absoluto .json');
  if (!reportPath || !path.isAbsolute(reportPath) || !reportPath.endsWith('.json')) errors.push('--spike-report deve ser um caminho absoluto .json');
  if (!profileDir || !path.isAbsolute(profileDir) || !isInside(tmpdir, profileDir) || !path.basename(profileDir).startsWith(PROFILE_PREFIX)) {
    errors.push(`--spike-profile deve ficar na pasta temporaria e se chamar ${PROFILE_PREFIX}*`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors, configPath, reportPath, profileDir };
}

module.exports = { PROFILE_PREFIX, parseLaunchArgs, isInside };
