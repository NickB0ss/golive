// src/splash/splash.js
//
// Traduz a fase da abertura (vinda de src/main/boot.js via IPC) pro texto em
// portugues -- so aqui, igual ao resto do app: src/main/ nunca tem texto de
// tela (ver o comentario de topo de src/main/updater.js).
'use strict';

(function () {
  const statusText = document.getElementById('status-text');
  const progress = document.getElementById('progress');
  const progressFill = document.getElementById('progress-fill');

  function setIndeterminate(on) {
    progress.classList.toggle('indeterminate', on);
  }

  function setProgress(pct) {
    setIndeterminate(false);
    progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  const TEXT = {
    checking: () => 'Procurando atualizações…',
    downloading: (extra) => `Baixando atualização — ${Math.round(extra.progress ?? 0)}%`,
    installing: () => 'Instalando…',
    release: () => 'Abrindo…',
  };

  window.goliveBoot?.onPhase((payload) => {
    const { phase } = payload || {};
    const build = TEXT[phase];
    statusText.textContent = build ? build(payload) : '';

    if (phase === 'downloading') {
      setProgress(payload.progress ?? 0);
    } else {
      // checando/instalando/abrindo: sem numero real pra mostrar.
      setIndeterminate(true);
    }
  });
})();
