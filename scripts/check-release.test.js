'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLatestYml, normalizeAssetName, checkRelease } = require('./check-release');

// latest.yml real, copiado do release v0.9.0 (sha512 encurtado).
const YML_OK = `version: 0.9.0
files:
  - url: GoLive-LAN-Setup-0.9.0.exe
    sha512: os+g0bpk1r3d==
    size: 79130708
path: GoLive-LAN-Setup-0.9.0.exe
sha512: os+g0bpk1r3d==
releaseDate: '2026-09-04T12:58:52.410Z'
`;

const releaseOk = (version) => ({
  tagName: `v${version}`,
  isDraft: false,
  isPrerelease: false,
  assets: [
    { name: `GoLive-LAN-Setup-${version}.exe` },
    { name: `GoLive-LAN-Setup-${version}.exe.blockmap` },
    { name: 'latest.yml' },
  ],
});

test('parseLatestYml tira version, path e a lista de arquivos', () => {
  assert.deepEqual(parseLatestYml(YML_OK), {
    version: '0.9.0',
    path: 'GoLive-LAN-Setup-0.9.0.exe',
    files: ['GoLive-LAN-Setup-0.9.0.exe'],
  });
});

test('parseLatestYml aguenta arquivo vazio sem explodir', () => {
  assert.deepEqual(parseLatestYml(''), { version: '', path: '', files: [] });
  assert.deepEqual(parseLatestYml(null), { version: '', path: '', files: [] });
});

test('normalizeAssetName junta as tres grafias do mesmo instalador', () => {
  const alvo = normalizeAssetName('GoLive-LAN-Setup-0.10.0.exe');
  assert.equal(normalizeAssetName('GoLive LAN Setup 0.10.0.exe'), alvo); // como sai do build
  assert.equal(normalizeAssetName('GoLive.LAN.Setup.0.10.0.exe'), alvo); // como o site do GitHub renomeia
});

test('release completo nao acusa nada', () => {
  assert.deepEqual(checkRelease({ version: '0.9.0', release: releaseOk('0.9.0'), latestYmlText: YML_OK }), []);
});

// A v0.10.0 exatamente como ficou no GitHub: so o .exe, com pontos no nome.
test('o caso da v0.10.0 -- so o .exe -- e pego, e o latest.yml aparece em destaque', () => {
  const problems = checkRelease({
    version: '0.10.0',
    release: {
      tagName: 'v0.10.0',
      isDraft: false,
      isPrerelease: false,
      assets: [{ name: 'GoLive.LAN.Setup.0.10.0.exe' }],
    },
    latestYmlText: null,
  });
  assert.equal(problems.length, 2);
  assert.match(problems.join('\n'), /blockmap/);
  assert.match(problems.join('\n'), /latest\.yml/);
  // o .exe com pontos conta como presente: e o mesmo arquivo, so renomeado
  assert.doesNotMatch(problems.join('\n'), /falta o instalador/);
});

test('rascunho e apontado -- o updater nao enxerga draft', () => {
  const release = { ...releaseOk('0.9.0'), isDraft: true };
  const problems = checkRelease({ version: '0.9.0', release, latestYmlText: YML_OK });
  assert.match(problems.join('\n'), /rascunho|draft/i);
});

test('latest.yml de outra versao e pego', () => {
  const problems = checkRelease({ version: '0.9.1', release: releaseOk('0.9.1'), latestYmlText: YML_OK });
  assert.match(problems.join('\n'), /latest\.yml diz version 0\.9\.0/);
});

test('latest.yml apontando pra arquivo que nao subiu e pego', () => {
  const release = {
    ...releaseOk('0.9.0'),
    assets: [{ name: 'outra-coisa.exe' }, { name: 'GoLive-LAN-Setup-0.9.0.exe.blockmap' }, { name: 'latest.yml' }],
  };
  const problems = checkRelease({ version: '0.9.0', release, latestYmlText: YML_OK });
  assert.match(problems.join('\n'), /aponta pra "GoLive-LAN-Setup-0\.9\.0\.exe"/);
});

test('release sem asset nenhum acusa tudo', () => {
  const release = { tagName: 'v1.0.0', isDraft: false, isPrerelease: false, assets: [] };
  const problems = checkRelease({ version: '1.0.0', release, latestYmlText: null });
  assert.equal(problems.length, 3);
});
