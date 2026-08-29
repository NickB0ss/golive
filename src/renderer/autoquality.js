'use strict';

(function (root) {
  // Teto de degraus que a telemetria pode pedir sozinha. Dois degraus a
  // partir de 1080p60 chegam em 720p30 (ver QUALITY_DEGRADE_CHAIN em
  // config.js); abaixo disso a imagem deixa de servir pro que o app existe,
  // e o problema passou a ser outro -- maquina que nao aguenta transmitir.
  const MAX_AUTO_STEPS = 2;

  // Tempo CONTINUO de sofrimento antes de descer -- nao contagem de
  // amostras. updateStats roda a cada 1s visivel mas 5s escondido (jogando
  // em fullscreen), entao contar amostras dava 15s de reacao no caso que
  // mais importa. Simetrico com GOOD_MS_TO_RECOVER.
  const BAD_MS_TO_DEGRADE = 3000;

  // Folga CONTINUA antes de subir de volta. Assimetrico de proposito:
  // descer e barato e reversivel; subir cedo demais recria o regime que
  // quebrou e a escada vira um oscilador.
  const GOOD_MS_TO_RECOVER = 30000;

  // Orcamento de encode por quadro a 60fps, somando todos os senders --
  // mesmo numero que a aba Estatisticas ja usa como limiar.
  const BUDGET_MS_60 = 16.6;

  const LIMITS = { MAX_AUTO_STEPS, BAD_MS_TO_DEGRADE, GOOD_MS_TO_RECOVER, BUDGET_MS_60 };

  /** Saude ausente NAO e ruim: quem nao reportou nada nao esta acusado.
   * Mesmo criterio neutro que tree.js usa pra eleger relay.
   *
   * O sinal e o TEMPO de encode por quadro, nao o encoder em si. Encoder em
   * software so e problema quando nao acompanha -- e ai o msPerFrame estoura
   * o orcamento de qualquer jeito. Uma maquina sem NVENC que codifica em
   * OpenH264 a ~2 ms/quadro esta bem; degradar ela era punir a ausencia de
   * hardware, e a escada nunca voltava porque softwareEncoder fica true pra
   * sempre. O caso que a regra antiga mirava (NVENC afogado caindo pro
   * software sob carga) continua coberto: 1080p60 em software passa MUITO
   * dos 16,6 ms. Ver o log de 2026-08-29 (RTX 3060 sem aceleracao de GPU,
   * OpenH264 a 1,7 ms, escada presa em g2). */
  function isBad(health, budgetMs) {
    if (!health) return false;
    return typeof health.msPerFrame === 'number' && health.msPerFrame > budgetMs;
  }

  /** Pior saude de uma lista (a nossa + a dos relays). Carrega softwareEncoder
   * adiante pra quem quiser exibir ("encoder em software" no cabecalho), mas
   * o gatilho da escada e so o msPerFrame -- ver isBad. */
  function worstHealth(list) {
    let worst = null;
    for (const h of list || []) {
      if (!h || typeof h !== 'object') continue;
      if (!worst) {
        worst = { softwareEncoder: h.softwareEncoder === true, msPerFrame: h.msPerFrame ?? null };
        continue;
      }
      worst.softwareEncoder = worst.softwareEncoder || h.softwareEncoder === true;
      if (typeof h.msPerFrame === 'number' && (worst.msPerFrame == null || h.msPerFrame > worst.msPerFrame)) {
        worst.msPerFrame = h.msPerFrame;
      }
    }
    return worst;
  }

  function initialState() {
    return { steps: 0, badSinceMs: null, goodSinceMs: null };
  }

  /** Avanca a escada com UMA amostra. Puro: mesma entrada, mesma saida --
   * o relogio entra por sample.atMs, nao por Date.now(). */
  function next(state, sample, opts) {
    const o = opts || {};
    const budgetMs = o.budgetMs ?? BUDGET_MS_60;
    const maxSteps = o.maxSteps ?? MAX_AUTO_STEPS;
    const badMsToDegrade = o.badMsToDegrade ?? BAD_MS_TO_DEGRADE;
    const goodMsToRecover = o.goodMsToRecover ?? GOOD_MS_TO_RECOVER;

    const prev = state || initialState();
    const atMs = Number(sample?.atMs) || 0;

    if (isBad(sample?.health, budgetMs)) {
      // badSinceMs marca o inicio da corrida ruim atual; a primeira amostra
      // ruim ancora o relogio. goodSinceMs zera: a folga tem de ser CONTINUA.
      const badSinceMs = prev.badSinceMs ?? atMs;
      if (prev.steps < maxSteps && atMs - badSinceMs >= badMsToDegrade) {
        // Desce um degrau e reinicia o relogio de sofrimento -- descer dois
        // degraus leva dois periodos.
        return { steps: prev.steps + 1, badSinceMs: atMs, goodSinceMs: null };
      }
      return { steps: prev.steps, badSinceMs, goodSinceMs: null };
    }

    const goodSinceMs = prev.goodSinceMs ?? atMs;
    if (prev.steps > 0 && atMs - goodSinceMs >= goodMsToRecover) {
      // Sobe UM degrau e reinicia a contagem: recuperar dois degraus leva
      // dois periodos de folga, pelo mesmo motivo de nao subir com pressa.
      return { steps: prev.steps - 1, badSinceMs: null, goodSinceMs: atMs };
    }
    return { steps: prev.steps, badSinceMs: null, goodSinceMs };
  }

  const api = { initialState, next, worstHealth, isBad, LIMITS };

  root.GoLive = root.GoLive || {};
  root.GoLive.autoquality = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
