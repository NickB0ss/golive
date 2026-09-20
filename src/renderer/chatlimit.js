'use strict';

(function (root) {
  // Imagens do chat carregam data URLs grandes; este teto limita o DOM sem
  // descartar o historico curto que app.js guarda para migracao da sala.
  const MAX_CHAT_MESSAGES = 200;

  function pruneChatMessages(container) {
    let removed = 0;
    while (container.querySelectorAll('.chat-line, .chat-sys').length > MAX_CHAT_MESSAGES) {
      const oldest = container.querySelector('.chat-line, .chat-sys');
      if (!oldest) break;
      oldest.remove();
      removed += 1;
    }
    return removed;
  }

  const api = { MAX_CHAT_MESSAGES, pruneChatMessages };
  if (typeof module !== 'undefined') module.exports = api;
  root.GoLiveChatLimit = api;
})(typeof window !== 'undefined' ? window : global);
