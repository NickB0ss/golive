'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSupported, create } = require('./screenrelay');

// Dubles das APIs de midia. Nao ha jsdom no projeto, entao o escopo e o
// document entram por injecao (ver os opts de `create`).

function fakeFrame(w, h) {
  return { displayWidth: w, displayHeight: h, fechado: false, close() { this.fechado = true; } };
}

/** Canvas falso que registra o que foi desenhado e o tamanho no momento. */
function fakeCanvas() {
  const c = {
    width: 0,
    height: 0,
    desenhos: [],
    pedidos: 0,
    getContext: () => ({
      drawImage(frame) { c.desenhos.push({ w: c.width, h: c.height, frame }); },
    }),
    captureStream(fps) {
      c.fpsPedido = fps;
      return {
        getVideoTracks: () => [{
          contentHint: '',
          parada: false,
          requestFrame() { c.pedidos += 1; },
          stop() { this.parada = true; },
        }],
      };
    },
  };
  return c;
}

/** Escopo com MediaStreamTrackProcessor que entrega `frames` e depois fecha. */
function fakeEscopo(frames, { falhaNaLeitura = false } = {}) {
  const fila = frames.slice();
  return {
    HTMLCanvasElement: function () {},
    MediaStreamTrackProcessor: function ({ track }) {
      this.track = track;
      this.readable = {
        getReader: () => ({
          cancelado: false,
          async read() {
            if (falhaNaLeitura) throw new Error('leitura explodiu');
            if (!fila.length) return { done: true };
            return { done: false, value: fila.shift() };
          },
          cancel() { this.cancelado = true; },
        }),
      };
    },
  };
}

function montarEscopo(frames, opts) {
  const e = fakeEscopo(frames, opts);
  e.HTMLCanvasElement.prototype = { captureStream() {} };
  return e;
}

function fakeDoc(canvas) {
  return { createElement: () => canvas };
}

const trackFalsa = { getSettings: () => ({ width: 1920, height: 1080 }) };
const proximoTick = () => new Promise((r) => setTimeout(r, 0));

test('isSupported exige Processor E captureStream no canvas', () => {
  const completo = montarEscopo([]);
  assert.equal(isSupported(completo), true);

  const semProcessor = montarEscopo([]);
  delete semProcessor.MediaStreamTrackProcessor;
  assert.equal(isSupported(semProcessor), false);

  const semCaptureStream = montarEscopo([]);
  semCaptureStream.HTMLCanvasElement.prototype = {};
  assert.equal(isSupported(semCaptureStream), false);
});

test('sem suporte, create devolve null em vez de lancar', () => {
  // O caminho de fallback: quem chama segue com a track de captura crua.
  const escopo = montarEscopo([]);
  delete escopo.MediaStreamTrackProcessor;
  assert.equal(create(trackFalsa, { escopo, document: fakeDoc(fakeCanvas()) }), null);
});

test('sem track, create devolve null', () => {
  assert.equal(create(null, { escopo: montarEscopo([]), document: fakeDoc(fakeCanvas()) }), null);
});

test('a track de saida nasce com contentHint motion', () => {
  // E o ponto do modulo inteiro: 'motion' numa track de CANVAS nao derruba
  // o encoder de hardware, ao contrario de 'motion' na track de captura.
  const canvas = fakeCanvas();
  const relay = create(trackFalsa, { escopo: montarEscopo([]), document: fakeDoc(canvas) });
  assert.equal(relay.track.contentHint, 'motion');
});

test('captureStream e pedido com 0 -- entrega manual, nao amostragem', () => {
  // captureStream(fps) instala um amostrador de taxa fixa que perde ~15%
  // dos quadros (medido). O 0 desliga isso.
  const canvas = fakeCanvas();
  create(trackFalsa, { escopo: montarEscopo([]), document: fakeDoc(canvas) });
  assert.equal(canvas.fpsPedido, 0);
});

test('cada quadro lido vira um desenho e um requestFrame', async () => {
  const canvas = fakeCanvas();
  const frames = [fakeFrame(1920, 1080), fakeFrame(1920, 1080), fakeFrame(1920, 1080)];
  const relay = create(trackFalsa, { escopo: montarEscopo(frames), document: fakeDoc(canvas) });

  for (let i = 0; i < 12; i += 1) await proximoTick();

  assert.equal(canvas.desenhos.length, 3);
  assert.equal(canvas.pedidos, 3, 'um requestFrame por quadro');
  assert.equal(relay.quadros(), 3);
  relay.stop();
});

test('TODO quadro e fechado -- VideoFrame segura memoria de GPU', async () => {
  const canvas = fakeCanvas();
  const frames = [fakeFrame(1280, 720), fakeFrame(1280, 720)];
  const relay = create(trackFalsa, { escopo: montarEscopo(frames), document: fakeDoc(canvas) });

  for (let i = 0; i < 12; i += 1) await proximoTick();

  assert.ok(frames.every((f) => f.fechado), 'sem close() o pipeline trava em poucos quadros');
  relay.stop();
});

test('o canvas segue o tamanho do quadro que chega', async () => {
  // E o que mantem o applyConstraints da escada de qualidade valendo:
  // quando ela baixa a captura pra 720p, o relay acompanha sozinho.
  const canvas = fakeCanvas();
  const frames = [fakeFrame(1920, 1080), fakeFrame(1280, 720), fakeFrame(1280, 720)];
  const relay = create(trackFalsa, { escopo: montarEscopo(frames), document: fakeDoc(canvas) });

  for (let i = 0; i < 12; i += 1) await proximoTick();

  assert.deepEqual(canvas.desenhos.map((d) => `${d.w}x${d.h}`), ['1920x1080', '1280x720', '1280x720']);
  relay.stop();
});

test('quadro sem dimensao nao zera o canvas', async () => {
  const canvas = fakeCanvas();
  const relay = create(trackFalsa, { escopo: montarEscopo([fakeFrame(0, 0)]), document: fakeDoc(canvas) });

  for (let i = 0; i < 12; i += 1) await proximoTick();

  assert.equal(canvas.desenhos[0].w, 1920, 'mantem o tamanho vindo de getSettings');
  assert.equal(canvas.desenhos[0].h, 1080);
  relay.stop();
});

test('stop para a track de saida e nao lanca duas vezes', () => {
  const canvas = fakeCanvas();
  const relay = create(trackFalsa, { escopo: montarEscopo([]), document: fakeDoc(canvas) });
  relay.stop();
  assert.equal(relay.track.parada, true);
  assert.doesNotThrow(() => relay.stop());
});

test('falha no laco vira callback, nao silencio', async () => {
  // Uma tela que congela sem deixar rastro no log foi exatamente o tipo de
  // problema que originou esta investigacao.
  const canvas = fakeCanvas();
  const erros = [];
  const relay = create(trackFalsa, {
    escopo: montarEscopo([], { falhaNaLeitura: true }),
    document: fakeDoc(canvas),
    onFrameError: (e) => erros.push(e),
  });

  for (let i = 0; i < 12; i += 1) await proximoTick();

  assert.equal(erros.length, 1);
  assert.match(String(erros[0].message), /explodiu/);
  relay.stop();
});

test('depois de stop, um erro tardio do laco nao vira callback', async () => {
  const canvas = fakeCanvas();
  const erros = [];
  const relay = create(trackFalsa, {
    escopo: montarEscopo([], { falhaNaLeitura: true }),
    document: fakeDoc(canvas),
    onFrameError: (e) => erros.push(e),
  });
  relay.stop();

  for (let i = 0; i < 12; i += 1) await proximoTick();

  assert.equal(erros.length, 0, 'parar de proposito nao e falha');
});
