/*
 * Atualizacao automatica via GitHub Releases (electron-updater).
 *
 * So faz sentido em build empacotado (app.isPackaged) -- em dev nao ha
 * instalador nenhum pra aplicar. O download roda em background assim que
 * uma versao nova e encontrada; a instalacao (que precisa fechar o app) fica
 * a cargo do renderer, via applyUpdateAndRestart, pra nao derrubar o usuario
 * no meio de uma transmissao.
 */

'use strict';

const { app } = require('electron');

/**
 * Liga o checador de updates e devolve os eventos pro chamador repassar ao
 * renderer. `onStatus` recebe { status, info? }, status em:
 *   'checking' | 'available' | 'not-available' | 'downloading' |
 *   'downloaded' | 'error'
 * `progress` (0-100) e mandado junto durante 'downloading'.
 */
function setupAutoUpdater(onStatus) {
  if (!app.isPackaged) return { checkForUpdates: () => {}, quitAndInstall: () => {} };

  // Import tardio: electron-updater loga bastante no require, sem valor em
  // dev.
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => onStatus({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => onStatus({ status: 'available', info }));
  autoUpdater.on('update-not-available', () => onStatus({ status: 'not-available' }));
  autoUpdater.on('download-progress', (progress) =>
    onStatus({ status: 'downloading', progress: Math.round(progress.percent) })
  );
  autoUpdater.on('update-downloaded', (info) => onStatus({ status: 'downloaded', info }));
  autoUpdater.on('error', (err) => onStatus({ status: 'error', message: err?.message || String(err) }));

  return {
    checkForUpdates: () => autoUpdater.checkForUpdates().catch(() => {}),
    quitAndInstall: () => autoUpdater.quitAndInstall(),
  };
}

module.exports = { setupAutoUpdater };
