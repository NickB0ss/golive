// src/renderer/sound.js
'use strict';

(function (root) {
  let audioCtx = null;
  let enabled = true;
  let lastChatSoundAt = 0;
  const recent = [];
  const RECENT_LIMIT = 20;
  const soundevents = root.GoLive.soundevents;

  function getAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function remember(name, status, reason) {
    const entry = { at: Date.now(), name, status, reason };
    recent.push(entry);
    if (recent.length > RECENT_LIMIT) recent.shift();
    const text = status === 'tocou'
      ? `[som] ${name}: tocou (contexto=${reason})`
      : `[som] ${name}: ${status} (${reason})`;
    console.log(text);
    return entry;
  }

  function waitForResume(ctx) {
    return Promise.race([
      ctx.resume(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('contexto nao retomou em 1s')), 1000);
      }),
    ]);
  }

  function tone(ctx, freqFrom, freqTo, duration, gainPeak, offset = 0) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime + offset;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqFrom, now);
    osc.frequency.linearRampToValueAtTime(freqTo, now + duration);

    gain.gain.setValueAtTime(gainPeak, now);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  const TONES = {
    entrou: [[440, 660, 0.12, 0.15]],
    saiu: [[660, 440, 0.12, 0.15]],
    chat: [[660, 660, 0.05, 0.10], [880, 880, 0.05, 0.10, 0.07]],
    'ao vivo': [[523, 784, 0.20, 0.15]],
    parou: [[784, 523, 0.16, 0.13]],
    interrompido: [[587, 392, 0.22, 0.16]],
    removido: [[440, 220, 0.34, 0.18]],
  };

  async function play(name, options = {}) {
    const now = Date.now();
    const decision = soundevents.shouldPlay(name, {
      enabled,
      hasFocus: options.ignoreChatFocus ? false : document.hasFocus(),
      now,
      lastChatAt: lastChatSoundAt,
    });
    if (!decision.play) return remember(name, 'pulado', decision.reason);
    // Marca antes do await: duas mensagens que chegam no mesmo tick nao podem
    // atravessar juntas o limite enquanto o contexto esta sendo retomado.
    if (name === 'chat') lastChatSoundAt = now;

    let ctx;
    try {
      ctx = getAudioContext();
      // O Chromium suspende o AudioContext com a janela oculta. So criar os
      // osciladores depois de confirmar running evita registrar um som que
      // ficou preso num relogio parado.
      if (ctx.state === 'suspended') await waitForResume(ctx);
      if (ctx.state !== 'running') return remember(name, 'NAO tocou', `contexto=${ctx.state}`);
      const tones = TONES[name];
      if (!tones) return remember(name, 'NAO tocou', 'som desconhecido');
      const startOffset = options.offset || 0;
      tones.forEach(([from, to, duration, peak, offset]) => tone(ctx, from, to, duration, peak, startOffset + (offset || 0)));
      return remember(name, 'tocou', 'running');
    } catch (err) {
      return remember(name, 'NAO tocou', err?.message || 'falha no AudioContext');
    }
  }

  // Mantem as entradas antigas para que os gatilhos nao precisem conhecer
  // os detalhes de cada tom.
  function playLeaveSound() {
    return play('saiu');
  }

  // Mensagem nova no chat: dois blips curtos, o som mais discreto do
  // conjunto. So toca com a janela do GoLive fora de foco (se voce esta
  // olhando a coluna, ja viu a mensagem chegar) e no maximo 1x a cada 2s --
  // uma conversa rapida nao pode virar uma rajada de beeps.
  function playChatSound() {
    return play('chat');
  }

  // Alguem comecou a transmitir -- o aviso mais util do conjunto: quinta
  // subindo, pra quem esta de olho no jogo e nao na janela do GoLive.
  function playLiveSound() {
    return play('ao vivo');
  }

  // O dono parou a SUA transmissao -- toca so pro alvo (app.js decide
  // quem chama). A sala ve a linha no chat, sem som.
  function playStoppedSound() {
    return play('interrompido');
  }

  // Alguem da sala encerrou a propria transmissao -- espelho do playLiveSound
  // (quinta descendo, mais curto e discreto), pra toda a sala. Distinto do
  // playStoppedSound acima, que so o alvo de uma acao de moderacao ouve.
  function playPeerStoppedSound() {
    return play('parou');
  }

  // Voce foi expulso ou banido -- grave e o mais longo do conjunto, porque
  // a tela pode voltar pro lobby sozinha enquanto voce olhava outra coisa.
  function playRemovedSound() {
    return play('removido');
  }

  function playJoinSound() {
    return play('entrou');
  }

  // A sequencia de teste compartilha o mesmo relogio de audio: a janela pode
  // demorar para repintar, mas os tons nao ficam dependentes desse atraso.
  async function playSequence(names, options = {}) {
    const gap = options.gap || 0.45;
    let offset = 0;
    const entries = [];
    for (const name of names) {
      entries.push(await play(name, { ...options, offset }));
      offset += gap;
    }
    return { entries, durationMs: Math.ceil(offset * 1000) };
  }

  function setEnabled(value) {
    enabled = Boolean(value);
  }

  function getRecent() {
    return recent.slice();
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
    play,
    playSequence,
    setEnabled,
    getRecent,
  };
})(window);
