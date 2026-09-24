'use strict';

// D6 (analise de 2026-09-23): o desktopCapturer devolve o nome da tela em
// ingles e sem dizer qual e qual ("Entire screen", "Screen 1", "Screen 2").
// Aqui vira "Monitor 1 (principal)", "Monitor 2". Janela mantem o titulo --
// e o que a pessoa reconhece.
//
// Numeracao pela ordem das telas na lista que o Chromium devolveu (a mesma
// do "Screen 1/2" dele). "principal" vem do display_id casado com o display
// principal do sistema; sem casamento, so o numero.

function isScreenId(id) {
  return typeof id === 'string' && id.startsWith('screen:');
}

/** Devolve um nome por fonte, na mesma ordem de `sources`. */
function friendlySourceNames(sources, primaryDisplayId) {
  let screenIndex = 0;
  return sources.map((source) => {
    if (!isScreenId(source?.id)) return source?.name || '';
    screenIndex += 1;
    const principal = primaryDisplayId != null && source.display_id != null && source.display_id !== ''
      && String(source.display_id) === String(primaryDisplayId);
    return `Monitor ${screenIndex}${principal ? ' (principal)' : ''}`;
  });
}

module.exports = { friendlySourceNames };
