'use strict';
/* global require */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('goliveSpy', {
  idioma: ipcRenderer.sendSync('i18n:get'),
  back: () => ipcRenderer.send('spy:back'),
});
