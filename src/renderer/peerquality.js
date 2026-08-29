'use strict';

(function (root) {
  // Teto de degraus por peer, A PARTIR do piso global. Dois: o piso ja pode
  // ter descido pelo tamanho da sala; mais dois degraus locais chegam num
  // preset que ainda serve pra assistir. Abaixo disso o problema da pessoa
  // e outro (a maquina/link dela nao aguenta nem o minimo).
  const MAX_PEER_STEPS = 2;

  // Amostras ruins SEGUIDAS antes de descer -- ~3s continuos com a janela
  // visivel, um pico isolado nao conta.
  const BAD_SAMPLES_TO_DEGRADE = 3;

  // Folga CONTINUA OBSERVADA antes de subir. Menor que os 30s do autoquality
  // global (20s): a recuperacao por-peer nao afeta a sala, entao arriscar
  // subir cedo custa menos.
  const GOOD_MS_TO_RECOVER = 20000;

  // Travar sem perda de rede = o decode nao acompanha (caso 1). Travar COM
  // perda alta e o caso 2, e o remedio e outro (o GCC ja esta agindo; a
  // resolucao seguir junto vem do sinal senderBandwidthLimited).
  const FREEZE_PER_MIN = 6;
  const LOSS_PCT_MAX = 2;

  const LIMITS = { MAX_PEER_STEPS, BAD_SAMPLES_TO_DEGRADE, GOOD_MS_TO_RECOVER, FREEZE_PER_MIN, LOSS_PCT_MAX };

  /** Ruim = qualquer um dos tres: link limitado por banda, decoder em
   * software do espectador, ou travar muito sem que a rede explique. */
  function isBad(signals, opts) {
    if (!signals) return false;
    if (signals.senderBandwidthLimited === true) return true;
    const rh = signals.receiveHealth;
    if (!rh || typeof rh !== 'object') return false;
    if (rh.softwareDecoder === true) return true;
    const o = opts || {};
    const freezeMax = o.freezePerMin ?? FREEZE_PER_MIN;
    const lossMax = o.lossPctMax ?? LOSS_PCT_MAX;
    return typeof rh.freezeRate === 'number' && typeof rh.lossPct === 'number'
      && rh.freezeRate > freezeMax && rh.lossPct < lossMax;
  }

  function initialState() {
    return { steps: 0, badRun: 0, goodSinceMs: null };
  }

  /** Avanca a escada de UM peer com UMA amostra. Puro: relogio via
   * signals.atMs. Mesma semantica de recuperacao do autoquality (Opcao B):
   * goodSinceMs zera no degrau, a primeira amostra boa ancora o relogio. */
  function next(state, signals, opts) {
    const o = opts || {};
    const maxSteps = o.maxSteps ?? MAX_PEER_STEPS;
    const badToDegrade = o.badSamplesToDegrade ?? BAD_SAMPLES_TO_DEGRADE;
    const goodMsToRecover = o.goodMsToRecover ?? GOOD_MS_TO_RECOVER;

    const prev = state || initialState();
    const atMs = Number(signals?.atMs) || 0;

    if (isBad(signals, o)) {
      const badRun = prev.badRun + 1;
      if (badRun >= badToDegrade && prev.steps < maxSteps) {
        return { steps: prev.steps + 1, badRun: 0, goodSinceMs: null };
      }
      return { steps: prev.steps, badRun, goodSinceMs: null };
    }

    const goodSinceMs = prev.goodSinceMs ?? atMs;
    if (prev.steps > 0 && atMs - goodSinceMs >= goodMsToRecover) {
      return { steps: prev.steps - 1, badRun: 0, goodSinceMs: atMs };
    }
    return { steps: prev.steps, badRun: 0, goodSinceMs };
  }

  const api = { initialState, next, isBad, LIMITS };

  root.GoLive = root.GoLive || {};
  root.GoLive.peerquality = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
