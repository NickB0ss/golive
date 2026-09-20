'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PcmRing, DEFAULTS } = require('./pcm-injector-worklet');

/** PCM planar com valores previsiveis: o quadro `i` vale `i` nos dois
 * canais (canal 1 com sinal trocado, pra flagrar troca de canal). */
function pcm(deQuadro, quantos, channels = 2) {
  return Array.from({ length: channels }, (_ignored, ch) => {
    const out = new Float32Array(quantos);
    for (let i = 0; i < quantos; i++) out[i] = ch === 0 ? deQuadro + i : -(deQuadro + i);
    return out;
  });
}

function saida(quadros, channels = 2) {
  return Array.from({ length: channels }, () => new Float32Array(quadros));
}

function entrelacado(deQuadro, quantos, channels = 2) {
  const out = new Float32Array(quantos * channels);
  for (let i = 0; i < quantos; i++) {
    for (let ch = 0; ch < channels; ch++) out[i * channels + ch] = ch === 0 ? deQuadro + i : -(deQuadro + i);
  }
  return out;
}

// Referencia literal do ring antes da mudanca. Ela fica so no teste para
// comparar a saida observavel, nao para ensinar a implementacao nova.
class RingAntigo {
  constructor({ channels = 2, capacityFrames = 96000, targetFrames = 5760 } = {}) {
    this.channels = channels;
    this.capacity = capacityFrames;
    this.target = Math.min(targetFrames, capacityFrames);
    this.buffers = Array.from({ length: channels }, () => new Float32Array(this.capacity));
    this.writeIdx = new Array(channels).fill(0);
    this.readIdx = new Array(channels).fill(0);
    this.available = new Array(channels).fill(0);
    this.droppedFrames = 0;
  }

  write(samples, channels) {
    if (channels !== this.channels) return 0;
    const frames = samples.length / channels;
    for (let ch = 0; ch < channels; ch++) {
      for (let i = 0; i < frames; i++) {
        this.buffers[ch][this.writeIdx[ch]] = samples[i * channels + ch];
        this.writeIdx[ch] = (this.writeIdx[ch] + 1) % this.capacity;
        if (this.available[ch] < this.capacity) this.available[ch]++;
        else this.readIdx[ch] = (this.readIdx[ch] + 1) % this.capacity;
      }
    }
    const excesso = this.available[0] - this.target;
    if (excesso > 0) {
      for (let ch = 0; ch < this.channels; ch++) {
        this.readIdx[ch] = (this.readIdx[ch] + excesso) % this.capacity;
        this.available[ch] -= excesso;
      }
      this.droppedFrames += excesso;
    }
    return frames;
  }

  read(outputs) {
    for (let ch = 0; ch < outputs.length; ch++) {
      const out = outputs[ch];
      const source = Math.min(ch, this.channels - 1);
      for (let i = 0; i < out.length; i++) {
        if (this.available[source] > 0) {
          out[i] = this.buffers[source][this.readIdx[source]];
          this.readIdx[source] = (this.readIdx[source] + 1) % this.capacity;
          this.available[source]--;
        } else out[i] = 0;
      }
    }
  }
}

test('ring em bloco preserva exatamente a saida antiga nos limites', () => {
  const novo = new PcmRing({ capacityFrames: 5, targetFrames: 3 });
  const antigo = new RingAntigo({ capacityFrames: 5, targetFrames: 3 });
  const compararLeitura = (frames) => {
    const atual = saida(frames);
    const referencia = saida(frames);
    novo.read(atual);
    antigo.read(referencia);
    assert.deepEqual(Array.from(atual[0]), Array.from(referencia[0]));
    assert.deepEqual(Array.from(atual[1]), Array.from(referencia[1]));
  };
  const compararEscrita = (inicio, frames) => {
    novo.write(pcm(inicio, frames), 2);
    antigo.write(entrelacado(inicio, frames), 2);
    assert.equal(novo.droppedFrames, antigo.droppedFrames);
  };

  compararLeitura(2); // silencio
  compararEscrita(1, 2); // bloco parcial
  compararLeitura(1);
  compararEscrita(3, 4); // volta no buffer circular e passa do teto
  compararLeitura(4);
});

test('devolve as amostras na ordem em que entraram, por canal', () => {
  const ring = new PcmRing();
  ring.write(pcm(1, 4), 2);
  const out = saida(4);
  ring.read(out);
  assert.deepEqual(Array.from(out[0]), [1, 2, 3, 4]);
  assert.deepEqual(Array.from(out[1]), [-1, -2, -3, -4]);
});

test('aceita planos e mantem a ordem no bloco parcial', () => {
  const ring = new PcmRing();
  ring.write(pcm(10, 5), 2);
  const out = saida(3);
  ring.read(out);
  assert.deepEqual(Array.from(out[0]), [10, 11, 12]);
  assert.deepEqual(Array.from(out[1]), [-10, -11, -12]);
});

test('planos atravessam a virada do buffer circular sem trocar canal', () => {
  const ring = new PcmRing({ capacityFrames: 5, targetFrames: 5 });
  ring.write(pcm(1, 4), 2);
  ring.read(saida(3));
  ring.write(pcm(5, 4), 2);
  const out = saida(5);
  ring.read(out);
  assert.deepEqual(Array.from(out[0]), [4, 5, 6, 7, 8]);
  assert.deepEqual(Array.from(out[1]), [-4, -5, -6, -7, -8]);
});

test('sem dado ainda e silencio, nao excecao nem lixo', () => {
  const ring = new PcmRing();
  const out = saida(3);
  ring.read(out);
  assert.deepEqual(Array.from(out[0]), [0, 0, 0]);
});

test('consumo parcial deixa o resto pro proximo quantum', () => {
  const ring = new PcmRing();
  ring.write(pcm(1, 5), 2);
  const a = saida(2);
  ring.read(a);
  assert.deepEqual(Array.from(a[0]), [1, 2]);
  const b = saida(3);
  ring.read(b);
  assert.deepEqual(Array.from(b[0]), [3, 4, 5]);
});

test('numero de canais diferente do esperado e ignorado', () => {
  const ring = new PcmRing();
  assert.equal(ring.write(pcm(1, 4, 1), 1), 0);
  assert.equal(ring.backlogFrames(), 0);
});

// --- O defeito do log de 2026-09-19: atraso que entra e nunca sai ---
//
// WASAPI e o AudioContext sao relogios INDEPENDENTES. Qualquer soluco (IPC
// atrasado, renderer ocupado, janela oculta) deixa o produtor a frente, e o
// consumo de 128 amostras por quantum nunca alcanca de volta. Ate aqui o
// unico limite era a capacidade de 2 s -- ou seja, o estado estavel depois de
// UM soluco era o atraso MAXIMO, permanente. "O som saia atrasado."
test('backlog acima do alvo e cortado, e o que sobra e o audio MAIS NOVO', () => {
  const ring = new PcmRing({ targetFrames: 100, capacityFrames: 10000 });
  ring.write(pcm(1, 500), 2); // 5x o alvo

  assert.equal(ring.backlogFrames(), 100, 'cortou pro alvo');
  assert.equal(ring.droppedFrames, 400);

  const out = saida(3);
  ring.read(out);
  // Descartar o mais VELHO e o que importa: manter o antigo seria manter o
  // atraso, que e exatamente o sintoma.
  assert.deepEqual(Array.from(out[0]), [401, 402, 403]);
});

test('backlog dentro do alvo nunca e cortado -- sem estalo gratuito', () => {
  const ring = new PcmRing({ targetFrames: 100, capacityFrames: 10000 });
  for (let i = 0; i < 9; i++) ring.write(pcm(1 + i * 10, 10), 2);
  assert.equal(ring.backlogFrames(), 90);
  assert.equal(ring.droppedFrames, 0);
  const out = saida(1);
  ring.read(out);
  assert.equal(out[0][0], 1, 'comecou do primeiro quadro, nada perdido');
});

test('deriva lenta tambem e contida -- o atraso nao cresce sem limite', () => {
  const ring = new PcmRing({ targetFrames: 100, capacityFrames: 10000 });
  // Produtor 10% mais rapido que o consumo, por muitas rodadas.
  for (let i = 0; i < 200; i++) {
    ring.write(pcm(1, 11), 2);
    ring.read(saida(10));
  }
  assert.ok(ring.backlogFrames() <= 100, `backlog ficou em ${ring.backlogFrames()}`);
  assert.ok(ring.droppedFrames > 0, 'houve corte');
});

test('o alvo padrao e bem menor que a capacidade -- folga nao e latencia', () => {
  assert.ok(DEFAULTS.targetFrames < DEFAULTS.capacityFrames / 4);
  assert.ok(DEFAULTS.targetFrames / 48000 <= 0.2, 'alvo de playout acima de 200ms ja e audivel');
});

test('estourar a capacidade continua descartando o mais antigo, sem travar', () => {
  const ring = new PcmRing({ targetFrames: 1000, capacityFrames: 100 });
  ring.write(pcm(1, 250), 2);
  assert.ok(ring.backlogFrames() <= 100);
  const out = saida(1);
  ring.read(out);
  assert.equal(out[0][0], 151, 'ficou com o fim do que entrou');
});
