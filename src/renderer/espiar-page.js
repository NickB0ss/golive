'use strict';

const video = document.getElementById('video');
const state = document.getElementById('state');
let tileId = null;

window.GoLiveSpy = {
  setStream(id, stream, title) {
    tileId = id;
    document.title = title ? `Espiar — ${title}` : 'Espiar';
    video.srcObject = stream;
    video.play().catch(() => {});
  },
  setPaused(paused, opts) {
    state.textContent = paused ? (opts?.title || 'Transmissão pausada') : '';
    state.classList.toggle('visible', Boolean(paused));
  },
};

document.getElementById('back').addEventListener('click', () => window.goliveSpy.back());
document.getElementById('close').addEventListener('click', () => window.close());
window.addEventListener('pagehide', () => window.opener?.GoLive?.__espiarClosed?.(tileId));
