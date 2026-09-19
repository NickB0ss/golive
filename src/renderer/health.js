'use strict';

// P4 (auditoria 2026-09-18, anexo 5-produto.md): rxstats.js ja MEDE a saude
// de recepcao, view-state ja TRANSPORTA e peer.receiveHealth ja GUARDA --
// mas nada disso virava pixel fora da tabela de Configuracoes. Este modulo
// e so a DECISAO (ok/atencao/ruim + culpado), puro e testavel sem DOM;
// quem le o WebRTC e app.js, mesma divisao de capturewatch.js/peerquality.js.
//
// Histerese: sem ela o chip piscaria a cada amostra (rxstats roda a cada
// 1-5s e o dado oscila sozinho). Duas amostras seguidas ruins pra virar
// "atencao", mais pra virar "ruim" -- e o dobro de tempo bom pra cada
// degrau de volta, mesma assimetria de peerquality.js (sumir tem que ser
// mais dificil que aparecer).
(function (root) {
  // Mesmo limiar que peerquality.isBad usa pra degradar a escada por-peer:
  // e o MESMO dado (receiveHealth), entao os dois tem de concordar sobre o
  // que e "travando" -- um dizer uma coisa e o outro outra confundiria mais
  // do que ajudaria.
  const FREEZE_PER_MIN_MAX = 6;
  const LOSS_PCT_MAX = 2;

  // Tempo CONTINUO de "travando" antes de cada degrau piorar.
  const ATTENTION_MS = 3000;
  const BAD_MS = 8000;
  // Tempo CONTINUO de folga antes de cada degrau melhorar -- maior que os
  // dois de cima, de proposito (ver nota de assimetria acima).
  const RECOVER_MS = 10000;

  function isTravando(receiveHealth) {
    if (!receiveHealth || typeof receiveHealth !== 'object') return false;
    const { freezeRate, lossPct } = receiveHealth;
    return (typeof freezeRate === 'number' && freezeRate > FREEZE_PER_MIN_MAX)
      || (typeof lossPct === 'number' && lossPct > LOSS_PCT_MAX);
  }

  // O culpado so e nomeado quando a ORIGEM mandou o proprio `limit`
  // (broadcast-state, P4) -- sem ele, apontar um lado seria chute. Mesmo
  // criterio de normalizeReceiveHealth/normalizeEncodeHealth em app.js:
  // ausencia (ou um cliente antigo que nunca manda o campo) e o caso
  // NEUTRO, nunca vira diagnostico.
  function blameFor(senderLimit) {
    return senderLimit === 'bandwidth' || senderLimit === 'cpu' || senderLimit === 'other'
      ? senderLimit
      : null;
  }

  const BLAME_TEXT = {
    bandwidth: 'travando — a rede de quem está transmitindo não aguenta',
    cpu: 'travando — a máquina de quem está transmitindo está apertada',
    other: 'travando — o encoder de quem está transmitindo está no limite',
  };
  const GENERIC_TEXT = 'travando — a rede entre vocês';

  function textFor(level, blame) {
    if (level === 'ok') return '';
    return blame ? BLAME_TEXT[blame] : GENERIC_TEXT;
  }

  function initialState() {
    return { level: 'ok', blame: null, text: '', badSinceMs: null, goodSinceMs: null };
  }

  /** Avanca o veredicto de UM tile (ou UMA pessoa, do lado de quem
   * transmite) com UMA amostra.
   *
   * `receiveHealth`: saude de recepcao mais recente para aquela conexao, ou
   * null (sem amostra fresca -- rxstats/freshReceiveHealth ja tratam
   * ausencia como "sem dado", nunca como "esta bem". Um stream congelado de
   * vez para de reportar; distinguir isso de "travando" e trabalho de
   * outro vigia (stallwatch.js), nao deste modulo).
   *
   * `senderLimit`: o ultimo `limit` que a ORIGEM daquela tela anunciou
   * (`'bandwidth'|'cpu'|'other'|null`).
   *
   * `atMs`: relogio da histerese -- mesmo padrao de peerquality.next
   * (tempo continuo, nao contagem de amostras: a cadencia de updateStats
   * muda entre janela visivel e oculta). */
  function next(state, receiveHealth, senderLimit, atMs) {
    const prev = state || initialState();
    const now = Number(atMs) || 0;

    if (isTravando(receiveHealth)) {
      const badSinceMs = prev.badSinceMs ?? now;
      const elapsed = now - badSinceMs;
      let level = prev.level;
      if (level === 'ok' && elapsed >= ATTENTION_MS) level = 'atencao';
      if (level !== 'ruim' && elapsed >= BAD_MS) level = 'ruim';
      const blame = level === 'ok' ? null : blameFor(senderLimit);
      return { level, blame, text: textFor(level, blame), badSinceMs, goodSinceMs: null };
    }

    const goodSinceMs = prev.goodSinceMs ?? now;
    if (prev.level !== 'ok' && now - goodSinceMs >= RECOVER_MS) {
      const level = prev.level === 'ruim' ? 'atencao' : 'ok';
      const blame = level === 'ok' ? null : blameFor(senderLimit);
      // goodSinceMs REINICIA no degrau: descer de ruim pra atencao nao pode
      // dar de graca o degrau seguinte (atencao -> ok) so porque a folga
      // que sobrou ja passava dos 10s -- cada degrau exige a sua propria
      // janela de RECOVER_MS. Mesmo mecanismo de peerquality.next.
      return { level, blame, text: textFor(level, blame), badSinceMs: null, goodSinceMs: now };
    }
    // Nivel nao mudou, mas o culpado pode: enquanto ainda "ruim"/"atencao"
    // e a origem muda de limitacao (ex: rampou a banda e passou a ser CPU),
    // o texto tem de acompanhar sem esperar a proxima virada de nivel.
    const blame = prev.level === 'ok' ? null : blameFor(senderLimit);
    return { level: prev.level, blame, text: textFor(prev.level, blame), badSinceMs: null, goodSinceMs };
  }

  const api = {
    initialState,
    next,
    isTravando,
    blameFor,
    LIMITS: { FREEZE_PER_MIN_MAX, LOSS_PCT_MAX, ATTENTION_MS, BAD_MS, RECOVER_MS },
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.health = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
