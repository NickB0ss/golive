'use strict';

const video = document.getElementById('video');
const tileName = document.getElementById('tile-name');
let tileId = null;
let controlsTimer = 0;

function showControls() {
  document.body.classList.add('spy-controls');
  window.clearTimeout(controlsTimer);
  controlsTimer = window.setTimeout(() => document.body.classList.remove('spy-controls'), 1800);
}

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
    tileName.textContent = title || 'Transmissão';
    video.srcObject = stream;
    video.play().catch(() => {});
  },
  setTheme,
  setPaused() {
    // A janela Espiar e so a imagem: a pausa fica no tile original, sem HUD
    // sobre o video da janela auxiliar.
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

document.getElementById('close').addEventListener('click', () => window.close());
document.addEventListener('pointermove', showControls, { passive: true });
document.addEventListener('pointerdown', showControls, { passive: true });
document.addEventListener('focusin', showControls);
window.addEventListener('pagehide', () => window.opener?.GoLive?.__espiarClosed?.(tileId));
