'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const C = require('./constantes');
const P = require('./pacote');
const { Remontador, ReceptorVideo } = require('./remontar');

const { TIPO, MODO } = C;
const SESSAO = 0x0a0b0c0d;
const CHAVE = crypto.createHash('sha256').update('chave de teste').digest();

// Monta um cenario: relogio injetavel, Remontador e um "emissor" que gera pacotes ja aceitos pelo
// Verificador (o caminho real: datagrama com HMAC -> verificar -> remontador).
function cenario({ fecN = 10 } = {}) {
  const c = { t: 0, quadros: [], pedidos: [], dados: new Map() };
  c.rem = new Remontador({
    fecN,
    agora: () => c.t,
    aoQuadro: (q) => c.quadros.push(q),
    aoPedirKeyframe: (p) => c.pedidos.push(p),
  });
  const ver = new P.Verificador();
  ver.adicionarSessao(SESSAO, { chave: CHAVE, papel: 'receptor', fecN });
  let seq = 1;
  // Pacotes do quadro `q` (VIDEO e FEC), ja verificados. `tam` em bytes.
  c.pacotes = (q, keyframe, tam = 1152 * 3 - 100) => {
    const dados = crypto.randomBytes(tam);
    c.dados.set(q, dados);
    return P.fragmentarQuadro(dados, { quadro: q, keyframe, fecN }).map((p) => {
      const r = ver.verificar(P.montarDatagrama({ ...p, sessao: SESSAO, seq: seq++, tempo: 0 }, CHAVE));
      assert.equal(r.ok, true);
      return r.pacote;
    });
  };
  c.videos = (q, keyframe, tam) => c.pacotes(q, keyframe, tam).filter((p) => p.tipo === TIPO.VIDEO);
  c.dar = (ps) => ps.forEach((p) => c.rem.receber(p));
  c.entregues = () => c.quadros.map((q) => q.quadro);
  c.confere = () => c.quadros.forEach((q) => assert.deepEqual(q.dados, c.dados.get(q.quadro), `quadro ${q.quadro}`));
  return c;
}

test('em ordem: keyframe e deltas entregues inteiros, na ordem, com o tipo certo', () => {
  const c = cenario();
  c.dar(c.pacotes(10, true));
  assert.equal(c.rem.modo, MODO.NORMAL);
  c.dar(c.pacotes(11, false));
  c.dar(c.pacotes(12, false, 1));
  assert.deepEqual(c.entregues(), [10, 11, 12]);
  assert.deepEqual(c.quadros.map((q) => q.keyframe), [true, false, false]);
  c.confere();
  assert.equal(c.rem.U, 12);
  assert.equal(c.rem.montagem.size, 0);
  assert.equal(c.rem.contadores.quadros_completos, 3);
  assert.deepEqual(c.pedidos, []);
});

test('reordenacao: fragmentos embaralhados e quadros cruzados saem em ordem', () => {
  const c = cenario();
  const k = c.pacotes(10, true, 1152 * 12);
  const d1 = c.pacotes(11, false, 1152 * 5 + 1);
  const d2 = c.pacotes(12, false, 2000);
  // 12 chega antes de 11, e cada quadro de tras para a frente.
  c.dar([...k].reverse());
  c.dar([...d2].reverse());
  assert.deepEqual(c.entregues(), [10]);
  c.dar([d1[3], d1[0], d1[5], d1[1], d1[4], d1[2], d1[6]]);
  assert.deepEqual(c.entregues(), [10, 11, 12]);
  c.confere();
});

test('duplicacao: cada pacote duas vezes (VIDEO e FEC) nao muda a saida e conta duplicados', () => {
  const c = cenario();
  const k = c.pacotes(10, true);
  const d = c.pacotes(11, false, 1152 * 11);
  for (const p of k) c.dar([p, p]);
  c.dar(d.slice(0, 5));
  c.dar(d.slice(0, 5));
  c.dar(d.slice(5));
  assert.deepEqual(c.entregues(), [10, 11]);
  c.confere();
  // k: os 2 primeiros VIDEO repetidos sao duplicados; a copia do ultimo e o FEC (2x) ja chegam com o
  // quadro entregue e contam atrasados (regra 1). d: 5 VIDEO duplicados; o FEC do ultimo grupo, atrasado.
  assert.equal(c.rem.contadores.duplicados, 2 + 5);
  assert.equal(c.rem.contadores.atrasados, 3 + 1);
  c.dar([d[0]]);
  assert.equal(c.rem.contadores.atrasados, 5);
});

test('perda e vencimento: quadro incompleto vence em 100 ms, leva os deltas seguintes e pede keyframe', () => {
  const c = cenario();
  c.dar(c.pacotes(10, true));
  const d11 = c.videos(11, false);
  c.dar(d11.slice(1)); // perdeu o fragmento 0
  c.dar(c.pacotes(12, false)); // completo, mas espera o 11
  assert.deepEqual(c.entregues(), [10]);
  c.t = 99;
  c.rem.tick();
  assert.equal(c.rem.montagem.size, 2);
  c.t = 100;
  c.rem.tick();
  assert.equal(c.rem.montagem.size, 0);
  assert.equal(c.rem.modo, MODO.ESPERANDO_KEYFRAME);
  assert.equal(c.rem.contadores.quadros_vencidos, 1);
  assert.equal(c.rem.contadores.quadros_descartados, 1);
  assert.deepEqual(c.pedidos, [{ motivo: C.MOTIVO_KEYFRAME.VENCIDO, ultimoQuadro: 10 }]);
  // Delta seguinte sem keyframe em montagem: sem_referencia, sem NACK nem pedido novo antes de 500 ms.
  c.dar(c.pacotes(13, false));
  assert.equal(c.rem.contadores.sem_referencia, 4); // 3 fragmentos e o FEC do 13
  assert.equal(c.pedidos.length, 1);
  // O fragmento perdido chegando tarde nao ressuscita o 11.
  c.dar([d11[0]]);
  assert.equal(c.rem.montagem.size, 0);
  // Keyframe novo encerra a espera.
  c.dar(c.pacotes(14, true));
  assert.deepEqual(c.entregues(), [10, 14]);
  assert.equal(c.rem.modo, MODO.NORMAL);
  c.confere();
});

test('PEDIR_KEYFRAME: no maximo 1 a cada 500 ms, repete enquanto espera, cala com keyframe a caminho', () => {
  const c = cenario();
  c.dar(c.pacotes(5, false)); // inicio da sessao: delta sem referencia
  assert.deepEqual(c.pedidos, [{ motivo: C.MOTIVO_KEYFRAME.SEM_REFERENCIA, ultimoQuadro: 0 }]);
  c.t = 499;
  c.rem.tick();
  c.dar(c.pacotes(6, false));
  assert.equal(c.pedidos.length, 1);
  c.t = 500;
  c.rem.tick();
  assert.equal(c.pedidos.length, 2);
  c.t = 1000;
  c.dar(c.videos(7, true).slice(0, 1)); // keyframe em montagem: nao repete
  c.t = 1100;
  c.rem.tick(); // o 7 venceu aqui (100 ms) e nao ha outro keyframe: volta a pedir (motivo do pendente)
  assert.equal(c.rem.contadores.quadros_vencidos, 1);
  assert.equal(c.pedidos.length, 3);
  c.dar(c.pacotes(8, true));
  c.t = 5000;
  c.rem.tick();
  assert.equal(c.pedidos.length, 3);
  assert.deepEqual(c.entregues(), [8]);
});

test('pedirKeyframe do decoder (P2.5): pede na hora com o motivo dado, respeitando os 500 ms', () => {
  const c = cenario();
  c.dar(c.pacotes(1, true));
  c.t = 10;
  c.rem.pedirKeyframe(C.MOTIVO_KEYFRAME.ERRO_DECODE);
  c.rem.pedirKeyframe(C.MOTIVO_KEYFRAME.SEM_SPS_PPS);
  assert.deepEqual(c.pedidos, [{ motivo: 2, ultimoQuadro: 1 }]);
  assert.equal(c.rem.modo, MODO.ESPERANDO_KEYFRAME);
});

test('keyframe chegando em ESPERANDO_KEYFRAME, com deltas completos atras dele em montagem', () => {
  const c = cenario();
  const k = c.videos(50, true, 1152 * 4);
  c.dar(k.slice(0, 3)); // falta o ultimo
  c.dar(c.pacotes(51, false)); // regra 2: ha keyframe menor em montagem, entra
  c.dar(c.pacotes(52, false));
  assert.deepEqual(c.entregues(), []);
  assert.equal(c.rem.contadores.sem_referencia, 0);
  c.dar(k.slice(3));
  assert.deepEqual(c.entregues(), [50, 51, 52]);
  assert.equal(c.rem.modo, MODO.NORMAL);
  c.confere();
});

test('delta atras de keyframe em montagem com lacuna: entradas vazias (regra 7, keyframe no lugar de U)', () => {
  const c = cenario();
  const k = c.videos(50, true);
  c.dar(k.slice(1));
  const d51 = c.pacotes(51, false);
  const d52 = c.pacotes(52, false);
  c.dar(c.pacotes(53, false));
  assert.deepEqual([...c.rem.montagem.keys()].sort((a, b) => a - b), [50, 51, 52, 53]);
  const vazias = c.rem.entradas().filter((e) => e.n === null).map((e) => e.quadro);
  assert.deepEqual(vazias, [51, 52]);
  c.dar([...d52, ...d51, k[0]]);
  assert.deepEqual(c.entregues(), [50, 51, 52, 53]);
  c.confere();
});

test('keyframe em ESPERANDO_KEYFRAME nao cria lacuna, mesmo longe do ultimo entregue', () => {
  const c = cenario();
  c.dar(c.pacotes(1, true));
  c.rem.pedirKeyframe(C.MOTIVO_KEYFRAME.ERRO_DECODE);
  c.dar(c.pacotes(500, true));
  assert.deepEqual(c.entregues(), [1, 500]);
  assert.equal(c.rem.contadores.lacunas, 0);
  assert.equal(c.pedidos.length, 1);
});

test('lacuna pequena em NORMAL: entradas vazias; se ninguem chega, vencem e pedem keyframe', () => {
  const c = cenario();
  c.dar(c.pacotes(10, true));
  const d11 = c.pacotes(11, false);
  c.dar(c.pacotes(13, false));
  assert.deepEqual(c.rem.entradas().map((e) => [e.quadro, e.n]), [[11, null], [12, null], [13, 3]]);
  c.dar(d11);
  assert.deepEqual(c.entregues(), [10, 11]);
  c.t = 100;
  c.rem.tick();
  assert.equal(c.rem.contadores.quadros_vencidos, 1); // o 12
  assert.equal(c.rem.contadores.quadros_descartados, 1); // o 13, que dependia dele
  assert.deepEqual(c.pedidos, [{ motivo: 1, ultimoQuadro: 11 }]);
});

test('lacuna grande em NORMAL: delta descarta tudo e pede; keyframe descarta tudo e segue sem pedir', () => {
  const c = cenario();
  c.dar(c.pacotes(10, true));
  c.dar(c.videos(11, false).slice(0, 1));
  c.dar(c.pacotes(20, false)); // lacuna de 9 (11..19), com o 11 em montagem
  assert.equal(c.rem.contadores.lacunas, 1);
  assert.equal(c.rem.montagem.size, 0);
  assert.equal(c.rem.modo, MODO.ESPERANDO_KEYFRAME);
  assert.deepEqual(c.pedidos, [{ motivo: 1, ultimoQuadro: 10 }]);

  const d = cenario();
  d.dar(d.pacotes(10, true));
  d.dar(d.videos(11, false).slice(0, 1));
  d.dar(d.pacotes(25, true));
  assert.deepEqual(d.entregues(), [10, 25]);
  assert.equal(d.rem.contadores.lacunas, 1);
  assert.deepEqual(d.pedidos, []);
});

test('regra 6: o nono quadro em montagem faz vencer o de menor numero na hora', () => {
  const c = cenario();
  c.dar(c.pacotes(10, true));
  for (let q = 11; q <= 18; q++) c.dar(c.videos(q, false).slice(1)); // todos incompletos
  assert.equal(c.rem.montagem.size, 8);
  c.dar(c.pacotes(19, false));
  assert.equal(c.rem.contadores.quadros_vencidos, 1);
  assert.equal(c.rem.contadores.quadros_descartados, 7);
  assert.equal(c.rem.montagem.size, 0);
  assert.equal(c.rem.contadores.sem_referencia, 4); // o 19 (3 VIDEO + FEC) ja caiu em ESPERANDO_KEYFRAME
  assert.equal(c.pedidos.length, 1);
});

test('keyframe completo entrega na hora e descarta o que esta atras, sem pedir', () => {
  const c = cenario();
  c.dar(c.pacotes(10, true));
  c.dar(c.videos(11, false).slice(1));
  c.dar(c.pacotes(12, true));
  assert.deepEqual(c.entregues(), [10, 12]);
  assert.equal(c.rem.contadores.quadros_descartados, 1);
  assert.deepEqual(c.pedidos, []);
});

test('vencimento com keyframe posterior em montagem: deltas caem, keyframe continua, sem pedido', () => {
  const c = cenario();
  c.dar(c.pacotes(10, true));
  c.dar(c.videos(11, false).slice(1));
  c.t = 50; // o 12 e o 13 comecam depois: so o 11 vence aos 100 ms
  const k12 = c.videos(12, true);
  c.dar(k12.slice(1));
  c.dar(c.pacotes(13, false));
  c.t = 100;
  c.rem.tick();
  assert.equal(c.rem.contadores.quadros_vencidos, 1);
  assert.deepEqual([...c.rem.montagem.keys()], [12]);
  assert.deepEqual(c.pedidos, []);
  c.dar([k12[0]]);
  assert.deepEqual(c.entregues(), [10, 12]);
  assert.equal(c.rem.modo, MODO.NORMAL);
});

test('regra 3: n ou KEYFRAME diferente do primeiro pacote do quadro conta campo', () => {
  const c = cenario();
  c.dar(c.pacotes(10, true));
  const d = c.videos(11, false, 1152 * 3);
  c.dar([d[0]]);
  c.dar([{ ...d[1], total: 4 }]);
  c.dar([{ ...d[1], flags: d[1].flags | C.FLAG.KEYFRAME }]);
  assert.equal(c.rem.contadores.campo, 2);
  c.dar(d.slice(1));
  assert.deepEqual(c.entregues(), [10, 11]);
});

test('recuperarFec (gancho do P2.3): um faltante por grupo volta pelo FEC; dois faltantes nao', () => {
  const c = cenario();
  c.dar(c.pacotes(10, true));
  const ps = c.pacotes(11, false, 1152 * 11 + 5); // grupos [0-9] e [10-11]
  const semPerda = ps.filter((p) => !(p.tipo === TIPO.VIDEO && (p.indice === 3 || p.indice === 11)));
  c.dar(semPerda);
  const e = c.rem.entradas()[0];
  assert.deepEqual(e.faltantes, [3, 11]);
  assert.deepEqual(e.gruposComFec, [0, 10]);
  assert.equal(c.rem.recuperarFec(11, 0), 3);
  assert.equal(c.rem.recuperarFec(11, 0), -1); // nada mais faltando no grupo
  assert.deepEqual(c.entregues(), [10]);
  assert.equal(c.rem.recuperarFec(11, 10), 11); // o ultimo, de 5 bytes
  assert.deepEqual(c.entregues(), [10, 11]);
  assert.equal(c.rem.contadores.recuperados_fec, 2);
  c.confere();

  const d = cenario();
  d.dar(d.pacotes(10, true));
  const qs = d.pacotes(11, false, 1152 * 5);
  d.dar(qs.filter((p) => !(p.tipo === TIPO.VIDEO && p.indice < 2)));
  assert.equal(d.rem.recuperarFec(11, 0), -1);
  assert.equal(d.rem.recuperarFec(99, 0), -1);
});

test('recuperarFec com tamanho que nao fecha conta campo e nao entrega', () => {
  const c = cenario();
  c.dar(c.pacotes(10, true));
  const ps = c.pacotes(11, false, 1152 * 2);
  const fec = ps.find((p) => p.tipo === TIPO.FEC);
  c.dar([ps[1], { ...fec, campos: { ...fec.campos, xorTamanhos: fec.campos.xorTamanhos ^ 3 } }]);
  assert.equal(c.rem.recuperarFec(11, 0), -1);
  assert.equal(c.rem.contadores.campo, 1);
});

// --- ReceptorVideo: tabela de sessoes, endereco de volta e troca de sessao (9.2, 9.3) ---

function receptor() {
  const r = { t: 0, quadros: [], pedidos: [], fins: [], olas: [] };
  r.rv = new ReceptorVideo({
    agora: () => r.t,
    aoQuadro: (s, q) => r.quadros.push([s, q.quadro]),
    aoPedirKeyframe: (s, p) => r.pedidos.push([s, p.motivo]),
    aoOla: (s, o) => r.olas.push([s, o.estado]),
    aoFim: (s, m) => r.fins.push([s, m]),
  });
  return r;
}

function emissor(sessao, chave, fecN = 10) {
  let seq = 1;
  return {
    quadro: (q, keyframe, tam = 3000) => P.fragmentarQuadro(crypto.randomBytes(tam), { quadro: q, keyframe, fecN })
      .map((p) => P.montarDatagrama({ ...p, sessao, seq: seq++, tempo: 0 }, chave)),
    outro: (tipo, payload, flags = 0) =>
      P.montarDatagrama({ tipo, sessao, seq: seq++, tempo: 0, flags, payload }, chave),
  };
}

test('ReceptorVideo: entrega por sessao, HMAC errado e replay contados, endereco so de quem avanca', () => {
  const r = receptor();
  const chave = crypto.randomBytes(32);
  assert.deepEqual(r.rv.abrirSessao({ sessao: 7, chave, origem: 'p1' }), { aceita: true, substituida: null });
  const em = emissor(7, chave);
  const k = em.quadro(100, true);
  k.forEach((d) => r.rv.receber(d, '10.0.0.5:50000'));
  assert.deepEqual(r.quadros, [[7, 100]]);
  assert.equal(r.rv.sessao(7).endereco, '10.0.0.5:50000');
  // Repetido de outro endereco: replay, e o endereco de volta nao muda.
  assert.equal(r.rv.receber(k[0], '10.0.0.66:1').motivo, 'replay');
  // Atrasado dentro da janela (aceito, mas nao avanca): tambem nao muda o endereco.
  const d = em.quadro(101, false);
  r.rv.receber(d[1], '10.0.0.5:50000');
  r.rv.receber(d[0], '10.0.0.77:2');
  assert.equal(r.rv.sessao(7).endereco, '10.0.0.5:50000');
  const forjado = emissor(7, crypto.randomBytes(32)).quadro(102, true)[0];
  assert.equal(r.rv.receber(forjado, '10.0.0.88:3').motivo, 'hmac');
  assert.equal(r.rv.verificador.contadores.hmac, 1);
  assert.equal(r.rv.verificador.contadores.replay, 1);
});

test('ReceptorVideo: sessao repetida e recusada; mesma (origem, kind) substitui a anterior do zero', () => {
  const r = receptor();
  const ca = crypto.randomBytes(32);
  r.rv.abrirSessao({ sessao: 1, chave: ca, origem: 'p1' });
  assert.deepEqual(r.rv.abrirSessao({ sessao: 1, chave: ca, origem: 'p2' }), { aceita: false, motivo: 'sessao' });
  const a = emissor(1, ca);
  a.quadro(100, true).forEach((d) => r.rv.receber(d));
  const deltaA = a.quadro(101, false);
  assert.deepEqual(r.quadros, [[1, 100]]);

  // Origem diferente nao substitui.
  assert.equal(r.rv.abrirSessao({ sessao: 9, chave: crypto.randomBytes(32), origem: 'p2' }).substituida, null);
  // Exe reiniciado / sessao refeita: mesma origem, sessao nova.
  const cb = crypto.randomBytes(32);
  assert.deepEqual(r.rv.abrirSessao({ sessao: 2, chave: cb, origem: 'p1' }), { aceita: true, substituida: 1 });
  assert.equal(r.rv.sessao(1), null);
  // Pacotes atrasados da sessao velha caem em `sessao`.
  deltaA.forEach((d) => r.rv.receber(d));
  assert.equal(r.rv.verificador.contadores.sessao, deltaA.length);
  // A nova comeca em ESPERANDO_KEYFRAME, sem herdar U: delta 105 e sem referencia; keyframe 106 entra.
  const b = emissor(2, cb);
  b.quadro(105, false).forEach((d) => r.rv.receber(d));
  assert.equal(r.rv.sessao(2).remontador.contadores.sem_referencia, 4);
  b.quadro(106, true).forEach((d) => r.rv.receber(d));
  b.quadro(107, false).forEach((d) => r.rv.receber(d));
  assert.deepEqual(r.quadros, [[1, 100], [2, 106], [2, 107]]);
  assert.deepEqual(r.pedidos, [[2, C.MOTIVO_KEYFRAME.SEM_REFERENCIA]]);
});

test('ReceptorVideo: OLA guarda o estado; TCHAU apaga a sessao e avisa', () => {
  const r = receptor();
  const chave = crypto.randomBytes(32);
  r.rv.abrirSessao({ sessao: 3, chave, origem: 'p1' });
  const em = emissor(3, chave);
  r.rv.receber(em.outro(TIPO.OLA, P.payloadOla({ estado: 1 })));
  assert.equal(r.rv.sessao(3).estado, 1);
  assert.deepEqual(r.olas, [[3, 1]]);
  r.rv.receber(em.outro(TIPO.TCHAU, P.payloadTchau({ motivo: C.MOTIVO_TCHAU.FIM })));
  assert.deepEqual(r.fins, [[3, 1]]);
  assert.equal(r.rv.sessao(3), null);
  assert.equal(r.rv.receber(em.outro(TIPO.OLA, P.payloadOla({}))).motivo, 'sessao');
});

test('ReceptorVideo: tick faz vencer em todas as sessoes', () => {
  const r = receptor();
  const chave = crypto.randomBytes(32);
  r.rv.abrirSessao({ sessao: 4, chave, origem: 'p1' });
  const em = emissor(4, chave);
  em.quadro(1, true).forEach((d) => r.rv.receber(d));
  em.quadro(2, false).slice(1).forEach((d) => r.rv.receber(d));
  r.t = 100;
  r.rv.tick();
  assert.equal(r.rv.sessao(4).remontador.contadores.quadros_vencidos, 1);
  assert.deepEqual(r.pedidos, [[4, C.MOTIVO_KEYFRAME.VENCIDO]]);
});

// --- P2.3: suspeita, FEC automatico e NACK (6.5) ---

function cenarioNack(op) {
  const c = cenario(op);
  c.nacks = [];
  c.rem.aoNack = (e) => c.nacks.push(e);
  return c;
}

test('P2.3: faltante com indice maior chegando vira NACK depois de ESPERA_NACK_MS, uma vez so', () => {
  const c = cenarioNack({ fecN: 0 });
  c.dar(c.pacotes(10, true));
  const d = c.videos(11, false, 1152 * 5);
  c.dar([d[0], d[1], d[3], d[4]]); // falta o 2
  assert.deepEqual(c.nacks, []);
  c.t += C.ESPERA_NACK_MS - 1;
  c.rem.tick();
  assert.deepEqual(c.nacks, []);
  c.t += 1;
  c.rem.tick();
  assert.deepEqual(c.nacks, [[{ quadro: 11, primeiro: 2, quantidade: 1 }]]);
  c.t += 20;
  c.rem.tick();
  assert.equal(c.nacks.length, 1, 'cada fragmento e pedido uma vez so');
  c.dar([d[2]]);
  assert.deepEqual(c.entregues(), [10, 11]);
  c.confere();
  assert.equal(c.rem.contadores.nacks, 1);
  assert.equal(c.rem.contadores.pedidos_nack, 1);
});

test('P2.3: um faltante no grupo com FEC presente recupera sozinho, sem NACK', () => {
  const c = cenarioNack({ fecN: 4 });
  c.dar(c.pacotes(10, true));
  const d = c.pacotes(11, false, 1152 * 7 + 10); // 8 fragmentos, 2 grupos de 4
  const semUm = d.filter((p) => !(p.tipo === TIPO.VIDEO && p.indice === 5));
  c.dar(semUm);
  assert.deepEqual(c.entregues(), [10]);
  c.t += C.ESPERA_NACK_MS;
  c.rem.tick();
  assert.deepEqual(c.entregues(), [10, 11]);
  c.confere();
  assert.deepEqual(c.nacks, []);
  assert.equal(c.rem.contadores.recuperados_fec, 1);
});

test('P2.3: dois faltantes no grupo vao juntos numa faixa so do NACK', () => {
  const c = cenarioNack({ fecN: 4 });
  c.dar(c.pacotes(10, true));
  const d = c.pacotes(11, false, 1152 * 7 + 10);
  c.dar(d.filter((p) => !(p.tipo === TIPO.VIDEO && (p.indice === 1 || p.indice === 2))));
  c.t += C.ESPERA_NACK_MS;
  c.rem.tick();
  assert.deepEqual(c.nacks, [[{ quadro: 11, primeiro: 1, quantidade: 2 }]]);
});

test('P2.3: fim do quadro perdido fica suspeito com o quadro seguinte ou depois de SUSPEITA_MS', () => {
  const c = cenarioNack({ fecN: 0 });
  c.dar(c.pacotes(10, true));
  const d = c.videos(11, false, 1152 * 3);
  c.dar([d[0], d[1]]); // o ultimo (indice 2) nao chegou e nada indica isso
  c.t += C.ESPERA_NACK_MS;
  c.rem.tick();
  assert.deepEqual(c.nacks, []);
  c.t += C.SUSPEITA_MS - C.ESPERA_NACK_MS + C.ESPERA_NACK_MS; // 20 ms do ultimo pacote + 5 ms
  c.rem.tick();
  assert.deepEqual(c.nacks, [[{ quadro: 11, primeiro: 2, quantidade: 1 }]]);

  const c2 = cenarioNack({ fecN: 0 });
  c2.dar(c2.pacotes(10, true));
  const e = c2.videos(11, false, 1152 * 3);
  c2.dar([e[0], e[1]]);
  c2.dar([c2.videos(12, false, 100)[0]]); // quadro posterior: o fim do 11 vira suspeito
  c2.t += C.ESPERA_NACK_MS;
  c2.rem.tick();
  assert.deepEqual(c2.nacks, [[{ quadro: 11, primeiro: 2, quantidade: 1 }]]);
});

test('P2.3: quadro inteiro perdido vai como 0xFFFF e depois nao pede os fragmentos dele', () => {
  const c = cenarioNack({ fecN: 0 });
  c.dar(c.pacotes(10, true));
  const perdido = c.videos(11, false, 1152 * 2);
  c.dar(c.videos(12, false, 500));
  c.t += C.ESPERA_NACK_MS;
  c.rem.tick();
  assert.deepEqual(c.nacks, [[{ quadro: 11, primeiro: 0, quantidade: C.NACK_QUADRO_INTEIRO }]]);
  c.dar([perdido[1]]); // so metade do reenvio chegou
  c.t += 50;
  c.rem.tick();
  assert.equal(c.nacks.length, 1, 'depois do 0xFFFF todos contam como pedidos');
  c.dar([perdido[0]]);
  assert.deepEqual(c.entregues(), [10, 11, 12]);
  c.confere();
});

test('P2.3: no maximo 1 NACK a cada 5 ms; o que vence no intervalo espera o proximo', () => {
  const c = cenarioNack({ fecN: 0 });
  c.dar(c.pacotes(10, true));
  const a = c.videos(11, false, 1152 * 3);
  c.dar([a[0], a[2]]);
  c.t += C.ESPERA_NACK_MS;
  c.rem.tick();
  assert.equal(c.nacks.length, 1);
  const b = c.videos(12, false, 1152 * 3);
  c.t += 1;
  c.dar([b[0], b[2]]); // b[1] suspeito agora
  c.t += C.ESPERA_NACK_MS - 2; // passaram 4 ms do NACK anterior... e so 3 desde a suspeita
  c.rem.tick();
  assert.equal(c.nacks.length, 1);
  c.t += 2;
  c.rem.tick();
  assert.deepEqual(c.nacks[1], [{ quadro: 12, primeiro: 1, quantidade: 1 }]);
});

test('P2.3: NACK com mais de 64 faixas leva as 64 primeiras e o resto vai no seguinte', () => {
  const c = cenarioNack({ fecN: 0 });
  c.dar(c.pacotes(10, true));
  const d = c.videos(11, false, 1152 * 200);
  c.dar(d.filter((p) => p.indice % 2 === 0)); // 100 faltantes nao contiguos
  c.t += C.ESPERA_NACK_MS;
  c.rem.tick();
  assert.equal(c.nacks[0].length, C.NACK_MAX_ENTRADAS);
  c.t += C.SUSPEITA_MS; // o 199 (fim do quadro) so fica suspeito pelos 20 ms
  c.rem.tick();
  assert.equal(c.nacks[1].length, 100 - C.NACK_MAX_ENTRADAS);
  assert.equal(c.rem.contadores.pedidos_nack, 100);
  // As entradas montam um NACK valido.
  for (const n of c.nacks) assert.ok(P.payloadNack(n).length > 0);
});
