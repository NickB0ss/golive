// Recebe chunks de PCM float32 entrelacado via postMessage (ver
// pcmInjector() em app.js) e devolve como audio "de verdade" pro grafo do
// Web Audio, através de um buffer circular por canal -- e a unica forma de
// levar audio que nao veio de um <video>/<audio>/getUserMedia (nesse caso,
// capturado nativamente fora do Chromium) pra dentro de um MediaStreamTrack
// que o WebRTC aceita.
class PcmInjectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 2s de buffer por canal a 48kHz -- generoso o bastante pra absorver
    // qualquer atraso do IPC main->renderer sem estourar.
    this.capacity = 48000 * 2;
    this.channels = 2;
    this.buffers = [new Float32Array(this.capacity), new Float32Array(this.capacity)];
    this.writeIdx = [0, 0];
    this.readIdx = [0, 0];
    this.available = [0, 0];

    this.port.onmessage = (event) => {
      const { samples, channels } = event.data;
      if (channels !== this.channels) {
        // Reamostragem de canal nao suportada aqui -- na pratica a captura
        // nativa sempre entrega estereo (ver loopback_capture.cc).
        return;
      }
      const frames = samples.length / channels;
      for (let ch = 0; ch < channels; ch++) {
        const buf = this.buffers[ch];
        for (let i = 0; i < frames; i++) {
          buf[this.writeIdx[ch]] = samples[i * channels + ch];
          this.writeIdx[ch] = (this.writeIdx[ch] + 1) % this.capacity;
          if (this.available[ch] < this.capacity) {
            this.available[ch]++;
          } else {
            // Buffer cheio (produtor mais rapido que o consumo em tempo
            // real, ex: apos um soluco no IPC) -- descarta a amostra mais
            // antiga em vez de travar tudo.
            this.readIdx[ch] = (this.readIdx[ch] + 1) % this.capacity;
          }
        }
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    for (let ch = 0; ch < output.length; ch++) {
      const outCh = output[ch];
      const srcCh = ch < this.channels ? ch : this.channels - 1;
      const buf = this.buffers[srcCh];
      for (let i = 0; i < outCh.length; i++) {
        if (this.available[srcCh] > 0) {
          outCh[i] = buf[this.readIdx[srcCh]];
          this.readIdx[srcCh] = (this.readIdx[srcCh] + 1) % this.capacity;
          this.available[srcCh]--;
        } else {
          outCh[i] = 0; // sem dado disponivel ainda -- silencio em vez de travar
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-injector', PcmInjectorProcessor);
