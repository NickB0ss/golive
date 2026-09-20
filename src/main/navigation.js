'use strict';

/**
 * A pagina de cada janela e fixa. Comparar a URL inteira impede que uma
 * navegacao para outro arquivo local herde o preload da janela atual.
 */
function canNavigateTo(url, allowedUrl) {
  if (typeof url !== 'string' || typeof allowedUrl !== 'string') return false;
  try {
    return new URL(url).href === new URL(allowedUrl).href;
  } catch {
    return false;
  }
}

module.exports = { canNavigateTo };
