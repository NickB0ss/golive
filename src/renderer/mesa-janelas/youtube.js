'use strict';

/*
 * Conteudo da janela "Video do YouTube" (contrato, secao 6):
 * `GoLive.mesaJanelas.youtube.mount(el, api)`.
 *
 * - Sem video: campo para colar o link.
 * - Com video: o player (ytplayer.js, sem script do YouTube) e, por cima,
 *   os controles do app: tocar/pausar e a barra de posicao valem para a sala
 *   (viram `act`); volume e mudo sao so seus (guardados neste PC).
 * - Um so video com imagem por PC (GoLive.mesaMidia): o segundo fica em
 *   espera, com a capa e "Tocar este"; o estado da sala continua andando.
 * - Sem internet (ou o player nao responde), a janela diz isso no lugar
 *   do player e tenta de novo quando a rede volta.
 *
 * A cada 250 ms: alvo = positionAt(estado, api.serverNow()); a deriva
 * (mesa-sync-media.js) decide velocidade ou salto.
 */

(function (root) {
  const TICK_MS = 250;
  const NOTE_MS = 4000;
  const VOL_KEY = 'golive-mesa-volume';
  const MIN_PLAY_MS = 1500;

  function mod() {
    return (root.GoLive.mesaRegistry && root.GoLive.mesaRegistry.get('youtube')) || root.GoLive.mesaModules.youtube;
  }

  /** Volume local { vol: 0..100, muted } -- so deste PC. */
  function loadVolume() {
    try {
      const v = JSON.parse(root.localStorage.getItem(VOL_KEY) || 'null');
      if (v && Number.isFinite(v.vol)) return { vol: Math.max(0, Math.min(100, v.vol)), muted: !!v.muted };
    } catch {
      // sem localStorage: fica o padrao
    }
    return { vol: 80, muted: false };
  }

  function saveVolume(v) {
    try {
      root.localStorage.setItem(VOL_KEY, JSON.stringify(v));
    } catch {
      // idem
    }
  }

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const k of kids) if (k) n.appendChild(k);
    return n;
  }

  function thumb(videoId) {
    return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  }

  function mountReal(el, api) {
    const M = mod();
    const L = root.GoLive.mesaMidiaLinks;
    const YP = root.GoLive.ytplayer;
    const S = root.GoLive.mesaSyncMedia;
    const now = () => root.performance.now();
    let state = M.init({});
    let player = null;
    let sync = null;
    let errorCode = null;
    let dragging = false;
    let showForm = false;
    let noteTimer = null;
    let loadedAt = 0;
    let endedSent = null; // videoId cujo fim este PC ja avisou
    const volume = loadVolume();

    // ---------- DOM (montado uma vez) ----------
    const input = h('input', { class: 'mjm-input', type: 'text', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'Cole um link do YouTube', 'aria-label': 'Link do YouTube', maxlength: 2048 });
    const submit = h('button', { class: 'mjm-btn mjm-btn-act', type: 'submit', text: 'Pôr' });
    const cancel = h('button', { class: 'mjm-btn', type: 'button', text: 'Cancelar' });
    const form = h('form', { class: 'mjm-form' }, input, submit, cancel);
    const empty = h('div', { class: 'mjm-empty' }, h('p', { class: 'mjm-hint', text: 'Vídeo do YouTube para todos verem juntos.' }), form);

    const host = h('div', { class: 'mjm-player' });
    const coverImg = h('img', { class: 'mjm-cover-img', alt: '', draggable: 'false' });
    const takeBtn = h('button', { class: 'mjm-btn mjm-btn-act', type: 'button', text: 'Tocar este' });
    const coverText = h('p', { class: 'mjm-hint', text: 'Outro vídeo está tocando neste PC.' });
    const cover = h('div', { class: 'mjm-cover' }, coverImg, h('div', { class: 'mjm-cover-cta' }, coverText, takeBtn));
    const msgText = h('p', { class: 'mjm-msg-text' });
    const retryBtn = h('button', { class: 'mjm-btn', type: 'button', text: 'Tentar de novo' });
    const msg = h('div', { class: 'mjm-msg', role: 'status' }, msgText, retryBtn);

    const playBtn = h('button', { class: 'mjm-btn mjm-icon', type: 'button', 'aria-label': 'Tocar para todos' });
    const range = h('input', { class: 'mjm-range', type: 'range', min: 0, max: 0, step: 1, value: 0, 'aria-label': 'Posição do vídeo (para todos)' });
    const time = h('span', { class: 'mjm-time', text: '0:00' });
    const muteBtn = h('button', { class: 'mjm-btn mjm-icon', type: 'button' });
    const vol = h('input', { class: 'mjm-range mjm-vol', type: 'range', min: 0, max: 100, step: 1, value: volume.vol, 'aria-label': 'Volume (só seu)' });
    const swapBtn = h('button', { class: 'mjm-btn', type: 'button', text: 'Trocar', title: 'Trocar o vídeo' });
    const bar = h('div', { class: 'mjm-bar' }, playBtn, range, time, muteBtn, vol, swapBtn);
    const note = h('p', { class: 'mjm-note', 'aria-live': 'polite' });
    const stage = h('div', { class: 'mjm-stage' }, host, cover, msg, bar);
    const rootEl = h('div', { class: 'mjm mjm-yt' }, stage, empty, note);
    el.appendChild(rootEl);

    // ---------- Coordenacao: um video com imagem por PC ----------
    const slot = root.GoLive.mesaMidia.register('image', () => render());

    function showNote(text) {
      note.textContent = text || '';
      if (noteTimer) root.clearTimeout(noteTimer);
      if (text) noteTimer = root.setTimeout(() => { note.textContent = ''; }, NOTE_MS);
    }

    function target() {
      return L.positionAt(state, api.serverNow());
    }

    function applyVolume() {
      if (!player || !player.ready) return;
      player.setVolume(volume.vol);
      if (volume.muted || volume.vol === 0) player.mute();
      else player.unMute();
    }

    function destroyPlayer() {
      if (player) player.destroy();
      player = null;
      sync = null;
    }

    /** O video acabou neste PC: avisa a sala (o modulo so muda na primeira
     * vez). So se o proprio player diz que e este video e ja tocou um tempo:
     * o fim atrasado do video anterior nao para o novo. */
    function reportEnded() {
      if (!player || !state.videoId || !state.playing || endedSent === state.videoId) return;
      const seen = player.info().videoId;
      if ((seen && seen !== state.videoId) || now() - loadedAt < MIN_PLAY_MS) return;
      endedSent = state.videoId;
      const pos = player.currentTime();
      api.act(pos !== null ? { kind: 'ended', videoId: state.videoId, pos: Math.round(pos * 100) / 100 } : { kind: 'ended', videoId: state.videoId });
    }

    function createPlayer() {
      errorCode = null;
      loadedAt = now();
      player = YP.create({
        container: host,
        videoId: state.videoId,
        start: target(),
        title: 'Vídeo do YouTube',
        onReady: () => {
          applyVolume();
          if (sync) sync.tick();
          render();
        },
        onState: (st) => {
          if (st === 'ended') reportEnded();
          render();
        },
        onError: (code, text) => {
          errorCode = code;
          msgText.textContent = text;
          if (code === 'timeout' || code === 'offline' || code === 153 || code === 152) destroyPlayer();
          render();
        },
      });
      sync = S.createSync({
        player,
        now,
        // Com erro na tela (video bloqueado, removido), nada de insistir.
        desired: () => (state.videoId && errorCode === null ? { target: target(), want: state.playing ? 'play' : 'pause' } : null),
      });
    }

    // ---------- Desenho ----------
    function render() {
      const has = !!state.videoId;
      const active = slot.active();
      empty.hidden = has && !showForm;
      stage.hidden = !has;
      if (!has) {
        destroyPlayer();
        return;
      }
      if (active && !player && errorCode === null) createPlayer();
      if (!active && player) destroyPlayer();
      if (player && player.videoId !== state.videoId) {
        player.load(state.videoId, target());
        loadedAt = now();
        if (sync) sync.reset();
      }
      cover.hidden = active;
      if (!active && coverImg.dataset.id !== state.videoId) {
        coverImg.dataset.id = state.videoId;
        coverImg.src = thumb(state.videoId);
      }
      const failed = errorCode !== null && active;
      msg.hidden = !failed;
      retryBtn.hidden = !(errorCode === 'timeout' || errorCode === 'offline' || errorCode === 153 || errorCode === 152);
      playBtn.textContent = state.playing ? '❚❚' : '▶';
      playBtn.setAttribute('aria-label', state.playing ? 'Pausar para todos' : 'Tocar para todos');
      muteBtn.textContent = volume.muted || volume.vol === 0 ? '🔇' : '🔊';
      muteBtn.setAttribute('aria-label', volume.muted ? 'Ligar o som (só seu)' : 'Tirar o som (só seu)');
      muteBtn.setAttribute('aria-pressed', String(!!volume.muted));
      paintTime();
    }

    function paintTime() {
      if (!state.videoId) return;
      const pos = target();
      const dur = player && player.duration() ? player.duration() : 0;
      if (!dragging) {
        range.max = String(Math.max(Math.ceil(dur), Math.ceil(pos), 1));
        range.value = String(Math.floor(pos));
      }
      time.textContent = dur ? `${L.formatPos(pos)} / ${L.formatPos(dur)}` : L.formatPos(pos);
    }

    // ---------- Acoes ----------
    function send(action) {
      const ok = api.validate(action);
      if (ok !== true) {
        showNote(ok);
        return false;
      }
      api.act(action);
      return true;
    }

    /** Posicao do proprio player se ele esta pronto e perto do alvo; senao
     * o servidor calcula pela hora (quem ainda carrega nao volta a sala). */
    function localPos() {
      if (!player || !player.ready) return undefined;
      const cur = player.currentTime();
      return cur !== null && Math.abs(cur - target()) < 2 ? Math.round(cur * 100) / 100 : undefined;
    }

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const url = input.value.trim();
      if (!url) return;
      if (send({ kind: 'load', url })) {
        input.value = '';
        showForm = false;
        render();
      }
    });
    cancel.addEventListener('click', () => {
      showForm = false;
      render();
    });
    swapBtn.addEventListener('click', () => {
      showForm = true;
      render();
      input.focus();
    });
    playBtn.addEventListener('click', () => {
      if (state.playing) {
        const pos = localPos();
        send(pos === undefined ? { kind: 'pause' } : { kind: 'pause', pos });
      } else {
        send({ kind: 'play' });
      }
    });
    range.addEventListener('input', () => {
      dragging = true;
      time.textContent = L.formatPos(Number(range.value));
    });
    range.addEventListener('change', () => {
      dragging = false;
      send({ kind: 'seek', pos: Number(range.value) });
    });
    vol.addEventListener('input', () => {
      volume.vol = Number(vol.value);
      if (volume.vol > 0) volume.muted = false;
      saveVolume(volume);
      applyVolume();
      render();
    });
    muteBtn.addEventListener('click', () => {
      volume.muted = !volume.muted;
      saveVolume(volume);
      applyVolume();
      render();
    });
    takeBtn.addEventListener('click', () => slot.take());
    retryBtn.addEventListener('click', () => {
      errorCode = null;
      destroyPlayer();
      render();
    });
    const onOnline = () => {
      if (errorCode === 'timeout' || errorCode === 'offline') {
        errorCode = null;
        render();
      }
    };
    root.addEventListener('online', onOnline);
    const offDenied = typeof api.onDenied === 'function'
      ? api.onDenied((d) => showNote(d && (d.detail || d.reason) ? `Não deu: ${d.detail || d.reason}` : 'Não deu'))
      : null;

    const timer = root.setInterval(() => {
      if (sync && state.videoId && slot.active()) sync.tick();
      paintTime();
    }, TICK_MS);
    render();

    return {
      update(next) {
        if (!next || typeof next !== 'object') return;
        const changedVideo = next.videoId !== state.videoId;
        if (next.playing && !state.playing) endedSent = null;
        state = next;
        if (changedVideo) {
          errorCode = null;
          showForm = false;
        }
        render();
        if (sync && slot.active()) sync.tick();
      },
      destroy() {
        root.clearInterval(timer);
        if (noteTimer) root.clearTimeout(noteTimer);
        root.removeEventListener('online', onOnline);
        if (typeof offDenied === 'function') offDenied();
        destroyPlayer();
        slot.release();
        rootEl.remove();
      },
      focus() {
        (state.videoId ? playBtn : input).focus();
      },
      // Para a bancada (tools/midia): o player e a deriva deste conteudo.
      _debug: () => ({ player, sync, active: slot.active(), errorCode }),
    };
  }

  // ---------- Dependencias sob demanda ----------
  // A Vista so carrega `mesa-janelas/<tipo>.js`; o player, a deriva e o
  // coordenador de midia nao tem tag no index.html. O primeiro conteudo de
  // midia que monta injeta cada <script> uma vez (promessa dividida em
  // GoLive.mesaMidiaCarga) e so entao monta de verdade.
  const DEPS = [['ytplayer.js', 'ytplayer'], ['mesa-sync-media.js', 'mesaSyncMedia'], ['mesa-midia.js', 'mesaMidia']];

  function carregar(src, global) {
    if (root.GoLive[global]) return Promise.resolve();
    root.GoLive.mesaMidiaCarga = root.GoLive.mesaMidiaCarga || {};
    const cache = root.GoLive.mesaMidiaCarga;
    if (!cache[src]) {
      cache[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.onload = () => (root.GoLive[global] ? resolve() : reject(new Error(`${src} nao registrou ${global}`)));
        s.onerror = () => reject(new Error(`${src} nao carregou`));
        document.head.appendChild(s);
      });
      cache[src].catch(() => { delete cache[src]; });
    }
    return cache[src];
  }

  function mount(el, api) {
    let inner = null;
    let dead = false;
    let last = null; // [state, meta] que chegou antes de montar
    const wait = document.createElement('p');
    wait.className = 'mjm-loading';
    wait.textContent = 'Carregando…';
    el.appendChild(wait);
    Promise.all(DEPS.map(([src, global]) => carregar(src, global))).then(() => {
      if (dead) return;
      wait.remove();
      inner = mountReal(el, api);
      if (last) inner.update(last[0], last[1]);
    }).catch(() => {
      if (!dead) wait.textContent = 'Não deu para carregar o player desta janela.';
    });
    return {
      update(state, meta) {
        if (inner) inner.update(state, meta);
        else last = [state, meta];
      },
      destroy() {
        dead = true;
        wait.remove();
        if (inner) inner.destroy();
      },
      focus() {
        if (inner && inner.focus) inner.focus();
      },
      _debug: () => (inner && inner._debug ? inner._debug() : {}),
    };
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaJanelas = root.GoLive.mesaJanelas || {};
  root.GoLive.mesaJanelas.youtube = { type: 'youtube', mount };

  if (typeof module !== 'undefined') module.exports = root.GoLive.mesaJanelas.youtube;
})(typeof window !== 'undefined' ? window : global);
