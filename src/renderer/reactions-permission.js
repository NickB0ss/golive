'use strict';

(function (root) {
  const t = (...args) => root.GoLive.i18n.t(...args);

  /** Camera conserva reacao livre. Na tela, quem recebe respeita a escolha
   * da dona, inclusive quando a mensagem chega depois de ela desligar. */
  function canReceiveScreenReaction({ kind, allowed = false } = {}) {
    if (kind !== 'screen') return true;
    return allowed === true;
  }

  function overlayUnavailableToast({ reason, annotations = false, reactions = false } = {}) {
    const ambos = annotations && reactions;
    if (reason === 'window') {
      if (ambos) return t('sistema.overlayJanelaAmbos');
      if (reactions) return t('sistema.overlayJanelaReacoes');
      if (annotations) return t('sistema.overlayJanelaRabiscos');
    }
    if (reason === 'display') {
      if (ambos) return t('sistema.overlayMonitorAmbos');
      if (reactions) return t('sistema.overlayMonitorReacoes');
      if (annotations) return t('sistema.overlayMonitorRabiscos');
    }
    return '';
  }

  const api = { canReceiveScreenReaction, overlayUnavailableToast };
  root.GoLive = root.GoLive || {};
  root.GoLive.reactionsPermission = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
