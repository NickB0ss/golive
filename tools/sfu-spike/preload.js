'use strict';

/*
 * Preload minimo (contextIsolation ligado). A pagina so enxerga estas
 * funcoes; nenhuma toca disco, rede ou desktop. `rpc` fala com a SFU local
 * SOMENTE por este canal, e o main so aceita o frame principal da bancada.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sfuSpike', {
  getPlan: () => ipcRenderer.invoke('spike:plan'),
  scenarioStart: (key) => ipcRenderer.invoke('spike:scenario-start', key),
  /** Devolve { ok: true, result } ou { ok: false, error: { code, message } }. */
  rpc: (method, params) => ipcRenderer.invoke('spike:rpc', method, params),
  scenarioDone: (payload) => ipcRenderer.invoke('spike:scenario-done', payload),
  log: (text) => ipcRenderer.send('spike:log', String(text)),
  finish: (fatal) => ipcRenderer.invoke('spike:finish', fatal),
});
