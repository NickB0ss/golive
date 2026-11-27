'use strict';
// Teste cruzado C++ -> JS do P2.2: roda `golive-media --gerar-vetores` e confere, no JS, as constantes, o
// SHA-256/HMAC proprio do exe, os vetores V1-V4 da spec e um cenario de quadros que o JS verifica e remonta
// byte a byte. Mesma convencao de native/media/golive-media.test.js: binario em GOLIVE_MEDIA_EXE ou em
// build/Release/; sem binario, pula (o CI so de JS nao compila C++).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const C = require('./constantes');
const P = require('./pacote');
const { Remontador } = require('./remontar');
const { CHAVE, V1, V2, V3, V4 } = require('../../../tools/videonativo/vetores-spec');

const raiz = path.join(__dirname, '..', '..', '..');
const nome = process.platform === 'win32' ? 'golive-media.exe' : 'golive-media';
const candidatos = [process.env.GOLIVE_MEDIA_EXE, path.join(raiz, 'build', 'Release', nome)].filter(Boolean);
const exe = candidatos.find((f) => fs.existsSync(f));
const SEM_BINARIO = `golive-media nao compilado (procurado em: ${candidatos.join(', ')}); rode npm run build:native`;

let saida = null;
function vetoresDoExe() {
  if (saida) return saida;
  const r = spawnSync(exe, ['--gerar-vetores'], { encoding: 'utf8', input: '', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  const linhas = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  saida = {
    constantes: linhas.find((l) => l.constantes),
    cripto: linhas.find((l) => l.cripto).cripto,
    resumos: linhas.find((l) => l.sha256),
    vetores: Object.fromEntries(linhas.filter((l) => l.vetor).map((l) => [l.vetor, l])),
    cenario: linhas.find((l) => l.cenario).cenario,
    quadros: linhas.filter((l) => l.datagramas),
    limite: linhas.find((l) => l.limite).limite,
  };
  return saida;
}

// Conteudo dos quadros do cenario: o mesmo LCG de native/media/pacote_vetores.cc.
function conteudoQuadro(quadro, tam) {
  const b = Buffer.alloc(tam);
  let x = Math.imul(quadro, 2654435761) >>> 0;
  for (let i = 0; i < tam; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    b[i] = x >>> 24;
  }
  return b;
}

test('cruzado: constantes do C++ iguais as do JS, nome a nome', (t) => {
  if (!exe) return t.skip(SEM_BINARIO);
  const { constantes, TIPO, FLAG } = vetoresDoExe().constantes;
  for (const [k, v] of Object.entries(constantes)) assert.equal(v, C[k], k);
  assert.equal(Object.keys(constantes).length, 26);
  assert.deepEqual(TIPO, { ...C.TIPO });
  assert.deepEqual(FLAG, { ...C.FLAG });
});

test('cruzado: SHA-256/HMAC proprio passa no FIPS 180-4 e RFC 4231 e bate com o Node de 0 a 200 bytes', (t) => {
  if (!exe) return t.skip(SEM_BINARIO);
  const { cripto, resumos } = vetoresDoExe();
  assert.deepEqual(cripto, { ok: true, casos: 13, falhas: [] });
  assert.equal(resumos.sha256.length, 201);
  for (let n = 0; n <= 200; n++) {
    const m = Buffer.alloc(n);
    for (let i = 0; i < n; i++) m[i] = (i * 7 + 3) & 0xff;
    assert.equal(resumos.sha256[n], crypto.createHash('sha256').update(m).digest('hex'), `sha256 de ${n} bytes`);
    assert.equal(resumos.hmac[n], crypto.createHmac('sha256', CHAVE).update(m).digest('hex'), `hmac de ${n} bytes`);
  }
});

test('cruzado: o C++ produz exatamente os bytes de V1-V4, e o JS os le', (t) => {
  if (!exe) return t.skip(SEM_BINARIO);
  const { vetores } = vetoresDoExe();
  const b = (v) => Buffer.from(vetores[v].hex, 'hex');
  assert.deepEqual(b('V1'), V1.hex);
  assert.equal(vetores.V1.hmac32, V1.hmac32.toString('hex'));
  assert.deepEqual(b('V2'), V2.hex);
  assert.deepEqual(b('V3'), V3.hex);
  const v4 = b('V4');
  assert.equal(v4.length, V4.tamanho);
  assert.deepEqual(v4.subarray(0, V4.inicio.length), V4.inicio);
  assert.deepEqual(v4.subarray(v4.length - 16), V4.hmac);
  assert.equal(vetores.V4.sha256, V4.sha256);
  assert.equal(crypto.createHash('sha256').update(v4).digest('hex'), V4.sha256);

  const rec = new P.Verificador();
  rec.adicionarSessao(0x12345678, { chave: CHAVE, papel: 'receptor', fecN: 10 });
  assert.deepEqual(rec.verificar(b('V1')).pacote.payload, V1.payload);
  const fec = rec.verificar(v4).pacote.campos;
  assert.deepEqual(P.recuperarFec(fec, [V4.fragmento0], 1, 2), V4.fragmento1);
  const emi = new P.Verificador();
  emi.adicionarSessao(0x12345678, { chave: CHAVE, papel: 'emissor' });
  assert.deepEqual(emi.verificar(b('V2')).pacote.campos.entradas, V2.entradas);
  assert.deepEqual(emi.verificar(b('V3')).pacote.campos, V3.relatorio);
});

function remontarCenario(datagramas, cen, { perder = () => false, ordem = (x) => x } = {}) {
  const ver = new P.Verificador();
  const chave = Buffer.from(cen.chave, 'hex');
  ver.adicionarSessao(cen.sessao, { chave, papel: 'receptor', fecN: cen.fecN });
  const entregues = [];
  const rem = new Remontador({ fecN: cen.fecN, agora: () => 0, aoQuadro: (q) => entregues.push(q) });
  const pacotes = [];
  for (const hex of datagramas) {
    const r = ver.verificar(Buffer.from(hex, 'hex'));
    assert.equal(r.ok, true, r.motivo);
    pacotes.push(r.pacote);
  }
  for (const p of ordem(pacotes)) if (!perder(p)) rem.receber(p);
  return { entregues, rem, ver };
}

test('cruzado: o cenario do C++ passa pelo Verificador e remonta cada quadro byte a byte', (t) => {
  if (!exe) return t.skip(SEM_BINARIO);
  const { cenario, quadros } = vetoresDoExe();
  const todos = quadros.flatMap((q) => q.datagramas);
  const { entregues, ver } = remontarCenario(todos, cenario);
  assert.deepEqual(entregues.map((q) => q.quadro), quadros.map((q) => q.quadro));
  for (const [k, q] of quadros.entries()) {
    const original = conteudoQuadro(q.quadro, q.tamanho);
    assert.equal(crypto.createHash('sha256').update(original).digest('hex'), q.sha256, `conteudo do ${q.quadro}`);
    assert.deepEqual(entregues[k].dados, original, `quadro ${q.quadro}`);
    assert.equal(entregues[k].keyframe, q.keyframe);
  }
  // Sequencias de 1 em 1 desde 1, em todo datagrama (FEC inclusive), sem nenhum descarte.
  assert.deepEqual(todos.map((h) => Buffer.from(h, 'hex').readUInt32BE(8)), todos.map((_, i) => i + 1));
  assert.ok(Object.values(ver.contadores).every((n) => n === 0));
});

test('cruzado: o JS empacota o mesmo cenario com os mesmos bytes do C++', (t) => {
  if (!exe) return t.skip(SEM_BINARIO);
  const { cenario, quadros } = vetoresDoExe();
  const chave = Buffer.from(cenario.chave, 'hex');
  let seq = 1;
  for (const q of quadros) {
    const ps = P.fragmentarQuadro(conteudoQuadro(q.quadro, q.tamanho), { quadro: q.quadro, keyframe: q.keyframe,
      fecN: cenario.fecN });
    const meus = ps.map((p) => {
      const tempo = 5000000 + 100 * seq;
      return P.montarDatagrama({ ...p, sessao: cenario.sessao, seq: seq++, tempo }, chave).toString('hex');
    });
    assert.deepEqual(meus, q.datagramas, `quadro ${q.quadro}`);
  }
});

test('cruzado: cenario do C++ embaralhado, duplicado e perdendo um fragmento por grupo, recuperado pelo FEC', (t) => {
  if (!exe) return t.skip(SEM_BINARIO);
  const { cenario, quadros } = vetoresDoExe();
  const todos = quadros.flatMap((q) => q.datagramas);
  // Perde o primeiro fragmento de cada grupo de FEC; quadros chegam de tras para a frente dentro de si.
  const perdido = (p) => p.tipo === C.TIPO.VIDEO && p.indice % cenario.fecN === 0;
  const ordem = (ps) => {
    const porQuadro = new Map();
    for (const p of ps) porQuadro.set(p.quadro, [...(porQuadro.get(p.quadro) || []), p]);
    return [...porQuadro.values()].flatMap((l) => [...l].reverse().flatMap((p) => [p, p]));
  };
  const { entregues, rem } = remontarCenario(todos, cenario, { perder: perdido, ordem });
  assert.deepEqual(entregues, []);
  // O gancho do P2.3: para cada quadro em montagem, recupera grupo a grupo.
  for (const e of rem.entradas()) for (const g of e.gruposComFec) assert.notEqual(rem.recuperarFec(e.quadro, g), -1);
  assert.deepEqual(entregues.map((q) => q.quadro), quadros.map((q) => q.quadro));
  for (const [k, q] of quadros.entries()) assert.deepEqual(entregues[k].dados, conteudoQuadro(q.quadro, q.tamanho));
  assert.ok(rem.contadores.duplicados > 0);
  assert.equal(rem.contadores.recuperados_fec, quadros.reduce((s, q) => s + Math.ceil(Math.ceil(q.tamanho / 1152) / 10),
    0));
});

test('cruzado: limite da 6.2 no C++ (1024 fragmentos sim, um byte a mais nao)', (t) => {
  if (!exe) return t.skip(SEM_BINARIO);
  assert.deepEqual(vetoresDoExe().limite, { maior: 1152 * 1024, aceita: true, fragmentos: 1024,
    recusa_maior_mais_1: true });
});

test('golive-media --gerar-vetores com outro argumento sai com 2', (t) => {
  if (!exe) return t.skip(SEM_BINARIO);
  const r = spawnSync(exe, ['--gerar-vetores', '--fps', '30'], { encoding: 'utf8', input: '' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--gerar-vetores/);
});
