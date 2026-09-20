// Recebe chunks de PCM float32 entrelacado via postMessage (ver
// pcmInjector() em app.js) e devolve como audio "de verdade" pro grafo do
// Web Audio, através de um buffer circular por canal -- e a unica forma de
// levar audio que nao veio de um <video>/<audio>/getUserMedia (nesse caso,
// capturado nativamente fora do Chromium) pra dentro de um MediaStreamTrack
// que o WebRTC aceita.
//
// O ALVO DE PLAYOUT, e por que ele existe (log de 2026-09-19, "o som saia
// atrasado"): a captura nativa (WASAPI) e o AudioContext sao relogios
// INDEPENDENTES. Eles nunca batem exatamente, e o consumo aqui e rigido --
// 128 amostras por quantum, sempre. Entao qualquer soluco (IPC atrasado,
// renderer ocupado, janela oculta) deixa o produtor a frente e o atraso
// resultante NAO volta sozinho: nada neste laco pula pra frente.
//
// Ate 2026-09-19 o unico limite era a capacidade de 2 s. Isso lia como folga
// generosa e era o contrario: numa fila produtor/consumidor a folga E
// latencia, e o estado estavel depois de um unico soluco era o atraso
// maximo, permanente, ate a transmissao acabar.
//
// Agora o backlog tem um TETO. Passou do alvo, descarta-se o mais VELHO e
// segue do mais novo -- troca um estalo de uma vez por um atraso que nao
// cresce. Manter o audio antigo seria manter exatamente o sintoma.
const DEFAULTS = {
  channels: 2,
  // 2s por canal a 48kHz. Continua sendo o teto duro do buffer circular.
  capacityFrames: 48000 * 2,
  // ~120 ms. Tem de caber a jitter do IPC main->renderer sem cortar toda
  // hora, e ficar abaixo do que se percebe como labial fora de sincronia.
  targetFrames: Math.round(48000 * 0.12),
};

/** Buffer circular por canal com teto de atraso. Puro: sem AudioWorklet,
 * sem postMessage, pra regra ficar coberta em teste. */
class PcmRing {
  constructor(opts = {}) {
    this.channels = opts.channels ?? DEFAULTS.channels;
    this.capacity = opts.capacityFrames ?? DEFAULTS.capacityFrames;
    this.target = Math.min(opts.targetFrames ?? DEFAULTS.targetFrames, this.capacity);
    this.buffers = Array.from({ length: this.channels }, () => new Float32Array(this.capacity));
    this.writeIdx = new Array(this.channels).fill(0);
    this.readIdx = new Array(this.channels).fill(0);
    this.available = new Array(this.channels).fill(0);
    this.droppedFrames = 0;
  }

  /** Quadros esperando pra tocar. E o atraso do playout em quadros. */
  backlogFrames() {
    return this.available[0] || 0;
  }

  /** Escreve PCM entrelacado. Devolve quantos quadros entraram (0 quando o
   * numero de canais nao bate -- reamostragem de canal nao e feita aqui; na
   * pratica a captura nativa sempre entrega estereo, ver loopback_capture.cc). */
  write(samples, channels) {
    if (channels !== this.channels) return 0;
    const frames = samples.length / channels;
    for (let ch = 0; ch < channels; ch++) {
      const buf = this.buffers[ch];
      for (let i = 0; i < frames; i++) {
        buf[this.writeIdx[ch]] = samples[i * channels + ch];
        this.writeIdx[ch] = (this.writeIdx[ch] + 1) % this.capacity;
        if (this.available[ch] < this.capacity) {
          this.available[ch]++;
        } else {
          // Capacidade estourada: descarta a amostra mais antiga em vez de
          // travar tudo. Com o alvo abaixo isto virou caminho de excecao.
          this.readIdx[ch] = (this.readIdx[ch] + 1) % this.capacity;
        }
      }
    }
    this.#trim();
    return frames;
  }

  /** Corta o excesso acima do alvo, pulando o audio mais VELHO. */
  #trim() {
    const excesso = this.available[0] - this.target;
    if (excesso <= 0) return;
    for (let ch = 0; ch < this.channels; ch++) {
      this.readIdx[ch] = (this.readIdx[ch] + excesso) % this.capacity;
      this.available[ch] -= excesso;
    }
    this.droppedFrames += excesso;
  }

  /** Preenche cada canal de `outputs` (Float32Array). Sem dado, silencio --
   * nunca trava nem repete quadro velho. */
  read(outputs) {
    for (let ch = 0; ch < outputs.length; ch++) {
      const outCh = outputs[ch];
      const srcCh = ch < this.channels ? ch : this.channels - 1;
      const buf = this.buffers[srcCh];
      for (let i = 0; i < outCh.length; i++) {
        if (this.available[srcCh] > 0) {
          outCh[i] = buf[this.readIdx[srcCh]];
          this.readIdx[srcCh] = (this.readIdx[srcCh] + 1) % this.capacity;
          this.available[srcCh]--;
        } else {
          outCh[i] = 0;
        }
      }
    }
  }
}

// O AudioWorklet nao tem require/import, entao o ring mora neste mesmo
// arquivo. A base condicional deixa o modulo carregar no Node pro teste sem
// mudar nada de como o Chromium o executa.
const Base = typeof AudioWorkletProcessor === 'function' ? AudioWorkletProcessor : class {};

class PcmInjectorProcessor extends Base {
  constructor() {
    super();
    this.ring = new PcmRing();
    this.lastReport = 0;
    this.port.onmessage = (event) => {
      const { samples, channels } = event.data;
      this.ring.write(samples, channels);
    };
  }

  process(_inputs, outputs) {
    this.ring.read(outputs[0]);
    // Atraso e corte sao os dois numeros que faltaram pra diagnosticar o
    // "som atrasado" a partir do log. Um relatorio por segundo nao pesa.
    if (this.ring.droppedFrames !== this.lastReport) {
      this.lastReport = this.ring.droppedFrames;
      this.port.postMessage({ backlogFrames: this.ring.backlogFrames(), droppedFrames: this.ring.droppedFrames });
    }
    return true;
  }
}

if (typeof registerProcessor === 'function') registerProcessor('pcm-injector', PcmInjectorProcessor);
if (typeof module !== 'undefined') module.exports = { PcmRing, PcmInjectorProcessor, DEFAULTS };
