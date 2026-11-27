/*
 * Prazo pra uma espera que pode nunca terminar. Logica pura, sem electron --
 * por isso fica separada de main.js, que o node:test nao importa.
 *
 * Usado no fechamento do servidor embutido: o `close()` dele espera as
 * conexoes TCP acabarem, e o `app.quit()` (ou o proximo "Criar sala") nao pode
 * ficar atras de um par mudo (auditoria 2026-11-25, M-01).
 */

'use strict';

/** Valor devolvido por `comPrazo` quando o prazo estoura antes da promessa. */
const PRAZO_ESGOTADO = Symbol('prazo-esgotado');

/**
 * Espera `promessa` por no maximo `ms`. Se ela resolver antes, devolve o valor
 * dela; se rejeitar antes, rejeita igual; se o prazo estourar, devolve
 * `PRAZO_ESGOTADO` (a promessa original segue e seu resultado e descartado).
 * @template T
 * @param {Promise<T> | T} promessa
 * @param {number} ms
 * @returns {Promise<T | typeof PRAZO_ESGOTADO>}
 */
function comPrazo(promessa, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(PRAZO_ESGOTADO), ms);
    Promise.resolve(promessa).then(
      (valor) => {
        clearTimeout(timer);
        resolve(valor);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

module.exports = { comPrazo, PRAZO_ESGOTADO };
