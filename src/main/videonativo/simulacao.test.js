'use strict';
/*
 * P2.3, criterio de pronto do plano: "com 2% de perda simulada, o video segue sem keyframe em mais de
 * 95% dos quadros". Simulacao de eventos discretos com o caminho real de ponta a ponta em JS:
 * fragmentarQuadro -> montarDatagrama (HMAC) -> rede com perda, atraso e jitter -> Verificador ->
 * Remontador, com o NACK voltando ao BufferReenvio e o PEDIR_KEYFRAME ao "encoder".
 * Perda vale para tudo: VIDEO, FEC, reenvio, NACK e PEDIR_KEYFRAME.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const C = require('./constantes');
const P = require('./pacote');
const { Remontador } = require('./remontar');
const { BufferReenvio } = require('./reenvio');

const SESSAO = 0x01020304;
const CHAVE = crypto.createHash('sha256').update('simulacao').digest();

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simular({ perda, quadros = 1800, fecN = 10, semente = 7, idaMs = 2, jitterMs = 0.5 }) {
  const rnd = mulberry32(semente);
  let t = 0;
  const fila = []; // eventos {t, fn}, ordenados por t
  const agenda = (em, fn) => {
    let i = fila.length;
    while (i > 0 && fila[i - 1].t > em) i--;
    fila.splice(i, 0, { t: em, fn });
  };
  const rede = (fn) => {
    if (rnd() < perda) return;
    agenda(t + idaMs + rnd() * jitterMs, fn);
  };

  const ver = new P.Verificador({ agora: () => t });
  ver.adicionarSessao(SESSAO, { chave: CHAVE, papel: 'receptor', fecN });
  const buf = new BufferReenvio({ agora: () => t });
  const bitrate = 20e6;
  let seq = 1;
  let querKeyframe = false;
  let keyframesPedidos = 0;
  const entregues = [];

  const enviar = (p) => {
    const dg = P.montarDatagrama({ ...p, sessao: SESSAO, seq: seq++, tempo: 0 }, CHAVE);
    rede(() => {
      const r = ver.verificar(dg);
      assert.equal(r.ok, true);
      rem.receber(r.pacote);
    });
  };
  const rem = new Remontador({
    fecN,
    agora: () => t,
    aoQuadro: (q) => entregues.push(q.quadro),
    aoNack: (entradas) => rede(() => buf.atender(entradas, bitrate).forEach(enviar)),
    aoPedirKeyframe: () => rede(() => {
      querKeyframe = true;
      keyframesPedidos++;
    }),
  });

  const intervalo = 1000 / 60;
  for (let k = 0; k < quadros; k++) {
    agenda(k * intervalo, () => {
      const keyframe = k === 0 || querKeyframe;
      querKeyframe = false;
      const tam = keyframe ? 60000 : 4000 + Math.floor(rnd() * 26000);
      const ps = P.fragmentarQuadro(crypto.randomBytes(tam), { quadro: k + 1, keyframe, fecN });
      // Pacing: os pacotes do quadro espalhados em ~2 ms.
      ps.forEach((p, i) => {
        buf.guardar(p);
        agenda(t + (2 * i) / ps.length, () => enviar(p));
      });
    });
  }
  const fim = quadros * intervalo + 500;
  for (let x = 0; x <= fim; x += C.ESPERA_NACK_MS) agenda(x, () => rem.tick());

  while (fila.length) {
    const ev = fila.shift();
    t = ev.t;
    ev.fn();
  }
  return { entregues, keyframesPedidos, contadores: rem.contadores, reenvio: buf.contadores };
}

test('simulacao: sem perda, todos os quadros chegam e nada e pedido', () => {
  const r = simular({ perda: 0, quadros: 300 });
  assert.equal(r.entregues.length, 300);
  assert.equal(r.contadores.nacks, 0);
  assert.equal(r.keyframesPedidos, 0);
});

for (const fecN of [C.FEC_N_PADRAO, 5]) {
  test(`simulacao: 2% de perda (fecN=${fecN}), mais de 95% dos quadros chegam sem keyframe pedido`, () => {
    const quadros = 1800; // 30 s a 60 fps
    const r = simular({ perda: 0.02, quadros, fecN });
    const fracao = r.entregues.length / quadros;
    assert.ok(fracao > 0.95, `entregues ${r.entregues.length}/${quadros} (${(100 * fracao).toFixed(1)}%), `
      + `keyframes pedidos ${r.keyframesPedidos}, ${JSON.stringify(r.contadores)}`);
    // Em ordem e sem repetir.
    for (let i = 1; i < r.entregues.length; i++) assert.ok(r.entregues[i] > r.entregues[i - 1]);
    assert.ok(r.contadores.nacks > 0);
    assert.ok(r.contadores.recuperados_fec > 0);
    assert.ok(r.reenvio.reenviados > 0);
  });
}

// Sem FEC a spec (6.5) pede cada fragmento uma vez so: NACK ou reenvio perdido (~4 %) vence o quadro
// e custa ~10 quadros ate o keyframe. Medido em 27/11: 87-94 % em 4 sementes. Piso de regressao, nao
// criterio; a decisao (segundo NACK?) esta na Revisao da spec.
test('simulacao: 2% de perda sem FEC fica acima de 80% (piso de regressao)', () => {
  const r = simular({ perda: 0.02, quadros: 1800, fecN: 0 });
  assert.ok(r.entregues.length / 1800 > 0.8, `entregues ${r.entregues.length}/1800`);
  assert.equal(r.contadores.recuperados_fec, 0);
});
