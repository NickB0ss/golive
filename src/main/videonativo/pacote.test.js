'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const C = require('./constantes');
const P = require('./pacote');
const { CHAVE, V1, V2, V3, V4 } = require('../../../tools/videonativo/vetores-spec');

const { TIPO, FLAG } = C;

const ver = (op) => {
  const v = new P.Verificador(op);
  v.adicionarSessao(0x12345678, { chave: CHAVE, papel: (op && op.papel) || 'receptor', fecN: 10 });
  return v;
};
let seqLivre = 100;
// Datagrama com HMAC valido; a sequencia muda a cada chamada para nao cair no replay.
const dg = (campos, payload) => P.montarDatagrama({ sessao: 0x12345678, seq: seqLivre++, tempo: 0, ...campos,
  payload }, CHAVE);
const frag = (n) => Buffer.alloc(n, 0x5a);

// --- Vetores da spec (secao 12) ---

test('V1: montarDatagrama reproduz o hex da spec, e o HMAC inteiro confere com a truncagem', () => {
  const d = P.montarDatagrama({ ...V1.campos, payload: V1.payload }, CHAVE);
  assert.deepEqual(d, V1.hex);
  const inteiro = crypto.createHmac('sha256', CHAVE).update(d.subarray(0, d.length - 16)).digest();
  assert.deepEqual(inteiro, V1.hmac32);
  // O mesmo pela fragmentacao: quadro de 8 bytes, keyframe, um fragmento.
  const [p] = P.fragmentarQuadro(V1.payload, { quadro: 1, keyframe: true, fecN: 0 });
  assert.deepEqual(P.montarDatagrama({ ...p, sessao: 0x12345678, seq: 1, tempo: 1000000 }, CHAVE), V1.hex);
});

test('V2 e V3: NACK e RELATORIO saem byte a byte como na spec', () => {
  assert.deepEqual(P.montarDatagrama({ ...V2.campos, payload: P.payloadNack(V2.entradas) }, CHAVE), V2.hex);
  assert.deepEqual(P.montarDatagrama({ ...V3.campos, payload: P.payloadRelatorio(V3.relatorio) }, CHAVE), V3.hex);
});

test('V4: o FEC do quadro 5 tem 1200 bytes, o comeco, a etiqueta e o SHA-256 da spec', () => {
  const ps = P.fragmentarQuadro(V4.quadro, { quadro: 5, keyframe: false, fecN: 10 });
  assert.deepEqual(ps.map((p) => [p.tipo, p.indice]), [[TIPO.VIDEO, 0], [TIPO.VIDEO, 1], [TIPO.FEC, 0]]);
  const d = P.montarDatagrama({ ...ps[2], sessao: 0x12345678, seq: 16, tempo: 3000000 }, CHAVE);
  assert.equal(d.length, V4.tamanho);
  assert.deepEqual(d.subarray(0, V4.inicio.length), V4.inicio);
  assert.deepEqual(d.subarray(1184), V4.hmac);
  assert.equal(crypto.createHash('sha256').update(d).digest('hex'), V4.sha256);
  // "xor_dados segue igual ao fragmento 0 ate o fim"
  assert.deepEqual(d.subarray(28 + 4 + 5, 28 + 4 + 1152), V4.fragmento0.subarray(5));
});

test('V4: recuperar o fragmento 1 pelo FEC da tamanho 5 e aa bb cc dd ee (e o 0 a partir do 1)', () => {
  const ps = P.fragmentarQuadro(V4.quadro, { quadro: 5, keyframe: false, fecN: 10 });
  const r = ver().verificar(P.montarDatagrama({ ...ps[2], sessao: 0x12345678, seq: 16, tempo: 3000000 }, CHAVE));
  assert.equal(r.ok, true);
  const fec = r.pacote.campos;
  assert.equal(fec.k, 2);
  assert.equal(fec.xorTamanhos, 0x0485);
  assert.deepEqual(P.recuperarFec(fec, [V4.fragmento0], 1, 2), V4.fragmento1);
  assert.deepEqual(P.recuperarFec(fec, [V4.fragmento1], 0, 2), V4.fragmento0);
  // Tamanho que nao fecha: o 0 nao e o ultimo e teria de ter 1152.
  assert.equal(P.recuperarFec({ ...fec, xorTamanhos: 0x0485 ^ 1 }, [V4.fragmento1], 0, 2), null);
});

test('V1 negativo: um bit trocado no payload cai em hmac', () => {
  const v = ver();
  const neg = Buffer.from(V1.hex);
  neg[30] ^= 0x01;
  assert.deepEqual(v.verificar(neg), { ok: false, motivo: 'hmac' });
  assert.equal(v.contadores.hmac, 1);
  // E o original passa, com os campos lidos.
  const r = v.verificar(V1.hex);
  assert.equal(r.ok, true);
  assert.equal(r.avancou, true);
  assert.equal(r.pacote.quadro, 1);
  assert.equal(r.pacote.flags, FLAG.KEYFRAME | FLAG.FIM_DE_QUADRO);
  assert.deepEqual(r.pacote.payload, V1.payload);
});

test('V2 e V3 lidos por quem e emissor na sessao (VOLTA = 1)', () => {
  const v = ver({ papel: 'emissor' });
  const r2 = v.verificar(V2.hex);
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.pacote.campos, { entradas: V2.entradas });
  const r3 = v.verificar(V3.hex);
  assert.equal(r3.ok, true);
  assert.deepEqual(r3.pacote.campos, V3.relatorio);
});

// --- Fragmentacao ---

test('fragmentarQuadro: n = ceil(T/1152), FEC logo depois do ultimo fragmento do grupo, flags certas', () => {
  const dados = crypto.randomBytes(1152 * 21 + 7); // 22 fragmentos, grupos [0-9] [10-19] [20-21]
  const ps = P.fragmentarQuadro(dados, { quadro: 9, keyframe: true, fecN: 10 });
  const ordem = ps.map((p) => (p.tipo === TIPO.FEC ? `F${p.indice}` : String(p.indice)));
  assert.deepEqual(ordem, [...'0123456789'.split(''), 'F0', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19',
    'F10', '20', '21', 'F20']);
  assert.ok(ps.every((p) => p.total === 22 && p.quadro === 9 && (p.flags & FLAG.KEYFRAME)));
  const videos = ps.filter((p) => p.tipo === TIPO.VIDEO);
  assert.deepEqual(Buffer.concat(videos.map((p) => p.payload)), dados);
  assert.ok(videos.every((p) => ((p.flags & FLAG.FIM_DE_QUADRO) !== 0) === (p.indice === 21)));
  const fecs = ps.filter((p) => p.tipo === TIPO.FEC);
  assert.deepEqual(fecs.map((f) => [f.payload[0], f.payload.length, f.flags]), [[10, 1156, 1], [10, 1156, 1],
    [2, 1156, 1]]);
});

test('fragmentarQuadro: sem FEC, N = 1 (copia), ultimo grupo de k = 1 com L pequeno, e o limite da 6.2', () => {
  const semFec = P.fragmentarQuadro(frag(3000), { quadro: 1, keyframe: false, fecN: 0 });
  assert.ok(semFec.every((p) => p.tipo === TIPO.VIDEO));
  const um = P.fragmentarQuadro(frag(1153), { quadro: 1, keyframe: false, fecN: 1 });
  assert.deepEqual(um.map((p) => p.tipo), [1, 2, 1, 2]);
  assert.equal(um[3].payload.length, 4 + 1);
  assert.deepEqual(um[1].payload.subarray(4), um[0].payload);
  const ultimo = P.fragmentarQuadro(frag(1152 * 10 + 3), { quadro: 1, keyframe: false, fecN: 10 }).at(-1);
  assert.deepEqual([ultimo.indice, ultimo.payload[0], ultimo.payload.length], [10, 1, 7]);
  assert.equal(P.fragmentarQuadro(frag(1152 * 1024), { quadro: 1, keyframe: true, fecN: 0 }).length, 1024);
  assert.equal(P.fragmentarQuadro(frag(1152 * 1024 + 1), { quadro: 1, keyframe: true, fecN: 0 }), null);
  assert.throws(() => P.fragmentarQuadro(Buffer.alloc(0), { quadro: 1, keyframe: true }), RangeError);
  assert.throws(() => P.fragmentarQuadro(frag(1), { quadro: 0, keyframe: true }), RangeError);
  assert.throws(() => P.fragmentarQuadro(frag(1), { quadro: 1, keyframe: true, fecN: 33 }), RangeError);
});

// --- Ordem de verificacao (4.5), passos 1 a 7 ---

test('passo 1: datagrama com menos de 44 ou mais de 1200 bytes conta tamanho', () => {
  const v = ver();
  assert.equal(v.verificar(Buffer.alloc(43)).motivo, 'tamanho');
  assert.equal(v.verificar(Buffer.alloc(1201)).motivo, 'tamanho');
  assert.equal(v.contadores.tamanho, 2);
});

test('passo 2: magia, versao e tipo; versao loga no maximo uma linha a cada 60 s, no total', () => {
  let t = 0;
  const linhas = [];
  const v = ver({ agora: () => t, log: (l) => linhas.push(l) });
  const ruim = (byte, valor) => {
    const d = Buffer.from(V1.hex);
    d[byte] = valor;
    return d;
  };
  assert.equal(v.verificar(ruim(0, 0x48)).motivo, 'magia');
  assert.equal(v.verificar(ruim(1, 0x00)).motivo, 'magia');
  assert.equal(v.verificar(ruim(2, 2), '10.0.0.1:5000').motivo, 'versao');
  assert.equal(v.verificar(ruim(2, 0), '10.0.0.2:5000').motivo, 'versao');
  t = 59999;
  v.verificar(ruim(2, 2), '10.0.0.3:5000');
  t = 60000;
  v.verificar(ruim(2, 2), '10.0.0.4:5000');
  assert.equal(v.contadores.versao, 4);
  assert.equal(linhas.length, 2);
  assert.match(linhas[0], /10\.0\.0\.1:5000/);
  assert.match(linhas[1], /10\.0\.0\.4:5000/);
  assert.equal(v.verificar(ruim(3, 0)).motivo, 'tipo');
  assert.equal(v.verificar(ruim(3, 8)).motivo, 'tipo');
});

test('passo 3: campo tamanho diferente de datagrama - 44 conta tamanho', () => {
  const v = ver();
  const d = Buffer.from(V1.hex);
  d.writeUInt16BE(9, 26);
  assert.equal(v.verificar(d).motivo, 'tamanho');
  assert.equal(v.verificar(Buffer.concat([V1.hex, Buffer.alloc(1)])).motivo, 'tamanho');
});

test('passo 4: sessao 0 ou desconhecida conta sessao (antes do HMAC)', () => {
  const v = ver();
  const outra = P.montarDatagrama({ ...V1.campos, sessao: 0x12345679, payload: V1.payload }, CHAVE);
  assert.equal(v.verificar(outra).motivo, 'sessao');
  const zero = Buffer.from(V1.hex);
  zero.writeUInt32BE(0, 4);
  assert.equal(v.verificar(zero).motivo, 'sessao');
  assert.equal(v.contadores.hmac, 0);
});

test('passo 5: chave errada conta hmac e nao mexe na janela', () => {
  const v = ver();
  const forjado = P.montarDatagrama({ ...V1.campos, seq: 5000, payload: V1.payload }, Buffer.alloc(32, 7));
  assert.equal(v.verificar(forjado).motivo, 'hmac');
  // A janela nao andou: a sequencia 1 legitima ainda passa (e a 5000 forjada nao a empurrou para fora).
  assert.equal(v.verificar(V1.hex).ok, true);
  // Etiqueta truncada errada em um bit tambem.
  const d = Buffer.from(V2.hex);
  d[d.length - 1] ^= 0x80;
  assert.equal(ver({ papel: 'emissor' }).verificar(d).motivo, 'hmac');
});

test('passo 6: VOLTA contra o papel conta direcao', () => {
  assert.equal(ver({ papel: 'emissor' }).verificar(V1.hex).motivo, 'direcao');
  assert.equal(ver({ papel: 'receptor' }).verificar(V2.hex).motivo, 'direcao');
});

test('passo 7: sequencia 0 conta campo; repetida ou velha conta replay; so a nova "avanca"', () => {
  const v = ver();
  const video = (seq) => P.montarDatagrama({ ...V1.campos, seq, payload: V1.payload }, CHAVE);
  assert.equal(v.verificar(video(0)).motivo, 'campo');
  assert.equal(v.verificar(video(2000)).avancou, true);
  assert.equal(v.verificar(video(2000)).motivo, 'replay');
  const dentro = v.verificar(video(1999));
  assert.deepEqual([dentro.ok, dentro.avancou], [true, false]);
  assert.equal(v.verificar(video(977)).ok, true); // 2000 - 1023: ultima da janela
  assert.equal(v.verificar(video(976)).motivo, 'replay'); // 2000 - 1024: fora
  assert.equal(v.verificar(video(2001)).avancou, true);
  assert.equal(v.contadores.replay, 2);
});

test('JanelaReplay: salto maior que a janela limpa tudo; o bitmap reaproveitado nao confunde', () => {
  const j = new P.JanelaReplay();
  assert.equal(j.aceitar(1), P.REPLAY.AVANCOU);
  assert.equal(j.aceitar(1 + 1024), P.REPLAY.AVANCOU); // mesma posicao no bitmap
  assert.equal(j.aceitar(1), P.REPLAY.REJEITA);
  assert.equal(j.aceitar(2), P.REPLAY.DENTRO);
  assert.equal(j.aceitar(10000), P.REPLAY.AVANCOU);
  assert.equal(j.aceitar(10000 - 1023), P.REPLAY.DENTRO);
  assert.equal(j.aceitar(1 + 1024), P.REPLAY.REJEITA);
  assert.equal(j.aceitar(0xffffffff), P.REPLAY.AVANCOU);
  assert.equal(j.aceitar(0xffffffff), P.REPLAY.REJEITA);
});

test('contadores tem exatamente os nomes da 4.5', () => {
  assert.deepEqual(Object.keys(ver().contadores), ['tamanho', 'magia', 'versao', 'tipo', 'sessao', 'hmac', 'direcao',
    'replay', 'campo']);
});

test('removerSessao zera a copia da chave; pacotes atrasados dela contam sessao', () => {
  const v = ver();
  const s = v.sessoes.get(0x12345678);
  assert.equal(v.removerSessao(0x12345678), true);
  assert.ok(s.chave.equals(Buffer.alloc(32)));
  assert.equal(v.verificar(V1.hex).motivo, 'sessao');
  assert.equal(v.removerSessao(0x12345678), false);
  assert.throws(() => v.adicionarSessao(1, { chave: Buffer.alloc(31), papel: 'receptor' }), RangeError);
  assert.throws(() => v.adicionarSessao(0, { chave: CHAVE, papel: 'receptor' }), RangeError);
  assert.throws(() => v.adicionarSessao(1, { chave: CHAVE, papel: 'relay' }), RangeError);
});

// --- Passo 8: campos de cada tipo (4.3, 4.4, 5) ---

const ok = (v, d) => assert.equal(v.verificar(d).ok, true);
const campo = (v, d) => assert.equal(v.verificar(d).motivo, 'campo');

test('cabecalho: bits 4-7 das flags e reservado diferente de 0 contam campo', () => {
  const v = ver();
  const base = { tipo: TIPO.VIDEO, quadro: 1, indice: 0, total: 1, flags: FLAG.FIM_DE_QUADRO };
  ok(v, dg(base, frag(10)));
  campo(v, dg({ ...base, flags: base.flags | 0x10 }, frag(10)));
  campo(v, dg({ ...base, flags: base.flags | 0x80 }, frag(10)));
  campo(v, dg({ ...base, reservado: 1 }, frag(10)));
});

test('VIDEO: quadro, indice, total, FIM_DE_QUADRO e tamanho do fragmento', () => {
  const v = ver();
  const base = { tipo: TIPO.VIDEO, quadro: 7, indice: 0, total: 2, flags: 0 };
  ok(v, dg(base, frag(1152)));
  ok(v, dg({ ...base, indice: 1, flags: FLAG.FIM_DE_QUADRO | FLAG.RETRANSMISSAO }, frag(1)));
  campo(v, dg({ ...base, quadro: 0 }, frag(1152)));
  campo(v, dg({ ...base, total: 0 }, frag(1152)));
  campo(v, dg({ ...base, total: 1025, indice: 0 }, frag(1152)));
  campo(v, dg({ ...base, indice: 2 }, frag(1)));
  campo(v, dg({ ...base, flags: FLAG.FIM_DE_QUADRO }, frag(1152))); // FIM fora do ultimo
  campo(v, dg({ ...base, indice: 1 }, frag(5))); // ultimo sem FIM
  campo(v, dg({ ...base, indice: 1, flags: FLAG.FIM_DE_QUADRO }, Buffer.alloc(0))); // payload vazio
  campo(v, dg(base, frag(1151))); // nao e o ultimo e nao tem 1152
  campo(v, dg({ ...base, indice: 1, flags: FLAG.FIM_DE_QUADRO }, frag(1153))); // acima de 1152
  // VIDEO com VOLTA para quem e emissor passa do passo 6 e cai no 8.
  const e = ver({ papel: 'emissor' });
  campo(e, dg({ ...base, indice: 1, flags: FLAG.FIM_DE_QUADRO | FLAG.VOLTA }, frag(5)));
});

test('FEC: N anunciado, i % N, k, L, reservado, FIM e RETRANSMISSAO', () => {
  const fecDe = (frags) => P.payloadFec(frags);
  const v = ver(); // fecN 10
  const base = { tipo: TIPO.FEC, quadro: 3, indice: 0, total: 12, flags: FLAG.KEYFRAME };
  const dez = Array.from({ length: 10 }, () => frag(1152));
  ok(v, dg(base, fecDe(dez)));
  ok(v, dg({ ...base, indice: 10 }, fecDe([frag(1152), frag(9)]))); // k = 2, L = 1152
  ok(v, dg({ ...base, indice: 0, total: 1 }, fecDe([frag(9)]))); // grupo so com o ultimo: L = 9
  campo(v, dg({ ...base, indice: 5 }, fecDe(dez))); // i % N != 0
  campo(v, dg(base, fecDe(dez.slice(1)))); // k = 9, devia ser 10
  campo(v, dg({ ...base, indice: 10 }, fecDe([frag(9), frag(9)]))); // L = 9 com i < n-1
  campo(v, dg({ ...base, indice: 0, total: 1 }, Buffer.concat([Buffer.from([1, 0, 0, 0])]))); // L = 0
  const res = fecDe(dez);
  res[1] = 1;
  campo(v, dg(base, res));
  campo(v, dg({ ...base, flags: FLAG.KEYFRAME | FLAG.FIM_DE_QUADRO }, fecDe(dez)));
  campo(v, dg({ ...base, flags: FLAG.KEYFRAME | FLAG.RETRANSMISSAO }, fecDe(dez)));
  // fecN = 0: todo FEC e campo (nada de i % 0); N = 1 exige k = 1.
  const sem = new P.Verificador();
  sem.adicionarSessao(0x12345678, { chave: CHAVE, papel: 'receptor', fecN: 0 });
  campo(sem, dg({ ...base, total: 1 }, fecDe([frag(9)])));
  const n1 = new P.Verificador();
  n1.adicionarSessao(0x12345678, { chave: CHAVE, papel: 'receptor', fecN: 1 });
  ok(n1, dg({ ...base, indice: 3 }, fecDe([frag(1152)])));
  campo(n1, dg(base, fecDe(dez)));
});

test('tipos sem quadro: quadro, indice, total e flags que nao sao VOLTA contam campo', () => {
  const v = ver({ papel: 'emissor' });
  const tchau = P.payloadTchau({ motivo: 1 });
  ok(v, dg({ tipo: TIPO.TCHAU, flags: FLAG.VOLTA }, tchau));
  campo(v, dg({ tipo: TIPO.TCHAU, flags: FLAG.VOLTA, quadro: 1 }, tchau));
  campo(v, dg({ tipo: TIPO.TCHAU, flags: FLAG.VOLTA, indice: 1 }, tchau));
  campo(v, dg({ tipo: TIPO.TCHAU, flags: FLAG.VOLTA, total: 1 }, tchau));
  campo(v, dg({ tipo: TIPO.TCHAU, flags: FLAG.VOLTA | FLAG.KEYFRAME }, tchau));
});

test('NACK: qtd, tamanho, quadro, faixa, quadro inteiro (0xFFFF) e VOLTA obrigatorio', () => {
  const v = ver({ papel: 'emissor' });
  const nack = (entradas) => dg({ tipo: TIPO.NACK, flags: FLAG.VOLTA }, P.payloadNack(entradas));
  ok(v, nack([{ quadro: 1, primeiro: 0, quantidade: 1 }, { quadro: 9, primeiro: 0, quantidade: 0xffff }]));
  ok(v, nack([{ quadro: 1, primeiro: 1000, quantidade: 24 }]));
  ok(v, nack(Array.from({ length: 64 }, (_, k) => ({ quadro: k + 1, primeiro: 0, quantidade: 1 }))));
  campo(v, nack([{ quadro: 0, primeiro: 0, quantidade: 1 }]));
  campo(v, nack([{ quadro: 1, primeiro: 0, quantidade: 0 }]));
  campo(v, nack([{ quadro: 1, primeiro: 1000, quantidade: 25 }]));
  campo(v, nack([{ quadro: 1, primeiro: 1, quantidade: 0xffff }]));
  campo(v, nack([{ quadro: 1, primeiro: 0, quantidade: 1025 }]));
  const p = P.payloadNack([{ quadro: 1, primeiro: 0, quantidade: 1 }]);
  campo(v, dg({ tipo: TIPO.NACK, flags: FLAG.VOLTA }, Buffer.concat([p, Buffer.alloc(8)]))); // qtd 1, 2 entradas
  const zero = Buffer.from(p);
  zero[0] = 0;
  campo(v, dg({ tipo: TIPO.NACK, flags: FLAG.VOLTA }, zero));
  const res = Buffer.from(p);
  res[1] = 1;
  campo(v, dg({ tipo: TIPO.NACK, flags: FLAG.VOLTA }, res));
  const muitos = Buffer.alloc(2 + 8 * 65);
  muitos[0] = 65;
  campo(v, dg({ tipo: TIPO.NACK, flags: FLAG.VOLTA }, muitos));
  // NACK com VOLTA = 0 chega a um receptor: passa do passo 6 e cai no 8.
  campo(ver(), dg({ tipo: TIPO.NACK }, p));
});

test('PEDIR_KEYFRAME: motivo 1-4, reservado e tamanho', () => {
  const v = ver({ papel: 'emissor' });
  const pedir = (payload) => dg({ tipo: TIPO.PEDIR_KEYFRAME, flags: FLAG.VOLTA }, payload);
  const r = v.verificar(pedir(P.payloadPedirKeyframe({ motivo: 3, ultimoQuadro: 77 })));
  assert.deepEqual(r.pacote.campos, { motivo: 3, ultimoQuadro: 77 });
  campo(v, pedir(P.payloadPedirKeyframe({ motivo: 0, ultimoQuadro: 0 })));
  campo(v, pedir(P.payloadPedirKeyframe({ motivo: 5, ultimoQuadro: 0 })));
  const res = P.payloadPedirKeyframe({ motivo: 1, ultimoQuadro: 0 });
  res[2] = 1;
  campo(v, pedir(res));
  campo(v, pedir(Buffer.concat([P.payloadPedirKeyframe({ motivo: 1, ultimoQuadro: 0 }), Buffer.alloc(1)])));
  campo(ver(), dg({ tipo: TIPO.PEDIR_KEYFRAME }, P.payloadPedirKeyframe({ motivo: 1, ultimoQuadro: 0 })));
});

test('RELATORIO: 40 bytes, VOLTA obrigatorio, contadores de 16 bits saturam', () => {
  const v = ver({ papel: 'emissor' });
  const r = v.verificar(dg({ tipo: TIPO.RELATORIO, flags: FLAG.VOLTA }, P.payloadRelatorio({ nacks: 70000 })));
  assert.equal(r.pacote.campos.nacks, 65535);
  campo(v, dg({ tipo: TIPO.RELATORIO, flags: FLAG.VOLTA }, Buffer.alloc(39)));
  campo(ver(), dg({ tipo: TIPO.RELATORIO }, Buffer.alloc(40)));
});

test('OLA: estado 0/1, estado 1 so no sentido de ida, reservado e tamanho', () => {
  const rec = ver();
  const emi = ver({ papel: 'emissor' });
  const r = rec.verificar(dg({ tipo: TIPO.OLA }, P.payloadOla({ estado: 1, ecoTempo: 5, ecoEsperaUs: 6 })));
  assert.deepEqual(r.pacote.campos, { estado: 1, ecoTempo: 5, ecoEsperaUs: 6 });
  ok(emi, dg({ tipo: TIPO.OLA, flags: FLAG.VOLTA }, P.payloadOla({ estado: 0 })));
  campo(emi, dg({ tipo: TIPO.OLA, flags: FLAG.VOLTA }, P.payloadOla({ estado: 1 })));
  campo(rec, dg({ tipo: TIPO.OLA }, P.payloadOla({ estado: 2 })));
  const res = P.payloadOla({});
  res[3] = 9;
  campo(rec, dg({ tipo: TIPO.OLA }, res));
  campo(rec, dg({ tipo: TIPO.OLA }, Buffer.alloc(11)));
});

test('TCHAU: motivo 1-6, reservado e tamanho; vale nos dois sentidos', () => {
  const rec = ver();
  for (let m = 1; m <= 6; m++) ok(rec, dg({ tipo: TIPO.TCHAU }, P.payloadTchau({ motivo: m })));
  campo(rec, dg({ tipo: TIPO.TCHAU }, P.payloadTchau({ motivo: 0 })));
  campo(rec, dg({ tipo: TIPO.TCHAU }, P.payloadTchau({ motivo: 7 })));
  const res = P.payloadTchau({ motivo: 1 });
  res[1] = 1;
  campo(rec, dg({ tipo: TIPO.TCHAU }, res));
  campo(rec, dg({ tipo: TIPO.TCHAU }, Buffer.alloc(5, 1)));
  ok(ver({ papel: 'emissor' }), dg({ tipo: TIPO.TCHAU, flags: FLAG.VOLTA }, P.payloadTchau({ motivo: 5 })));
});

test('montarDatagrama recusa payload acima de 1156 e campos fora de 32 bits', () => {
  const grande = { tipo: 1, sessao: 1, seq: 1, tempo: 0, payload: frag(1157) };
  assert.throws(() => P.montarDatagrama(grande, CHAVE), RangeError);
  assert.throws(() => P.montarDatagrama({ tipo: 1, sessao: 2 ** 32, seq: 1, tempo: 0 }, CHAVE), RangeError);
  assert.equal(P.montarDatagrama({ tipo: 2, sessao: 1, seq: 1, tempo: 0, payload: frag(1156) }, CHAVE).length, 1200);
});
