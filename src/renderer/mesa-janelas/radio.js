'use strict';
/* global window, document, module, global */

/*
 * Conteudo da janela "Radio da sala" (contrato, secao 6):
 * `GoLive.mesaJanelas.radio.mount(el, api)`.
 *
 * A musica atual com a capa (i.ytimg.com), quem pos, tocar/pausar, pular
 * (quem pos ou o lider) ou votar para pular; a fila com subir/descer/tirar;
 * o campo para por na fila. O player do YouTube fica escondido dentro da
 * janela (so audio) e segue o relogio da sala pela deriva.
 *
 * Cada PC avisa `ended`/`failed` quando o proprio player acaba ou recusa o
 * video (o modulo so avanca uma vez) e `title` quando o player conta o
 * titulo. O volume e so seu. Um radio tocando por PC (vaga de audio do
 * GoLive.mesaMidia); o segundo mostra "Ouvir este".
 */

(function (root) {
  const TICK_MS = 250;
  const NOTE_MS = 4000;
  const VOL_KEY = 'golive-mesa-volume-radio';
  // `ended` antes disso depois de carregar e o fim atrasado da anterior.
  const MIN_PLAY_MS = 1500;

  function mod() {
    return (root.GoLive.mesaRegistry && root.GoLive.mesaRegistry.get('radio')) || root.GoLive.mesaModules.radio;
  }

  function loadVolume() {
    try {
      const v = JSON.parse(root.localStorage.getItem(VOL_KEY) || 'null');
      if (v && Number.isFinite(v.vol)) return { vol: Math.max(0, Math.min(100, v.vol)) };
    } catch {
      // sem localStorage: padrao
    }
    return { vol: 70 };
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
    let noteTimer = null;
    let queueKey = '';
    let loadedFor = null; // id da musica que o player deste PC carregou
    let loadedAt = 0;
    const reported = new Set(); // ids ja avisados (ended/failed) por este PC
    const titled = new Set(); // ids cujo titulo este PC ja mandou
    const volume = loadVolume();

    // ---------- DOM ----------
    const cover = h('img', { class: 'mjm-radio-cover', alt: '', draggable: 'false' });
    const title = h('p', { class: 'mjm-radio-title' });
    const who = h('p', { class: 'mjm-radio-who' });
    const time = h('span', { class: 'mjm-time', text: '0:00' });
    const playBtn = h('button', { class: 'mjm-btn mjm-icon', type: 'button' });
    const skipBtn = h('button', { class: 'mjm-btn', type: 'button', text: 'Pular' });
    const voteBtn = h('button', { class: 'mjm-btn', type: 'button' });
    const vol = h('input', { class: 'mjm-range mjm-vol', type: 'range', min: 0, max: 100, step: 1, value: volume.vol, 'aria-label': 'Volume do rádio (só seu)' });
    const takeBtn = h('button', { class: 'mjm-btn mjm-btn-act', type: 'button', text: 'Ouvir este' });
    const standby = h('p', { class: 'mjm-hint' }, document.createTextNode('Outro rádio está tocando neste PC. '), takeBtn);
    const msg = h('p', { class: 'mjm-msg-text', role: 'status' });
    const nowBox = h('div', { class: 'mjm-radio-now' },
      cover,
      h('div', { class: 'mjm-radio-info' }, title, who, h('div', { class: 'mjm-bar mjm-bar-static' }, playBtn, time, skipBtn, voteBtn, vol)));
    const idle = h('p', { class: 'mjm-hint', text: 'Nada tocando. Cole um link do YouTube (ou YouTube Music) para começar.' });
    const failed = h('p', { class: 'mjm-note mjm-radio-failed' });
    const list = h('ol', { class: 'mjm-radio-queue', 'aria-label': 'Fila do rádio' });
    const queueHead = h('p', { class: 'mjm-radio-head' });
    const input = h('input', { class: 'mjm-input', type: 'text', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'Link do YouTube', 'aria-label': 'Link do YouTube para a fila', maxlength: 2048 });
    const form = h('form', { class: 'mjm-form' }, input, h('button', { class: 'mjm-btn mjm-btn-act', type: 'submit', text: 'Pôr na fila' }));
    const note = h('p', { class: 'mjm-note', 'aria-live': 'polite' });
    const audio = h('div', { class: 'mjm-radio-audio', 'aria-hidden': 'true' });
    const rootEl = h('div', { class: 'mjm mjm-radio' }, nowBox, idle, standby, msg, failed, queueHead, list, form, note, audio);
    el.appendChild(rootEl);

    const slot = root.GoLive.mesaMidia.register('audio', () => render());

    function showNote(text) {
      note.textContent = text || '';
      if (noteTimer) root.clearTimeout(noteTimer);
      if (text) noteTimer = root.setTimeout(() => { note.textContent = ''; }, NOTE_MS);
    }

    function target() {
      return L.positionAt(state, api.serverNow());
    }

    function send(action, quiet) {
      const ok = api.validate(action);
      if (ok !== true) {
        if (!quiet) showNote(ok);
        return false;
      }
      api.act(action);
      return true;
    }

    function destroyPlayer() {
      if (player) player.destroy();
      player = null;
      sync = null;
    }

    /** Avisa a sala que a musica atual acabou (ou nao deixa embed). So se o
     * proprio player diz que esta nesse video e ja o tocou por um tempo: um
     * `ended` atrasado da musica anterior (a sala ja avancou) nao pode pular
     * a seguinte. */
    function report(kind) {
      const cur = state.current;
      if (!cur || !player || loadedFor !== cur.id || reported.has(`${kind}:${cur.id}`)) return;
      if (kind === 'ended') {
        const seen = player.info().videoId;
        if ((seen && seen !== cur.videoId) || now() - loadedAt < MIN_PLAY_MS) return;
      }
      // `failed` vem logo depois de carregar e e do video carregado: o
      // player que recusa nem chega a contar o videoId dele.
      reported.add(`${kind}:${cur.id}`);
      send({ kind, videoId: cur.videoId, id: cur.id }, true);
    }

    function createPlayer() {
      errorCode = null;
      loadedFor = state.current.id;
      loadedAt = now();
      player = YP.create({
        container: audio,
        videoId: state.current.videoId,
        start: target(),
        title: 'Rádio da sala',
        onReady: () => {
          player.setVolume(volume.vol);
          if (sync) sync.tick();
        },
        onState: (st) => {
          if (st === 'ended') report('ended');
        },
        onInfo: (info) => {
          const cur = state.current;
          if (cur && !cur.title && info.title && info.videoId === cur.videoId && !titled.has(cur.id)) {
            titled.add(cur.id);
            send({ kind: 'title', id: cur.id, title: info.title }, true);
          }
        },
        onError: (code, text) => {
          if (YP.isVideoError(code)) {
            report('failed');
            return;
          }
          errorCode = code;
          msg.textContent = text;
          destroyPlayer();
          render();
        },
      });
      sync = S.createSync({
        player,
        now,
        desired: () => (state.current ? { target: target(), want: state.playing ? 'play' : 'pause' } : null),
      });
    }

    function paintQueue() {
      const key = JSON.stringify(state.queue.map((it) => [it.id, it.title, it.by]));
      if (key === queueKey) return;
      queueKey = key;
      list.textContent = '';
      state.queue.forEach((it, i) => {
        const canRemove = api.validate({ kind: 'remove', id: it.id }) === true;
        const up = h('button', { class: 'mjm-btn mjm-icon', type: 'button', 'aria-label': 'Subir na fila', text: '↑', disabled: i === 0 });
        const down = h('button', { class: 'mjm-btn mjm-icon', type: 'button', 'aria-label': 'Descer na fila', text: '↓', disabled: i === state.queue.length - 1 });
        const rm = h('button', { class: 'mjm-btn mjm-icon', type: 'button', 'aria-label': 'Tirar da fila', text: '×', disabled: !canRemove });
        up.addEventListener('click', () => send({ kind: 'move', id: it.id, to: i - 1 }));
        down.addEventListener('click', () => send({ kind: 'move', id: it.id, to: i + 1 }));
        rm.addEventListener('click', () => send({ kind: 'remove', id: it.id }));
        const dot = h('span', { class: 'mjm-dot', 'aria-hidden': 'true' });
        if (typeof api.colorFor === 'function' && it.by) dot.style.background = api.colorFor(it.by);
        list.appendChild(h('li', { class: 'mjm-radio-item' },
          dot,
          h('span', { class: 'mjm-radio-item-title', text: it.title || it.videoId }),
          h('span', { class: 'mjm-radio-item-who', text: it.name || (api.nameOf && api.nameOf(it.by)) || '' }),
          up, down, rm));
      });
    }

    function render() {
      const cur = state.current;
      const active = slot.active();
      nowBox.hidden = !cur;
      idle.hidden = !!cur;
      standby.hidden = !cur || active;
      if (!cur || !active) destroyPlayer();
      if (cur && active && !player && errorCode === null) createPlayer();
      if (player && cur && loadedFor !== cur.id) {
        // Musica nova (mesmo video repetido tambem: a deriva volta ao comeco).
        if (player.videoId !== cur.videoId) player.load(cur.videoId, target());
        loadedFor = cur.id;
        loadedAt = now();
        if (sync) sync.reset();
      }
      msg.hidden = errorCode === null;
      if (cur) {
        if (cover.dataset.id !== cur.videoId) {
          cover.dataset.id = cur.videoId;
          cover.src = thumb(cur.videoId);
        }
        title.textContent = cur.title || cur.videoId;
        const name = cur.name || (api.nameOf && api.nameOf(cur.by)) || '';
        who.textContent = name ? `posta por ${name}` : '';
        playBtn.textContent = state.playing ? '❚❚' : '▶';
        playBtn.setAttribute('aria-label', state.playing ? 'Pausar o rádio para todos' : 'Tocar o rádio para todos');
        const canSkip = api.validate({ kind: 'skip' }) === true;
        skipBtn.hidden = !canSkip;
        voteBtn.hidden = canSkip;
        const need = M.votesNeeded(typeof api.peers === 'function' ? api.peers().length : 1);
        const voted = state.votes.includes(String(api.me()));
        voteBtn.textContent = voted ? `Você votou (${state.votes.length}/${need})` : `Votar para pular (${state.votes.length}/${need})`;
        voteBtn.disabled = voted;
      }
      const last = state.failed[state.failed.length - 1];
      failed.hidden = !last;
      if (last) failed.textContent = `${last.title || last.videoId} não deixa tocar fora do YouTube; pulei.`;
      queueHead.textContent = state.queue.length ? `Próximas (${state.queue.length}/${M.MAX_QUEUE})` : 'Fila vazia';
      paintQueue();
      paintTime();
    }

    function paintTime() {
      if (!state.current) return;
      const dur = player && player.duration() ? player.duration() : 0;
      const pos = target();
      time.textContent = dur ? `${L.formatPos(pos)} / ${L.formatPos(dur)}` : L.formatPos(pos);
    }

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const url = input.value.trim();
      if (url && send({ kind: 'add', url })) input.value = '';
    });
    playBtn.addEventListener('click', () => {
      if (!state.playing) return send({ kind: 'play' });
      const cur = player && player.ready ? player.currentTime() : null;
      return send(cur !== null && Math.abs(cur - target()) < 2 ? { kind: 'pause', pos: Math.round(cur * 100) / 100 } : { kind: 'pause' });
    });
    skipBtn.addEventListener('click', () => send({ kind: 'skip' }));
    voteBtn.addEventListener('click', () => send({ kind: 'vote-skip' }));
    takeBtn.addEventListener('click', () => slot.take());
    vol.addEventListener('input', () => {
      volume.vol = Number(vol.value);
      saveVolume(volume);
      if (player && player.ready) player.setVolume(volume.vol);
    });
    const onOnline = () => {
      if (errorCode !== null) {
        errorCode = null;
        render();
      }
    };
    root.addEventListener('online', onOnline);
    const offDenied = typeof api.onDenied === 'function'
      ? api.onDenied((d) => showNote(d && (d.detail || d.reason) ? `Não deu: ${d.detail || d.reason}` : 'Não deu'))
      : null;

    const timer = root.setInterval(() => {
      if (sync && state.current && slot.active()) sync.tick();
      paintTime();
    }, TICK_MS);
    render();

    return {
      update(next) {
        if (!next || typeof next !== 'object') return;
        const changed = (next.current && next.current.id) !== (state.current && state.current.id);
        state = next;
        if (changed) errorCode = null;
        queueKey = changed ? '' : queueKey; // quem pode tirar muda com a atual
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
        (state.current ? playBtn : input).focus();
      },
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
  root.GoLive.mesaJanelas.radio = { type: 'radio', mount };

  if (typeof module !== 'undefined') module.exports = root.GoLive.mesaJanelas.radio;
})(typeof window !== 'undefined' ? window : global);
