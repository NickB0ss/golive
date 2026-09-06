// src/renderer/sound.js
'use strict';

(function (root) {
  let audioCtx = null;
  let enabled = true;
  let lastChatSoundAt = 0;
  const CHAT_SOUND_MIN_GAP_MS = 2000;

  function getAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function tone(freqFrom, freqTo, duration, gainPeak) {
    if (!enabled) return;
    const ctx = getAudioContext();
    // O Chromium suspende o AudioContext sempre que a janela do GoLive fica
    // minimizada/oculta -- e e exatamente ai que estes sons importam (chat e
    // "alguem foi live" so tocam com o app em segundo plano). Sem retomar, o
    // relogio de ctx.currentTime nao anda e o oscilador agendado nunca soa.
    // Mesmo remedio que ui.js ja aplica no contexto de playback de tiles.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqFrom, now);
    osc.frequency.linearRampToValueAtTime(freqTo, now + duration);

    gain.gain.setValueAtTime(gainPeak, now);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  function playJoinSound() {
    tone(440, 660, 0.12, 0.15);
  }

  function playLeaveSound() {
    tone(660, 440, 0.12, 0.15);
  }

  // Mensagem nova no chat: dois blips curtos, o som mais discreto do
  // conjunto. So toca com a janela do GoLive fora de foco (se voce esta
  // olhando a coluna, ja viu a mensagem chegar) e no maximo 1x a cada 2s --
  // uma conversa rapida nao pode virar uma rajada de beeps.
  function playChatSound() {
    if (!enabled) return;
    if (document.hasFocus()) return;
    const now = Date.now();
    if (now - lastChatSoundAt < CHAT_SOUND_MIN_GAP_MS) return;
    lastChatSoundAt = now;
    tone(660, 660, 0.05, 0.10);
    setTimeout(() => tone(880, 880, 0.05, 0.10), 70);
  }

  // Alguem comecou a transmitir -- o aviso mais util do conjunto: quinta
  // subindo, pra quem esta de olho no jogo e nao na janela do GoLive.
  function playLiveSound() {
    tone(523, 784, 0.20, 0.15);
  }

  // O dono parou a SUA transmissao -- toca so pro alvo (app.js decide
  // quem chama). A sala ve a linha no chat, sem som.
  function playStoppedSound() {
    tone(587, 392, 0.22, 0.16);
  }

  // Alguem da sala encerrou a propria transmissao -- espelho do playLiveSound
  // (quinta descendo, mais curto e discreto), pra toda a sala. Distinto do
  // playStoppedSound acima, que so o alvo de uma acao de moderacao ouve.
  function playPeerStoppedSound() {
    tone(784, 523, 0.16, 0.13);
  }

  // Voce foi expulso ou banido -- grave e o mais longo do conjunto, porque
  // a tela pode voltar pro lobby sozinha enquanto voce olhava outra coisa.
  function playRemovedSound() {
    tone(440, 220, 0.34, 0.18);
  }

  function setEnabled(value) {
    enabled = Boolean(value);
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.sound = {
    playJoinSound,
    playLeaveSound,
    playChatSound,
    playLiveSound,
    playStoppedSound,
    playPeerStoppedSound,
    playRemovedSound,
    setEnabled,
  };
})(window);
