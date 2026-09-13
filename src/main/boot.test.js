'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBootUpdater } = require('./boot');

// driver falso: espioes nas tres chamadas que o boot pode fazer.
function fakeDriver() {
  return {
    calls: [],
    checkForUpdates(manual) { this.calls.push(['checkForUpdates', manual]); },
    downloadUpdate(source) { this.calls.push(['downloadUpdate', source]); },
    quitAndInstall() { this.calls.push(['quitAndInstall']); },
  };
}

// scheduler falso: relogio manual (advance) em vez de setTimeout de verdade
// -- os testes de timeout/piso nao esperam segundo nenhum.
function fakeClock() {
  let time = 0;
  let seq = 0;
  const pending = new Map();
  return {
    now: () => time,
    scheduler: {
      setTimeout(fn, ms) {
        const id = ++seq;
        pending.set(id, { fn, dueAt: time + ms });
        return id;
      },
      clearTimeout(id) {
        pending.delete(id);
      },
    },
    // Avanca o relogio e dispara, em ordem de vencimento, os timers que
    // venceram no caminho -- inclusive os que um timer disparado agora
    // reagenda (um handleStatus dentro de fn pode armar outro timer).
    advance(ms) {
      time += ms;
      for (;;) {
        let nextId = null;
        let nextDue = Infinity;
        for (const [id, t] of pending) {
          if (t.dueAt <= time && t.dueAt < nextDue) {
            nextId = id;
            nextDue = t.dueAt;
          }
        }
        if (nextId === null) break;
        const { fn } = pending.get(nextId);
        pending.delete(nextId);
        fn();
      }
    },
  };
}

function collectPhases() {
  const phases = [];
  return { phases, onPhase: (phase, extra) => phases.push({ phase, ...extra }) };
}

test('sem atualizacao (minDisplayMs 0) libera na hora', () => {
  const driver = fakeDriver();
  const { phases, onPhase } = collectPhases();
  const clock = fakeClock();
  const boot = createBootUpdater({ driver, onPhase, scheduler: clock.scheduler, now: clock.now });

  boot.start();
  assert.deepEqual(phases, [{ phase: 'checking' }]);

  boot.handleStatus({ status: 'not-available' });
  assert.deepEqual(phases, [{ phase: 'checking' }, { phase: 'release', reason: 'sem-atualizacao' }]);
  assert.deepEqual(driver.calls, [['checkForUpdates', false]]);
});

test('piso de exibicao (dev) segura a liberacao ate o tempo minimo', () => {
  const driver = fakeDriver();
  const { phases, onPhase } = collectPhases();
  const clock = fakeClock();
  const boot = createBootUpdater({
    driver, onPhase, scheduler: clock.scheduler, now: clock.now, minDisplayMs: 600,
  });

  boot.start();
  boot.handleStatus({ status: 'not-available' }); // chega na hora 0, bem antes do piso

  assert.deepEqual(phases, [{ phase: 'checking' }]); // ainda nao liberou

  clock.advance(599);
  assert.deepEqual(phases, [{ phase: 'checking' }]); // ainda nao

  clock.advance(1);
  assert.deepEqual(phases, [{ phase: 'checking' }, { phase: 'release', reason: 'sem-atualizacao' }]);
});

test('timeout de checagem libera sozinho sem resposta nenhuma', () => {
  const driver = fakeDriver();
  const { phases, onPhase } = collectPhases();
  const clock = fakeClock();
  const boot = createBootUpdater({
    driver, onPhase, scheduler: clock.scheduler, now: clock.now, checkTimeoutMs: 5000,
  });

  boot.start();
  clock.advance(4999);
  assert.deepEqual(phases, [{ phase: 'checking' }]);

  clock.advance(1);
  assert.deepEqual(phases, [{ phase: 'checking' }, { phase: 'release', reason: 'timeout-checagem' }]);
});

test('available dispara o download e vira downloading', () => {
  const driver = fakeDriver();
  const { phases, onPhase } = collectPhases();
  const clock = fakeClock();
  const boot = createBootUpdater({ driver, onPhase, scheduler: clock.scheduler, now: clock.now });

  boot.start();
  boot.handleStatus({ status: 'available', version: '9.9.9' });

  assert.deepEqual(phases, [
    { phase: 'checking' },
    { phase: 'downloading', version: '9.9.9', progress: 0 },
  ]);
  assert.deepEqual(driver.calls, [['checkForUpdates', false], ['downloadUpdate', 'boot']]);
});

test('download travado 30s sem progresso novo libera', () => {
  const driver = fakeDriver();
  const { phases, onPhase } = collectPhases();
  const clock = fakeClock();
  const boot = createBootUpdater({
    driver, onPhase, scheduler: clock.scheduler, now: clock.now, stallTimeoutMs: 30000,
  });

  boot.start();
  boot.handleStatus({ status: 'available', version: '9.9.9' });

  clock.advance(29999);
  assert.equal(phases.at(-1).phase, 'downloading');

  clock.advance(1);
  assert.deepEqual(phases.at(-1), { phase: 'release', reason: 'download-travado' });
  assert.equal(boot.isDownloadAbandoned(), true);
});

test('downloaded tardio depois de stall nao instala no caminho do boot', () => {
  const driver = fakeDriver();
  const { phases, onPhase } = collectPhases();
  const clock = fakeClock();
  const boot = createBootUpdater({
    driver, onPhase, scheduler: clock.scheduler, now: clock.now, stallTimeoutMs: 30000,
  });

  boot.start();
  boot.handleStatus({ status: 'available', version: '9.9.9', downloadSource: 'boot' });
  clock.advance(30000);
  boot.handleStatus({ status: 'downloaded', version: '9.9.9', downloadSource: 'boot' });

  assert.equal(boot.isDownloadAbandoned(), true);
  assert.deepEqual(phases.at(-1), { phase: 'release', reason: 'download-travado' });
  assert.deepEqual(driver.calls, [
    ['checkForUpdates', false],
    ['downloadUpdate', 'boot'],
  ]);
});

test('progresso novo reseta o timer de travamento', () => {
  const driver = fakeDriver();
  const { phases, onPhase } = collectPhases();
  const clock = fakeClock();
  const boot = createBootUpdater({
    driver, onPhase, scheduler: clock.scheduler, now: clock.now, stallTimeoutMs: 30000,
  });

  boot.start();
  boot.handleStatus({ status: 'available', version: '9.9.9' });

  clock.advance(20000);
  boot.handleStatus({ status: 'downloading', version: '9.9.9', progress: 50 }); // reseta o relogio de travamento

  clock.advance(20000); // 40s desde o 'available', mas so 20s desde o ultimo progresso
  assert.equal(phases.at(-1).phase, 'downloading', 'nao deveria ter liberado ainda');

  clock.advance(10000); // agora sim, 30s desde o ultimo progresso
  assert.deepEqual(phases.at(-1), { phase: 'release', reason: 'download-travado' });
});

test('downloaded aciona a instalacao e nunca chega a liberar', () => {
  const driver = fakeDriver();
  const { phases, onPhase } = collectPhases();
  const clock = fakeClock();
  const boot = createBootUpdater({ driver, onPhase, scheduler: clock.scheduler, now: clock.now });

  boot.start();
  boot.handleStatus({ status: 'available', version: '9.9.9' });
  boot.handleStatus({ status: 'downloaded', version: '9.9.9' });

  assert.deepEqual(phases, [
    { phase: 'checking' },
    { phase: 'downloading', version: '9.9.9', progress: 0 },
    { phase: 'installing', version: '9.9.9' },
  ]);
  assert.deepEqual(driver.calls, [['checkForUpdates', false], ['downloadUpdate', 'boot'], ['quitAndInstall']]);

  // mesmo esperando um bocado depois, nao aparece nenhum 'release' -- o
  // processo real teria fechado sozinho nesse meio tempo.
  clock.advance(60000);
  assert.equal(phases.some((p) => p.phase === 'release'), false);
});

test('erro carrega o motivo (ou "erro" generico sem reason)', () => {
  const driver = fakeDriver();
  const { phases, onPhase } = collectPhases();
  const clock = fakeClock();
  const boot = createBootUpdater({ driver, onPhase, scheduler: clock.scheduler, now: clock.now });

  boot.start();
  boot.handleStatus({ status: 'error', reason: 'sem-rede' });
  assert.deepEqual(phases.at(-1), { phase: 'release', reason: 'sem-rede' });
});

test('erro sem reason conhecido vira "erro" generico', () => {
  const driver = fakeDriver();
  const { phases, onPhase } = collectPhases();
  const clock = fakeClock();
  const boot = createBootUpdater({ driver, onPhase, scheduler: clock.scheduler, now: clock.now });

  boot.start();
  boot.handleStatus({ status: 'error', message: 'vish' });
  assert.deepEqual(phases.at(-1), { phase: 'release', reason: 'erro' });
});

test('depois de liberado, evento novo nao faz nada (idempotencia)', () => {
  const driver = fakeDriver();
  const { phases, onPhase } = collectPhases();
  const clock = fakeClock();
  const boot = createBootUpdater({ driver, onPhase, scheduler: clock.scheduler, now: clock.now });

  boot.start();
  boot.handleStatus({ status: 'not-available' });
  const countAfterRelease = phases.length;
  const callsAfterRelease = driver.calls.length;

  boot.handleStatus({ status: 'available', version: '1.2.3' });
  boot.handleStatus({ status: 'error', reason: 'sem-rede' });

  assert.equal(phases.length, countAfterRelease);
  assert.equal(driver.calls.length, callsAfterRelease);
});
