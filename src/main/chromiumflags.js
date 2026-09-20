'use strict';

const ENABLED_FEATURES = [
  'WebRtcAllowH264Send',
  'AllowWgcScreenCapturer',
  'AllowWgcWindowCapturer',
  'AllowWgcDesktopCapturer',
];
const DISABLED_FEATURES = ['WebRtcHideLocalIpsWithMdns'];

// Mantem os nomes sensiveis a maiusculas em um lugar testavel, pois o
// Chromium ignora uma feature desconhecida sem avisar que ela foi perdida.
function montarFlagsChromium() {
  const enableFeatures = ENABLED_FEATURES.join(',');
  const disableFeatures = DISABLED_FEATURES.join(',');
  return {
    enableFeatures,
    disableFeatures,
    // Pares (switch, valor) pro appendSwitch. Medido no Electron 44.4.3 com
    // scripts/probe-command-line-case.js: appendSwitch PRESERVA as maiusculas
    // (getSwitchValue devolve a string intacta) e appendArgument nao chega ao
    // getSwitchValue -- devolve vazio, ou seja, as features sumiriam em
    // silencio. O medo registrado na auditoria (36 passa tudo pra minuscula)
    // nao se confirmou nesta versao; a validacao abaixo existe justamente pra
    // avisar caso volte a valer numa versao futura.
    switches: [
      ['enable-features', enableFeatures],
      ['disable-features', disableFeatures],
    ],
  };
}

function aplicarFlagsChromium(commandLine, logger) {
  const flags = montarFlagsChromium();
  for (const [nome, valor] of flags.switches) commandLine.appendSwitch(nome, valor);

  const enableRecebido = commandLine.getSwitchValue('enable-features');
  const disableRecebido = commandLine.getSwitchValue('disable-features');
  let valido = true;
  if (enableRecebido !== flags.enableFeatures) {
    logger.error(`command line enable-features incorreto: esperado=${flags.enableFeatures} recebido=${enableRecebido}`);
    valido = false;
  }
  if (disableRecebido !== flags.disableFeatures) {
    logger.error(`command line disable-features incorreto: esperado=${flags.disableFeatures} recebido=${disableRecebido}`);
    valido = false;
  }
  return { ...flags, valido };
}

module.exports = { montarFlagsChromium, aplicarFlagsChromium };
