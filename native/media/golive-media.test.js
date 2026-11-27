'use strict';
// Testa o golive-media compilado. Procura o binario em GOLIVE_MEDIA_EXE e em build/Release/ (stdin fica
// aberto, como no uso real); sem binario, os testes sao pulados (o CI so de JS nao compila C++).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const raiz = path.join(__dirname, '..', '..');
const nome = process.platform === 'win32' ? 'golive-media.exe' : 'golive-media';
const candidatos = [process.env.GOLIVE_MEDIA_EXE, path.join(raiz, 'build', 'Release', nome)].filter(Boolean);
const exe = candidatos.find((f) => fs.existsSync(f));
const SEM_BINARIO = `golive-media nao compilado (procurado em: ${candidatos.join(', ')}); rode npm run build:native`;

const linhas = (s) => s.split('\n').filter(Boolean);

test('--segundos 2 sai com 0 e imprime exatamente 2 linhas JSON (t=1 e t=2)', async (t) => {
  if (!exe) return t.skip(SEM_BINARIO);
  const filho = spawn(exe, ['--segundos', '2', '--fps', '30', '--kbps', '4000'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  filho.stdout.on('data', (d) => { out += d; });
  const codigo = await new Promise((resolve) => filho.on('close', resolve));
  assert.equal(codigo, 0);
  const ms = linhas(out).map((l) => JSON.parse(l));
  assert.deepEqual(ms.map((m) => m.t), [1, 2]);
  assert.ok(ms.every((m) => m.fps_alvo === 30 && m.kbps_alvo === 4000 && m.captura === null));
});

test('parar pelo stdin encerra rapido com 0', (t) => {
  if (!exe) return t.skip(SEM_BINARIO);
  const ini = Date.now();
  const r = spawnSync(exe, ['--segundos', '10'], { encoding: 'utf8', input: '{"cmd":"parar"}\n' });
  assert.equal(r.status, 0);
  assert.ok(Date.now() - ini < 3000);
  assert.equal(linhas(r.stdout).length, 0);
});

test('kbps muda a metrica; comando invalido avisa no stderr e segue', async (t) => {
  if (!exe) return t.skip(SEM_BINARIO);
  const filho = spawn(exe, ['--segundos', '3'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  filho.stdout.on('data', (d) => { out += d; });
  filho.stderr.on('data', (d) => { err += d; });
  filho.stdin.write('nao e json\n{"cmd":"voar"}\n{"cmd":"keyframe"}\n{ "cmd" : "kbps" , "valor" : 8000 }\n');
  const codigo = await new Promise((resolve) => filho.on('close', resolve));
  assert.equal(codigo, 0);
  const ms = linhas(out).map((l) => JSON.parse(l));
  assert.equal(ms.length, 3);
  assert.ok(ms.every((m) => m.kbps_alvo === 8000));
  assert.equal(linhas(err).length, 2);
});

test('EOF no stdin encerra com 0', (t) => {
  if (!exe) return t.skip(SEM_BINARIO);
  const r = spawnSync(exe, [], { encoding: 'utf8', input: '' });
  assert.equal(r.status, 0);
});

test('argumentos invalidos saem com 2 e mensagem no stderr', (t) => {
  if (!exe) return t.skip(SEM_BINARIO);
  const casos = [
    ['--fps', '0'], ['--fps', 'abc'], ['--kbps', '99'], ['--janela', 'xyz'], ['--monitor', '-1'],
    ['--janela', '123', '--monitor', '0'], ['--segundos'], ['--nada'],
  ];
  for (const args of casos) {
    const r = spawnSync(exe, args, { encoding: 'utf8', input: '' });
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /golive-media: /);
    assert.equal(r.stdout, '');
  }
});
