'use strict';

const video = document.getElementById('video');
const state = document.getElementById('state');
let tileId = null;

/** Aplica as cores do tema da janela principal (ver espiar.js). */
function setTheme(vars) {
  const clean = window.GoLive.espiar.sanitizeSpyTheme(vars);
  for (const [name, value] of Object.entries(clean)) {
    document.documentElement.style.setProperty(name, value);
  }
}

window.GoLiveSpy = {
  setStream(id, stream, title) {
    tileId = id;
    document.title = title ? `Espiar — ${title}` : 'Espiar';
    video.srcObject = stream;
    video.play().catch(() => {});
  },
  setTheme,
  setPaused(paused, opts) {
    state.textContent = paused ? (opts?.title || 'Transmissão pausada') : '';
    state.classList.toggle('visible', Boolean(paused));
  },
};

// Tema ja no primeiro quadro: busca na janela principal em vez de esperar
// o `load` de la (que chegaria depois da primeira pintura, com o Papel
// piscando escuro). Mudancas com a janela aberta chegam por setTheme.
try {
  setTheme(window.opener?.GoLive?.__espiarTheme?.());
} catch {
  /* sem opener (janela recarregada): fica o padrao ate o proximo setTheme */
}

document.getElementById('back').addEventListener('click', () => window.goliveSpy.back());
document.getElementById('close').addEventListener('click', () => window.close());
window.addEventListener('pagehide', () => window.opener?.GoLive?.__espiarClosed?.(tileId));
