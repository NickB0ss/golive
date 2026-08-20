// src/renderer/sound.js
'use strict';

(function (root) {
  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freqFrom, freqTo) {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const duration = 0.12;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqFrom, now);
    osc.frequency.linearRampToValueAtTime(freqTo, now + duration);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  function playJoinSound() {
    playTone(440, 660);
  }

  function playLeaveSound() {
    playTone(660, 440);
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.sound = { playJoinSound, playLeaveSound };
})(window);
