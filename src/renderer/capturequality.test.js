'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('./capturequality');

const LOW = { width: { max: 1280 }, frameRate: { max: 30 } };
const MID = { width: { max: 1600 }, frameRate: { max: 30 } };
const HIGH = { width: { max: 1920 }, frameRate: { max: 60 } };

class CaptureTrack extends EventTarget {
  readyState = 'live';
  calls = [];

  applyConstraints(constraints) {
    const pending = Promise.withResolvers();
    this.calls.push({ constraints, ...pending });
    return pending.promise;
  }

  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

function setup(onError) {
  const timers = new Set();
  const controller = create({
    onError,
    setTimeout(run, delay) {
      const timer = { run, delay, unref() { this.unreferenced = true; } };
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
  });
  return {
    ...controller, timers,
    retry() {
      assert.equal(timers.size, 1);
      const [timer] = timers;
      timers.delete(timer);
      timer.run();
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const applied = (track) => track.calls.map(({ constraints }) => constraints);

test('rejeicao permite repetir a mesma configuracao e sucesso encerra o retry', async () => {
  const errors = [];
  const controller = setup((error, context) => errors.push({ error, context }));
  const track = new CaptureTrack();
  const error = new Error('OverconstrainedError');

  controller.request(track, LOW);
  track.calls[0].reject(error);
  await flush();
  controller.request(track, LOW);
  assert.deepEqual(applied(track), [LOW]);
  assert.deepEqual(errors, [{ error, context: { track, constraints: LOW, attempt: 1, retryMs: 1000 } }]);
  assert.deepEqual(Array.from(controller.timers, ({ delay, unreferenced }) => [delay, unreferenced]), [[1000, true]]);

  controller.retry();
  assert.deepEqual(applied(track), [LOW, LOW]);
  track.calls[1].resolve();
  await flush();
  controller.request(track, LOW);
  assert.equal(track.calls.length, 2);
  assert.equal(controller.timers.size, 0);
});

test('dobra o intervalo de novas tentativas ate o teto', async () => {
  const controller = setup();
  const track = new CaptureTrack();
  controller.request(track, LOW);
  const delays = [1000, 2000, 4000, 8000, 10000, 10000];

  for (const [index, delay] of delays.entries()) {
    track.calls[index].reject(new Error('falha repetida'));
    await flush();
    assert.deepEqual(Array.from(controller.timers, (timer) => timer.delay), [delay]);
    controller.retry();
  }
  assert.deepEqual(applied(track), Array(delays.length + 1).fill(LOW));
});

test('deduplica constraints equivalentes durante a aplicacao e depois do sucesso', async () => {
  const controller = setup();
  const track = new CaptureTrack();

  controller.request(track, LOW);
  controller.request(track, { frameRate: { max: 30 }, width: { max: 1280 } });
  assert.deepEqual(applied(track), [LOW]);
  track.calls[0].resolve();
  await flush();
  controller.request(track, LOW);
  assert.deepEqual(applied(track), [LOW]);
});

test('serializa a mesma track e guarda apenas o alvo mais recente', async () => {
  const controller = setup();
  const track = new CaptureTrack();

  controller.request(track, LOW);
  controller.request(track, MID);
  controller.request(track, HIGH);
  assert.deepEqual(applied(track), [LOW]);
  track.calls[0].resolve();
  await flush();
  assert.deepEqual(applied(track), [LOW, HIGH]);
});

test('preserva as constraints enfileiradas quando o chamador muda objetos e listas', async () => {
  const controller = setup();
  const track = new CaptureTrack();
  const constraints = {
    frameRate: { ideal: 60, max: 60 },
    resizeMode: { ideal: ['crop-and-scale', 'none'] },
    advanced: [{ aspectRatio: { ideal: 16 / 9 } }],
  };
  controller.request(track, LOW);
  controller.request(track, constraints);
  constraints.frameRate.ideal = 15;
  constraints.resizeMode.ideal.reverse();
  constraints.advanced[0].aspectRatio.ideal = 4 / 3;
  track.calls[0].resolve();
  await flush();

  const original = {
    advanced: [{ aspectRatio: { ideal: 16 / 9 } }],
    resizeMode: { ideal: ['crop-and-scale', 'none'] },
    frameRate: { max: 60, ideal: 60 },
  };
  assert.deepEqual(applied(track), [LOW, original]);
  track.calls[1].resolve();
  await flush();
  controller.request(track, original);
  assert.equal(track.calls.length, 2);
  controller.request(track, constraints);
  assert.deepEqual(applied(track), [LOW, original, constraints]);
});

test('troca de track inicia a nova antes da conclusao antiga, que nao gera retry', async () => {
  const errors = [];
  const controller = setup((error) => errors.push(error));
  const old = new CaptureTrack();
  const current = new CaptureTrack();
  controller.request(old, LOW);
  controller.request(current, HIGH);
  assert.deepEqual(applied(current), [HIGH]);

  old.calls[0].reject(new Error('track antiga'));
  await flush();
  assert.deepEqual(errors, []);
  assert.equal(controller.timers.size, 0);
  current.calls[0].resolve();
  await flush();
  controller.request(current, HIGH);
  assert.deepEqual(applied(current), [HIGH]);
});

test('reset invalida a aplicacao antiga sem sobrepor duas aplicacoes na mesma track', async () => {
  const controller = setup();
  const track = new CaptureTrack();
  controller.request(track, HIGH);
  controller.reset();
  controller.request(track, HIGH);
  assert.deepEqual(applied(track), [HIGH]);

  track.calls[0].resolve();
  await flush();
  assert.deepEqual(applied(track), [HIGH, HIGH]);
  track.calls[1].resolve();
  await flush();
  controller.reset();
  controller.request(track, HIGH);
  assert.deepEqual(applied(track), [HIGH, HIGH, HIGH]);
});

test('reset e alvo com track invalida cancelam o timer do alvo anterior', async () => {
  const controller = setup();
  const track = new CaptureTrack();
  controller.request(track, LOW);
  track.calls[0].reject(new Error('falha antes do reset'));
  await flush();
  controller.reset();
  assert.equal(controller.timers.size, 0);

  controller.request(track, LOW);
  track.calls[1].reject(new Error('falha antes da troca'));
  await flush();
  controller.request({}, HIGH);
  assert.equal(controller.timers.size, 0);
});

test('track encerrada cancela o retry pendente', async () => {
  const controller = setup();
  const track = new CaptureTrack();
  controller.request(track, LOW);
  track.calls[0].reject(new Error('falha antes do encerramento'));
  await flush();
  assert.equal(controller.timers.size, 1);

  track.end();
  assert.equal(controller.timers.size, 0);
  controller.request(track, HIGH);
  assert.deepEqual(applied(track), [LOW]);
});

test('track que foi parada sem evento nao e reaplicada pelo timer', async () => {
  const controller = setup();
  const track = new CaptureTrack();
  controller.request(track, LOW);
  track.calls[0].reject(new Error('falha antes da parada'));
  await flush();
  track.readyState = 'ended';
  controller.retry();
  assert.deepEqual(applied(track), [LOW]);
  assert.equal(controller.timers.size, 0);
});

test('falha na callback de diagnostico nao impede o retry', async () => {
  let reports = 0;
  const controller = setup(() => {
    reports += 1;
    if (reports === 1) throw new Error('falha sincrona no diagnostico');
    return Promise.reject(new Error('falha assincrona no diagnostico'));
  });
  const track = new CaptureTrack();
  controller.request(track, LOW);
  track.calls[0].reject(new Error('primeira falha de captura'));
  await flush();
  controller.retry();
  track.calls[1].reject(new Error('segunda falha de captura'));
  await flush();
  controller.retry();
  assert.deepEqual(applied(track), [LOW, LOW, LOW]);
  assert.equal(reports, 2);
});

test('alvo novo cancela o backoff anterior e tem seu proprio intervalo', async () => {
  const controller = setup();
  const track = new CaptureTrack();
  controller.request(track, LOW);
  track.calls[0].reject(new Error('primeira falha'));
  await flush();
  controller.retry();
  track.calls[1].reject(new Error('segunda falha'));
  await flush();
  assert.deepEqual(Array.from(controller.timers, (timer) => timer.delay), [2000]);

  controller.request(track, HIGH);
  assert.equal(controller.timers.size, 0);
  assert.deepEqual(applied(track), [LOW, LOW, HIGH]);
  track.calls[2].reject(new Error('falha do alvo novo'));
  await flush();
  assert.deepEqual(Array.from(controller.timers, (timer) => timer.delay), [1000]);
});

test('alvo novo comeca assim que termina a tentativa anterior que falhou', async () => {
  const controller = setup();
  const track = new CaptureTrack();
  controller.request(track, LOW);
  controller.request(track, HIGH);
  assert.deepEqual(applied(track), [LOW]);
  track.calls[0].reject(new Error('alvo substituido durante aplicacao'));
  await flush();
  assert.equal(controller.timers.size, 0);
  assert.deepEqual(applied(track), [LOW, HIGH]);
});

test('volta ao alvo antes aplicado quando a tentativa intermediaria tem sucesso', async () => {
  const controller = setup();
  const track = new CaptureTrack();
  controller.request(track, LOW);
  track.calls[0].resolve();
  await flush();
  controller.request(track, HIGH);
  controller.request(track, LOW);
  assert.deepEqual(applied(track), [LOW, HIGH]);
  track.calls[1].resolve();
  await flush();
  assert.deepEqual(applied(track), [LOW, HIGH, LOW]);
});
