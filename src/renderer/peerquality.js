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

  // Carencia de um sender RECEM-CRIADO, contada da primeira amostra dele.
  //
  // Uma conexao que acabou de nascer ainda nao mandou pacote nenhum: o
  // estimador de banda do WebRTC (GCC) parte do piso e sobe ao longo de
  // alguns segundos. `qualityLimitationReason='bandwidth'` nesse intervalo
  // e o ESTADO NORMAL de quem esta subindo, nao sinal de link ruim -- mas a
  // escada lia como sofrimento e derrubava dois degraus antes de o primeiro
  // quadro chegar do outro lado.
  //
  // Log de 2026-09-05, maquina do nicol, o caso mais limpo que aparece:
  //   04:58:09 tela->gg out=960x540@0fps limite=bandwidth realKbps=0  p0
  //   04:58:12 MUDOU                                                  p1
  //   04:58:19 MUDOU out=853x480                                      p2
  //   04:58:22 MUDOU out=1280x720 limite=nenhum realKbps=565          p2
  // Treze segundos depois de nascer ja estava tudo bem -- e a essa altura
  // ela ja estava no piso, com 40s de folga CONTINUA pela frente pra
  // voltar. Toda conexao nova comecava estrangulada.
  //
  // 15s cobre a rampa tipica do GCC com folga. O custo, num link de fato
  // ruim, e adiar a primeira queda em 15 segundos; o beneficio e nao punir
  // TODA conexao nova por uma coisa que ia se resolver sozinha.
  const WARMUP_MS = 15000;

  const LIMITS = {
    MAX_PEER_STEPS, BAD_MS_TO_DEGRADE, GOOD_MS_TO_RECOVER, FREEZE_PER_MIN, LOSS_PCT_MAX, WARMUP_MS,
  };

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
    return { steps: 0, badSinceMs: null, goodSinceMs: null, startedAtMs: null };
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

    const warmupMs = o.warmupMs ?? WARMUP_MS;

    const prev = state || initialState();
    const atMs = Number(signals?.atMs) || 0;
    // A PRIMEIRA amostra deste sender ancora o relogio da carencia -- nao o
    // zero. updateStats roda desde que a sala abriu, e um sender pode nascer
    // minutos depois; contar do zero daria carencia nenhuma pra ele.
    const startedAtMs = prev.startedAtMs ?? atMs;

    // Dentro da carencia a escada nao anda pra lado nenhum: nem desce (o
    // sinal ainda nao vale), nem sobe (senao a carencia viraria folga
    // observada de graca pra um peer que ja estava degradado). Os dois
    // relogios zerados: quando ela acabar, a contagem comeca limpa.
    if (atMs - startedAtMs < warmupMs) {
      return { steps: prev.steps, badSinceMs: null, goodSinceMs: null, startedAtMs };
    }

    if (isBad(signals, o)) {
      const badSinceMs = prev.badSinceMs ?? atMs;
      if (prev.steps < maxSteps && atMs - badSinceMs >= badMsToDegrade) {
        return { steps: prev.steps + 1, badSinceMs: atMs, goodSinceMs: null, startedAtMs };
      }
      return { steps: prev.steps, badSinceMs, goodSinceMs: null, startedAtMs };
    }

    const goodSinceMs = prev.goodSinceMs ?? atMs;
    if (prev.steps > 0 && atMs - goodSinceMs >= goodMsToRecover) {
      return { steps: prev.steps - 1, badSinceMs: null, goodSinceMs: atMs, startedAtMs };
    }
    return { steps: prev.steps, badSinceMs: null, goodSinceMs, startedAtMs };
  }

  const api = { initialState, next, isBad, LIMITS };

  root.GoLive = root.GoLive || {};
  root.GoLive.peerquality = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
