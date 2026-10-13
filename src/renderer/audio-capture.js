'use strict';

(function (root) {
  function unwrapEnumeration(result) {
    if (!result?.ok || !Array.isArray(result.items)) {
      throw new Error(result?.error || 'enumeration-unavailable');
    }
    return result.items;
  }

  function pidTreeSet(rootPid, processes) {
    const result = new Set(rootPid ? [rootPid] : []);
    const queue = [...result];
    const children = new Map();
    for (const process of processes) {
      if (!children.has(process.ppid)) children.set(process.ppid, []);
      children.get(process.ppid).push(process.pid);
    }
    while (queue.length) {
      for (const pid of children.get(queue.shift()) || []) {
        if (result.has(pid)) continue;
        result.add(pid);
        queue.push(pid);
      }
    }
    return result;
  }

  // A ativacao IPC nao pode ser abortada pelo renderer. Mesmo apos o abort,
  // aguardamos o captureId e o devolvemos ao main antes de criar qualquer no.
  async function startNativeNode({ api, pid, exclude, signal, isCurrent = () => true, createNode,
    register = () => {}, unregister = () => {} }) {
    const usable = () => !signal?.aborted && isCurrent();
    if (!usable()) return null;
    let node = null;
    let stopped = false;
    let captureId = null;
    let terminalFailure = null;
    const earlyFailures = new Map();
    const listeners = new Set();
    // O evento pode atravessar o IPC antes da resposta de startCapture.
    const unsubscribe = api.onProcessAudioEnded?.((id, message) => {
      if (stopped) return;
      if (captureId === null) { earlyFailures.set(id, message); return; }
      if (id !== captureId) return;
      terminalFailure = message || 'capture-ended';
      const callbacks = [...listeners];
      stop();
      for (const callback of callbacks) callback(terminalFailure);
    });
    const stop = () => {
      if (stopped) return;
      stopped = true;
      unsubscribe?.();
      earlyFailures.clear();
      listeners.clear();
      if (captureId === null) return;
      void unregister(captureId);
      if (node) {
        node.port.onmessage = null;
        try { node.disconnect(); } catch { /* ja desconectado */ }
        node.port.close?.();
      }
      // Falha de parada continua observavel, sem rejeicao solta no teardown.
      void Promise.resolve(api.stopProcessAudioCapture(captureId)).catch((error) => {
        console.warn('[audio] parada nativa falhou:', error);
      });
    };
    let result;
    try {
      result = await api.startProcessAudioCapture(pid, exclude);
    } catch (error) {
      void stop();
      throw error;
    }
    if (!result?.ok) { void stop(); return null; }
    captureId = result.captureId;
    if (earlyFailures.has(captureId)) { void stop(); return null; }
    earlyFailures.clear();
    if (!usable()) { void stop(); return null; }
    try {
      node = createNode(captureId);
      void register(captureId, node);
      return { node, stop, onEnded(callback) {
        if (terminalFailure) { callback(terminalFailure); return () => {}; }
        if (!stopped) listeners.add(callback);
        return () => listeners.delete(callback);
      } };
    } catch (error) {
      void stop();
      throw error;
    }
  }

  // Adaptadores ficam fora deste modulo: Web Audio, IPC e relogio sao
  // injetados. Active significa ativacao aceita, nunca som audivel confirmado.
  function create(options) {
    const strategy = options.strategy;
    const controller = new AbortController();
    const captures = new Map();
    const failures = new Map();
    let graph = null;
    let stopped = false;
    let timer = null;
    let refreshPromise = null;
    let state = { status: 'none', track: null, issues: [], activeCount: 0, mode: strategy.mode };
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    const usable = () => !stopped && !options.signal?.aborted && (options.isCurrent?.() ?? true);
    function publish(status, issues = []) {
      state = { status, track: graph?.track || null, issues, activeCount: captures.size, mode: strategy.mode };
      options.onState?.(state);
      return state;
    }
    function clearCaptures() {
      const previous = [...captures.values()];
      captures.clear();
      for (const capture of previous) capture.stop();
    }
    function disposeGraph() {
      graph?.stop();
      graph = null;
    }
    function stop() {
      if (stopped) return;
      stopped = true;
      controller.abort();
      options.signal?.removeEventListener('abort', stop);
      clearTimer(timer);
      timer = null;
      clearCaptures();
      disposeGraph();
      publish('cancelled');
    }
    function continueOrStop() {
      if (usable()) return true;
      stop();
      return false;
    }
    function publishCaptureHealth() {
      if (!captures.size && strategy.mode === 'process') disposeGraph();
      return publish(captures.size ? (failures.size ? 'partial' : 'active') : 'unavailable',
        [...new Set(failures.values())]);
    }
    function ended(pid, capture) {
      if (!continueOrStop() || captures.get(pid) !== capture) return;
      captures.delete(pid);
      capture.stop();
      failures.set(pid, strategy.mode === 'include-list' ? 'process-refused'
        : pid === strategy.basePid ? 'base-failed' : 'discord-refused');
      publishCaptureHealth();
    }
    async function addProcess(pid, exclude) {
      if (!continueOrStop()) return false;
      const capture = await options.startProcess(pid, exclude, controller.signal);
      if (!continueOrStop()) { capture?.stop(); return false; }
      if (!capture || !graph) { capture?.stop(); return false; }
      try {
        captures.set(pid, capture);
        failures.delete(pid);
        capture.onEnded?.(() => ended(pid, capture));
        if (captures.get(pid) !== capture) return false;
        graph.connect(capture);
        return true;
      } catch (error) {
        captures.delete(pid);
        capture.stop();
        throw error;
      }
    }
    function scheduleRefresh() {
      if (!usable()) return;
      timer = setTimer(() => {
        timer = null;
        void refresh().then(scheduleRefresh).catch((error) => {
          console.warn('[audio] varredura falhou:', error);
          scheduleRefresh();
        });
      }, options.pollMs || 5000);
    }
    async function scan() {
      if (!continueOrStop()) return state;
      let snapshot;
      try {
        snapshot = await options.enumerate();
        if (!continueOrStop()) return state;
        if (!snapshot.ownPid || !Array.isArray(snapshot.renderPids) || !Array.isArray(snapshot.processes)) {
          throw new Error('enumeration-unavailable');
        }
      } catch (error) {
        if (!continueOrStop()) return state;
        // Sem um snapshot valido, nao podemos garantir as exclusoes.
        clearCaptures();
        return publish('unavailable', ['enumeration-failed']);
      }
      const { renderPids, processes, ownPid } = snapshot;
      const excluded = pidTreeSet(ownPid, processes);
      for (const process of processes) {
        if (!/^discord.*\.exe$/i.test(process.name || '')) continue;
        for (const pid of pidTreeSet(process.pid, processes)) excluded.add(pid);
      }
      // PID que ja morreu entre as duas enumeracoes nao pode ser ativado.
      const present = new Set(processes.map((process) => process.pid));
      const wanted = new Set(renderPids.filter((pid) => pid && present.has(pid) && !excluded.has(pid)));
      for (const pid of failures.keys()) {
        if (!wanted.has(pid)) failures.delete(pid);
      }
      for (const [pid, capture] of captures) {
        if (wanted.has(pid)) continue;
        captures.delete(pid);
        capture.stop();
      }
      let refused = 0;
      for (const pid of wanted) {
        if (captures.has(pid)) continue;
        try {
          if (!await addProcess(pid, false)) refused += 1;
        } catch { refused += 1; }
        if (!continueOrStop()) return state;
      }
      if (refused) return publish(captures.size ? 'partial' : 'unavailable', ['process-refused']);
      if (failures.size) return publishCaptureHealth();
      return publish(captures.size ? 'active' : 'pending');
    }
    function refresh() {
      if (refreshPromise) return refreshPromise;
      refreshPromise = scan().finally(() => { refreshPromise = null; });
      return refreshPromise;
    }
    async function begin() {
      if (!continueOrStop()) return state;
      if (strategy.mode === 'none') {
        return publish(strategy.audioUnavailable ? 'unavailable' : 'none',
          strategy.audioUnavailable ? ['base-refused'] : []);
      }
      if (strategy.mode === 'system-loopback') {
        const track = options.loopbackTrack;
        if (!track || track.readyState === 'ended') return publish('unavailable', ['base-refused']);
        graph = { track, stop: () => track.stop() };
        return publish('active');
      }
      try {
        graph = await options.prepareGraph();
        if (!continueOrStop()) { disposeGraph(); return state; }
        if (!graph?.track || graph.track.readyState === 'ended') throw new Error('output-track-unavailable');
        if (strategy.mode === 'include-list') {
          // Addon carregado nao prova suporte. O probe da propria arvore e
          // desconectado: confirma ativacao sem entrar na mistura publicada.
          if (strategy.probePid) {
            const probe = await options.startProcess(strategy.probePid, false, controller.signal);
            probe?.stop();
            if (!continueOrStop()) return state;
            if (!probe) {
              disposeGraph();
              return publish('unavailable', ['base-refused']);
            }
          }
          await refresh();
          if (!continueOrStop()) return state;
          if (state.status === 'unavailable') {
            disposeGraph();
            return publish('unavailable', state.issues);
          }
          scheduleRefresh();
          return state;
        }
        if (!await addProcess(strategy.basePid, strategy.baseExclude)) {
          if (!continueOrStop()) return state;
          disposeGraph();
          return publish('unavailable', ['base-refused']);
        }
        let discordPid = options.discordPid || 0;
        try {
          if (options.resolveDiscordPid) discordPid = await options.resolveDiscordPid();
          if (!continueOrStop()) return state;
          if (discordPid && discordPid !== strategy.basePid && !await addProcess(discordPid, false)) {
            if (!continueOrStop()) return state;
            failures.set(discordPid, 'discord-refused');
            return publishCaptureHealth();
          }
        } catch {
          if (!continueOrStop()) return state;
          failures.set(discordPid, 'discord-refused');
          return publishCaptureHealth();
        }
        return publishCaptureHealth();
      } catch (error) {
        if (!continueOrStop()) return state;
        clearCaptures();
        disposeGraph();
        return publish('unavailable', ['base-refused']);
      }
    }
    options.signal?.addEventListener('abort', stop, { once: true });
    const ready = begin();
    return { ready, stop, refresh, get state() { return state; } };
  }
  const api = { create, startNativeNode, unwrapEnumeration, pidTreeSet };
  root.GoLive = root.GoLive || {};
  root.GoLive.audioCapture = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
