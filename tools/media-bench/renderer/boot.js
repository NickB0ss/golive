'use strict';

/*
 * Inicio da pagina da bancada: pede o plano ao main, roda os cenarios em
 * sequencia (um por vez, com intervalo pra liberar encoder/GPU) e avisa o
 * fim. Qualquer excecao fora de cenario vira falha FATAL do conjunto -- o
 * main grava o relatorio parcial e sai com codigo nao-zero.
 */
(async function () {
  const bridge = window.mediaBench;
  const B = window.MediaBench;
  const status = document.getElementById('status');
  const say = (text) => { status.textContent = text; bridge.log(text); };

  window.addEventListener('error', (e) => bridge.log(`erro nao tratado: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => bridge.log(`rejeicao nao tratada: ${e.reason}`));

  try {
    const plan = await bridge.getPlan();
    for (let i = 0; i < plan.scenarios.length; i++) {
      const sc = plan.scenarios[i];
      say(`[${i + 1}/${plan.scenarios.length}] ${sc.key}`);
      await bridge.scenarioStart(sc.key);
      const result = await B.scenario.run(sc, bridge, { ownedWindow: plan.ownedWindow || null });
      await bridge.scenarioDone(result);
      say(`[${i + 1}/${plan.scenarios.length}] ${sc.key}: ${result.status}${result.error ? ` (${result.error})` : ''}`);
      await B.topology.sleep(500);
    }
    await bridge.finish(null);
  } catch (err) {
    await bridge.finish(String(err?.stack || err));
  }
})();
