'use strict';

/*
 * Quem pode falar com a SFU por IPC: so o frame principal da pagina da
 * bancada, no webContents que o main criou. O "dono" das sessoes e derivado
 * do webContents (nunca de um campo vindo da pagina).
 */

/**
 * @param {{ getWebContents: () => object|null, urlPrefix: string }} deps
 */
function createTrust({ getWebContents, urlPrefix }) {
  function isTrusted(event) {
    const wc = getWebContents();
    if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return false;
    if (!event || event.sender !== wc) return false;
    const frame = event.senderFrame;
    const main = wc.mainFrame;
    if (!frame || !main) return false;
    if (frame.processId !== main.processId || frame.routingId !== main.routingId) return false;
    return typeof frame.url === 'string' && frame.url.startsWith(urlPrefix);
  }
  function ownerOf(event) {
    return `wc:${event.sender.id}`;
  }
  return { isTrusted, ownerOf };
}

module.exports = { createTrust };
