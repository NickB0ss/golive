/*
 * Menu de aplicacao do Electron. Logica pura, sem electron -- por isso fica
 * separada de main.js, que o node:test nao importa.
 *
 * `setMenuBarVisibility(false)` so esconde a barra: os aceleradores do menu
 * padrao seguem vivos, e Ctrl+R recarregava a pagina no meio da sala e
 * Ctrl+Shift+I abria o DevTools com acesso a toda a ponte `window.golive`
 * (auditoria 2026-11-25, M-02).
 */

'use strict';

/**
 * Tira o menu padrao (e com ele os aceleradores de recarga e DevTools) no app
 * empacotado. No `npm start` ele fica: e o jeito de abrir o DevTools em dev.
 * Precisa rodar antes de criar as janelas.
 * @param {{ setApplicationMenu: (menu: null) => void }} Menu
 * @param {boolean} packaged `app.isPackaged`
 * @returns {boolean} true se o menu foi removido
 */
function removerMenuPadrao(Menu, packaged) {
  if (!packaged) return false;
  Menu.setApplicationMenu(null);
  return true;
}

module.exports = { removerMenuPadrao };
