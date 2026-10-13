'use strict';

/*
 * Flags do Chromium que a bancada liga. O que e comum ao app vem de
 * src/main/chromiumflags.js (importado, nao copiado). As quatro que o app
 * liga direto no topo de src/main.js (fora do chromiumflags) sao ESPELHADAS
 * aqui; flags.test.js falha se o topo do main.js deixar de conter alguma.
 */

const { aplicarFlagsChromium } = require('../../../src/main/chromiumflags');

/** [switch, valor] ligados no topo de src/main.js. */
const PRODUCTION_TOP_SWITCHES = [
  ['force_high_performance_gpu', ''],
  ['ignore-gpu-blocklist', ''],
  ['disable-background-timer-throttling', ''],
  ['disable-renderer-backgrounding', ''],
];

/** Liga as flags e devolve o que ficou efetivo, pra gravar no relatorio. */
function applyBenchFlags(commandLine, logger) {
  const chromium = aplicarFlagsChromium(commandLine, logger);
  for (const [name, value] of PRODUCTION_TOP_SWITCHES) {
    if (value === '') commandLine.appendSwitch(name);
    else commandLine.appendSwitch(name, value);
  }
  return {
    enableFeatures: commandLine.getSwitchValue('enable-features'),
    disableFeatures: commandLine.getSwitchValue('disable-features'),
    chromiumFlagsValid: chromium.valido,
    topSwitches: PRODUCTION_TOP_SWITCHES.map(([name]) => ({ name, present: commandLine.hasSwitch(name) })),
  };
}

module.exports = { PRODUCTION_TOP_SWITCHES, applyBenchFlags };
