'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

/** Compara apenas arquivos locais: a resolucao do Node pode usar o repo pai. */
function checkEnvironment(rootDir, { checkBinary = false } = {}) {
  const root = path.resolve(rootDir);
  const diagnostics = [];
  const electron = { declared: null, locked: null, installed: null, binaryChecked: checkBinary };
  const add = (code, message, details = {}) => diagnostics.push({ code, message, ...details });
  const readJson = (file, code, details = {}) => {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('objeto JSON esperado');
      return value;
    } catch (err) {
      add(code, `Nao foi possivel ler ${file}: ${err.message}`, details);
      return null;
    }
  };
  const manifest = readJson('package.json', 'MANIFEST_INVALID');
  const lock = readJson('package-lock.json', 'LOCK_INVALID');
  const result = () => ({ ok: diagnostics.length === 0, rootDir: root, electron, diagnostics });
  if (!manifest || !lock) return result();
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages || typeof lock.packages !== 'object' || !lock.packages['']) {
    add('LOCK_INVALID', 'O lock precisa conter packages e seu manifesto raiz (lockfileVersion 2 ou 3).');
    return result();
  }

  for (const field of ['name', 'version', 'dependencies', 'devDependencies', 'optionalDependencies', 'engines']) {
    const expected = manifest[field] ?? (field.endsWith('Dependencies') || field === 'dependencies' || field === 'engines' ? {} : null);
    const actual = lock.packages[''][field] ?? (typeof expected === 'object' ? {} : null);
    if (!isDeepStrictEqual(expected, actual)) {
      add('LOCK_ROOT_MISMATCH', `O campo ${field} do manifesto diverge da raiz do lock.`, { field, expected, actual });
    }
  }

  const declared = { ...manifest.devDependencies, ...manifest.dependencies, ...manifest.optionalDependencies };
  electron.declared = declared.electron ?? null;
  electron.locked = lock.packages['node_modules/electron']?.version ?? null;
  for (const name of Object.keys(declared)) {
    const packagePath = `node_modules/${name}/package.json`;
    const expected = lock.packages[`node_modules/${name}`]?.version;
    if (typeof expected !== 'string' || !expected) {
      add('LOCK_PACKAGE_MISSING', `O lock nao tem versao resolvida para ${name}.`, { package: name });
    }
    const localPath = path.join(root, packagePath);
    if (!fs.existsSync(localPath)) {
      add('PACKAGE_MISSING', `Pacote local ausente: ${name}. Rode npm ci --ignore-scripts nesta pasta.`, { package: name });
      continue;
    }
    const installed = readJson(packagePath, 'PACKAGE_INVALID', { package: name });
    if (!installed) continue;
    if (name === 'electron') electron.installed = installed.version ?? null;
    if (expected && installed.version !== expected) {
      add('PACKAGE_VERSION_MISMATCH', `${name}: instalado ${installed.version ?? '(sem versao)'}, lock ${expected}.`, {
        package: name, expected, actual: installed.version ?? null,
      });
    }
  }

  if (checkBinary) {
    const dir = path.join(root, 'node_modules/electron');
    try {
      const executable = fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim();
      const dist = path.join(dir, 'dist');
      const binary = path.resolve(dist, executable);
      // O caminho gravado pelo instalador deve apontar para dentro de dist.
      const relative = path.relative(dist, binary);
      if (!executable || relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(binary).isFile()) {
        throw new Error('caminho do executavel invalido');
      }
      const actual = fs.readFileSync(path.join(dist, 'version'), 'utf8').trim().replace(/^v/, '');
      if (actual !== electron.locked) {
        add('ELECTRON_BINARY_VERSION_MISMATCH', 'A versao do binario do Electron diverge do lock.', { expected: electron.locked, actual });
      }
    } catch (err) {
      add('ELECTRON_BINARY_MISSING', `Binario do Electron indisponivel: ${err.message}. Rode node node_modules/electron/install.js.`);
    }
  }
  return result();
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--binary')) {
    console.error('Uso: npm run env:check -- [--binary]');
    process.exitCode = 1;
  } else {
    const result = checkEnvironment(process.cwd(), { checkBinary: args.includes('--binary') });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  }
}

module.exports = { checkEnvironment };
