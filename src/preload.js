/*
 * Ponte entre o processo principal e a pagina. Mantem contextIsolation
 * ligado: o renderer so enxerga as tres funcoes abaixo, nada de Node.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('golive', {
  /** Lista telas e janelas capturaveis, com thumbnail em data URL. */
  listSources: () => ipcRenderer.invoke('sources:list'),

  /** Define qual fonte o getDisplayMedia vai devolver. */
  selectSource: (id, systemAudio) =>
    ipcRenderer.invoke('sources:select', { id, systemAudio }),

  /** Sobe o servidor de sinalizacao embutido e devolve o endereco pronto. */
  hostRoom: (payload) => ipcRenderer.invoke('room:host', payload),
});
