'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const audiometer = require('./audiometer');

// getByteTimeDomainData: array de inteiros 0-255 centrado em 128.
function silentSamples(n = 8) { return new Array(n).fill(128); }
function toneSamples(amplitude, n = 8) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(128 + (i % 2 === 0 ? amplitude : -amplitude));
  }
  return out;
}

test('level: silencio absoluto (tudo 128) e pico e rms zero', () => {
  const { peak, rms } = audiometer.level(silentSamples());
  assert.equal(peak, 0);
  assert.equal(rms, 0);
});

test('level: tom com amplitude conhecida devolve pico proporcional', () => {
  const { peak, rms } = audiometer.level(toneSamples(64)); // metade da faixa
  assert.equal(peak, 0.5);
  assert.ok(rms > 0 && rms <= peak, `rms (${rms}) deveria estar entre 0 e o pico`);
});

test('level: amostras vazias ou ausentes nao quebram, devolvem zero', () => {
  assert.deepEqual(audiometer.level([]), { peak: 0, rms: 0 });
  assert.deepEqual(audiometer.level(null), { peak: 0, rms: 0 });
  assert.deepEqual(audiometer.level(undefined), { peak: 0, rms: 0 });
});

test('silenceVerdict: sem historico nenhum, nunca avisa', () => {
  assert.equal(audiometer.silenceVerdict([], 100000), false);
  assert.equal(audiometer.silenceVerdict(null, 100000), false);
});

test('silenceVerdict: silencio por menos que o limiar nao avisa', () => {
  const history = [
    { atMs: 0, peak: 0 },
    { atMs: 5000, peak: 0 },
  ];
  assert.equal(audiometer.silenceVerdict(history, 10000), false); // 10s < 20s padrao
});

test('silenceVerdict: silencio continuo pelo limiar inteiro avisa', () => {
  const history = [
    { atMs: 0, peak: 0 },
    { atMs: 10000, peak: 0 },
    { atMs: 20000, peak: 0 },
  ];
  assert.equal(audiometer.silenceVerdict(history, 20000), true);
});

test('silenceVerdict: qualquer amostra com som recente quebra a sequencia', () => {
  const history = [
    { atMs: 0, peak: 0 },
    { atMs: 5000, peak: 0.3 }, // som no meio
    { atMs: 10000, peak: 0 },
    { atMs: 15000, peak: 0 },
  ];
  // Silencio so desde atMs=10000 -- 10s de silencio, nao 20s.
  assert.equal(audiometer.silenceVerdict(history, 20000), false);
  assert.equal(audiometer.silenceVerdict(history, 30000), true);
});

test('silenceVerdict: respeita um limiar customizado', () => {
  const history = [{ atMs: 0, peak: 0 }, { atMs: 3000, peak: 0 }];
  assert.equal(audiometer.silenceVerdict(history, 3000, 5000), false);
  assert.equal(audiometer.silenceVerdict(history, 5000, 5000), true);
});

// O caso central do P7: um AudioContext suspenso (janela minimizada) nao
// pode fingir silencio. A regra e de quem CHAMA (nao empilhar amostra
// enquanto ctx.state !== 'running'), mas o modulo tem de se comportar bem
// quando o historico simplesmente para de crescer por um tempo -- o
// relogio do silencio nao pode "recuperar o atraso" sozinho.
test('silenceVerdict: um gap no historico (contexto suspenso) nao acelera o aviso', () => {
  const history = [{ atMs: 0, peak: 0 }];
  // O proximo dado so chega bem depois (contexto ficou suspenso no meio),
  // mas comeca com som -- nao pode ter acumulado silencio no intervalo.
  const historyComSom = [...history, { atMs: 60000, peak: 0.1 }];
  assert.equal(audiometer.silenceVerdict(historyComSom, 60000), false);
});

test('silenceVerdict: entrada malformada no historico e tratada como som (para a sequencia)', () => {
  const history = [{ atMs: 0, peak: 0 }, null, { atMs: 5000, peak: 0 }];
  assert.equal(audiometer.silenceVerdict(history, 5000), false); // so 5s desde a entrada valida apos o null
});
