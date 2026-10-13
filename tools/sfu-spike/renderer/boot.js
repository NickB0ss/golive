'use strict';

/*
 * Pagina da prova de conceito: percorre o plano, cria a cena sintetica, roda
 * a sequencia do cliente (flow.js) e entrega o resultado bruto ao main, que
 * avalia, fecha a SFU e grava o relatorio.
 */
(function (root) {
  const bridge = root.sfuSpike;
  const status = (text) => { const el = root.document.getElementById('status'); if (el) el.textContent = text; };
  const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

  /** Chamada de RPC: desembrulha o envelope do main e lanca erro com `code`. */
  async function rpc(method, params) {
    const res = await bridge.rpc(method, params || {});
    if (!res || res.ok !== true) {
      const err = new Error(`${method}: ${res?.error?.message || 'falha sem detalhe'}`);
      err.code = res?.error?.code || 'UNKNOWN';
      throw err;
    }
    return res.result;
  }

  function attachVideo(track) {
    const video = root.document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = new root.MediaStream([track]);
    root.document.getElementById('viewers').appendChild(video);
    video.play().catch(() => { /* janela escondida pode recusar; o getStats segue valendo */ });
    return { stop() { video.srcObject = null; video.remove(); } };
  }

  async function runOne(scenario) {
    const cfg = scenario.config;
    let scene = null;
    let result;
    try {
      status(`${scenario.key}: iniciando SFU`);
      await bridge.scenarioStart(scenario.key);
      scene = root.MediaBench.scene.create({ width: cfg.width, height: cfg.height, fps: cfg.fps });
      scene.start();
      status(`${scenario.key}: medindo`);
      result = await root.SfuSpike.flow.runScenario({
        rpc,
        clientVersion: root.SfuSpikeClient.version,
        createDevice: () => root.SfuSpikeClient.Device.factory(),
        track: scene.track,
        attachVideo,
        sleep,
        now: () => root.performance.now(),
        wall: () => Date.now(),
        log: (t) => bridge.log(t),
      }, cfg);
      result.scene = scene.stats();
    } catch (err) {
      // Falha antes/fora do fluxo: o cenario ainda e entregue ao main (que fecha a SFU) como falho.
      result = { steps: [], samples: [], error: String(err?.message || err), cleanupErrors: [] };
    } finally {
      if (scene) scene.stop();
    }
    await bridge.scenarioDone({ key: scenario.key, result });
  }

  async function main() {
    try {
      if (!root.SfuSpikeClient) throw new Error('mediasoup-client.bundle.js nao carregou (rode npm run bundle)');
      const plan = await bridge.getPlan();
      for (const scenario of plan.scenarios) await runOne(scenario);
      status('fim');
      await bridge.finish(null);
    } catch (err) {
      status(`erro: ${err?.message || err}`);
      await bridge.finish(String(err?.stack || err?.message || err));
    }
  }

  void main();
})(globalThis);
