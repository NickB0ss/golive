'use strict';

// Microbenchmark reproduz um pacote WASAPI de 10 ms (480 quadros estereo) e
// quatro quanta de 128 quadros. Mede CPU local, nao latencia de IPC real.
const { performance } = require('node:perf_hooks');
const { PcmRing } = require('../src/renderer/pcm-injector-worklet');
const { PcmPlanarPool } = require('../src/renderer/pcm-planar');

const FRAMES = 480;
const CHANNELS = 2;
const QUANTUM = 128;
const BLOCKS = 100000;

class RingAntigo {
  constructor() {
    this.buffers = [new Float32Array(96000), new Float32Array(96000)];
    this.writeIdx = [0, 0];
    this.readIdx = [0, 0];
    this.available = [0, 0];
  }

  write(samples) {
    for (let ch = 0; ch < CHANNELS; ch++) {
      for (let i = 0; i < FRAMES; i++) {
        this.buffers[ch][this.writeIdx[ch]] = samples[i * CHANNELS + ch];
        this.writeIdx[ch] = (this.writeIdx[ch] + 1) % 96000;
        this.available[ch]++;
      }
    }
  }

  read(outputs) {
    for (let ch = 0; ch < CHANNELS; ch++) {
      for (let i = 0; i < QUANTUM; i++) {
        outputs[ch][i] = this.buffers[ch][this.readIdx[ch]];
        this.readIdx[ch] = (this.readIdx[ch] + 1) % 96000;
        this.available[ch]--;
      }
    }
  }
}

function interleaved() {
  const samples = new Float32Array(FRAMES * CHANNELS);
  for (let i = 0; i < samples.length; i++) samples[i] = i;
  return samples;
}

function measure(name, fn) {
  for (let i = 0; i < 5000; i++) fn();
  const started = performance.now();
  for (let i = 0; i < BLOCKS; i++) fn();
  const elapsedMs = performance.now() - started;
  return { name, elapsedMs, usPerBlock: (elapsedMs * 1000) / BLOCKS };
}

const source = interleaved();
const output = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
const oldRing = new RingAntigo();
const oldResult = measure('antigo-worklet', () => {
  oldRing.write(source);
  oldRing.read(output);
  oldRing.read(output);
  oldRing.read(output);
  oldRing.read(output);
});

const pool = new PcmPlanarPool({ framesPerBuffer: FRAMES, warmBuffers: 1 });
const newRing = new PcmRing({ capacityFrames: 96000, targetFrames: 96000 });
const newResult = measure('novo-renderer-e-worklet', () => {
  const planes = pool.acquire(FRAMES);
  pool.deinterleave(source, planes, FRAMES);
  newRing.write(planes, CHANNELS, FRAMES);
  newRing.read(output);
  newRing.read(output);
  newRing.read(output);
  newRing.read(output);
  // Simula os mesmos buffers devolvidos pelo worklet depois da transferencia.
  pool.release(planes);
});

const reusable = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
const cloneResult = measure('clone-sem-transferir', () => {
  structuredClone({ planes: reusable });
});
const transferResult = measure('transferir-e-devolver', () => {
  const sent = structuredClone({ planes: reusable }, { transfer: reusable.map((plane) => plane.buffer) });
  const returned = structuredClone(sent, { transfer: sent.planes.map((plane) => plane.buffer) });
  reusable[0] = returned.planes[0];
  reusable[1] = returned.planes[1];
});

for (const result of [oldResult, newResult, cloneResult, transferResult]) {
  console.log(`${result.name}: ${result.usPerBlock.toFixed(3)} us/bloco (${BLOCKS} blocos em ${result.elapsedMs.toFixed(1)} ms)`);
}
console.log(`iteracoes antigas no worklet: ${FRAMES * CHANNELS + 4 * QUANTUM * CHANNELS}; novas: 0 por amostra (renderer: ${FRAMES} quadros / ${FRAMES * CHANNELS} atribuicoes)`);
