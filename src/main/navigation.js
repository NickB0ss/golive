'use strict';

/**
 * A pagina de cada janela e fixa. Comparar a URL inteira impede que uma
 * navegacao para outro arquivo local herde o preload da janela atual.
 *
 * Vale igual para file:// e para a origem local http://localhost
 * (src/main/origem.js): a URL inteira inclui esquema, host e porta, entao
 * `http://localhost:8080/index.html` ou `http://127.0.0.1/index.html` nao
 * passam por `http://localhost/index.html`.
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
