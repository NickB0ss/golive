/*
 * Atualizacao via GitHub Releases (electron-updater).
 *
 * O fluxo e explicito, nao passivo: o app checa por atualizacao ao abrir
 * (e quando o usuario aperta o botao de buscar), mas NAO baixa nada sozinho
 * -- `autoDownload = false`. Quem dispara o download e o botao "Reiniciar e
 * instalar" no renderer; quando o download termina, o renderer chama
 * `quitAndInstall()`, que fecha o app, roda o instalador NSIS em silencio
 * (nsis.oneClick, ver package.json) e reabre na versao nova.
 *
 * `autoInstallOnAppQuit = false`: nada e instalado sem o usuario mandar.
 *
 * So faz sentido em build empacotado (app.isPackaged). Em dev nao ha
 * instalador nenhum -- ai `deps.autoUpdater` ausente cai num stub que so
 * emite um 'not-available' sintetico pro botao de buscar dar algum retorno.
 */

'use strict';

// `require('electron')` fora do runtime do Electron devolve uma string (o
// caminho do binario), entao `.app` fica undefined -- o try/catch cobre
// tanto isso quanto um require que falhe de vez (ambiente de teste).
function isPackagedApp() {
  try {
    return require('electron').app.isPackaged === true;
  } catch {
    return false;
  }
}

/**
 * Liga o checador de updates e devolve { checkForUpdates, downloadUpdate,
 * quitAndInstall } pro main repassar aos IPCs.
 *
 * `onStatus` recebe { status, manual, ... }, status em:
 *   'checking' | 'available' | 'not-available' | 'downloading' |
 *   'downloaded' | 'error'
 * `manual` diz se o ciclo atual foi disparado pelo botao de buscar (true)
 * ou pelo check automatico do boot (false) -- o renderer usa isso pra so
 * mostrar o toast de "voce ja esta na versao mais recente" em busca manual.
 * Extras por status: 'available'/'downloaded' trazem `version`;
 * 'downloading' traz `progress` (0-100); 'error' traz `message`.
 *
 * `deps.autoUpdater` e injetavel pra teste; sem ele, usa o autoUpdater real
 * do electron-updater (import tardio -- ele loga bastante no require).
 */
function setupAutoUpdater(onStatus, deps = {}) {
  const injected = deps.autoUpdater || null;

  // Sem instalador (dev) e sem mock: stub que so da retorno pro botao.
  if (!injected && !isPackagedApp()) {
    return {
      checkForUpdates: (manual) => onStatus({ status: 'not-available', manual: !!manual }),
      downloadUpdate: () => {},
      quitAndInstall: () => {},
    };
  }

  const autoUpdater = injected || require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // Guarda se o ciclo em andamento partiu do botao de buscar. Todo evento
  // repassado carrega esse flag ate o proximo checkForUpdates trocar.
  let lastCheckManual = false;
  const emit = (payload) => onStatus({ manual: lastCheckManual, ...payload });

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => emit({ status: 'available', version: info?.version }));
  autoUpdater.on('update-not-available', () => emit({ status: 'not-available' }));
  autoUpdater.on('download-progress', (p) =>
    emit({ status: 'downloading', progress: Math.round(p?.percent || 0) })
  );
  autoUpdater.on('update-downloaded', (info) => emit({ status: 'downloaded', version: info?.version }));
  autoUpdater.on('error', (err) => emit({ status: 'error', message: err?.message || String(err) }));

  return {
    checkForUpdates: (manual) => {
      lastCheckManual = !!manual;
      Promise.resolve(autoUpdater.checkForUpdates()).catch(() => {});
    },
    downloadUpdate: () => {
      Promise.resolve(autoUpdater.downloadUpdate()).catch(() => {});
    },
    quitAndInstall: () => autoUpdater.quitAndInstall(),
  };
}

module.exports = { setupAutoUpdater };
