'use strict';

(function (root) {
  // Teto de degraus por peer, A PARTIR do piso global. Dois: o piso ja pode
  // ter descido pelo tamanho da sala; mais dois degraus locais chegam num
  // preset que ainda serve pra assistir. Abaixo disso o problema da pessoa
  // e outro (a maquina/link dela nao aguenta nem o minimo).
  const MAX_PEER_STEPS = 2;

  // Tempo CONTINUO de sofrimento antes de descer -- nao contagem de
  // amostras (updateStats roda a cada 1s visivel mas 5s escondido).
  // Simetrico com GOOD_MS_TO_RECOVER.
  const BAD_MS_TO_DEGRADE = 3000;

  // Folga CONTINUA OBSERVADA antes de subir. Menor que os 30s do autoquality
  // global (20s): a recuperacao por-peer nao afeta a sala, entao arriscar
  // subir cedo custa menos.
  const GOOD_MS_TO_RECOVER = 20000;

  // Travar sem perda de rede = o decode nao acompanha (caso 1). Travar COM
  // perda alta e o caso 2, e o remedio e outro (o GCC ja esta agindo; a
  // resolucao seguir junto vem do sinal senderBandwidthLimited).
  const FREEZE_PER_MIN = 6;
  const LOSS_PCT_MAX = 2;

  const LIMITS = { MAX_PEER_STEPS, BAD_MS_TO_DEGRADE, GOOD_MS_TO_RECOVER, FREEZE_PER_MIN, LOSS_PCT_MAX };

  /** Ruim = qualquer um: link limitado por banda, encoder do peer saturado
   * (relay afogado), ou travar muito sem que a rede explique.
   *
   * Decoder em software NAO conta sozinho. Espelha a decisao do lado do
   * encoder (ver autoquality.isBad): decodificar na CPU so e problema quando
   * nao acompanha -- e ai o stream TRAVA, que o teste de freeze abaixo ja
   * pega. Log de 2026-08-29: a GPU do espectador (GTX 1650) tambem estava
   * desativada no Chromium, entao softwareDecoder ficava true pra sempre e
   * prendia a escada por-peer no piso mesmo com o decode dando conta
   * (fps de saida colado no alvo, sem travar). */
  function isBad(signals, opts) {
    if (!signals) return false;
    if (signals.senderBandwidthLimited === true) return true;
    // Relay afogando o proprio encoder (Task 5 faz myEncodeHealth subir dele):
    // degrada a conexao origem->relay que servimos, mesmo que ele decodifique
    // em hardware e a receiveHealth pareca limpa.
    if (signals.peerEncodeSaturated === true) return true;
    const rh = signals.receiveHealth;
    if (!rh || typeof rh !== 'object') return false;
    const o = opts || {};
    const freezeMax = o.freezePerMin ?? FREEZE_PER_MIN;
    const lossMax = o.lossPctMax ?? LOSS_PCT_MAX;
    return typeof rh.freezeRate === 'number' && typeof rh.lossPct === 'number'
      && rh.freezeRate > freezeMax && rh.lossPct < lossMax;
  }

  function initialState() {
    return { steps: 0, badSinceMs: null, goodSinceMs: null };
  }

  /** Avanca a escada de UM peer com UMA amostra. Puro: relogio via
   * signals.atMs. Mesma semantica de recuperacao do autoquality (Opcao B):
   * goodSinceMs zera no degrau, a primeira amostra boa ancora o relogio.
   * Descer tambem e por tempo continuo: badSinceMs marca o inicio da
   * corrida ruim atual. */
  function next(state, signals, opts) {
    const o = opts || {};
    const maxSteps = o.maxSteps ?? MAX_PEER_STEPS;
    const badMsToDegrade = o.badMsToDegrade ?? BAD_MS_TO_DEGRADE;
    const goodMsToRecover = o.goodMsToRecover ?? GOOD_MS_TO_RECOVER;

    const prev = state || initialState();
    const atMs = Number(signals?.atMs) || 0;

    if (isBad(signals, o)) {
      const badSinceMs = prev.badSinceMs ?? atMs;
      if (prev.steps < maxSteps && atMs - badSinceMs >= badMsToDegrade) {
        return { steps: prev.steps + 1, badSinceMs: atMs, goodSinceMs: null };
      }
      return { steps: prev.steps, badSinceMs, goodSinceMs: null };
    }

    const goodSinceMs = prev.goodSinceMs ?? atMs;
    if (prev.steps > 0 && atMs - goodSinceMs >= goodMsToRecover) {
      return { steps: prev.steps - 1, badSinceMs: null, goodSinceMs: atMs };
    }
    return { steps: prev.steps, badSinceMs: null, goodSinceMs };
  }

  const api = { initialState, next, isBad, LIMITS };

  root.GoLive = root.GoLive || {};
  root.GoLive.peerquality = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
