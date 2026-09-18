'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStallWatch, createRelayRetry } = require('./stallwatch');

const OPTS = { stallMs: 6000, cooldownMs: 20000, maxAttempts: 3 };

test('tela recem-assistida sem nenhum quadro pede cura so depois do limite', () => {
  const w = createStallWatch(OPTS);
  assert.equal(w.observe('7|screen', { watched: true, frames: 105, now: 0 }), null);
  assert.equal(w.observe('7|screen', { watched: true, frames: 105, now: 5000 }), null);
  assert.deepEqual(w.observe('7|screen', { watched: true, frames: 105, now: 6000 }), { action: 'heal', stalledFor: 6000, attempts: 1 });
});

test('respeita o intervalo entre tentativas e desiste uma vez so', () => {
  const w = createStallWatch(OPTS);
  w.observe('k', { watched: true, frames: 0, now: 0 });
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 6000 }).action, 'heal');
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 20000 }), null, 'dentro do intervalo');
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 26000 }).attempts, 2);
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 46000 }).attempts, 3);
  assert.deepEqual(w.observe('k', { watched: true, frames: 0, now: 66000 }), { action: 'give-up', stalledFor: 66000, attempts: 3 });
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 90000 }), null, 'nao repete o aviso');
});

test('tela que ja mostrou quadro e parou (conteudo parado) nao dispara', () => {
  const w = createStallWatch(OPTS);
  w.observe('k', { watched: true, frames: 10, now: 0 });
  w.observe('k', { watched: true, frames: 40, now: 1000 });
  assert.equal(w.observe('k', { watched: true, frames: 40, now: 60000 }), null);
});

test('avisa quando volta a mostrar quadro depois de uma cura', () => {
  const w = createStallWatch(OPTS);
  w.observe('k', { watched: true, frames: 0, now: 0 });
  w.observe('k', { watched: true, frames: 0, now: 6000 });
  assert.deepEqual(w.observe('k', { watched: true, frames: 3, now: 9000 }), { action: 'recovered', attempts: 1 });
});

test('tile recriado (contador reiniciou) nao zera as tentativas', () => {
  const w = createStallWatch(OPTS);
  w.observe('k', { watched: true, frames: 105, now: 0 });
  assert.equal(w.observe('k', { watched: true, frames: 105, now: 6000 }).attempts, 1);
  // A cura refez a conexao: o <video> novo comeca do zero e segue sem imagem.
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 7000 }), null);
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 13000 }), null, 'ainda no intervalo da tentativa 1');
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 27000 }).attempts, 2);
});

test('parar de assistir (ou medida indisponivel) esquece o estado', () => {
  const w = createStallWatch(OPTS);
  w.observe('k', { watched: true, frames: 0, now: 0 });
  assert.equal(w.observe('k', { watched: false, frames: 0, now: 3000 }), null);
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 4000 }), null, 'recomeca a contar');
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 9000 }), null);
  assert.equal(w.observe('k', { watched: true, frames: 0, now: 10000 }).action, 'heal');
  assert.equal(w.observe('k', { watched: true, frames: null, now: 11000 }), null);
});

test('reset esquece tentativas e intervalo da sessao anterior', () => {
  const w = createStallWatch(OPTS);
  w.observe('7|screen', { watched: true, frames: 0, now: 0 });
  assert.equal(w.observe('7|screen', { watched: true, frames: 0, now: 6000 }).attempts, 1);

  w.reset();
  w.observe('7|screen', { watched: true, frames: 0, now: 7000 });
  assert.equal(w.observe('7|screen', { watched: true, frames: 0, now: 13000 }).attempts, 1);
});

test('entrada esperada sem conexao nem tile pede cura com a mesma histerese', () => {
  const w = createStallWatch(OPTS);
  assert.equal(w.observe('relay|screen@origem', {
    watched: true, hasInbound: false, frames: null, now: 0,
  }), null);
  assert.equal(w.observe('relay|screen@origem', {
    watched: true, hasInbound: false, frames: null, now: 5999,
  }), null);
  assert.deepEqual(w.observe('relay|screen@origem', {
    watched: true, hasInbound: false, frames: null, now: 6000,
  }), { action: 'heal', stalledFor: 6000, attempts: 1 });
  assert.equal(w.observe('relay|screen@origem', {
    watched: true, hasInbound: false, frames: null, now: 8000,
  }), null, 'respeita o mesmo intervalo entre pedidos');
});

test('tentativas de repasse sao por filho e kind, com backoff e teto', () => {
  const retry = createRelayRetry({ baseDelayMs: 1000, maxAttempts: 3 });
  assert.deepEqual(retry.next('folha-a|screen@origem'), {
    action: 'retry', attempts: 1, delayMs: 1000,
  });
  assert.deepEqual(retry.next('folha-b|screen@origem'), {
    action: 'retry', attempts: 1, delayMs: 1000,
  }, 'outro filho comeca do proprio contador');
  assert.deepEqual(retry.next('folha-a|camera@origem'), {
    action: 'retry', attempts: 1, delayMs: 1000,
  }, 'outro kind comeca do proprio contador');
  assert.deepEqual(retry.next('folha-a|screen@origem'), {
    action: 'retry', attempts: 2, delayMs: 2000,
  });
  assert.deepEqual(retry.next('folha-a|screen@origem'), {
    action: 'retry', attempts: 3, delayMs: 4000,
  });
  assert.deepEqual(retry.next('folha-a|screen@origem'), {
    action: 'give-up', attempts: 3,
  });
  assert.equal(retry.next('folha-a|screen@origem'), null, 'nao repete o abandono');
});

test('repasse que voltou limpa o contador do filho e kind', () => {
  const retry = createRelayRetry({ baseDelayMs: 1000, maxAttempts: 3 });
  retry.next('folha|screen@origem');
  retry.next('folha|screen@origem');
  retry.reset('folha|screen@origem');
  assert.deepEqual(retry.next('folha|screen@origem'), {
    action: 'retry', attempts: 1, delayMs: 1000,
  });
});

function fakeRetryClock() {
  let nextHandle = 1;
  const timers = new Map();
  return {
    setTimeout(fn, delayMs) {
      const handle = nextHandle++;
      timers.set(handle, { fn, delayMs });
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    fireOnly() {
      assert.equal(timers.size, 1, 'esperava exatamente um retry agendado');
      const [handle, timer] = timers.entries().next().value;
      timers.delete(handle);
      timer.fn();
      return timer.delayMs;
    },
    get size() {
      return timers.size;
    },
  };
}

test('falhas consecutivas de repasse sem conexao fazem backoff de 1/2/4 s e desistem', () => {
  const clock = fakeRetryClock();
  const retry = createRelayRetry({
    baseDelayMs: 1000,
    maxAttempts: 3,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  const key = 'folha|screen@origem';
  const callbacks = [];
  const schedule = () => retry.failed(key, () => callbacks.push('retry'));

  assert.deepEqual(schedule(), { action: 'retry', attempts: 1, delayMs: 1000 });
  assert.equal(clock.fireOnly(), 1000);
  assert.deepEqual(schedule(), { action: 'retry', attempts: 2, delayMs: 2000 });
  assert.equal(clock.fireOnly(), 2000);
  assert.deepEqual(schedule(), { action: 'retry', attempts: 3, delayMs: 4000 });
  assert.equal(clock.fireOnly(), 4000);
  assert.deepEqual(schedule(), { action: 'give-up', attempts: 3 });
  assert.deepEqual(callbacks, ['retry', 'retry', 'retry']);
});

test('teardown cancela todos os timers de retry pendentes', () => {
  const clock = fakeRetryClock();
  const retry = createRelayRetry({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  let fired = 0;
  retry.failed('a|screen@origem', () => { fired += 1; });
  retry.failed('b|camera@origem', () => { fired += 1; });

  retry.clear();
  assert.equal(clock.size, 0);
  assert.equal(fired, 0);
});

test('cancelWhere cancela somente retries da origem e kind encerrados', () => {
  const clock = fakeRetryClock();
  const retry = createRelayRetry({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  let own = 0;
  let thirdParty = 0;
  retry.failed('leaf-a|screen@me', () => { own += 1; });
  retry.failed('leaf-b|screen@other', () => { thirdParty += 1; });

  retry.cancelWhere((key) => key.endsWith('|screen@me'));
  assert.equal(clock.size, 1);
  clock.fireOnly();
  assert.equal(own, 0);
  assert.equal(thirdParty, 1);
});

test('so connectionState connected zera o contador de retry', () => {
  const clock = fakeRetryClock();
  const retry = createRelayRetry({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const key = 'folha|screen@origem';

  retry.failed(key, () => {});
  clock.fireOnly();
  retry.connectionState(key, 'connecting');
  assert.deepEqual(retry.failed(key, () => {}), { action: 'retry', attempts: 2, delayMs: 2000 });

  retry.connectionState(key, 'connected');
  assert.deepEqual(retry.failed(key, () => {}), { action: 'retry', attempts: 1, delayMs: 1000 });
});

test('pedido explicito depois da desistência reinicia o ciclo de retry', () => {
  const clock = fakeRetryClock();
  const retry = createRelayRetry({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  const key = 'folha|screen@origem';

  for (let attempt = 0; attempt < 3; attempt += 1) {
    retry.failed(key, () => {});
    clock.fireOnly();
  }
  assert.deepEqual(retry.failed(key, () => {}), { action: 'give-up', attempts: 3 });

  retry.restart(key);
  assert.deepEqual(retry.failed(key, () => {}), { action: 'retry', attempts: 1, delayMs: 1000 });
});
