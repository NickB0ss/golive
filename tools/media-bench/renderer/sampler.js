'use strict';

/*
 * Coleta periodica de getStats dos nos medidos. Guarda a amostra extraida
 * (readSender/readReceiver) de cada tick e, no fim, o relatorio bruto
 * FILTRADO do ultimo tick (so os tipos que explicam encode/decode/transporte),
 * suficiente pra auditar os numeros depois.
 */
(function (root) {
  const M = root.MediaBench.metrics;
  const RAW_TYPES = new Set([
    'outbound-rtp', 'inbound-rtp', 'codec', 'media-source', 'transport', 'candidate-pair',
    'local-candidate', 'remote-candidate', 'remote-inbound-rtp',
  ]);

  const plain = (s) => JSON.parse(JSON.stringify(s));

  function filterRaw(report) {
    return M.toArray(report).filter((s) => RAW_TYPES.has(s.type)).map(plain);
  }

  /**
   * @param nodes [{ role, label, kind, pc }]
   * @param sourceStats () => objeto livre da fonte (quadros desenhados etc.)
   */
  function create(nodes, sourceStats) {
    const series = nodes.map((n) => ({ role: n.role, label: n.label, kind: n.kind, samples: [], raw: null }));
    const source = [];

    async function tick() {
      const atMs = performance.now();
      source.push({ atMs, ...sourceStats() });
      await Promise.all(nodes.map(async (n, i) => {
        const report = await n.pc.getStats();
        const sample = n.kind === 'sender' ? M.readSender(report) : M.readReceiver(report);
        series[i].samples.push({ atMs, sample });
        series[i].raw = filterRaw(report);
      }));
    }

    /** Roda `tick` a cada `sampleMs` por `durationMs` (inclui o tick inicial e o final). */
    async function run(durationMs, sampleMs, shouldStop = () => false) {
      const start = performance.now();
      await tick();
      while (performance.now() - start < durationMs && !shouldStop()) {
        const wait = Math.max(0, sampleMs - ((performance.now() - start) % sampleMs));
        await new Promise((r) => { setTimeout(r, wait); });
        await tick();
      }
    }

    return { tick, run, series, source };
  }

  root.MediaBench.sampler = { create, filterRaw };
})(globalThis);
