'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDrift, DEFAULTS } = require('./mesa-sync-media');

function tocando(target, current, now, extra = {}) {
  return { target, current, want: 'play', player: 'playing', rate: 1, now, ...extra };
}

test('erro menor que 0,3 s: nada', () => {
  const d = createDrift();
  assert.deepEqual(d.step(tocando(10, 9.75, 0)), []);
  assert.deepEqual(d.step(tocando(10, 10.29, 250)), []);
});

test('entre 0,3 e 1,5 s: velocidade 1,05 atras, 0,95 adiantado, e volta a 1 ao cruzar', () => {
  const d = createDrift();
  assert.deepEqual(d.step(tocando(10, 9, 0)), [{ cmd: 'rate', rate: 1.05 }]);
  assert.deepEqual(d.step(tocando(10.25, 9.3, 250, { rate: 1.05 })), [], 'continua corrigindo');
  // Com erro de 0,2 s (abaixo do dead) ainda corrige: a histerese so solta ao cruzar.
  assert.deepEqual(d.step(tocando(20, 19.8, 1000, { rate: 1.05 })), []);
  assert.deepEqual(d.step(tocando(20.25, 20.26, 1250, { rate: 1.05 })), [{ cmd: 'rate', rate: 1 }]);
  const e = createDrift();
  assert.deepEqual(e.step(tocando(10, 11, 0)), [{ cmd: 'rate', rate: 0.95 }]);
  assert.deepEqual(e.step(tocando(10.5, 10.53, 500, { rate: 0.95 })), [{ cmd: 'rate', rate: 1 }], 'erro < release solta');
});

test('acima de 1,5 s: salto, e fica quieto enquanto o player reporta a posicao velha', () => {
  const d = createDrift();
  assert.deepEqual(d.step(tocando(30, 10, 0)), [{ cmd: 'seek', to: 30 }]);
  assert.deepEqual(d.step(tocando(30.25, 10.25, 250)), [], 'dentro do seekHoldMs');
  assert.deepEqual(d.step(tocando(31.3, 10.3, DEFAULTS.seekHoldMs + 100)), [{ cmd: 'seek', to: 31.3 }]);
});

test('salto no meio de uma correcao por velocidade volta a velocidade a 1', () => {
  const d = createDrift();
  d.step(tocando(10, 9, 0));
  assert.deepEqual(d.step(tocando(12, 9.2, 250, { rate: 1.05 })), [{ cmd: 'rate', rate: 1 }, { cmd: 'seek', to: 12 }]);
});

test('player que nao aceita 1,05: passa a saltar so acima de 0,6 s', () => {
  const d = createDrift();
  assert.deepEqual(d.step(tocando(10, 9, 0)), [{ cmd: 'rate', rate: 1.05 }]);
  assert.deepEqual(d.step(tocando(12, 11, DEFAULTS.rateCheckMs, { rate: 1 })), [{ cmd: 'rate', rate: 1 }, { cmd: 'seek', to: 12 }]);
  assert.equal(d.state().rateBroken, true);
  const t = DEFAULTS.rateCheckMs + DEFAULTS.seekHoldMs + 10;
  assert.deepEqual(d.step(tocando(20, 19.5, t)), [], '0,5 s com velocidade quebrada: tolera');
  assert.deepEqual(d.step(tocando(20, 19.3, t + 250)), [{ cmd: 'seek', to: 20 }]);
});

test('estado desejado: tocar um player parado salta (se longe) e da play, sem repetir a cada tique', () => {
  const d = createDrift();
  assert.deepEqual(d.step({ target: 50, current: 0, want: 'play', player: 'cued', now: 0 }), [{ cmd: 'seek', to: 50 }, { cmd: 'play' }]);
  assert.deepEqual(d.step({ target: 50.25, current: 0, want: 'play', player: 'cued', now: 250 }), []);
  assert.deepEqual(d.step({ target: 50, current: 50.1, want: 'play', player: 'paused', now: 2000 }), [{ cmd: 'play' }]);
});

test('pausar: manda pause e alinha na posicao da sala', () => {
  const d = createDrift();
  assert.deepEqual(d.step({ target: 40, current: 40.1, want: 'pause', player: 'playing', now: 0 }), [{ cmd: 'pause' }]);
  assert.deepEqual(d.step({ target: 40, current: 40.2, want: 'pause', player: 'playing', now: 200 }), [], 'nao repete');
  assert.deepEqual(d.step({ target: 40, current: 43, want: 'pause', player: 'paused', now: 2000 }), [{ cmd: 'seek', to: 40 }]);
  assert.deepEqual(d.step({ target: 40, current: 40, want: 'pause', player: 'paused', now: 4000 }), []);
  // pausar no meio de uma correcao desfaz a velocidade
  const e = createDrift();
  e.step(tocando(10, 9, 0));
  assert.deepEqual(e.step({ target: 10, current: 9.5, want: 'pause', player: 'playing', now: 250 }), [{ cmd: 'rate', rate: 1 }, { cmd: 'pause' }, { cmd: 'seek', to: 10 }]);
});

test('carregando ou sem posicao: nada; fim do video: so volta se o alvo voltou', () => {
  const d = createDrift();
  assert.deepEqual(d.step(tocando(10, 5, 0, { player: 'buffering' })), []);
  assert.deepEqual(d.step(tocando(10, null, 0)), []);
  assert.deepEqual(d.step(tocando(212.2, 212, 0, { player: 'ended' })), []);
  assert.deepEqual(d.step(tocando(30, 212, 0, { player: 'ended' })), [{ cmd: 'seek', to: 30 }, { cmd: 'play' }]);
  assert.deepEqual(d.step({}), []);
});

/** Player simulado: anda `rate` x o tempo; salto e instantaneo. */
function simula({ inicioErro, segundos, aceitaRate = true, tique = 250, jitter = 0 }) {
  const d = createDrift();
  let pos = 100 - inicioErro;
  let rate = 1;
  const erros = [];
  let comandos = 0;
  let trocasDeVelocidade = 0;
  for (let t = 0; t <= segundos * 1000; t += tique) {
    const target = 100 + t / 1000;
    const ruido = jitter ? Math.sin(t / 97) * jitter : 0;
    for (const c of d.step({ target, current: pos + ruido, want: 'play', player: 'playing', rate, now: t })) {
      comandos++;
      if (c.cmd === 'seek') pos = c.to;
      if (c.cmd === 'rate') {
        trocasDeVelocidade++;
        rate = aceitaRate ? c.rate : 1;
      }
    }
    erros.push(target - pos);
    pos += (tique / 1000) * rate;
  }
  return { erros, comandos, trocasDeVelocidade, final: Math.abs(erros[erros.length - 1]) };
}

test('simulacao: 1 s atras converge por velocidade em ~20 s, sem oscilar', () => {
  const r = simula({ inicioErro: 1, segundos: 40 });
  assert.ok(r.final < DEFAULTS.dead, `erro final ${r.final}`);
  assert.equal(r.trocasDeVelocidade, 2, 'uma ida (1,05) e uma volta (1)');
  const t = r.erros.findIndex((e) => Math.abs(e) < 0.1) * 0.25;
  assert.ok(t > 15 && t < 25, `cruzou em ${t} s`);
});

test('simulacao: 0,8 s adiantado com ruido de leitura de 0,1 s nao fica trocando de velocidade', () => {
  const r = simula({ inicioErro: -0.8, segundos: 60, jitter: 0.1 });
  assert.ok(r.final < DEFAULTS.dead, `erro final ${r.final}`);
  assert.ok(r.trocasDeVelocidade <= 4, `${r.trocasDeVelocidade} trocas`);
});

test('simulacao: 5 s atras salta uma vez', () => {
  const r = simula({ inicioErro: 5, segundos: 10 });
  assert.equal(r.comandos, 1);
  assert.ok(r.final < 0.01);
});

test('simulacao: player que ignora a velocidade acaba alinhado por salto', () => {
  const r = simula({ inicioErro: 1, segundos: 10, aceitaRate: false });
  assert.ok(r.final < DEFAULTS.dead, `erro final ${r.final}`);
});
