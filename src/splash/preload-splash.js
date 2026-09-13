/*
 * Ponte da tela de carregamento. Superficie minima de proposito, mesmo
 * padrao do preload-overlay.js: esta pagina so RECEBE a fase da abertura,
 * nunca chama nada de volta pro processo principal.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('goliveBoot', {
  /** { phase, version?, progress?, reason? } -- phase em 'checking' |
   * 'downloading' | 'installing' | 'release'. Ver src/main/boot.js. */
  onPhase: (callback) =>
    ipcRenderer.on('boot:phase', (_event, payload) => callback(payload)),
});
