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

test('relay arredonda o canvas inicial e o frame impar para baixo ate par', async () => {
  const canvas = fakeCanvas();
  const source = { getSettings: () => ({ width: 1203, height: 847 }) };
  create(source, {
    escopo: montarEscopo([fakeFrame(1203, 847)]),
    document: fakeDoc(canvas),
  });
  await proximoTick();
  assert.equal(canvas.width, 1202);
  assert.equal(canvas.height, 846);
  assert.deepEqual(canvas.desenhos.map(({ w, h }) => ({ w, h })), [{ w: 1202, h: 846 }]);
});

test('relay conserva o tamanho par do canvas', async () => {
  const canvas = fakeCanvas();
  const source = { getSettings: () => ({ width: 1202, height: 846 }) };
  create(source, {
    escopo: montarEscopo([fakeFrame(1202, 846)]),
    document: fakeDoc(canvas),
  });
  await proximoTick();
  assert.equal(canvas.width, 1202);
  assert.equal(canvas.height, 846);
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

function escopoPorTrack() {
  const e = {
    HTMLCanvasElement: function () {},
    MediaStreamTrackProcessor: function ({ track }) {
      if (track.invalida) throw new Error('track invalida');
      const fila = track.frames;
      let pendente;
      this.readable = {
        getReader: () => ({
          async read() {
            if (fila.length) return { done: false, value: fila.shift() };
            return new Promise((resolve) => { pendente = resolve; });
          },
          cancel() { pendente?.({ done: true }); },
        }),
      };
    },
  };
  e.HTMLCanvasElement.prototype = { captureStream() {} };
  return e;
}

test('swapSource troca a entrada e conserva a track de saida', async () => {
  const canvas = fakeCanvas();
  const antiga = { frames: [fakeFrame(1280, 720)], getSettings: () => ({ width: 1280, height: 720 }) };
  const nova = { frames: [fakeFrame(800, 600)], getSettings: () => ({ width: 800, height: 600 }) };
  const relay = create(antiga, { escopo: escopoPorTrack(), document: fakeDoc(canvas) });
  const saida = relay.track;
  await proximoTick();

  assert.equal(relay.swapSource(nova), true);
  for (let i = 0; i < 4; i += 1) await proximoTick();

  assert.equal(relay.track, saida);
  assert.deepEqual(canvas.desenhos.map((d) => `${d.w}x${d.h}`), ['1280x720', '800x600']);
  assert.equal(saida.parada, false);
  relay.stop();
});

test('swapSource recusada conserva a fonte anterior', async () => {
  const canvas = fakeCanvas();
  const antiga = { frames: [fakeFrame(640, 480), fakeFrame(640, 480)], getSettings: () => ({ width: 640, height: 480 }) };
  const relay = create(antiga, { escopo: escopoPorTrack(), document: fakeDoc(canvas) });

  assert.equal(relay.swapSource({ invalida: true }), false);
  for (let i = 0; i < 4; i += 1) await proximoTick();

  assert.equal(canvas.desenhos.length, 2);
  relay.stop();
});

test('dois swapSource seguidos mantem o laco vivo na fonte mais nova', async () => {
  const canvas = fakeCanvas();
  const antiga = { frames: [], getSettings: () => ({ width: 640, height: 480 }) };
  const segunda = { frames: [], getSettings: () => ({ width: 800, height: 600 }) };
  const terceira = { frames: [fakeFrame(1024, 768)], getSettings: () => ({ width: 1024, height: 768 }) };
  const relay = create(antiga, { escopo: escopoPorTrack(), document: fakeDoc(canvas) });

  assert.equal(relay.swapSource(segunda), true);
  assert.equal(relay.swapSource(terceira), true);
  for (let i = 0; i < 4; i += 1) await proximoTick();

  assert.equal(relay.quadros(), 1);
  assert.equal(canvas.desenhos[0].w, 1024);
  relay.stop();
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

/** Canvas cujo contexto 2D pode ser perdido de fora, como acontece quando o
 * processo de GPU cai com a janela escondida (spike 2026-10-25, Electron 44):
 * `isContextLost()` vira true na hora, o canvas para de emitir quadro e so
 * se restaura quando a pagina volta a ficar visivel. */
function fakeCanvasPerdivel() {
  const c = fakeCanvas();
  c.perdido = false;
  const getContext = c.getContext;
  c.getContext = () => ({ ...getContext(), isContextLost: () => c.perdido });
  return c;
}

/** Document que entrega um canvas novo a cada createElement. */
function docDeCanvases(canvases) {
  let i = 0;
  return { createElement: () => canvases[i++] };
}

test('contexto do canvas perdido: a saida e refeita num canvas novo e quem chama troca a track', async () => {
  // O sala-de-6 do laboratorio: GPU caiu com a janela da Ana escondida, o
  // canvas do relay parou de emitir e quem assistia ficou sem imagem ate a
  // janela aparecer. Um canvas criado depois da queda funciona mesmo
  // escondido (medido no spike), entao o relay se refaz sozinho.
  const primeiro = fakeCanvasPerdivel();
  const segundo = fakeCanvasPerdivel();
  const fonte = { frames: [fakeFrame(1280, 720)], getSettings: () => ({ width: 1280, height: 720 }) };
  const trocas = [];
  const relay = create(fonte, {
    escopo: escopoPorTrack(),
    document: docDeCanvases([primeiro, segundo]),
    onTrackChange: (nova, antiga) => trocas.push({ nova, antiga }),
  });
  const antiga = relay.track;
  await proximoTick();
  assert.equal(primeiro.desenhos.length, 1);

  primeiro.perdido = true;
  fonte.frames.push(fakeFrame(1280, 720));
  relay.swapSource(fonte); // acorda o leitor falso com o quadro novo
  for (let i = 0; i < 4; i += 1) await proximoTick();

  assert.equal(trocas.length, 1, 'um aviso de troca');
  assert.equal(trocas[0].antiga, antiga);
  assert.equal(trocas[0].nova, relay.track);
  assert.notEqual(relay.track, antiga);
  assert.equal(relay.track.contentHint, 'motion', 'a saida nova tambem leva o hint');
  assert.equal(segundo.fpsPedido, 0);
  assert.equal(antiga.parada, true, 'a saida morta e encerrada');
  assert.equal(primeiro.desenhos.length, 1, 'nada mais e desenhado no canvas perdido');
  assert.deepEqual(segundo.desenhos.map((d) => `${d.w}x${d.h}`), ['1280x720'], 'o quadro que chegou vai pro canvas novo');
  assert.equal(segundo.pedidos, 1);
  relay.stop();
  assert.equal(relay.track.parada, true, 'stop encerra a saida atual');
});

test('contexto perdido e canvas novo indisponivel: segue tentando no proximo quadro', async () => {
  const primeiro = fakeCanvasPerdivel();
  const semContexto = { ...fakeCanvas(), getContext: () => null };
  const terceiro = fakeCanvasPerdivel();
  const fonte = { frames: [], getSettings: () => ({ width: 640, height: 480 }) };
  const trocas = [];
  const relay = create(fonte, {
    escopo: escopoPorTrack(),
    document: docDeCanvases([primeiro, semContexto, terceiro]),
    onTrackChange: (nova) => trocas.push(nova),
  });
  primeiro.perdido = true;

  fonte.frames.push(fakeFrame(640, 480));
  relay.swapSource(fonte);
  for (let i = 0; i < 4; i += 1) await proximoTick();
  assert.equal(trocas.length, 0, 'sem canvas novo, sem troca');

  fonte.frames.push(fakeFrame(640, 480));
  relay.swapSource(fonte);
  for (let i = 0; i < 4; i += 1) await proximoTick();
  assert.equal(trocas.length, 1);
  assert.equal(terceiro.desenhos.length, 1);
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
