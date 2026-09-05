'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initialState, next, worstHealth, isBad, budgetMsFor, LIMITS } = require('./autoquality');

const OK = { softwareEncoder: false, msPerFrame: 4 };
const RUIM = { softwareEncoder: false, msPerFrame: 40 };
// Chromium marcou o encode como limitado por CPU, mesmo com ms/frame baixo.
const CPU = { softwareEncoder: false, cpuLimited: true, msPerFrame: 4 };
// Encoder em software mas RAPIDO (maquina sem NVENC, OpenH264 a 2 ms/quadro).
const SOFTWARE = { softwareEncoder: true, msPerFrame: 2 };
// Encoder em software e LENTO (NVENC afogado caiu pro software sob carga).
const SOFTWARE_LENTO = { softwareEncoder: true, msPerFrame: 40 };

// Aplica varias amostras em sequencia, 1s entre elas (a cadencia real do
// updateStats com a janela visivel).
function run(state, healths, startMs = 0) {
  let s = state;
  healths.forEach((health, i) => {
    s = next(s, { atMs: startMs + i * 1000, health });
  });
  return s;
}

// Quantas amostras a 1s de cadencia sao precisas pra cruzar o tempo de
// sofrimento -- so pra montar cenarios de "ja degradado" sem depender de
// uma contagem magica.
const AMOSTRAS_ATE_DEGRADAR = Math.ceil(LIMITS.BAD_MS_TO_DEGRADE / 1000) + 1;

test('uma amostra ruim isolada nao degrada -- picos acontecem', () => {
  assert.equal(run(initialState(), [RUIM]).steps, 0);
});

test('sofrimento continuo por BAD_MS_TO_DEGRADE desce um degrau', () => {
  let s = initialState();
  s = next(s, { atMs: 0, health: RUIM });
  s = next(s, { atMs: LIMITS.BAD_MS_TO_DEGRADE - 1, health: RUIM });
  assert.equal(s.steps, 0, 'antes de completar o tempo, nao desce');
  s = next(s, { atMs: LIMITS.BAD_MS_TO_DEGRADE + 1, health: RUIM });
  assert.equal(s.steps, 1);
  assert.equal(s.badSinceMs, LIMITS.BAD_MS_TO_DEGRADE + 1, 'relogio de sofrimento reinicia no degrau');
});

test('uma amostra boa no meio reinicia o relogio de sofrimento', () => {
  let s = initialState();
  s = next(s, { atMs: 0, health: RUIM });
  s = next(s, { atMs: 2000, health: OK });          // zera badSinceMs
  s = next(s, { atMs: 3000, health: RUIM });        // recomeca
  s = next(s, { atMs: 3000 + LIMITS.BAD_MS_TO_DEGRADE - 1, health: RUIM });
  assert.equal(s.steps, 0);
});

test('poll lento (5s escondido) ainda desce em ~BAD_MS_TO_DEGRADE, nao em 3 amostras', () => {
  let s = initialState();
  s = next(s, { atMs: 0, health: RUIM });
  s = next(s, { atMs: 5000, health: RUIM }); // so 2 amostras, mas 5s > 3s
  assert.equal(s.steps, 1);
});

test('encoder em software RAPIDO nao degrada -- ausencia de NVENC nao e sofrimento', () => {
  const s = run(initialState(), Array(AMOSTRAS_ATE_DEGRADAR).fill(SOFTWARE));
  assert.equal(s.steps, 0);
});

test('encoder em software LENTO degrada -- NVENC afogado caindo pro software sob carga', () => {
  const s = run(initialState(), Array(AMOSTRAS_ATE_DEGRADAR).fill(SOFTWARE_LENTO));
  assert.equal(s.steps, 1);
});

test('cpuLimited degrada mesmo com ms/frame baixo -- sinal autoritativo do Chromium', () => {
  const s = run(initialState(), Array(AMOSTRAS_ATE_DEGRADAR).fill(CPU));
  assert.equal(s.steps, 1);
});

test('saude ausente nao conta como ruim -- ausencia nao e diagnostico', () => {
  assert.equal(run(initialState(), [null, null, null, null, null]).steps, 0);
});

test('a escada tem teto', () => {
  // Sofrimento longo o bastante pra pedir mais degraus do que o teto: cada
  // degrau reinicia o relogio, entao sao BAD_MS_TO_DEGRADE por degrau.
  const muitas = Array(AMOSTRAS_ATE_DEGRADAR * (LIMITS.MAX_AUTO_STEPS + 3)).fill(RUIM);
  assert.equal(run(initialState(), muitas).steps, LIMITS.MAX_AUTO_STEPS);
});

test('so sobe de volta depois da folga continua inteira', () => {
  const degradado = run(initialState(), Array(AMOSTRAS_ATE_DEGRADAR).fill(RUIM));
  assert.equal(degradado.steps, 1);
  const t0 = AMOSTRAS_ATE_DEGRADAR * 1000;

  // A primeira amostra boa ancora o relogio da folga: a contagem e de
  // telemetria boa OBSERVADA, nao do instante do degrau.
  const inicio = next(degradado, { atMs: t0, health: OK });
  assert.equal(inicio.steps, 1);

  const cedo = next(inicio, { atMs: t0 + LIMITS.GOOD_MS_TO_RECOVER - 1, health: OK });
  assert.equal(cedo.steps, 1, 'nao pode subir antes da folga completa');

  const naHora = next(cedo, { atMs: t0 + LIMITS.GOOD_MS_TO_RECOVER + 1, health: OK });
  assert.equal(naHora.steps, 0);
});

test('uma amostra ruim durante a espera cancela a recuperacao', () => {
  const degradado = run(initialState(), Array(AMOSTRAS_ATE_DEGRADAR).fill(RUIM));
  const t0 = AMOSTRAS_ATE_DEGRADAR * 1000;

  let s = next(degradado, { atMs: t0 + 1000, health: OK });
  s = next(s, { atMs: t0 + 2000, health: RUIM });
  s = next(s, { atMs: t0 + 3000, health: OK });
  // A folga recomecou do zero em t0+3000, entao no instante em que teria
  // subido pela contagem antiga ela ainda nao pode subir.
  s = next(s, { atMs: t0 + LIMITS.GOOD_MS_TO_RECOVER + 1000, health: OK });
  assert.equal(s.steps, 1);
});

test('worstHealth: software vence qualquer msPerFrame', () => {
  assert.equal(worstHealth([OK, SOFTWARE, RUIM]).softwareEncoder, true);
});

test('worstHealth: sem software, vence o maior msPerFrame', () => {
  assert.equal(worstHealth([OK, RUIM]).msPerFrame, 40);
});

test('worstHealth: lista vazia ou so de nulos devolve null', () => {
  assert.equal(worstHealth([]), null);
  assert.equal(worstHealth([null, null]), null);
});

test('worstHealth ignora entradas invalidas sem lancar', () => {
  assert.equal(worstHealth([null, undefined, OK]).msPerFrame, 4);
});

// --- Orcamento por quadro proporcional ao fps do alvo ---
//
// BUDGET_MS_60 e o intervalo entre quadros A 60fps. Compara-lo com o
// msPerFrame de um alvo de 30fps e cobrar do encoder o dobro da velocidade
// que o stream precisa: a 30fps ha 33,3ms entre quadros, nao 16,6.
//
// Log de 2026-09-05, 04:54:50-55, maquina do nicol, duas quedas em CINCO
// segundos:
//   out=1920x1080@43fps realKbps=9481 msFrame=22.3 limite=nenhum -> g1
//   out=1920x1080@29fps realKbps=4638 msFrame=20.6 limite=nenhum -> g2
// 1080p sendo entregue a 9,5 Mbps, sem o Chromium reclamar de nada, e a
// escada derrubando o alvo de 12000 pra 2500 kbps. A 30fps, 22,3ms cabe
// folgado. Com o numero fixo, todo preset de 30fps nasce marcado como ruim
// e a escada nunca para de oscilar.

test('budgetMsFor: o orcamento e o intervalo entre quadros do alvo', () => {
  assert.equal(Math.round(budgetMsFor(60) * 10) / 10, 16.7);
  assert.equal(Math.round(budgetMsFor(30) * 10) / 10, 33.3);
});

test('budgetMsFor: nunca mais apertado que o de 60fps', () => {
  // Alvo acima de 60fps nao torna a regra mais dura -- o custo por quadro ja
  // e o piso do que a maquina consegue.
  assert.ok(budgetMsFor(144) >= LIMITS.BUDGET_MS_60);
  assert.ok(budgetMsFor(120) >= LIMITS.BUDGET_MS_60);
});

test('budgetMsFor: fps ausente ou torto cai no orcamento de 60fps', () => {
  assert.equal(budgetMsFor(undefined), LIMITS.BUDGET_MS_60);
  assert.equal(budgetMsFor(0), LIMITS.BUDGET_MS_60);
  assert.equal(budgetMsFor(-5), LIMITS.BUDGET_MS_60);
  assert.equal(budgetMsFor('trinta'), LIMITS.BUDGET_MS_60);
});

test('22,3 ms/quadro e RUIM a 60fps e SAUDAVEL a 30fps', () => {
  const real = { softwareEncoder: true, msPerFrame: 22.3 };
  assert.equal(isBad(real, budgetMsFor(60)), true);
  assert.equal(isBad(real, budgetMsFor(30)), false);
});

test('cpuLimited segue derrubando mesmo com orcamento folgado', () => {
  // O sinal autoritativo do Chromium nao depende do orcamento.
  assert.equal(isBad({ cpuLimited: true, msPerFrame: 1 }, budgetMsFor(30)), true);
});

test('a 30fps, o caso real do log nao degrada nenhum degrau', () => {
  const real = { softwareEncoder: true, msPerFrame: 22.3 };
  const opts = { budgetMs: budgetMsFor(30) };
  let s = initialState();
  for (let i = 0; i < 60; i += 1) s = next(s, { atMs: i * 1000, health: real }, opts);
  assert.equal(s.steps, 0);
});
