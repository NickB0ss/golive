'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initialState, next, worstHealth, LIMITS } = require('./autoquality');

const OK = { softwareEncoder: false, msPerFrame: 4 };
const RUIM = { softwareEncoder: false, msPerFrame: 40 };
const SOFTWARE = { softwareEncoder: true, msPerFrame: 2 };

// Aplica varias amostras em sequencia, 1s entre elas (a cadencia real do
// updateStats com a janela visivel).
function run(state, healths, startMs = 0) {
  let s = state;
  healths.forEach((health, i) => {
    s = next(s, { atMs: startMs + i * 1000, health });
  });
  return s;
}

test('uma amostra ruim isolada nao degrada -- picos acontecem', () => {
  assert.equal(run(initialState(), [RUIM]).steps, 0);
});

test('amostras ruins seguidas o bastante descem um degrau e zeram a corrida', () => {
  const s = run(initialState(), Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(RUIM));
  assert.equal(s.steps, 1);
  assert.equal(s.badRun, 0);
});

test('uma amostra boa no meio zera a corrida de ruins', () => {
  const s = run(initialState(), [RUIM, RUIM, OK, RUIM, RUIM]);
  assert.equal(s.steps, 0);
});

test('encoder em software e ruim mesmo com msPerFrame baixo', () => {
  assert.equal(run(initialState(), Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(SOFTWARE)).steps, 1);
});

test('saude ausente nao conta como ruim -- ausencia nao e diagnostico', () => {
  assert.equal(run(initialState(), [null, null, null, null, null]).steps, 0);
});

test('a escada tem teto', () => {
  const muitas = Array(LIMITS.BAD_SAMPLES_TO_DEGRADE * (LIMITS.MAX_AUTO_STEPS + 3)).fill(RUIM);
  assert.equal(run(initialState(), muitas).steps, LIMITS.MAX_AUTO_STEPS);
});

test('so sobe de volta depois da folga continua inteira', () => {
  const degradado = run(initialState(), Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(RUIM));
  const t0 = LIMITS.BAD_SAMPLES_TO_DEGRADE * 1000;

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
  const degradado = run(initialState(), Array(LIMITS.BAD_SAMPLES_TO_DEGRADE).fill(RUIM));
  const t0 = LIMITS.BAD_SAMPLES_TO_DEGRADE * 1000;

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
