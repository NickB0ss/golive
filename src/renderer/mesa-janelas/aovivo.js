'use strict';
/* global window, document, module, global */

/*
 * Conteudo da janela "Ao vivo (Twitch)" (contrato, secao 6):
 * `GoLive.mesaJanelas.aovivo.mount(el, api)`.
 *
 * O player da Twitch em <iframe> (`parent` = o host da pagina, `localhost`
 * na origem local do app). Sem sincronia: e ao vivo. Os controles sao os do
 * proprio player (volume, qualidade). Conta como video com imagem na regra
 * de um por PC (GoLive.mesaMidia): em espera mostra "Tocar este".
 */

(function (root) {
  const NOTE_MS = 4000;
  const SANDBOX = 'allow-scripts allow-same-origin allow-popups';

  function mod() {
    return (root.GoLive.mesaRegistry && root.GoLive.mesaRegistry.get('aovivo')) || root.GoLive.mesaModules.aovivo;
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

  function mount(el, api) {
    const M = mod();
    let state = M.init({});
    let frame = null;
    let frameChannel = null;
    let showForm = false;
    let noteTimer = null;

    const input = h('input', { class: 'mjm-input', type: 'text', placeholder: 'Canal ou link da Twitch', 'aria-label': 'Canal da Twitch', maxlength: 2048 });
    const cancel = h('button', { class: 'mjm-btn', type: 'button', text: 'Cancelar' });
    const form = h('form', { class: 'mjm-form' }, input, h('button', { class: 'mjm-btn mjm-btn-act', type: 'submit', text: 'Abrir' }), cancel);
    const empty = h('div', { class: 'mjm-empty' }, h('p', { class: 'mjm-hint', text: 'Uma live da Twitch para todos assistirem.' }), form);
    const host = h('div', { class: 'mjm-player' });
    const takeBtn = h('button', { class: 'mjm-btn mjm-btn-act', type: 'button', text: 'Tocar este' });
    const coverName = h('p', { class: 'mjm-cover-name' });
    const cover = h('div', { class: 'mjm-cover' }, h('div', { class: 'mjm-cover-cta' }, coverName, h('p', { class: 'mjm-hint', text: 'Outro vídeo está tocando neste PC.' }), takeBtn));
    const msg = h('div', { class: 'mjm-msg', role: 'status' }, h('p', { class: 'mjm-msg-text', text: 'Sem internet: a Twitch não carregou neste PC.' }));
    const swapBtn = h('button', { class: 'mjm-btn', type: 'button', text: 'Trocar canal' });
    const bar = h('div', { class: 'mjm-bar mjm-bar-top' }, swapBtn);
    const stage = h('div', { class: 'mjm-stage' }, host, cover, msg, bar);
    const note = h('p', { class: 'mjm-note', 'aria-live': 'polite' });
    const rootEl = h('div', { class: 'mjm mjm-live' }, stage, empty, note);
    el.appendChild(rootEl);

    const slot = root.GoLive.mesaMidia.register('image', () => render());

    function showNote(text) {
      note.textContent = text || '';
      if (noteTimer) root.clearTimeout(noteTimer);
      if (text) noteTimer = root.setTimeout(() => { note.textContent = ''; }, NOTE_MS);
    }

    function dropFrame() {
      if (frame) frame.remove();
      frame = null;
      frameChannel = null;
    }

    function render() {
      const ch = state.channel;
      const active = slot.active();
      const online = !root.navigator || root.navigator.onLine !== false;
      empty.hidden = !!ch && !showForm;
      stage.hidden = !ch;
      cover.hidden = active;
      msg.hidden = !(active && !online);
      coverName.textContent = ch ? `twitch.tv/${ch}` : '';
      if (!ch || !active || !online) {
        dropFrame();
        return;
      }
      if (frameChannel === ch) return;
      dropFrame();
      frame = h('iframe', {
        class: 'mjm-frame',
        src: M.playerUrl(ch, root.location.hostname),
        sandbox: SANDBOX,
        allow: 'autoplay',
        referrerpolicy: 'strict-origin-when-cross-origin',
        title: `Twitch: ${ch}`,
      });
      frameChannel = ch;
      host.appendChild(frame);
    }

    function send(action) {
      const ok = api.validate(action);
      if (ok !== true) {
        showNote(ok);
        return false;
      }
      api.act(action);
      return true;
    }

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = input.value.trim();
      if (v && send({ kind: 'set', url: v })) {
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
    takeBtn.addEventListener('click', () => slot.take());
    const onNet = () => render();
    root.addEventListener('online', onNet);
    root.addEventListener('offline', onNet);
    const offDenied = typeof api.onDenied === 'function'
      ? api.onDenied((d) => showNote(d && (d.detail || d.reason) ? `Não deu: ${d.detail || d.reason}` : 'Não deu'))
      : null;
    render();

    return {
      update(next) {
        if (!next || typeof next !== 'object') return;
        if (next.channel !== state.channel) showForm = false;
        state = next;
        render();
      },
      destroy() {
        if (noteTimer) root.clearTimeout(noteTimer);
        root.removeEventListener('online', onNet);
        root.removeEventListener('offline', onNet);
        if (typeof offDenied === 'function') offDenied();
        dropFrame();
        slot.release();
        rootEl.remove();
      },
      focus() {
        (state.channel ? swapBtn : input).focus();
      },
    };
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaJanelas = root.GoLive.mesaJanelas || {};
  root.GoLive.mesaJanelas.aovivo = { type: 'aovivo', mount };

  if (typeof module !== 'undefined') module.exports = root.GoLive.mesaJanelas.aovivo;
})(typeof window !== 'undefined' ? window : global);
