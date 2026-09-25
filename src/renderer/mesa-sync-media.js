'use strict';

/*
 * Correcao de deriva da midia da Mesa (YouTube, Radio) -- PURA.
 *
 * Spec 2026-09-24-sala-em-dois-modos-design.md, secao 4.5: o alvo e
 * `positionAt(estado, agoraDoServidor)`; erro abaixo de 0,3 s, nada; ate
 * 1,5 s, `setPlaybackRate` 1,05 (atras) ou 0,95 (adiantado) ate cruzar o
 * alvo; acima, salto.
 *
 * Quem usa chama `step()` de tempos em tempos (4 vezes por segundo) com o
 * que o player diz e aplica os comandos que voltam. Sem DOM e sem relogio:
 * `now` (ms, monotonico) vem de fora.
 *
 * Histerese, para nao oscilar:
 * - a correcao por velocidade entra acima de `dead` (0,3 s) e so sai quando o
 *   erro cruza o zero ou cai abaixo de `release` (0,05 s);
 * - depois de um salto, `seekHoldMs` sem olhar (o player demora a reportar a
 *   posicao nova), e play/pause nao se repetem antes de `cmdHoldMs`;
 * - carregando (buffering), nada: a posicao congela e o alvo anda; quando
 *   voltar a tocar, o erro decide.
 * - Se o player nao aceitar a velocidade pedida (o YouTube arredonda para uma
 *   que ele tem; a IFrame API avisa que pode acontecer), depois de
 *   `rateCheckMs` com a velocidade reportada ainda em 1 a faixa do meio passa
 *   a saltar, mas so acima de `brokenSeek` (0,6 s).
 */

(function (root) {
  const DEFAULTS = Object.freeze({
    dead: 0.3,
    soft: 1.5,
    release: 0.05,
    rateUp: 1.05,
    rateDown: 0.95,
    seekHoldMs: 1200,
    cmdHoldMs: 1000,
    rateCheckMs: 2000,
    brokenSeek: 0.6,
    seekLead: 0,
  });

  // Estados do player (os nomes do ytplayer.stateName).
  const RUNNING = new Set(['playing', 'buffering']);
  const STOPPED = new Set(['paused', 'cued', 'unstarted']);

  function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function createDrift(options) {
    const o = { ...DEFAULTS, ...(options || {}) };
    let correcting = 0; // 0 | +1 (acelerando) | -1 (freando)
    let rateAskedAt = null;
    let rateBroken = false;
    let holdUntil = -Infinity; // depois de salto
    let cmdUntil = -Infinity; // depois de play/pause
    let lastErr = 0;

    function reset() {
      correcting = 0;
      rateAskedAt = null;
      holdUntil = -Infinity;
      cmdUntil = -Infinity;
      lastErr = 0;
    }

    function seek(to, now, cmds) {
      holdUntil = now + o.seekHoldMs;
      cmds.push({ cmd: 'seek', to: Math.max(0, to) });
    }

    function stopRate(cmds) {
      if (correcting !== 0) cmds.push({ cmd: 'rate', rate: 1 });
      correcting = 0;
      rateAskedAt = null;
    }

    /**
     * input: {
     *   target: s onde deveria estar; current: s onde o player esta (ou null),
     *   want: 'play' | 'pause'; player: 'playing' | 'paused' | 'buffering' |
     *   'ended' | 'cued' | 'unstarted' | 'unknown'; rate: a reportada; now: ms
     * }
     * Devolve a lista de comandos: { cmd: 'play' | 'pause' } |
     * { cmd: 'seek', to } | { cmd: 'rate', rate }.
     */
    function step(input) {
      const cmds = [];
      const { target, current, want, player, now } = input || {};
      if (!isNum(target) || !isNum(now)) return cmds;
      const known = isNum(current);
      const err = known ? target - current : 0;
      lastErr = err;

      if (want === 'pause') {
        stopRate(cmds);
        if (RUNNING.has(player)) {
          if (now >= cmdUntil) {
            cmds.push({ cmd: 'pause' });
            cmdUntil = now + o.cmdHoldMs;
            if (known && Math.abs(err) > o.dead) seek(target, now, cmds);
          }
          return cmds;
        }
        if (known && Math.abs(err) > o.dead && now >= holdUntil && player !== 'unknown') seek(target, now, cmds);
        return cmds;
      }

      // want === 'play'
      if (player === 'ended') {
        // O player acabou: se o alvo ainda esta antes do fim, voltou alguem
        // atras (seek) -- salta e toca; senao espera o estado dizer que acabou.
        if (known && err < -o.soft && now >= cmdUntil) {
          seek(target, now, cmds);
          cmds.push({ cmd: 'play' });
          cmdUntil = now + o.cmdHoldMs;
        }
        return cmds;
      }
      if (STOPPED.has(player)) {
        stopRate(cmds);
        if (now < cmdUntil) return cmds;
        if (!known || Math.abs(err) > o.dead) seek(target + o.seekLead, now, cmds);
        cmds.push({ cmd: 'play' });
        cmdUntil = now + o.cmdHoldMs;
        return cmds;
      }
      if (player !== 'playing' || !known) return cmds; // carregando ou sem posicao
      if (now < holdUntil) return cmds;

      const abs = Math.abs(err);
      if (abs > o.soft) {
        stopRate(cmds);
        seek(target + o.seekLead, now, cmds);
        return cmds;
      }

      if (correcting !== 0) {
        // Velocidade pedida e o player ainda em 1: ele nao aceitou.
        if (rateAskedAt !== null && now - rateAskedAt >= o.rateCheckMs && isNum(input.rate) && input.rate === 1) {
          rateBroken = true;
          stopRate(cmds);
          if (abs > o.brokenSeek) seek(target + o.seekLead, now, cmds);
          return cmds;
        }
        const crossed = Math.sign(err) !== 0 && Math.sign(err) !== correcting;
        if (crossed || abs < o.release) stopRate(cmds);
        return cmds;
      }

      if (abs <= o.dead) return cmds;
      if (rateBroken) {
        if (abs > o.brokenSeek) seek(target + o.seekLead, now, cmds);
        return cmds;
      }
      correcting = err > 0 ? 1 : -1;
      rateAskedAt = now;
      cmds.push({ cmd: 'rate', rate: correcting > 0 ? o.rateUp : o.rateDown });
      return cmds;
    }

    return {
      step,
      reset,
      /** Para diagnostico e testes. */
      state: () => ({ correcting, rateBroken, lastErr, holdUntil }),
    };
  }

  /** Aplica os comandos da deriva num player com a interface do ytplayer
   * (`seek`, `setRate`, `play`, `pause`). */
  function applyCommands(player, cmds) {
    for (const c of cmds) {
      if (c.cmd === 'seek') player.seek(c.to);
      else if (c.cmd === 'rate') player.setRate(c.rate);
      else if (c.cmd === 'play') player.play();
      else if (c.cmd === 'pause') player.pause();
    }
    return cmds;
  }

  /**
   * Liga um player a uma deriva. `desired()` devolve `{ target, want }` (ou
   * null quando nao ha o que tocar); `now()` e o relogio monotonico local.
   * `tick()` e chamado pelo conteudo (timer de 250 ms) e devolve os comandos
   * aplicados, para quem quiser medir.
   */
  function createSync({ player, desired, now, drift }) {
    const d = drift || createDrift();
    return {
      drift: d,
      tick() {
        if (!player || !player.ready) return [];
        const want = desired();
        if (!want) return [];
        return applyCommands(player, d.step({
          target: want.target,
          current: player.currentTime(),
          want: want.want,
          player: player.playerState(),
          rate: player.rate(),
          now: now(),
        }));
      },
      reset: () => d.reset(),
    };
  }

  const api = { DEFAULTS, createDrift, applyCommands, createSync };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaSyncMedia = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
