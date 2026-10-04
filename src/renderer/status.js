'use strict';

(function (root) {
  const t = (...args) => root.GoLive.i18n.t(...args);

  // Rotulo da degradacao. Com preset, a frase inteira e uma chave so (nada de
  // juntar pedacos traduzidos).
  function reasonLabel(reason, preset) {
    if (preset) {
      switch (reason) {
        case 'encoder': return t('sistema.motivoEncoderPreset', { preset });
        case 'malha': return t('sistema.motivoMalhaPreset', { preset });
        case 'auto': return t('sistema.motivoAutoPreset', { preset });
        default: return t('sistema.motivoSalaPreset', { preset });
      }
    }
    switch (reason) {
      case 'encoder': return t('sistema.motivoEncoder');
      case 'malha': return t('sistema.motivoMalha');
      case 'auto': return t('sistema.motivoAuto');
      default: return t('sistema.motivoSala');
    }
  }

  // Precedencia: encoder em software e a causa mais grave (a imagem esta
  // sendo codificada pela CPU agora); malha degradada vem antes do tamanho
  // da sala porque ela JA embute o degrau do tamanho da sala -- ver
  // qualityFor em app.js. 'auto' fica entre malha e sala: a telemetria de
  // encode pediu o degrau; pode ser a nossa CPU ou a de um relay.
  function degradeReason(state) {
    if (state.softwareEncoder) return 'encoder';
    if (state.meshFallback) return 'malha';
    if (state.autoDegraded) return 'auto';
    if (state.presetDegraded) return 'sala';
    return null;
  }

  /** Estado do cabecalho da sala, derivado. Nao toca no DOM: quem chama
   * decide o que fazer com { level, label }.
   *
   *   'offline'      -- sem sessao nenhuma
   *   'reconnecting' -- sinalizacao caida com a midia viva (H1)
   *   'degraded'     -- NOS estamos transmitindo abaixo do preset escolhido
   *   'paused'       -- NOS estamos transmitindo mas com a saida suspensa (Task 7)
   *   'live'         -- alguem esta ao vivo, sem degradacao conhecida
   *   'idle'         -- na sala, ninguem transmitindo
   *
   * A regra do tema mora aqui: o acento (--live) so pode ser pintado em
   * 'live'. 'degraded' e --warn, 'reconnecting' e --warn pulsando, e
   * 'idle'/'offline' sao neutros -- estar numa sala nao e transmissao.
   *
   * Degradacao so e reportada quando weAreLive: a saude de encode de quem
   * transmite PRA NOS nao chega ate aqui, e chutar seria pior que calar.
   */
  function roomStatus(state) {
    const s = state || {};
    if (!s.inRoom) return { level: 'offline', label: '' };
    if (s.reconnecting) return { level: 'reconnecting', label: t('sistema.reconectando') };
    if (s.weAreLive && s.paused) return { level: 'paused', label: t('sistema.transmissaoPausada') };
    if (!s.anyoneLive) return { level: 'idle', label: '' };

    const reason = s.weAreLive ? degradeReason(s) : null;
    if (!reason) return { level: 'live', label: '' };

    return { level: 'degraded', label: reasonLabel(reason, s.effectivePreset || '') };
  }

  const api = { roomStatus, degradeReason };

  root.GoLive = root.GoLive || {};
  root.GoLive.status = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
