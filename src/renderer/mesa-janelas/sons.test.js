'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../mesa-modules/sons');
require('./comum');
const janela = require('./sons');

test('registra o conteudo dos sons', () => {
  assert.equal(globalThis.GoLive.mesaJanelas.sons, janela);
});

test('todo som do modulo tem partitura curta (ate 1,5 s) e bem formada', () => {
  const ONDAS = ['sine', 'square', 'sawtooth', 'triangle'];
  const FILTROS = ['lowpass', 'highpass', 'bandpass'];
  for (const som of m.SOUNDS) {
    const p = janela.partitura(som);
    assert.ok(p, som);
    assert.ok(p.dur > 0.2 && p.dur <= janela.MAX_DUR, `${som}: ${p.dur} s`);
    assert.ok(p.vozes.length > 0 && p.vozes.length <= 40, `${som}: ${p.vozes.length} vozes`);
    for (const v of p.vozes) {
      assert.ok(['osc', 'ruido'].includes(v.tipo), som);
      assert.ok(v.t >= 0 && v.dur > 0 && v.t + v.dur <= p.dur + 1e-9, `${som}: voz fora do tempo`);
      // Envelope: comeca e acaba no zero (sem estalo), tempos em ordem, pico ate 1.
      assert.deepEqual(v.ganho[0], [0, 0], `${som}: envelope comeca no zero`);
      assert.equal(v.ganho[v.ganho.length - 1][1], 0, `${som}: envelope acaba no zero`);
      assert.ok(Math.abs(v.ganho[v.ganho.length - 1][0] - v.dur) < 1e-9, `${som}: envelope acaba com a voz`);
      for (let i = 1; i < v.ganho.length; i++) assert.ok(v.ganho[i][0] >= v.ganho[i - 1][0], `${som}: envelope em ordem`);
      for (const [, g] of v.ganho) assert.ok(g >= 0 && g <= 1, `${som}: ganho ${g}`);
      if (v.tipo === 'osc') {
        assert.ok(ONDAS.includes(v.onda), som);
        assert.equal(v.freq[0][0], 0);
        for (const [t, f] of v.freq) assert.ok(t >= 0 && t <= v.dur + 1e-9 && f >= 20 && f <= 12000, `${som}: ${f} Hz`);
        if (v.vibrato) assert.ok(v.vibrato.freq > 0 && v.vibrato.freq < 60 && v.vibrato.prof > 0 && v.vibrato.prof < 500, som);
      } else {
        assert.ok(v.filtro, `${som}: ruido sempre filtrado`);
      }
      if (v.filtro) {
        assert.ok(FILTROS.includes(v.filtro.tipo), som);
        assert.ok(v.filtro.freq >= 20 && v.filtro.freq <= 16000 && v.filtro.q > 0, som);
      }
    }
  }
  assert.equal(janela.partitura('nao-existe'), null);
  assert.equal(janela.partitura('toString'), null);
  assert.deepEqual(janela.partitura('sino'), janela.partitura('sino'), 'deterministica');
});

test('ruido com semente: o mesmo a cada vez, dentro de [-1, 1)', () => {
  const a = janela.amostrasDeRuido(4096);
  const b = janela.amostrasDeRuido(4096);
  assert.deepEqual(a, b);
  assert.ok(a.every((x) => x >= -1 && x < 1));
  const media = a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(Math.abs(media) < 0.05, `media ${media}`);
});

/** AudioContext de mentira: anota os nos, ligacoes e agendamentos. */
function contextoFalso() {
  const log = { nos: [], ligacoes: 0, starts: [], stops: [] };
  function param(v = 0) {
    return {
      value: v,
      pontos: [],
      setValueAtTime(x, t) { this.pontos.push(['set', x, t]); },
      linearRampToValueAtTime(x, t) { this.pontos.push(['lin', x, t]); },
      exponentialRampToValueAtTime(x, t) {
        assert.ok(x > 0, 'rampa exponencial nunca ate zero');
        this.pontos.push(['exp', x, t]);
      },
    };
  }
  function no(tipo, extra) {
    const n = {
      tipo,
      destinos: [],
      connect(d) { log.ligacoes++; this.destinos.push(d); return d; },
      start(t) { log.starts.push(t); },
      stop(t) { log.stops.push(t); },
      ...extra,
    };
    log.nos.push(n);
    return n;
  }
  const ac = {
    currentTime: 5,
    sampleRate: 8000,
    destination: { tipo: 'saida' },
    createGain: () => no('gain', { gain: param(1) }),
    createOscillator: () => no('osc', { type: 'sine', frequency: param(440) }),
    createBufferSource: () => no('buffer', { buffer: null }),
    createBiquadFilter: () => no('filtro', { type: 'lowpass', frequency: param(350), Q: param(1) }),
    createDynamicsCompressor: () => no('compressor'),
    createBuffer: (canais, n) => {
      const dados = new Float32Array(n);
      return { length: n, getChannelData: () => dados };
    },
  };
  return { ac, log };
}

test('tocar monta os nos de cada som e agenda tudo dentro da duracao', () => {
  for (const som of m.SOUNDS) {
    const { ac, log } = contextoFalso();
    const p = janela.partitura(som);
    const fim = janela.tocar(ac, p, 0.5);
    assert.ok(Math.abs(fim - (5.01 + p.dur)) < 1e-9, som);
    const mestre = log.nos[0];
    assert.equal(mestre.tipo, 'gain');
    assert.ok(Math.abs(mestre.gain.value - 0.35) < 1e-9, `${som}: volume do mestre`);
    assert.equal(log.nos[1].tipo, 'compressor');
    assert.equal(log.nos[1].destinos[0], ac.destination);
    const fontes = log.nos.filter((n) => n.tipo === 'osc' || n.tipo === 'buffer');
    assert.ok(fontes.length >= p.vozes.length, som);
    for (const t of log.starts) assert.ok(t >= 5.01 && t <= fim, `${som}: start ${t}`);
    for (const t of log.stops) assert.ok(t > 5.01 && t <= fim + 0.021, `${som}: stop ${t}`);
    for (const n of log.nos.filter((x) => x.tipo === 'buffer')) assert.ok(n.buffer && n.buffer.length === 8000, som);
  }
});

test('volume fora de 0..1 e cortado', () => {
  const { ac, log } = contextoFalso();
  janela.tocar(ac, janela.partitura('boing'), 7);
  assert.equal(log.nos[0].gain.value, 0.7);
  const f = contextoFalso();
  janela.tocar(f.ac, janela.partitura('boing'), -1);
  assert.equal(f.log.nos[0].gain.value, 0);
});

test('deveTocar: so play novo e recente (ate 2 s pela hora do servidor)', () => {
  const last = { n: 5, sound: 'sino', at: 10_000, by: '1' };
  assert.equal(janela.deveTocar(last, 4, 10_300), true);
  assert.equal(janela.deveTocar(last, 4, 12_000), true);
  assert.equal(janela.deveTocar(last, 4, 12_001), false, 'atrasado demais');
  assert.equal(janela.deveTocar(last, 5, 10_300), false, 'ja visto');
  assert.equal(janela.deveTocar(last, 9, 10_300), false);
  assert.equal(janela.deveTocar(last, 4, 9_000), true, 'relogio um pouco atras ainda toca');
  assert.equal(janela.deveTocar(null, 0, 10_000), false);
  assert.equal(janela.deveTocar(last, 4, NaN), false);
});

test('preferencias locais: volume 0..100 e mudo, com padrao para lixo', () => {
  assert.deepEqual(janela.lerPrefs('{"vol":30,"muted":true}'), { vol: 30, muted: true });
  assert.deepEqual(janela.lerPrefs('{"vol":300}'), { vol: 100, muted: false });
  assert.deepEqual(janela.lerPrefs('{"vol":-3,"muted":"sim"}'), { vol: 0, muted: false });
  for (const lixo of [null, '', 'nao e json', '[]', '{"vol":"alto"}', '5']) {
    assert.deepEqual(janela.lerPrefs(lixo), { ...janela.PREFS_PADRAO }, String(lixo));
  }
});

test('quemTocou', () => {
  const nomeDe = (id) => ({ 1: 'Ana' })[id] || 'Alguém';
  assert.equal(janela.quemTocou({ n: 1, sound: 'badumtss', at: 1, by: '1' }, nomeDe, m.soundName), 'Ana tocou Ba dum tss');
  assert.equal(janela.quemTocou(null, nomeDe, m.soundName), 'Ninguém tocou ainda');
});
