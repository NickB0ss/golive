/*
 * Ponte da janela de rabisco. Superficie minima de proposito: esta pagina so
 * RECEBE o que desenhar, e nao tem uma unica funcao pra chamar de volta --
 * ela nao fala com a sala, nao le disco e nao abre socket. Tudo o que ela
 * sabe chega por estes tres eventos.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('goliveOverlay', {
  /** Uma op de anotacao (`begin`/`points`/`text`/`undo`/`clear`), com quem
   * mandou. A cor sai de `from` do lado de ca, igual no app: nao existe
   * campo de cor pra forjar. */
  onOp: (callback) =>
    ipcRenderer.on('overlay:op', (_event, payload) => callback(payload)),

  /** Lousa inteira de uma vez -- usado quando a janela nasce no meio de uma
   * transmissao que ja tinha rabisco. */
  onLoad: (callback) =>
    ipcRenderer.on('overlay:load', (_event, payload) => callback(payload)),
});
