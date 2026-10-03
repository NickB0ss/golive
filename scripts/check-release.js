#!/usr/bin/env node
/*
 * Confere se um release do GitHub esta em condicoes de servir o
 * auto-updater ANTES de virar o "Latest" que todo mundo vai consultar.
 *
 * Existe por causa da v0.10.0: ela subiu so com o `.exe`, sem `latest.yml`
 * e sem `.blockmap`. O electron-updater sempre busca o `latest.yml` do
 * release mais novo -- levou 404, e todo mundo passou a ver "nao consegui
 * verificar a atualizacao". Um release incompleto nao quebra so ele mesmo:
 * quebra a atualizacao de quem esta em QUALQUER versao anterior.
 *
 * Uso:
 *   node scripts/check-release.js v0.10.1
 *   node scripts/check-release.js            (usa a version do package.json)
 *
 * Sai com codigo 1 se achar problema, pra poder entrar num `&&`.
 */

'use strict';

const { execFileSync } = require('node:child_process');

/*
 * Le o `latest.yml` do electron-builder. NAO e um parser de YAML: o arquivo
 * e gerado por maquina, plano e sempre com a mesma forma --
 *
 *   version: 0.9.0
 *   files:
 *     - url: GoLive-LAN-Setup-0.9.0.exe
 *       sha512: ...
 *   path: GoLive-LAN-Setup-0.9.0.exe
 *
 * -- entao arrastar uma dependencia de YAML pra ler tres campos nao se paga.
 */
function parseLatestYml(text) {
  const lines = String(text || '').split(/\r?\n/);
  const version = (lines.find((l) => /^version:/.test(l)) || '').replace(/^version:\s*/, '').trim();
  const path = (lines.find((l) => /^path:/.test(l)) || '').replace(/^path:\s*/, '').trim();
  const files = lines
    .filter((l) => /^\s+-?\s*url:/.test(l))
    .map((l) => l.replace(/^\s+-?\s*url:\s*/, '').trim())
    .filter(Boolean);
  return { version, path, files: [...new Set(files)] };
}

/*
 * O GitHub troca espaco por ponto no nome do arquivo enviado; o
 * electron-updater, na hora de baixar, troca espaco por traco
 * (GitHubProvider.resolveFiles). Um `.exe` com espaco no nome portanto sobe
 * como `A.B.exe` e e procurado como `A-B.exe` -- 404 no download mesmo com
 * o `latest.yml` no lugar. Comparar normalizado acha esse desencontro.
 */
function normalizeAssetName(name) {
  return String(name || '').replace(/[ .-]+/g, '-').toLowerCase();
}

/**
 * Problemas encontrados, em uma lista de frases. Vazia = release saudavel.
 *
 * `release`: { tagName, isDraft, isPrerelease, assets: [{ name }] }
 * `latestYmlText`: conteudo do latest.yml, ou null se ele nem existe.
 */
function checkRelease({ version, release, latestYmlText }) {
  const problems = [];
  const assets = (release?.assets || []).map((a) => a.name);
  const has = (name) => assets.some((a) => normalizeAssetName(a) === normalizeAssetName(name));

  if (release?.isDraft) {
    problems.push('o release ainda e rascunho (draft) -- o electron-updater nao enxerga rascunho');
  }

  const exe = `GoLive-LAN-Setup-${version}.exe`;
  if (!has(exe)) problems.push(`falta o instalador ${exe} (assets: ${assets.join(', ') || 'nenhum'})`);
  if (!has(`${exe}.blockmap`)) problems.push(`falta o ${exe}.blockmap (o updater usa pra baixar so o que mudou)`);

  if (!assets.includes('latest.yml')) {
    problems.push('falta o latest.yml -- SEM ELE NINGUEM CONSEGUE VERIFICAR ATUALIZACAO');
    return problems; // sem o arquivo, os testes abaixo nao tem o que checar
  }
  if (latestYmlText == null) {
    problems.push('nao consegui baixar o latest.yml pra conferir o conteudo');
    return problems;
  }

  const yml = parseLatestYml(latestYmlText);
  if (yml.version !== version) {
    problems.push(`o latest.yml diz version ${yml.version || '(vazio)'}, mas o release e ${version}`);
  }
  for (const referenced of [...new Set([yml.path, ...yml.files].filter(Boolean))]) {
    if (!has(referenced)) {
      problems.push(`o latest.yml aponta pra "${referenced}", que nao esta entre os assets do release`);
    }
  }
  if (!yml.path && !yml.files.length) {
    problems.push('o latest.yml nao aponta pra arquivo nenhum');
  }

  return problems;
}

// --- CLI -------------------------------------------------------------------

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function main() {
  const pkg = require('../package.json');
  const version = (process.argv[2] || `v${pkg.version}`).replace(/^v/, '');
  const tag = `v${version}`;

  let release;
  try {
    release = JSON.parse(sh('gh', ['release', 'view', tag, '--json', 'tagName,isDraft,isPrerelease,assets']));
  } catch {
    console.error(`x nao achei o release ${tag} no GitHub (o \`gh\` esta autenticado?)`);
    process.exit(1);
  }

  let latestYmlText = null;
  if ((release.assets || []).some((a) => a.name === 'latest.yml')) {
    try {
      latestYmlText = sh('gh', [
        'release', 'download', tag, '--pattern', 'latest.yml', '--output', '-',
      ]);
    } catch {
      latestYmlText = null;
    }
  }

  const problems = checkRelease({ version, release, latestYmlText });
  if (!problems.length) {
    console.log(`ok ${tag} esta completo: ${release.assets.map((a) => a.name).join(', ')}`);
    return;
  }
  console.error(`x ${tag} tem ${problems.length} problema(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nConserte antes de publicar: um release incompleto derruba a');
  console.error('atualizacao de quem esta em qualquer versao anterior.');
  process.exit(1);
}

if (require.main === module) main();

module.exports = { parseLatestYml, normalizeAssetName, checkRelease };
