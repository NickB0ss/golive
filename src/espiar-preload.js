'use strict';
/* global require */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('goliveSpy', {
  back: () => ipcRenderer.send('spy:back'),
});
