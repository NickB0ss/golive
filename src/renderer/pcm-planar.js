'use strict';

// A desintercalacao fica no renderer, nunca no AudioWorklet: o renderer pode
// atrasar um pacote, mas um laco por amostra no quantum de audio causa falha
// audivel. O pool evita alocar planos no renderer para cada pacote.
(function (root) {
  class PcmPlanarPool {
    constructor(opts = {}) {
      this.channels = opts.channels ?? 2;
      this.framesPerBuffer = opts.framesPerBuffer ?? 960;
      this.free = [];
      const warmBuffers = opts.warmBuffers ?? 4;
      for (let i = 0; i < warmBuffers; i++) this.free.push(this.#make(this.framesPerBuffer));
    }

    acquire(frames) {
      const index = this.free.findIndex((planes) => planes[0].length >= frames);
      return index === -1 ? this.#make(frames) : this.free.splice(index, 1)[0];
    }

    release(planes) {
      if (!Array.isArray(planes) || planes.length !== this.channels) return;
      if (!planes.every((plane) => plane instanceof Float32Array)) return;
      this.free.push(planes);
    }

    deinterleave(samples, planes, frames) {
      for (let frame = 0, sample = 0; frame < frames; frame++, sample += this.channels) {
        for (let ch = 0; ch < this.channels; ch++) planes[ch][frame] = samples[sample + ch];
      }
    }

    #make(frames) {
      return Array.from({ length: this.channels }, () => new Float32Array(frames));
    }
  }

  const api = { PcmPlanarPool };
  root.GoLive = root.GoLive || {};
  root.GoLive.pcmPlanar = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
