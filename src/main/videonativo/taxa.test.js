'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const P = require('./pacote');
const { MedidorRelatorio, ControleTaxa, FOLGA_MS } = require('./taxa');

const us = (ms) => Math.floor(ms * 1000) >>> 0;

test('medidor: esperados, recebidos, kbps e deltas dos contadores por periodo', () => {
  let t = 1000;
  const m = new MedidorRelatorio({ agora: () => t });
  // Periodo 1: seq 5..14 com o 9 perdido.
  for (let s = 5; s <= 14; s++) if (s !== 9) m.aoPacote({ seq: s, tempo: us(t), bytes: 1000 });
  t += 200;
  const r1 = m.gerar({ quadros_completos: 3, pedidos_nack: 1, recuperados_fec: 2, quadros_vencidos: 0 });
  assert.equal(r1.esperados, 10);
  assert.equal(r1.recebidos, 9);
  assert.equal(r1.kbps, 360); // 9000 B * 8 / 200 ms
  assert.equal(r1.intervaloUs, 200000);
  assert.equal(r1.maiorSeq, 14);
  assert.deepEqual([r1.quadrosCompletos, r1.nacks, r1.recuperadosFec], [3, 1, 2]);
  // Periodo 2: so o 16 (15 perdido); contadores viram delta.
  m.aoPacote({ seq: 16, tempo: us(t), bytes: 500 });
  t += 200;
  const r2 = m.gerar({ quadros_completos: 4, pedidos_nack: 1, recuperados_fec: 2, quadros_vencidos: 1 });
  assert.equal(r2.esperados, 2);
  assert.equal(r2.recebidos, 1);
  assert.deepEqual([r2.quadrosCompletos, r2.nacks, r2.quadrosVencidos], [1, 0, 1]);
  // Periodo vazio: tudo zero, sem dividir por zero.
  t += 200;
  const r3 = m.gerar({ quadros_completos: 4, pedidos_nack: 1, recuperados_fec: 2, quadros_vencidos: 1 });
  assert.deepEqual([r3.esperados, r3.recebidos, r3.kbps, r3.atrasoMedioUs], [0, 0, 0, 0]);
  // Os campos cabem no payload do fio e voltam iguais.
  assert.equal(P.payloadRelatorio(r1).length, 40);
});

test('medidor: atraso relativo ao minimo, com relogios de offset qualquer e wrap de 32 bits', () => {
  let t = 0;
  const m = new MedidorRelatorio({ agora: () => t });
  const offsetUs = 0xfffff000; // relogio de quem manda perto do wrap
  const mandar = (atrasoMs) => {
    const envio = t - atrasoMs;
    m.aoPacote({ seq: Math.floor(t) + 1, tempo: (us(envio) + offsetUs) >>> 0, bytes: 100 });
  };
  t = 10;
  mandar(3); // d minimo
  t = 20;
  mandar(8); // 5 ms acima
  t = 30;
  mandar(13); // 10 ms acima
  const r = m.gerar();
  assert.equal(r.atrasoMedioUs, 5000);
  assert.equal(r.atrasoMaxUs, 10000);
  assert.equal(r.ecoEsperaUs, 0);
  t = 30.5;
  assert.equal(m.gerar().ecoEsperaUs, 500);
});

test('medidor: o minimo do atraso esquece o que tem mais de 10 s', () => {
  let t = 0;
  const m = new MedidorRelatorio({ agora: () => t });
  m.aoPacote({ seq: 1, tempo: us(t - 1), bytes: 1 }); // 1 ms
  t = 11000;
  m.aoPacote({ seq: 2, tempo: us(t - 20), bytes: 1 }); // 20 ms, mas o minimo velho saiu da janela
  m.gerar();
  t = 11001;
  m.aoPacote({ seq: 3, tempo: us(t - 25), bytes: 1 });
  assert.equal(m.gerar().atrasoMedioUs, 5000);
});

function rel(o = {}) {
  return { esperados: 100, recebidos: 100, kbps: 10000, atrasoMedioUs: 1000, ecoTempo: 0, ecoEsperaUs: 0, ...o };
}

test('controle: perda acima de 5% em 1 s corta 20%, e espera 1 s antes do proximo corte', () => {
  let t = 0;
  const c = new ControleTaxa({ kbps: 10000, teto: 20000, agora: () => t });
  const passo = (o) => {
    t += 200;
    return c.relatorio(rel(o));
  };
  assert.equal(passo({ recebidos: 98 }), null); // 2 %
  assert.equal(passo({ recebidos: 80 }), 8000); // soma: 22/200 = 11 %
  assert.equal(passo({ recebidos: 80 }), null); // dentro do 1 s depois do corte
  assert.equal(passo({ recebidos: 80 }), null);
  assert.equal(passo({ recebidos: 80 }), null);
  assert.equal(passo({ recebidos: 80 }), null); // 1200 ms: 800 ms depois do corte de 400 ms
  assert.equal(passo({ recebidos: 80 }), 6400);
  assert.equal(c.contadores.cortes, 2);
});

test('controle: no corte o alvo fica abaixo do que de fato chegou', () => {
  let t = 0;
  const c = new ControleTaxa({ kbps: 20000, teto: 20000, agora: () => t });
  t += 200;
  assert.equal(c.relatorio(rel({ recebidos: 50, kbps: 8000 })), 6800);
});

test('controle: atraso medio subindo 3 vezes seguidas e acima de 10 ms corta', () => {
  let t = 0;
  const c = new ControleTaxa({ kbps: 10000, teto: 20000, agora: () => t });
  const out = [4000, 7000, 9000, 12000].map((a) => {
    t += 200;
    return c.relatorio(rel({ atrasoMedioUs: a }));
  });
  assert.deepEqual(out, [null, null, null, 8000]);
  // Atraso alto mas estavel nao corta.
  const c2 = new ControleTaxa({ kbps: 10000, teto: 20000, agora: () => t });
  for (let i = 0; i < 6; i++) {
    t += 200;
    assert.equal(c2.relatorio(rel({ atrasoMedioUs: 15000 })), null);
  }
});

test('controle: folga por 5 s sobe 10% ate o teto; piso segura os cortes', () => {
  let t = 0;
  const c = new ControleTaxa({ kbps: 10000, teto: 11500, piso: 9000, agora: () => t });
  const mudancas = [];
  for (let i = 0; i < (3 * FOLGA_MS) / 200; i++) {
    t += 200;
    const n = c.relatorio(rel());
    if (n !== null) mudancas.push([t, n]);
  }
  assert.deepEqual(mudancas, [[5000, 11000], [10000, 11500]]);
  for (let i = 0; i < 30; i++) {
    t += 200;
    c.relatorio(rel({ recebidos: 50 }));
  }
  assert.equal(c.kbps, 9000);
  assert.equal(c.definirTeto(8000), 8000);
  assert.equal(c.definirTeto(8000), null);
});

test('controle: relatorio a menos de 100 ms do anterior e descartado; RTT pelo eco', () => {
  let t = 1000;
  const c = new ControleTaxa({ kbps: 10000, teto: 20000, agora: () => t });
  c.relatorio(rel({ ecoTempo: us(990), ecoEsperaUs: 2000 }));
  assert.equal(c.rttUs, 8000);
  t += 50;
  assert.equal(c.relatorio(rel({ recebidos: 0 })), null);
  assert.equal(c.contadores.relatorio_excesso, 1);
});
