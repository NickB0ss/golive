'use strict';
/*
 * P2.4, criterio de pronto do plano: "com banda limitada artificialmente, o atraso volta ao normal em
 * menos de 3 s" (medido: ~2,0 s). Gargalo simulado (fila FIFO com descarte no fim, 300 ms de buffer), 1 ms por passo,
 * MedidorRelatorio do lado de quem assiste (relogio deslocado, para provar que o atraso relativo nao
 * depende de relogio sincronizado) e ControleTaxa do lado de quem transmite.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const C = require('./constantes');
const { MedidorRelatorio, ControleTaxa } = require('./taxa');

const TAM = 1200;

function simular({ capacidade, kbps = 20000, teto = 20000, ateMs, baseMs = 2, bufferMs = 300 }) {
  let t = 0;
  const medidor = new MedidorRelatorio({ agora: () => t + 987654.321 });
  const controle = new ControleTaxa({ kbps, teto, agora: () => t });
  let alvo = controle.kbps;
  let fila = 0; // bytes no gargalo
  let credito = 0;
  let seq = 1;
  const chegadas = []; // {em, seq, tempo}
  const reversos = []; // {em, r}
  const amostras = []; // {t, atrasoFilaMs, kbps}
  for (; t <= ateMs; t++) {
    const cap = capacidade(t) / 8; // bytes por ms
    credito += alvo / 8;
    while (credito >= TAM) {
      credito -= TAM;
      const s = seq++;
      if (fila + TAM > cap * bufferMs) continue; // descarte no fim da fila
      fila += TAM;
      chegadas.push({ em: t + baseMs + fila / cap, seq: s, tempo: Math.floor(t * 1000) >>> 0 });
    }
    fila = Math.max(0, fila - cap);
    while (chegadas.length && chegadas[0].em <= t) {
      const p = chegadas.shift();
      medidor.aoPacote({ seq: p.seq, tempo: p.tempo, bytes: TAM });
    }
    if (t > 0 && t % C.INTERVALO_RELATORIO_MS === 0) reversos.push({ em: t + baseMs, r: medidor.gerar() });
    while (reversos.length && reversos[0].em <= t) {
      const novo = controle.relatorio(reversos.shift().r);
      if (novo !== null) alvo = novo;
    }
    amostras.push({ t, atrasoFilaMs: fila / cap, kbps: alvo });
  }
  return { amostras, controle };
}

// Primeiro instante depois de `de` a partir do qual a fila fica abaixo de `limiteMs` ate `ate`.
function normalizouEm(amostras, de, ate, limiteMs = 10) {
  let ultimoRuim = de;
  for (const a of amostras) if (a.t >= de && a.t <= ate && a.atrasoFilaMs >= limiteMs) ultimoRuim = a.t;
  return ultimoRuim - de;
}

test('taxa: banda cai de 30 para 8 Mbps e o atraso volta ao normal em menos de 3 s', () => {
  const corte = 5000;
  const { amostras, controle } = simular({ capacidade: (t) => (t < corte ? 30000 : 8000), ateMs: 15000 });
  const ms = normalizouEm(amostras, corte, 15000);
  assert.ok(ms < 3000, `normalizou em ${ms} ms; cortes ${controle.contadores.cortes}, alvo final ${controle.kbps}`);
  assert.ok(controle.kbps <= 8000, `alvo final ${controle.kbps}`);
  assert.ok(controle.kbps >= 4000, `nao despencou: ${controle.kbps}`);
});

test('taxa: banda volta e o alvo sobe em degraus de 10% a cada 5 s ate o teto', () => {
  const { amostras, controle } = simular({
    capacidade: (t) => (t >= 5000 && t < 15000 ? 8000 : 30000), ateMs: 90000,
  });
  const em15 = amostras.find((a) => a.t === 15000).kbps;
  assert.ok(controle.kbps > em15, `subiu de ${em15} para ${controle.kbps}`);
  assert.equal(controle.kbps, 20000);
  assert.ok(normalizouEm(amostras, 15000, 90000) < 1000);
});
