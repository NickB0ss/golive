'use strict';

/*
 * Conteudo da janela "Sons" (contrato da Mesa, secao 6). O modulo puro e
 * `mesa-modules/sons.js`: so o nome do som, quem tocou e a hora do servidor
 * andam pela sala.
 *
 * Os sons sao SINTETIZADOS aqui, com WebAudio, sem arquivo de audio:
 * `partitura(som)` descreve cada um (vozes de oscilador ou ruido, com
 * envelope de volume, curva de frequencia e filtro) e `tocar(ac, partitura,
 * volume)` monta os nos. As duas sao testaveis no Node (a segunda com um
 * AudioContext de mentira). Todos com ate 1,5 s.
 *
 * Tocar: cada PC toca ao receber um `play` NOVO (o `n` subiu) aplicado por
 * `act` -- nunca ao montar nem num retrato (`mesa-sync`) -- e so se ele for
 * recente: ate 2 s de atraso pela hora do servidor (`api.serverNow()`).
 * Volume e "silenciar" sao so deste PC (localStorage).
 */

(function (root) {
  const TYPE = 'sons';
  const MAX_ATRASO_MS = 2000;
  const MAX_DUR = 1.5;
  const PREFS_KEY = 'golive-mesa-sons';
  const PREFS_PADRAO = Object.freeze({ vol: 70, muted: false });

  function mod() {
    return root.GoLive.mesaModules[TYPE];
  }

  // ---------- Partituras (puras) ----------
  //
  // Voz: { tipo: 'osc', onda, t, dur, freq: [[t, hz]...], ganho: [[t, g]...],
  //        filtro?: { tipo, freq, q }, vibrato?: { freq, prof } }
  //    | { tipo: 'ruido', t, dur, ganho, filtro }
  // Tempos da curva relativos ao inicio da voz; o primeiro ponto e o t=0.

  /** Envelope de percussao: sobe em `ataque` ate `pico` e cai ate zero. */
  function perc(pico, dur, ataque = 0.005) {
    return [[0, 0], [ataque, pico], [dur, 0]];
  }

  /** Envelope de nota sustentada: sobe, segura, solta. */
  function nota(pico, dur, ataque = 0.02, solta = 0.08) {
    return [[0, 0], [ataque, pico], [Math.max(ataque, dur - solta), pico * 0.85], [dur, 0]];
  }

  function osc(onda, t, dur, freq, ganho, extra) {
    return { tipo: 'osc', onda, t, dur, freq, ganho, ...(extra || {}) };
  }

  function ruido(t, dur, ganho, filtro) {
    return { tipo: 'ruido', t, dur, ganho, filtro };
  }

  const PARTITURAS = {
    // Buzina de estadio: dois toques de serra desafinada, um curto e um longo.
    buzina() {
      const vozes = [];
      for (const [t, dur] of [[0, 0.22], [0.3, 0.8]]) {
        for (const [f0, f1] of [[392, 466], [398, 470], [494, 587]]) {
          vozes.push(osc('sawtooth', t, dur, [[0, f0], [0.05, f1], [dur, f1 * 0.985]], nota(0.16, dur, 0.02, 0.06),
            { filtro: { tipo: 'lowpass', freq: 2600, q: 1 } }));
        }
      }
      return vozes;
    },
    // Palmas: duas pessoas batendo, cada palma com tres estalos de ruido.
    palmas() {
      const vozes = [];
      const batidas = [0, 0.05, 0.19, 0.26, 0.4, 0.47, 0.61, 0.69, 0.83, 0.9];
      batidas.forEach((t, i) => {
        for (let k = 0; k < 3; k++) {
          vozes.push(ruido(t + k * 0.011, 0.09, perc(k === 2 ? 0.95 : 0.6, 0.09, 0.002),
            { tipo: 'bandpass', freq: i % 2 ? 1500 : 1100, q: 1.2 }));
        }
      });
      return vozes;
    },
    // Ba dum tss: dois tambores, bumbo e prato.
    badumtss() {
      return [
        osc('sine', 0, 0.22, [[0, 220], [0.15, 110]], perc(0.8, 0.22)),
        osc('sine', 0.22, 0.26, [[0, 160], [0.18, 80]], perc(0.8, 0.26)),
        osc('sine', 0.5, 0.35, [[0, 120], [0.2, 48]], perc(0.9, 0.35)),
        ruido(0.5, 0.95, perc(0.35, 0.95, 0.003), { tipo: 'highpass', freq: 6500, q: 0.7 }),
        ruido(0.5, 0.12, perc(0.25, 0.12, 0.002), { tipo: 'bandpass', freq: 3000, q: 0.8 }),
      ];
    },
    // Rufar de tambor: caixa cada vez mais forte e um prato no fim.
    rufar() {
      const vozes = [];
      const passos = 22;
      for (let i = 0; i < passos; i++) {
        const t = i * 0.045;
        vozes.push(ruido(t, 0.06, perc(0.12 + (0.38 * i) / (passos - 1), 0.06, 0.002), { tipo: 'bandpass', freq: 1800, q: 0.9 }));
      }
      vozes.push(ruido(1.0, 0.5, perc(0.45, 0.5, 0.003), { tipo: 'highpass', freq: 5000, q: 0.7 }));
      vozes.push(osc('sine', 1.0, 0.3, [[0, 110], [0.2, 50]], perc(0.8, 0.3)));
      return vozes;
    },
    // Sino: parciais inarmonicas; as agudas morrem antes.
    sino() {
      const base = 880;
      return [[1, 0.45, 1.45], [2, 0.22, 1.1], [2.76, 0.18, 0.9], [5.4, 0.1, 0.6], [8.93, 0.05, 0.4]]
        .map(([r, g, dur]) => osc('sine', 0, dur, [[0, base * r]], perc(g, dur, 0.004)));
    },
    // Acertou: arpejo maior subindo (do, mi, sol, do).
    acertou() {
      return [523.25, 659.25, 783.99, 1046.5].flatMap((f, i) => {
        const t = i * 0.09;
        const dur = i === 3 ? 0.42 : 0.14;
        return [
          osc('triangle', t, dur, [[0, f]], nota(0.35, dur, 0.008, 0.06)),
          osc('square', t, dur, [[0, f * 2]], nota(0.04, dur, 0.008, 0.06), { filtro: { tipo: 'lowpass', freq: 5000, q: 0.7 } }),
        ];
      });
    },
    // Errou: o trombone triste, quatro notas descendo, a ultima tremida.
    errou() {
      const notas = [[0, 0.3, 392], [0.3, 0.3, 370], [0.6, 0.3, 349.23], [0.9, 0.6, 329.63]];
      return notas.map(([t, dur, f], i) => osc('sawtooth', t, dur, i === 3 ? [[0, f], [dur, f * 0.94]] : [[0, f]],
        nota(0.3, dur, 0.03, 0.08), { filtro: { tipo: 'lowpass', freq: 1100, q: 2 }, ...(i === 3 ? { vibrato: { freq: 6, prof: 9 } } : {}) }));
    },
    // Suspense: "dun dun duuun", grave.
    suspense() {
      const notas = [[0, 0.2, 196], [0.26, 0.2, 185], [0.52, 0.9, 155.56]];
      return notas.flatMap(([t, dur, f]) => [
        osc('sawtooth', t, dur, [[0, f]], nota(0.28, dur, 0.015, dur > 0.5 ? 0.5 : 0.06), { filtro: { tipo: 'lowpass', freq: 900, q: 1.5 } }),
        osc('square', t, dur, [[0, f / 2]], nota(0.12, dur, 0.015, dur > 0.5 ? 0.5 : 0.06), { filtro: { tipo: 'lowpass', freq: 500, q: 1 } }),
      ]);
    },
    // Boing: mola que sobe e treme.
    boing() {
      return [osc('sine', 0, 0.65, [[0, 110], [0.07, 440], [0.65, 360]], perc(0.6, 0.65, 0.01), { vibrato: { freq: 14, prof: 40 } })];
    },
    // Apito de juiz: dois trilos agudos.
    apito() {
      return [[0, 0.2], [0.28, 0.55]].map(([t, dur]) => osc('sine', t, dur, [[0, 2350], [dur, 2450]], nota(0.3, dur, 0.01, 0.05),
        { vibrato: { freq: 32, prof: 140 } }));
    },
  };

  /** A partitura de um som: `{ dur, vozes }`, ou `null` (som desconhecido). */
  function partitura(som) {
    if (!Object.prototype.hasOwnProperty.call(PARTITURAS, som)) return null;
    const vozes = PARTITURAS[som]();
    const dur = vozes.reduce((d, v) => Math.max(d, v.t + v.dur), 0);
    return { dur: Math.round(dur * 1000) / 1000, vozes };
  }

  /** Ruido branco com semente fixa (o mesmo a cada PC e a cada vez). */
  function amostrasDeRuido(n, semente = 12345) {
    const out = new Float32Array(n);
    let s = semente >>> 0;
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      out[i] = (s / 4294967296) * 2 - 1;
    }
    return out;
  }

  const ruidoPorContexto = new WeakMap();

  function bufferDeRuido(ac) {
    let b = ruidoPorContexto.get(ac);
    if (!b) {
      const n = Math.ceil(ac.sampleRate * 1);
      b = ac.createBuffer(1, n, ac.sampleRate);
      b.getChannelData(0).set(amostrasDeRuido(n));
      ruidoPorContexto.set(ac, b);
    }
    return b;
  }

  function curva(param, pontos, inicio, exponencial) {
    param.setValueAtTime(pontos[0][1], inicio);
    for (let i = 1; i < pontos.length; i++) {
      const [t, v] = pontos[i];
      if (exponencial && v > 0) param.exponentialRampToValueAtTime(v, inicio + t);
      else param.linearRampToValueAtTime(v, inicio + t);
    }
  }

  /** Monta e agenda os nos de uma partitura em `ac` (um AudioContext).
   * `volume` de 0 a 1. Devolve a hora (do contexto) em que acaba. */
  function tocar(ac, p, volume, destino) {
    const agora = ac.currentTime + 0.01;
    const mestre = ac.createGain();
    mestre.gain.value = Math.max(0, Math.min(1, volume)) * 0.7;
    const limite = ac.createDynamicsCompressor();
    mestre.connect(limite);
    limite.connect(destino || ac.destination);
    for (const v of p.vozes) {
      const inicio = agora + v.t;
      const fim = inicio + v.dur;
      let fonte;
      if (v.tipo === 'osc') {
        fonte = ac.createOscillator();
        fonte.type = v.onda;
        curva(fonte.frequency, v.freq, inicio, true);
        if (v.vibrato) {
          const lfo = ac.createOscillator();
          const prof = ac.createGain();
          lfo.frequency.value = v.vibrato.freq;
          prof.gain.value = v.vibrato.prof;
          lfo.connect(prof);
          prof.connect(fonte.frequency);
          lfo.start(inicio);
          lfo.stop(fim + 0.02);
        }
      } else {
        fonte = ac.createBufferSource();
        fonte.buffer = bufferDeRuido(ac);
      }
      const env = ac.createGain();
      curva(env.gain, v.ganho, inicio, false);
      let ultimo = fonte;
      if (v.filtro) {
        const f = ac.createBiquadFilter();
        f.type = v.filtro.tipo;
        f.frequency.value = v.filtro.freq;
        f.Q.value = v.filtro.q;
        fonte.connect(f);
        ultimo = f;
      }
      ultimo.connect(env);
      env.connect(mestre);
      fonte.start(inicio);
      fonte.stop(fim + 0.02);
    }
    return agora + p.dur;
  }

  // ---------- Puras da janela ----------

  /** O `play` novo deve tocar neste PC? So se o contador subiu desde o
   * ultimo visto e o atraso (pela hora do servidor) e de ate 2 s. */
  function deveTocar(last, visto, agora) {
    if (!last || typeof last.n !== 'number' || last.n <= visto) return false;
    if (typeof last.at !== 'number' || typeof agora !== 'number' || !Number.isFinite(agora)) return false;
    return agora - last.at <= MAX_ATRASO_MS;
  }

  /** Preferencias locais (texto do localStorage) -> { vol: 0..100, muted }. */
  function lerPrefs(texto) {
    try {
      const v = JSON.parse(texto || 'null');
      if (v && typeof v === 'object' && Number.isFinite(v.vol)) {
        return { vol: Math.max(0, Math.min(100, Math.round(v.vol))), muted: v.muted === true };
      }
    } catch {
      // texto estragado: fica o padrao
    }
    return { ...PREFS_PADRAO };
  }

  function carregarPrefs() {
    try {
      return lerPrefs(root.localStorage.getItem(PREFS_KEY));
    } catch {
      return { ...PREFS_PADRAO };
    }
  }

  function salvarPrefs(p) {
    try {
      root.localStorage.setItem(PREFS_KEY, JSON.stringify({ vol: p.vol, muted: p.muted }));
    } catch {
      // sem localStorage (privado, bloqueado): so nao lembra
    }
  }

  /** "Ana tocou Buzina". */
  function quemTocou(last, nomeDe, nomeDoSom) {
    return last ? `${nomeDe(last.by)} tocou ${nomeDoSom(last.sound)}` : 'Ninguém tocou ainda';
  }

  // ---------- Audio do PC (um contexto para todas as janelas de sons) ----------

  function contextoDeAudio() {
    const G = root.GoLive;
    if (G.mesaSonsAudio && G.mesaSonsAudio.state !== 'closed') return G.mesaSonsAudio;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (typeof AC !== 'function') return null;
    try {
      G.mesaSonsAudio = new AC();
    } catch {
      return null;
    }
    return G.mesaSonsAudio;
  }

  function tocarSom(som, volume) {
    const p = partitura(som);
    const ac = p && volume > 0 ? contextoDeAudio() : null;
    if (!ac) return false;
    try {
      if (ac.state === 'suspended' && typeof ac.resume === 'function') ac.resume().catch(() => {});
      tocar(ac, p, volume);
      return true;
    } catch {
      return false;
    }
  }

  // ---------- DOM ----------

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const m = mod();
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;
    let visto = null; // o `n` do ultimo play ja visto (null = ainda nao montou)
    let timerEspera = null;
    const prefs = carregarPrefs();

    const grade = el('div', { class: 'mj-sons-grade', attrs: { role: 'group', 'aria-label': 'Sons para a sala' } });
    const botoes = new Map();
    for (const som of m.SOUNDS) {
      const btn = C.botao({ text: m.soundName(som), class: 'mj-sons-btn', label: `Tocar ${m.soundName(som)} para todos` });
      btn.dataset.som = som;
      b.clique(btn, grade, () => b.acao(grade, { kind: 'play', sound: som }));
      botoes.set(som, btn);
      grade.append(btn);
    }
    const barraEspera = el('div', { class: 'mj-sons-espera', attrs: { 'aria-hidden': 'true' } }, el('span'));

    const tocou = el('p', { class: 'mj-sons-tocou', attrs: { 'aria-live': 'polite' } });
    const mudo = C.botao({ class: 'mj-fantasma mj-ic', label: 'Silenciar os sons neste PC' });
    const vol = el('input', {
      class: 'mj-sons-vol',
      attrs: { type: 'range', min: '0', max: '100', step: '1', value: String(prefs.vol), 'aria-label': 'Volume dos sons (só seu)' },
    });
    const rodape = el('div', { class: 'mj-barra mj-sons-rodape' }, tocou, el('span', { class: 'mj-mola' }), mudo, vol);

    b.raiz.append(grade, barraEspera, rodape);
    b.aviso.em(b.raiz);

    const SVG_SOM = '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>';
    const SVG_MUDO = '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>';

    function desenharMudo() {
      const svg = mudo.querySelector('svg') || C.icone('x');
      svg.innerHTML = prefs.muted ? SVG_MUDO : SVG_SOM;
      if (!svg.parentNode) mudo.append(svg);
      mudo.setAttribute('aria-pressed', prefs.muted ? 'true' : 'false');
      const rot = prefs.muted ? 'Ligar os sons neste PC' : 'Silenciar os sons neste PC';
      mudo.setAttribute('aria-label', rot);
      mudo.title = rot;
      b.raiz.classList.toggle('is-mudo', prefs.muted);
    }
    desenharMudo();

    mudo.addEventListener('click', () => {
      prefs.muted = !prefs.muted;
      salvarPrefs(prefs);
      desenharMudo();
    });
    vol.addEventListener('input', () => {
      prefs.vol = Number(vol.value);
      if (prefs.muted && prefs.vol > 0) {
        prefs.muted = false;
        desenharMudo();
      }
    });
    vol.addEventListener('change', () => salvarPrefs(prefs));
    b.faxina.push(() => { if (timerEspera) clearTimeout(timerEspera); });

    /** Liga/desliga os botoes pela espera de 3 s de quem esta aqui, e
     * agenda religar quando ela acabar. A barrinha anda uma vez por som
     * (nao recomeca a cada segundo). */
    let esperaDe = null; // o `at` do meu ultimo som que a barrinha mostra
    function desenharEspera() {
      if (timerEspera) clearTimeout(timerEspera);
      timerEspera = null;
      const falta = m.cooldownLeft(state, api.me(), api.serverNow());
      const motivo = falta > 0 ? `Espere ${Math.ceil(falta / 1000)} s para tocar outro som` : true;
      for (const [som, btn] of botoes) C.ligado(btn, motivo, `Tocar ${m.soundName(som)} para todos`);
      barraEspera.classList.toggle('is-on', falta > 0);
      if (falta <= 0) {
        esperaDe = null;
        return;
      }
      const meu = state.recent[String(api.me())];
      if (meu !== esperaDe) {
        esperaDe = meu;
        const barra = barraEspera.firstElementChild;
        barra.style.setProperty('--mj-falta', String(falta / m.COOLDOWN_MS));
        barra.style.setProperty('--mj-dur', `${Math.round(falta)}ms`);
        barra.classList.remove('is-anda');
        void barra.offsetWidth; // recomeca a animacao
        barra.classList.add('is-anda');
      }
      timerEspera = setTimeout(desenharEspera, (falta % 1000 || 1000) + 30);
    }

    function piscar(som) {
      const btn = botoes.get(som);
      if (!btn || C.reduzMovimento()) return;
      btn.classList.remove('is-toca');
      void btn.offsetWidth;
      btn.classList.add('is-toca');
    }

    function update(novo, meta) {
      state = novo;
      const last = state.last;
      if (visto === null) {
        // Ao montar: nada de tocar o que ja tinha tocado.
        visto = state.n;
      } else if (meta && deveTocar(last, visto, api.serverNow())) {
        visto = last.n;
        if (!prefs.muted) tocarSom(last.sound, prefs.vol / 100);
        piscar(last.sound);
      }
      visto = Math.max(visto, state.n);
      tocou.replaceChildren();
      if (last) {
        const cor = C.corDe(api, last.by);
        tocou.classList.toggle('is-pessoa', !!cor);
        if (cor) tocou.style.setProperty('--mj-cor', cor);
        tocou.append(C.bolinha(cor), el('span', { text: C.nomeDe(api, last.by) }), el('em', { text: ` tocou ${m.soundName(last.sound)}` }));
      } else {
        tocou.append(el('em', { text: 'Ninguém tocou ainda' }));
      }
      tocou.title = quemTocou(last, (id) => C.nomeDe(api, id), m.soundName);
      desenharEspera();
    }

    return { update, destroy: b.destruir, focus() { botoes.get(m.SOUNDS[0]).focus(); } };
  }

  // ---------- Registro ----------
  // Igual aos outros conteudos: a Vista carrega so `mesa-janelas/sons.js`;
  // o apoio (comum.js) vem daqui, uma vez, da mesma pasta.
  function registrar(api, arquivos) {
    const G = (root.GoLive = root.GoLive || {});
    G.mesaJanelas = G.mesaJanelas || {};
    const GLOBAIS = { 'comum.js': 'mesaJanelasComum', 'tabuleiro.js': 'mesaJanelasTabuleiro' };
    const doc = root.document;
    const falta = () => arquivos.filter((a) => !G[GLOBAIS[a]]);
    const esperas = [];
    if (doc && falta().length) {
      const base = (doc.currentScript && doc.currentScript.src) || doc.baseURI;
      G.mesaJanelasApoio = G.mesaJanelasApoio || {};
      for (const a of falta()) {
        if (G.mesaJanelasApoio[a]) continue;
        const s = doc.createElement('script');
        s.src = new root.URL(a, base).href;
        s.async = false;
        G.mesaJanelasApoio[a] = s;
        doc.head.appendChild(s);
      }
      for (const a of falta()) {
        esperas.push(new Promise((ok) => {
          G.mesaJanelasApoio[a].addEventListener('load', ok, { once: true });
        }));
      }
    }
    const montar = api.mount;
    const pronto = esperas.length ? Promise.all(esperas) : null;
    api.mount = function (el, vistaApi) {
      if (!falta().length) return montar(el, vistaApi);
      let inst = null;
      let ultimo = null;
      let morto = false;
      pronto.then(() => {
        if (morto) return;
        inst = montar(el, vistaApi);
        if (ultimo) inst.update(ultimo[0], ultimo[1]);
      }, () => {});
      return {
        update(s, meta) { if (inst) inst.update(s, meta); else ultimo = [s, meta]; },
        destroy() { morto = true; if (inst) inst.destroy(); },
        focus() { if (inst && inst.focus) inst.focus(); },
      };
    };
    G.mesaJanelas[api.type] = api;
  }

  const api = {
    type: TYPE,
    mount,
    MAX_ATRASO_MS, MAX_DUR, PREFS_KEY, PREFS_PADRAO,
    partitura, tocar, amostrasDeRuido, deveTocar, lerPrefs, quemTocou,
  };

  registrar(api, ['comum.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
