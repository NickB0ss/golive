'use strict';

/*
 * Executa UM cenario do inicio ao fim e devolve o resultado serializavel.
 * Sempre fecha tudo (finally), inclusive em falha parcial: um cenario que
 * quebra no meio nao deixa PeerConnection, track ou timer vivo pro proximo.
 */
(function (root) {
  const B = root.MediaBench;

  /**
   * @param scenario { key, id, label, config }
   * @param bridge   window.mediaBench (preload)
   * @param extra    { ownedWindow }  tamanho efetivo da janela propria (main)
   */
  async function run(scenario, bridge, extra = {}) {
    const cfg = scenario.config;
    const result = {
      key: scenario.key, id: scenario.id, label: scenario.label, config: cfg,
      status: 'error', error: null, problems: [], notes: [],
      timing: {}, source: null, topology: null, nodes: [], roles: null, raw: {},
    };
    let source = null;
    let topo = null;
    const t0 = Date.now();
    try {
      source = await B.source.create(cfg, { arm: () => bridge.armCapture() });
      result.source = { kind: cfg.source, pipeline: cfg.pipeline, requestedHint: cfg.hint, effectiveHint: source.effectiveHint };
      if (cfg.source === 'owned-window') {
        // Registra o que a captura entregou (nao o pedido) e avisa se divergir.
        const measured = source.measured ? source.measured() : null;
        result.source.requested = { width: cfg.width, height: cfg.height, fps: cfg.fps };
        result.source.measured = measured;
        result.source.ownedWindow = extra.ownedWindow || null;
        result.notes.push(...B.metrics.compareSource(cfg, measured, extra.ownedWindow));
      }
      topo = await B.topology.build(cfg, source.track);
      result.topology = { kind: cfg.topology, viewers: cfg.viewers, rtpSenders: topo.rtpSenders };

      await B.topology.sleep(cfg.warmupMs);
      const sampler = B.sampler.create(topo.nodes, source.stats);
      result.timing.measureStartWall = Date.now();
      await sampler.run(cfg.durationMs, cfg.sampleMs);
      result.timing.measureEndWall = Date.now();

      result.nodes = sampler.series.map((s) => B.metrics.summarizeNode(s));
      result.roles = B.metrics.summarizeRoles(result.nodes);
      result.source.series = sampler.source;
      result.raw = Object.fromEntries(sampler.series.map((s) => [s.label, { role: s.role, samples: s.samples, final: s.raw }]));
      const verdict = B.metrics.evaluateScenario(result.nodes, cfg);
      result.problems = verdict.problems;
      result.notes.push(...verdict.notes);
      result.status = verdict.problems.length ? 'error' : 'ok';
      if (verdict.problems.length) result.error = verdict.problems.join('; ');
    } catch (err) {
      result.error = String(err?.message || err);
      result.status = 'error';
    } finally {
      try { topo?.close(); } catch (err) { result.notes.push(`falha ao fechar topologia: ${err}`); }
      try { source?.stop(); } catch (err) { result.notes.push(`falha ao parar fonte: ${err}`); }
      result.timing.totalMs = Date.now() - t0;
    }
    return result;
  }

  B.scenario = { run };
})(globalThis);
