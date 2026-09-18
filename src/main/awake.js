/*
 * Decide se a sessao justifica prender a maquina acordada
 * (powerSaveBlocker em main.js). Fica de fora do main.js -- que nao tem
 * teste -- porque a regra tem tres entradas e casos de borda (P5 da
 * auditoria 2026-09-18, anexo 5-produto.md).
 *
 * So estar "na sala" nao basta: uma sala parada, com ninguem transmitindo e
 * ninguem assistindo nenhum tile, nao deveria prender a maquina acordada --
 * so quando ha video de verdade correndo (a pessoa transmite ou assiste
 * algo) e que faz sentido brigar com o protetor de tela e a suspensao.
 */

'use strict';

/**
 * @param {{ inRoom: boolean, sharing: boolean, watching: boolean }} state
 * @returns {boolean} true quando a maquina deve ser mantida acordada.
 */
function shouldKeepAwake({ inRoom, sharing, watching }) {
  return Boolean(inRoom) && (Boolean(sharing) || Boolean(watching));
}

module.exports = { shouldKeepAwake };
