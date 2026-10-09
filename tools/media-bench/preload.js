'use strict';

/*
 * Preload minimo da bancada (contextIsolation ligado). A pagina so enxerga
 * estas funcoes; nenhuma delas toca disco, rede ou o desktop.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mediaBench', {
  /** Plano validado: { scenarios: [{ key, id, label, config }] }. */
  getPlan: () => ipcRenderer.invoke('bench:plan'),
  /** Arma UMA autorizacao de getDisplayMedia (so owned-window; o main recusa o resto). */
  armCapture: () => ipcRenderer.invoke('bench:arm-capture'),
  scenarioStart: (key) => ipcRenderer.invoke('bench:scenario-start', key),
  scenarioDone: (result) => ipcRenderer.invoke('bench:scenario-done', result),
  log: (text) => ipcRenderer.send('bench:log', String(text)),
  /** Encerra o conjunto; `fatal` (texto) marca falha de runtime. */
  finish: (fatal) => ipcRenderer.invoke('bench:finish', fatal),
});
