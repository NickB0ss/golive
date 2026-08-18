// src/renderer/signaling.js
'use strict';

(function (root) {
  function connect(url, { onOpen, onMessage, onError, onClose } = {}) {
    const ws = new WebSocket(url);

    ws.addEventListener('open', () => onOpen && onOpen());
    ws.addEventListener('message', (event) => {
      if (onMessage) onMessage(JSON.parse(event.data));
    });
    ws.addEventListener('error', () => onError && onError());
    ws.addEventListener('close', () => onClose && onClose());

    return {
      send(payload) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
      },
      close() {
        ws.close();
      },
      isOpen() {
        return ws.readyState === WebSocket.OPEN;
      },
    };
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.signaling = { connect };
})(window);
