'use strict';

(function (root) {
  /** Camera conserva reacao livre. Na tela, quem recebe respeita a escolha
   * da dona, inclusive quando a mensagem chega depois de ela desligar. */
  function canReceiveScreenReaction({ kind, allowed = false } = {}) {
    if (kind !== 'screen') return true;
    return allowed === true;
  }

  function overlayUnavailableToast({ reason, annotations = false, reactions = false } = {}) {
    const ambos = annotations && reactions;
    if (reason === 'window') {
      if (ambos) return 'Compartilhando uma janela: rabiscos e reações aparecem no app, não na tela.';
      if (reactions) return 'Compartilhando uma janela: as reações aparecem no app, não na tela.';
      if (annotations) return 'Compartilhando uma janela: os rabiscos aparecem no app, não na tela.';
    }
    if (reason === 'display') {
      if (ambos) return 'Não achei o monitor para rabiscos e reações; eles ficam só no app.';
      if (reactions) return 'Não achei o monitor para as reações; elas ficam só no app.';
      if (annotations) return 'Não achei o monitor para os rabiscos; eles ficam só no app.';
    }
    return '';
  }

  const api = { canReceiveScreenReaction, overlayUnavailableToast };
  root.GoLive = root.GoLive || {};
  root.GoLive.reactionsPermission = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
