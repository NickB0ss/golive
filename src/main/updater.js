/*
 * Atualizacao automatica via GitHub Releases (electron-updater).
 *
 * So faz sentido em build empacotado (app.isPackaged) -- em dev nao ha
 * instalador nenhum pra aplicar. O download roda em background assim que
 * uma versao nova e encontrada; com autoInstallOnAppQuit, a instalacao
 * acontece sozinha quando o app fecha (nsis.oneClick, ver package.json,
 * garante que roda silenciosa, sem o assistente de "escolher pasta e
 * avancar") -- o usuario so precisa abrir o app de novo pra estar na versao
 * nova, sem nenhum procedimento no meio.
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
  if (!app.isPackaged) return { checkForUpdates: () => {} };

  // Import tardio: electron-updater loga bastante no require, sem valor em
  // dev.
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

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
  };
}

module.exports = { setupAutoUpdater };
