'use strict';

/*
 * Empacotador minimo de CommonJS para o mediasoup-client, so para esta prova
 * de conceito. Existe para NAO acrescentar um bundler (esbuild/webpack) como
 * dependencia: o mediasoup-client 3.24.4 e suas dependencias sao CommonJS puro
 * (o `lib/` e saida do tsc), entao basta resolver os `require()` literais,
 * embrulhar cada arquivo numa funcao e juntar tudo num script classico.
 *
 * Limites assumidos (falham com mensagem, nao em silencio):
 *  - so `require('literal')`; require dinamico nao e resolvido;
 *  - so CommonJS: arquivo com `import`/`export` no inicio de linha e recusado;
 *  - modulos nativos do Node nao existem no navegador. O unico alias e
 *    `events` / `node:events` -> pacote `events-alias`. Na versao atual o
 *    mediasoup-client ja pede `require('events-alias')` direto, entao o alias
 *    nao e usado hoje; fica como rede de seguranca para versoes futuras;
 *  - a resolucao de pacotes PARA em <raiz>/node_modules (a raiz do spike): uma
 *    dependencia ausente nao e pega do node_modules do app, acima;
 *  - formas de package.json que poderiam empacotar o build de Node sem erro
 *    (`browser` em forma de objeto, `exports` so de condicoes, `exports` sem a
 *    entrada pedida) FALHAM com mensagem, em vez de cair em `main`;
 *  - `expectPackages` (opcional) trava a lista de pacotes do grafo.
 */

const fs = require('fs');
const path = require('path');

/** Pedidos que o navegador nao tem, mapeados para um pacote equivalente instalado (rede de seguranca). */
const BROWSER_ALIASES = { 'node:events': 'events-alias', events: 'events-alias' };

const REQUIRE_RE = /(?<![\w$.])require\(\s*(['"])([^'"\n]+)\1\s*\)/g;
const ESM_RE = /^\s*(import\s[^(]|export\s+(default|const|function|class|\{|\*))/m;

function scanRequires(source) {
  const found = new Set();
  let m;
  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(source)) !== null) found.add(m[2]);
  return [...found];
}

function tryFile(base, io) {
  const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
  for (const c of candidates) {
    try {
      if (io.statSync(c).isFile()) return c;
    } catch { /* proximo candidato */ }
  }
  return null;
}

function readJson(file, io) {
  try {
    return JSON.parse(io.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Condicoes aceitas, na ORDEM em que o package.json as escreve (como o Node faz); `import`, `types` e `node` ficam de fora. */
const CONDITIONS = ['browser', 'require', 'default'];

function pickCondition(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    for (const item of v) {
      const r = pickCondition(item);
      if (r) return r;
    }
    return null;
  }
  if (v && typeof v === 'object') {
    for (const key of Object.keys(v)) {
      if (!CONDITIONS.includes(key)) continue;
      const r = pickCondition(v[key]);
      if (r) return r;
    }
  }
  return null;
}

/** Entrada de `exports` para o subcaminho; null se o pacote nao tem `exports`. Lanca nas formas ambiguas. */
function exportsEntry(pkg, sub, name = pkg.name) {
  const ex = pkg.exports;
  if (ex === undefined || ex === null) return null;
  if (typeof ex === 'string' || Array.isArray(ex)) {
    if (sub !== '.') throw new Error(`${name}: exports nao define o subcaminho ${sub}`);
    const picked = pickCondition(ex);
    if (!picked) throw new Error(`${name}: exports sem condicao browser/require/default`);
    return picked;
  }
  if (typeof ex !== 'object') throw new Error(`${name}: exports em formato desconhecido`);
  const keys = Object.keys(ex);
  if (!keys.some((k) => k.startsWith('.'))) {
    throw new Error(`${name}: exports so de condicoes (sem chave "."); o empacotador recusa para nao cair no build de Node`);
  }
  if (keys.some((k) => !k.startsWith('.'))) throw new Error(`${name}: exports mistura subcaminhos e condicoes`);
  if (!Object.prototype.hasOwnProperty.call(ex, sub)) throw new Error(`${name}: exports nao define o subcaminho ${sub}`);
  const picked = pickCondition(ex[sub]);
  if (!picked) throw new Error(`${name}: exports["${sub}"] sem condicao browser/require/default`);
  return picked;
}

/** Acha a pasta node_modules/<pkg> subindo a partir de fromDir, sem passar de `boundary` (quando dado). */
function findPackageDir(fromDir, pkgName, io, boundary) {
  const stop = boundary ? path.resolve(boundary) : null;
  let dir = path.resolve(fromDir);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', pkgName);
    try {
      if (io.statSync(path.join(candidate, 'package.json')).isFile()) return candidate;
    } catch { /* continua subindo */ }
    if (stop && dir === stop) return null; // a raiz e o ultimo node_modules consultado
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function splitBare(request) {
  const parts = request.split('/');
  const name = request.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  const rest = request.slice(name.length);
  return { name, sub: rest ? `.${rest}` : '.' };
}

function resolveRequest(fromFile, request, io = fs, boundary = null) {
  const aliased = Object.prototype.hasOwnProperty.call(BROWSER_ALIASES, request) ? BROWSER_ALIASES[request] : request;
  if (aliased.startsWith('node:')) throw new Error(`modulo nativo do Node nao existe no navegador: ${request} (pedido por ${fromFile})`);
  if (aliased.startsWith('.') || path.isAbsolute(aliased)) {
    const file = tryFile(path.resolve(path.dirname(fromFile), aliased), io);
    if (!file) throw new Error(`nao achei ${request} (pedido por ${fromFile})`);
    return file;
  }
  const { name, sub } = splitBare(aliased);
  const pkgDir = findPackageDir(path.dirname(fromFile), name, io, boundary);
  if (!pkgDir) throw new Error(`pacote ${name} nao instalado (pedido por ${fromFile}); rode npm ci --ignore-scripts em tools/sfu-spike`);
  const pkg = readJson(path.join(pkgDir, 'package.json'), io) || {};
  if (pkg.browser !== undefined && typeof pkg.browser !== 'string') {
    throw new Error(`${name}: campo "browser" em forma de ${typeof pkg.browser} nao e suportado (so string); o empacotador recusa para nao empacotar o build de Node`);
  }
  const viaExports = exportsEntry(pkg, sub, name);
  let rel;
  if (sub === '.') rel = pkg.browser || viaExports || pkg.main || 'index.js';
  else rel = viaExports || sub;
  const file = tryFile(path.resolve(pkgDir, rel), io);
  if (!file) throw new Error(`entrada ${rel} de ${name} nao encontrada (pedido por ${fromFile})`);
  return file;
}

/** Monta o grafo de modulos a partir de `entry`. */
function collectModules(entry, io = fs, boundary = null) {
  const modules = new Map(); // arquivo -> { source, deps: {request: arquivo} }
  const stack = [path.resolve(entry)];
  while (stack.length) {
    const file = stack.pop();
    if (modules.has(file)) continue;
    const source = io.readFileSync(file, 'utf8');
    if (file.endsWith('.json')) {
      modules.set(file, { json: true, source, deps: {} });
      continue;
    }
    if (ESM_RE.test(source)) throw new Error(`${file} parece ES module; este empacotador so le CommonJS`);
    const deps = {};
    for (const request of scanRequires(source)) {
      const resolved = resolveRequest(file, request, io, boundary);
      deps[request] = resolved;
      if (!modules.has(resolved)) stack.push(resolved);
    }
    modules.set(file, { json: false, source, deps });
  }
  return modules;
}

/** Nomes dos pacotes (node_modules/<nome>) presentes no grafo, ordenados. */
function packagesIn(modules) {
  const names = new Set();
  for (const file of modules.keys()) {
    const parts = file.split(path.sep);
    const i = parts.lastIndexOf('node_modules');
    if (i < 0) continue;
    names.add(parts[i + 1].startsWith('@') ? `${parts[i + 1]}/${parts[i + 2]}` : parts[i + 1]);
  }
  return [...names].sort();
}

function buildBundle(entry, { root, io = fs, expectPackages = null } = {}) {
  const base = path.resolve(root || path.dirname(entry));
  const modules = collectModules(entry, io, base);
  if (expectPackages) {
    const found = packagesIn(modules);
    const want = [...expectPackages].sort();
    if (found.join('|') !== want.join('|')) {
      const extra = found.filter((x) => !want.includes(x));
      const missing = want.filter((x) => !found.includes(x));
      throw new Error(`grafo de pacotes diferente do esperado (a mais: ${extra.join(', ') || '-'}; a menos: ${missing.join(', ') || '-'}); revise a dependencia antes de gerar o bundle`);
    }
  }
  const idOf = (file) => path.relative(base, file).split(path.sep).join('/');
  const defs = [];
  const deps = {};
  for (const [file, mod] of modules) {
    const id = idOf(file);
    deps[id] = Object.fromEntries(Object.entries(mod.deps).map(([req, target]) => [req, idOf(target)]));
    const body = mod.json ? `module.exports = ${mod.source.trim()};` : mod.source;
    defs.push(`${JSON.stringify(id)}: function (module, exports, require) {\n${body}\n}`);
  }
  const entryId = idOf(path.resolve(entry));
  return `/* Gerado por tools/sfu-spike/scripts/bundle.js. NAO editar nem versionar. */
(function () {
'use strict';
var defs = {\n${defs.join(',\n')}\n};
var deps = ${JSON.stringify(deps)};
var cache = {};
function load(id) {
  if (Object.prototype.hasOwnProperty.call(cache, id)) return cache[id].exports;
  var module = { exports: {} };
  cache[id] = module;
  var map = deps[id];
  function localRequire(request) {
    if (!Object.prototype.hasOwnProperty.call(map, request)) throw new Error('require nao empacotado: ' + request + ' (em ' + id + ')');
    return load(map[request]);
  }
  defs[id].call(module.exports, module, module.exports, localRequire);
  return module.exports;
}
load(${JSON.stringify(entryId)});
})();
`;
}

module.exports = { BROWSER_ALIASES, scanRequires, resolveRequest, collectModules, packagesIn, exportsEntry, findPackageDir, buildBundle };
